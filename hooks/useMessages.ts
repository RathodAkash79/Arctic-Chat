'use client';

import { useEffect, useCallback, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/useAppStore';
import { encryptMessage, decryptMessage, hasPassphrase } from '@/lib/crypto';
import type { Message, MentionedUser } from '@/types';

const PAGE_SIZE = 30;

export function useMessages() {
    const {
        currentUser,
        currentChat,
        messages,
        setMessages,
        addMessage,
        prependMessages,
        setTypingUsers,
        updateChatLastMessage,
    } = useAppStore();

    const [loadingMessages, setLoadingMessages] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [sendingMessage, setSendingMessage] = useState(false);
    const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
    const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

    // Decrypt a batch of messages
    const decryptBatch = useCallback(async (msgs: Message[]): Promise<Message[]> => {
        if (!hasPassphrase()) return msgs;
        return Promise.all(
            msgs.map(async (msg) => ({
                ...msg,
                text: await decryptMessage(msg.text),
            }))
        );
    }, []);

    // Fetch latest messages for current chat
    const fetchMessages = useCallback(
        async (chatId: string) => {
            setLoadingMessages(true);
            setHasMore(true);

            const { data, error } = await supabase
                .from('messages')
                .select('*')
                .eq('chat_id', chatId)
                .order('created_at', { ascending: false })
                .limit(PAGE_SIZE);

            if (error) {
                console.error('Failed to fetch messages:', error);
                setLoadingMessages(false);
                return;
            }

            const raw = (data || []).reverse() as Message[];
            const decrypted = await decryptBatch(raw);
            setMessages(decrypted);
            setHasMore(raw.length >= PAGE_SIZE);
            setLoadingMessages(false);
        },
        [setMessages, decryptBatch]
    );

    // Load older messages (pagination)
    const loadMore = useCallback(async () => {
        if (!currentChat || !hasMore || loadingMessages) return;

        const oldestMessage = messages[0];
        if (!oldestMessage) return;

        setLoadingMessages(true);

        const { data, error } = await supabase
            .from('messages')
            .select('*')
            .eq('chat_id', currentChat.id)
            .lt('created_at', oldestMessage.created_at)
            .order('created_at', { ascending: false })
            .limit(PAGE_SIZE);

        if (error) {
            setLoadingMessages(false);
            return;
        }

        const older = (data || []).reverse() as Message[];
        const decrypted = await decryptBatch(older);
        prependMessages(decrypted);
        setHasMore(older.length >= PAGE_SIZE);
        setLoadingMessages(false);
    }, [currentChat, hasMore, loadingMessages, messages, prependMessages, decryptBatch]);

    // Send a message (text and/or media)
    const sendMessage = useCallback(
        async (
            text: string,
            mediaUrl?: string,
            replyToId?: string,
            isDisappearing?: boolean,
            mentions?: MentionedUser[]
        ) => {
            if (!currentUser || !currentChat) return;
            if (!text.trim() && !mediaUrl) return;

            setSendingMessage(true);

            const msgId = typeof crypto !== 'undefined' && crypto.randomUUID
                ? crypto.randomUUID()
                : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
                    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
                    return v.toString(16);
                });

            const now = new Date().toISOString();

            // Optimistic UI update immediately (plaintext)
            const optimisticMsg: Message = {
                id: msgId,
                chat_id: currentChat.id,
                sender_id: currentUser.id,
                text: text || '',
                media_url: mediaUrl || undefined,
                is_compressed: !!mediaUrl,
                is_disappearing: isDisappearing || false,
                expires_at: isDisappearing ? new Date(Date.now() + 86400000).toISOString() : undefined,
                mentions: mentions || [],
                created_at: now,
                is_pending: true,  // show sending indicator
                ...(replyToId ? { reply_to_id: replyToId } : {}),
            };
            addMessage(optimisticMsg);

            // Optimistic chat list update
            updateChatLastMessage(
                currentChat.id,
                text || (mediaUrl ? '[Media attached]' : 'New message'),
                now
            );

            // Encrypt the text before storing
            let encryptedText = '';
            if (text.trim()) {
                try {
                    encryptedText = await encryptMessage(text.trim());
                } catch (err) {
                    console.error('Encryption error:', err);
                    encryptedText = text.trim(); // fallback plaintext
                }
            }

            if (text.trim() && !hasPassphrase()) {
                console.warn('No passphrase set — message sent as plaintext.');
            }

            const payload: Record<string, unknown> = {
                id: msgId,
                chat_id: currentChat.id,
                sender_id: currentUser.id,
                text: encryptedText || (mediaUrl ? '[Media]' : ''),
                created_at: now,
                // Only include these columns if they have values (they may not exist if patches aren't run)
                ...(mentions && mentions.length > 0 ? { mentions } : {}),
                ...(replyToId ? { reply_to_id: replyToId } : {}),
            };

            if (mediaUrl) {
                payload.media_url = mediaUrl;
                payload.is_compressed = true;
                payload.is_disappearing = isDisappearing || false;
                if (isDisappearing) {
                    payload.expires_at = new Date(Date.now() + 86400000).toISOString();
                }
            }

            // Fire and forget — but log properly
            const sendToDB = async () => {
                try {
                    const { error } = await supabase.from('messages').insert(payload);
                    if (error) {
                        console.error('Failed to send message:', error.message, error.code, error.details, error.hint);
                    } else {
                        // Clear the sending indicator — Realtime may also do this via upsert
                        useAppStore.setState((s) => ({
                            messages: s.messages.map((m) =>
                                m.id === msgId ? { ...m, is_pending: false } : m
                            ),
                        }));
                    }
                } catch (err: unknown) {
                    console.error('Send network error:', err);
                } finally {
                    setSendingMessage(false);
                }
            };
            sendToDB();
        },
        [currentUser, currentChat, addMessage, updateChatLastMessage]
    );

    // Fetch messages when chat changes
    useEffect(() => {
        if (!currentChat) {
            setMessages([]);
            return;
        }
        fetchMessages(currentChat.id);
    }, [currentChat?.id, fetchMessages, setMessages]);

    // Realtime subscription for new messages
    useEffect(() => {
        if (!currentChat) return;

        if (channelRef.current) {
            supabase.removeChannel(channelRef.current);
        }

        const channel = supabase
            .channel(`messages-${currentChat.id}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'messages',
                    filter: `chat_id=eq.${currentChat.id}`,
                },
                async (payload) => {
                    const newMsg = payload.new as Message;
                    // Skip own optimistic message (already in store)
                    if (newMsg.sender_id === useAppStore.getState().currentUser?.id) return;
                    if (hasPassphrase()) {
                        newMsg.text = await decryptMessage(newMsg.text);
                    }
                    addMessage(newMsg);
                }
            )
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'messages',
                    filter: `chat_id=eq.${currentChat.id}`,
                },
                async (payload) => {
                    const updated = payload.new as Message;
                    if (hasPassphrase() && updated.text && !updated.is_deleted) {
                        updated.text = await decryptMessage(updated.text);
                    }
                    useAppStore.setState((s) => ({
                        messages: s.messages.map((m) => m.id === updated.id ? { ...m, ...updated } : m),
                    }));
                }
            )
            .subscribe();

        channelRef.current = channel;

        if (typingChannelRef.current) {
            supabase.removeChannel(typingChannelRef.current);
        }

        let typingUsersList: string[] = [];

        const typingChannel = supabase
            .channel(`typing-${currentChat.id}`)
            .on('broadcast', { event: 'typing' }, (payload) => {
                const { user_id, is_typing } = payload.payload;
                if (is_typing) {
                    if (!typingUsersList.includes(user_id)) {
                        typingUsersList = [...typingUsersList, user_id];
                    }
                } else {
                    typingUsersList = typingUsersList.filter(id => id !== user_id);
                }
                setTypingUsers(currentChat.id, typingUsersList);
            })
            .subscribe();

        typingChannelRef.current = typingChannel;

        return () => {
            if (channelRef.current) {
                supabase.removeChannel(channelRef.current);
                channelRef.current = null;
            }
            if (typingChannelRef.current) {
                supabase.removeChannel(typingChannelRef.current);
                typingChannelRef.current = null;
            }
            setTypingUsers(currentChat.id, []);
        };
    }, [currentChat?.id, addMessage, setTypingUsers]);

    // Broadcast typing state
    const sendTypingEvent = useCallback(async (isTyping: boolean) => {
        if (!typingChannelRef.current || !currentUser) return;
        await typingChannelRef.current.send({
            type: 'broadcast',
            event: 'typing',
            payload: { user_id: currentUser.id, is_typing: isTyping }
        });
    }, [currentUser]);

    return {
        messages,
        loadingMessages,
        hasMore,
        sendingMessage,
        loadMore,
        sendMessage,
        sendTypingEvent,
    };
}
