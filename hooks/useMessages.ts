'use client';

import { useEffect, useCallback, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/useAppStore';
import { encryptMessage, decryptMessage, hasPassphrase } from '@/lib/crypto';
import type { Message, MentionedUser } from '@/types';

const PAGE_SIZE = 30;
const SEND_TIMEOUT = 15000;  // 15s — generous for post-tab-switch when connections need revival
const FETCH_TIMEOUT = 12000; // 12s — generous for initial load and post-tab-switch

// ── Promise timeout helper (accepts PromiseLike for Supabase query builders) ──
function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
    return Promise.race([
        Promise.resolve(promise),
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
        ),
    ]);
}

// ── Offline Queue Management ─────────────────────────────────────────
interface OfflineMessage {
    optimistic: Message;
    payload: any;
}

function getOfflineQueue(userId: string): OfflineMessage[] {
    if (typeof window === 'undefined') return [];
    try {
        const data = localStorage.getItem(`offline_messages_${userId}`);
        return data ? JSON.parse(data) : [];
    } catch { return []; }
}

function saveToOfflineQueue(userId: string, item: OfflineMessage) {
    if (typeof window === 'undefined') return;
    const q = getOfflineQueue(userId);
    q.push(item);
    localStorage.setItem(`offline_messages_${userId}`, JSON.stringify(q));
}

function removeFromOfflineQueue(userId: string, msgId: string) {
    if (typeof window === 'undefined') return;
    const q = getOfflineQueue(userId);
    const nq = q.filter(i => i.optimistic.id !== msgId);
    localStorage.setItem(`offline_messages_${userId}`, JSON.stringify(nq));
}

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
    const [fetchError, setFetchError] = useState(false);
    const [reconnectCount, setReconnectCount] = useState(0);
    const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
    const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
    const channelHealthy = useRef(true);
    // Guard: track which chatId we are currently fetching for
    const fetchingForChatId = useRef<string | null>(null);

    // ── Decrypt a batch of messages ─────────────────────────────────
    const decryptBatch = useCallback(async (msgs: Message[]): Promise<Message[]> => {
        if (!hasPassphrase()) return msgs;
        return Promise.all(
            msgs.map(async (msg) => ({
                ...msg,
                text: await decryptMessage(msg.text),
            }))
        );
    }, []);

    // ── Fetch latest messages for current chat (with 7s timeout) ────
    const fetchMessages = useCallback(
        async (chatId: string) => {
            fetchingForChatId.current = chatId;
            // Clear immediately so previous chat's messages never show in new chat
            setMessages([]);
            setLoadingMessages(true);
            setHasMore(true);
            setFetchError(false);

            try {
                const { data, error } = await withTimeout(
                    Promise.resolve(
                        supabase
                            .from('messages')
                            .select('*')
                            .eq('chat_id', chatId)
                            .order('created_at', { ascending: false })
                            .limit(PAGE_SIZE)
                    ),
                    FETCH_TIMEOUT
                );

                // If chat changed while we were fetching, discard stale results
                if (fetchingForChatId.current !== chatId) return;

                if (error) {
                    console.error('Failed to fetch messages:', error);
                    setLoadingMessages(false);
                    setFetchError(true);
                    return;
                }

                const raw = (data || []).reverse() as Message[];
                const decrypted = await decryptBatch(raw);

                // Final guard after async decrypt
                if (fetchingForChatId.current !== chatId) return;

                // Inject offline queue
                const offlineQ = getOfflineQueue(useAppStore.getState().currentUser?.id || '').filter(i => i.optimistic.chat_id === chatId);
                const offlineMsgs = offlineQ.map(i => ({ ...i.optimistic, is_pending: false, is_failed: true }));

                // Avoid duplicating messages that might have actually sent but stayed in the queue due to a race condition
                const existingIds = new Set(decrypted.map(m => m.id));
                const uniqueOffline = offlineMsgs.filter(m => !existingIds.has(m.id));

                setMessages([...decrypted, ...uniqueOffline]);
                setHasMore(raw.length >= PAGE_SIZE);
                setLoadingMessages(false);
                setFetchError(false);
            } catch (err) {
                console.error('Fetch messages timeout/error:', err);
                if (fetchingForChatId.current !== chatId) return;
                setLoadingMessages(false);
                setFetchError(true);
            }
        },
        [setMessages, decryptBatch]
    );

    // ── Process Offline Queue ───────────────────────────────────────
    const processOfflineQueue = useCallback(async () => {
        const user = useAppStore.getState().currentUser;
        if (!user) return;

        const q = getOfflineQueue(user.id);
        if (!q.length) return;

        for (const item of q) {
            try {
                // Optimistically change to pending if in current view
                useAppStore.setState(s => ({
                    messages: s.messages.map(m =>
                        m.id === item.optimistic.id ? { ...m, is_pending: true, is_failed: false } : m
                    )
                }));

                const { error } = await withTimeout(
                    Promise.resolve(supabase.from('messages').insert(item.payload)),
                    SEND_TIMEOUT
                );

                if (!error) {
                    removeFromOfflineQueue(user.id, item.optimistic.id);
                    useAppStore.setState(s => ({
                        messages: s.messages.map(m =>
                            m.id === item.optimistic.id ? { ...m, is_pending: false, is_failed: false } : m
                        )
                    }));
                } else {
                    useAppStore.setState(s => ({
                        messages: s.messages.map(m =>
                            m.id === item.optimistic.id ? { ...m, is_pending: false, is_failed: true } : m
                        )
                    }));
                }
            } catch (e) {
                // keep failed
                useAppStore.setState(s => ({
                    messages: s.messages.map(m =>
                        m.id === item.optimistic.id ? { ...m, is_pending: false, is_failed: true } : m
                    )
                }));
            }
        }
    }, []);

    useEffect(() => {
        processOfflineQueue();

        const handleOnline = () => processOfflineQueue();
        const handleVisibility = () => {
            if (document.visibilityState === 'visible') {
                processOfflineQueue();
            }
        };

        window.addEventListener('online', handleOnline);
        document.addEventListener('visibilitychange', handleVisibility);

        return () => {
            window.removeEventListener('online', handleOnline);
            document.removeEventListener('visibilitychange', handleVisibility);
        };
    }, [processOfflineQueue]);

    // ── Manual retry for fetch failures ─────────────────────────────
    const retryFetch = useCallback(() => {
        const chat = useAppStore.getState().currentChat;
        if (chat) fetchMessages(chat.id);
    }, [fetchMessages]);

    // ── Load older messages (pagination) ────────────────────────────
    const loadMore = useCallback(async () => {
        if (!currentChat || !hasMore || loadingMessages) return;

        const oldestMessage = messages[0];
        if (!oldestMessage) return;

        setLoadingMessages(true);

        try {
            const { data, error } = await withTimeout(
                Promise.resolve(
                    supabase
                        .from('messages')
                        .select('*')
                        .eq('chat_id', currentChat.id)
                        .lt('created_at', oldestMessage.created_at)
                        .order('created_at', { ascending: false })
                        .limit(PAGE_SIZE)
                ),
                FETCH_TIMEOUT
            );

            if (error) {
                setLoadingMessages(false);
                return;
            }

            const older = (data || []).reverse() as Message[];
            const decrypted = await decryptBatch(older);
            prependMessages(decrypted);
            setHasMore(older.length >= PAGE_SIZE);
            setLoadingMessages(false);
        } catch (err) {
            console.error('Load more timeout/error:', err);
            setLoadingMessages(false);
        }
    }, [currentChat, hasMore, loadingMessages, messages, prependMessages, decryptBatch]);

    // ── Send a message (text and/or media) with 5s timeout ──────────
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
                // Only include these columns if they have values
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

            // ── Save to local queue + Send with timeout ────────────────
            saveToOfflineQueue(currentUser.id, { optimistic: optimisticMsg, payload });

            const sendToDB = async () => {
                try {
                    const { error } = await withTimeout(
                        Promise.resolve(supabase.from('messages').insert(payload)),
                        SEND_TIMEOUT
                    );
                    if (error) {
                        console.error('Failed to send message:', error.message, error.code, error.details, error.hint);
                        useAppStore.setState((s) => ({
                            messages: s.messages.map((m) =>
                                m.id === msgId ? { ...m, is_pending: false, is_failed: true } : m
                            ),
                        }));
                    } else {
                        removeFromOfflineQueue(currentUser.id, msgId);
                        useAppStore.setState((s) => ({
                            messages: s.messages.map((m) =>
                                m.id === msgId ? { ...m, is_pending: false, is_failed: false } : m
                            ),
                        }));
                    }
                } catch (err: unknown) {
                    console.error('Send timeout/network error:', err);
                    useAppStore.setState((s) => ({
                        messages: s.messages.map((m) =>
                            m.id === msgId ? { ...m, is_pending: false, is_failed: true } : m
                        ),
                    }));
                } finally {
                    setSendingMessage(false);
                }
            };
            sendToDB();
        },
        [currentUser, currentChat, addMessage, updateChatLastMessage]
    );

    // ── Retry handler (reads from store to avoid stale closure) ─────
    useEffect(() => {
        const handleRetry = (e: Event) => {
            const customEvent = e as CustomEvent<{ msgId: string }>;
            // Read fresh state from the store — not from closure
            const state = useAppStore.getState();
            const failedMsg = state.messages.find(m => m.id === customEvent.detail.msgId);
            const chat = state.currentChat;
            if (!failedMsg || !chat) return;

            // Re-mark as pending
            useAppStore.setState((s) => ({
                messages: s.messages.map((m) =>
                    m.id === failedMsg.id ? { ...m, is_pending: true, is_failed: false } : m
                ),
            }));

            // Re-encrypt and retry with 5s timeout
            const retrySend = async () => {
                let textPayload = failedMsg.text;
                if (hasPassphrase() && textPayload && textPayload !== '[Media]' && textPayload !== '[deleted]') {
                    textPayload = await encryptMessage(textPayload);
                }

                const payload = {
                    id: failedMsg.id,
                    chat_id: failedMsg.chat_id,
                    sender_id: failedMsg.sender_id,
                    text: textPayload,
                    created_at: failedMsg.created_at,
                    ...(failedMsg.media_url ? {
                        media_url: failedMsg.media_url,
                        is_compressed: true,
                        is_disappearing: failedMsg.is_disappearing || false,
                        ...(failedMsg.expires_at ? { expires_at: failedMsg.expires_at } : {})
                    } : {}),
                    ...(failedMsg.mentions && failedMsg.mentions.length > 0 ? { mentions: failedMsg.mentions } : {}),
                    ...(failedMsg.reply_to_id ? { reply_to_id: failedMsg.reply_to_id } : {}),
                };

                try {
                    const { error } = await withTimeout(
                        Promise.resolve(supabase.from('messages').insert(payload)),
                        SEND_TIMEOUT
                    );
                    if (error) throw error;

                    const currentUser = useAppStore.getState().currentUser;
                    if (currentUser) removeFromOfflineQueue(currentUser.id, failedMsg.id);

                    useAppStore.setState((s) => ({
                        messages: s.messages.map((m) =>
                            m.id === failedMsg.id ? { ...m, is_pending: false, is_failed: false } : m
                        ),
                    }));
                } catch (err) {
                    console.error('Retry failed:', err);
                    useAppStore.setState((s) => ({
                        messages: s.messages.map((m) =>
                            m.id === failedMsg.id ? { ...m, is_pending: false, is_failed: true } : m
                        ),
                    }));
                }
            };
            retrySend();
        };

        window.addEventListener('retry-message', handleRetry);
        return () => window.removeEventListener('retry-message', handleRetry);
    }, []); // No deps needed — reads from store directly

    // ── Fetch messages when chat changes ────────────────────────────
    useEffect(() => {
        if (!currentChat) {
            setMessages([]);
            return;
        }
        // Require currentUser to be resolved before fetching
        if (!currentUser) return;
        fetchMessages(currentChat.id);
    }, [currentChat?.id, currentUser?.id, fetchMessages, setMessages]);

    // ── Realtime subscription with health monitoring ────────────────
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
            .subscribe((status) => {
                // ── Channel health monitoring ───────────────────────
                if (status === 'SUBSCRIBED') {
                    channelHealthy.current = true;
                }
                if (status === 'TIMED_OUT' || status === 'CLOSED' || status === 'CHANNEL_ERROR') {
                    console.warn('[Realtime] Channel issue:', status, '— will reconnect in 2s');
                    channelHealthy.current = false;
                    // Auto-reconnect after 2s by bumping reconnectCount
                    setTimeout(() => {
                        if (channelRef.current) {
                            supabase.removeChannel(channelRef.current);
                            channelRef.current = null;
                        }
                        setReconnectCount(c => c + 1);
                    }, 2000);
                }
            });

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
    }, [currentChat?.id, addMessage, setTypingUsers, reconnectCount]);

    // ── Broadcast typing state ──────────────────────────────────────
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
        fetchError,
        loadMore,
        sendMessage,
        sendTypingEvent,
        retryFetch,
    };
}
