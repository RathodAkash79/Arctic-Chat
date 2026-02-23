'use client';

import { useEffect, useCallback, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/useAppStore';
import { encryptMessage, decryptMessage, hasPassphrase } from '@/lib/crypto';
import type { Message } from '@/types';

const PAGE_SIZE = 30;

export function useMessages() {
    const {
        currentUser,
        currentChat,
        messages,
        setMessages,
        addMessage,
        prependMessages,
    } = useAppStore();

    const [loadingMessages, setLoadingMessages] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [sendingMessage, setSendingMessage] = useState(false);
    const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

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

        // We need to compare against the original created_at from the database
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
        async (text: string, mediaUrl?: string, isDisappearing?: boolean) => {
            if (!currentUser || !currentChat) return;
            if (!text.trim() && !mediaUrl) return;

            setSendingMessage(true);

            // 1. Pre-generate UUID for optimistic update & deduplication
            // Fallback for mobile HTTP testing where crypto.randomUUID is undefined
            const msgId = typeof crypto !== 'undefined' && crypto.randomUUID
                ? crypto.randomUUID()
                : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
                    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
                    return v.toString(16);
                });

            const now = new Date().toISOString();

            // 2. Optimistic UI update immediately
            const optimisticMsg: Message = {
                id: msgId,
                chat_id: currentChat.id,
                sender_id: currentUser.id,
                text: text || '', // Display plaintext immediately
                media_url: mediaUrl || undefined,
                is_compressed: !!mediaUrl,
                is_disappearing: isDisappearing || false,
                expires_at: isDisappearing ? new Date(Date.now() + 86400000).toISOString() : undefined,
                created_at: now,
            };
            addMessage(optimisticMsg);

            // 3. Encrypt the text (if passphrase set)
            // We await this because it's local and very fast
            let encryptedText = '';
            if (text.trim()) {
                try {
                    encryptedText = await encryptMessage(text.trim());
                } catch (err) {
                    console.error('Encryption error:', err);
                }
            }

            if (text.trim() && !hasPassphrase()) {
                console.warn('Sending message as plaintext because no E2EE passphrase is set!');
            }

            const payload: Record<string, unknown> = {
                id: msgId,
                chat_id: currentChat.id,
                sender_id: currentUser.id,
                text: encryptedText || (mediaUrl ? '[Media]' : ''),
                created_at: now,
            };

            if (mediaUrl) {
                payload.media_url = mediaUrl;
                payload.is_compressed = true;
                payload.is_disappearing = isDisappearing || false;

                if (isDisappearing) {
                    payload.expires_at = new Date(Date.now() + 86400000).toISOString();
                }
            }

            // UNBLOCK UI IMMEDIATELY
            setSendingMessage(false);

            // 4. Send to Supabase (Fire and forget network request)
            const sendToDB = async () => {
                try {
                    const { error } = await supabase.from('messages').insert(payload);
                    if (error) {
                        console.error('Failed to send message:', error);
                    }
                } catch (err: any) {
                    console.error('Send network error:', err);
                }
            };
            sendToDB();
        },
        [currentUser, currentChat, addMessage]
    );

    // Fetch messages when chat changes
    useEffect(() => {
        if (!currentChat) {
            setMessages([]);
            return;
        }

        fetchMessages(currentChat.id);
    }, [currentChat?.id, fetchMessages, setMessages]);

    // Realtime subscription for new messages in the active chat
    useEffect(() => {
        if (!currentChat) return;

        // Clean up previous channel
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
                    // Decrypt the incoming message
                    if (hasPassphrase()) {
                        newMsg.text = await decryptMessage(newMsg.text);
                    }
                    addMessage(newMsg);
                }
            )
            .subscribe();

        channelRef.current = channel;

        return () => {
            if (channelRef.current) {
                supabase.removeChannel(channelRef.current);
                channelRef.current = null;
            }
        };
    }, [currentChat?.id, addMessage]);

    return {
        messages,
        loadingMessages,
        hasMore,
        sendingMessage,
        loadMore,
        sendMessage,
    };
}
