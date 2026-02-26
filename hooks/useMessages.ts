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

// ── Helper: delete S3 objects via proxy API ───────────────────────────
async function deleteObjectsFromStorage(urls: string[]) {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        await fetch('/api/media/delete', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ keys: urls }),
        });
    } catch (err) {
        console.warn('[Storage] Failed to send delete request:', err);
    }
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

    // ── Fetch latest messages for current chat ────
    const fetchMessages = useCallback(
        async (chatId: string) => {
            fetchingForChatId.current = chatId;
            // Clear previous chat messages; pending optimistic ones for THIS chat stay via addMessage
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

                // ── Cleanup Offline Queue ──
                // If a message we just fetched from the DB is also in our offline queue,
                // remove it from the queue because it's officially persisted.
                const userId = useAppStore.getState().currentUser?.id;
                if (userId) {
                    const queue = getOfflineQueue(userId);
                    let queueModified = false;
                    const cleanQueue = queue.filter(item => {
                        const inDB = decrypted.some(d => d.id === item.optimistic.id);
                        if (inDB) queueModified = true;
                        return !inDB;
                    });
                    if (queueModified) {
                        localStorage.setItem(`offline_messages_${userId}`, JSON.stringify(cleanQueue));
                    }
                }

                // ── Re-inject remaining offline-queued messages as pending bubbles ──
                const pendingBubbles: Message[] = userId
                    ? getOfflineQueue(userId)
                        .filter(i => i.optimistic.chat_id === chatId)
                        .filter(i => !decrypted.some(d => d.id === i.optimistic.id))
                        .map(i => ({ ...i.optimistic, is_pending: true, is_failed: false }))
                    : [];

                setMessages([...decrypted, ...pendingBubbles]);
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

    // ── Process Offline Queue — re-injects pending bubbles and sends ──
    const processOfflineQueue = useCallback(async () => {
        const user = useAppStore.getState().currentUser;
        if (!user) return;

        const q = getOfflineQueue(user.id);
        if (!q.length) return;

        console.log(`[OfflineQueue] Retrying ${q.length} pending messages...`);

        for (const item of q) {
            // ── Ensure the pending bubble is visible with a spinner ──
            // If fetchMessages cleared the list (tab switch, refresh), re-add the bubble
            // so the user always sees the message with a sending indicator.
            const state = useAppStore.getState();
            const isSameChat = state.currentChat?.id === item.optimistic.chat_id;
            const alreadyVisible = state.messages.some(m => m.id === item.optimistic.id);
            if (isSameChat && !alreadyVisible) {
                useAppStore.setState(s => ({
                    messages: [...s.messages, { ...item.optimistic, is_pending: true, is_failed: false }]
                }));
            }

            try {
                // ── Re-encrypt text before sending ──────────────────────────
                // The queued payload may have been saved with plaintext (when the page
                // was refreshed before encryption completed). Re-encrypt here if needed.
                let sendPayload = { ...item.payload };
                const rawText = item.optimistic.text;
                if (
                    hasPassphrase() &&
                    rawText &&
                    rawText !== '[Media]' &&
                    rawText !== '[deleted]'
                ) {
                    try {
                        sendPayload = { ...sendPayload, text: await encryptMessage(rawText) };
                    } catch {
                        // encryption failed — send as-is (plaintext fallback)
                    }
                }

                const { error } = await withTimeout(
                    Promise.resolve(supabase.from('messages').upsert(sendPayload, {
                        onConflict: 'id',
                        ignoreDuplicates: true,   // if sendToDB already persisted it, just skip
                    })),
                    SEND_TIMEOUT
                );

                const isConflict = (error as any)?.code === '23505';
                if (!error || isConflict) {
                    if (isConflict) {
                        console.log('[OfflineQueue] Message already exists in DB, clearing from queue');
                    }
                    // Remove from localStorage — sent successfully or already exists
                    removeFromOfflineQueue(user.id, item.optimistic.id);
                    // Mark bubble as confirmed in place
                    useAppStore.setState(s => ({
                        messages: s.messages.map(m =>
                            m.id === item.optimistic.id
                                ? { ...m, is_pending: false, is_failed: false }
                                : m
                        )
                    }));
                } else {
                    console.error('[OfflineQueue] Send error:', error.message);
                    useAppStore.setState(s => ({
                        messages: s.messages.map(m =>
                            m.id === item.optimistic.id
                                ? { ...m, is_pending: false, is_failed: true }
                                : m
                        )
                    }));
                }
            } catch (e) {
                console.error('[OfflineQueue] Will retry later:', e);
                useAppStore.setState(s => ({
                    messages: s.messages.map(m =>
                        m.id === item.optimistic.id
                            ? { ...m, is_pending: false, is_failed: true }
                            : m
                    )
                }));
            }
        }
    }, []);

    useEffect(() => {
        // Run immediately on mount (handles page refresh case)
        processOfflineQueue();

        // Re-run when network comes back
        const handleOnline = () => processOfflineQueue();
        // Re-run when user returns to this tab — read currentChat fresh from store
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

    // ── Send a message (text and/or media) with guards ──────────
    const sendMessage = useCallback(
        async (
            text: string,
            mediaUrl?: string,
            replyToId?: string,
            isDisappearing?: boolean,
            mentions?: MentionedUser[],
            onStatusError?: (error: string) => void
        ) => {
            if (!currentUser || !currentChat) return;
            if (!text.trim() && !mediaUrl) return;

            setSendingMessage(true);

            // ── Step 1: Show optimistic bubble INSTANTLY ─────────────────
            // The message appears in the UI with a spinner the moment Send is pressed,
            // before any network calls. If the status check later rejects it, we roll back.
            const msgId = typeof crypto !== 'undefined' && crypto.randomUUID
                ? crypto.randomUUID()
                : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
                    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
                    return v.toString(16);
                });

            const now = new Date().toISOString();

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
                is_pending: true,  // show spinner immediately
                ...(replyToId ? { reply_to_id: replyToId } : {}),
            };

            // Add to UI immediately (spinner visible right away)
            addMessage(optimisticMsg);

            // Optimistic chat list update
            updateChatLastMessage(
                currentChat.id,
                text || (mediaUrl ? '[Media attached]' : 'New message'),
                now
            );

            // ── Step 2: Save to localStorage IMMEDIATELY ────────────────
            // Build a plaintext payload now so it survives a refresh at any point.
            // processOfflineQueue will re-encrypt before sending if a passphrase is set.
            const plaintextPayload: Record<string, unknown> = {
                id: msgId,
                chat_id: currentChat.id,
                sender_id: currentUser.id,
                text: text || (mediaUrl ? '[Media]' : ''),  // plaintext — encrypted later
                created_at: now,
                ...(mentions && mentions.length > 0 ? { mentions } : {}),
                ...(replyToId ? { reply_to_id: replyToId } : {}),
                ...(mediaUrl ? {
                    media_url: mediaUrl,
                    is_compressed: true,
                    is_disappearing: isDisappearing || false,
                    ...(isDisappearing ? { expires_at: new Date(Date.now() + 86400000).toISOString() } : {}),
                } : {}),
            };
            // Save NOW — before any async work — so a refresh always finds this message
            saveToOfflineQueue(currentUser.id, { optimistic: optimisticMsg, payload: plaintextPayload });

            // ── Step 3: Status guard (runs after bubble is shown) ────────
            // If the user is muted/timed-out, remove the bubble (rollback) and show error.
            try {
                const { data: status, error: statusError } = await supabase.rpc('get_user_group_status', {
                    p_chat_id: currentChat.id
                });

                if (statusError) throw statusError;

                if (status.is_timed_out) {
                    const until = new Date(status.timed_until).toLocaleTimeString();
                    onStatusError?.(`🚫 You are timed out until ${until}`);
                    // Rollback: remove the bubble AND the queue entry
                    useAppStore.setState(s => ({
                        messages: s.messages.filter(m => m.id !== msgId)
                    }));
                    removeFromOfflineQueue(currentUser.id, msgId);
                    setSendingMessage(false);
                    return;
                }

                if (status.is_muted) {
                    onStatusError?.(`🔇 You are muted in this group and cannot send messages.`);
                    // Rollback: remove the bubble AND the queue entry
                    useAppStore.setState(s => ({
                        messages: s.messages.filter(m => m.id !== msgId)
                    }));
                    removeFromOfflineQueue(currentUser.id, msgId);
                    setSendingMessage(false);
                    return;
                }
            } catch (err) {
                // If status check fails, let the send proceed (non-group chats, etc.)
                console.warn('[Guard] Failed to verify group status:', err);
            }

            // ── Step 4: Encrypt + build final send payload ────────────────
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

            // Update queue entry with the now-encrypted payload
            removeFromOfflineQueue(currentUser.id, msgId);
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

    const sendSystemMessage = useCallback(async (text: string) => {
        if (!currentUser || !currentChat) return;
        const msgId = crypto.randomUUID();
        const now = new Date().toISOString();

        let encryptedText = text;
        try {
            encryptedText = await encryptMessage(text);
        } catch {
            // not encrypted, that's fine
        }

        const payload = {
            id: msgId,
            chat_id: currentChat.id,
            sender_id: currentUser.id,
            text: encryptedText,
            is_system: true,
            created_at: now,
        };

        // Optimistic add as system message (no pending indicator)
        addMessage({
            ...payload,
            text, // plaintext for display
            is_compressed: false,
            is_disappearing: false,
            is_deleted: false,
            is_system: true,
        } as any);

        await supabase.from('messages').insert(payload);
    }, [currentUser, currentChat, addMessage]);

    // ── Nuke Chat ──────────────────────────────────────────────────
    const nukeChat = useCallback(async () => {
        if (!currentChat) return;

        const { data, error } = await supabase.rpc('execute_group_command', {
            p_chat_id: currentChat.id,
            p_action: 'nuke'
        });

        if (error) {
            console.error('Nuke failed:', error);
            return;
        }

        if (data?.ok) {
            setMessages([]);
            if (data.media_urls && data.media_urls.length > 0) {
                await deleteObjectsFromStorage(data.media_urls);
            }
        }
    }, [currentChat, setMessages]);

    // ── Retry handler (reads from store to avoid stale closure) ─────
    useEffect(() => {
        const handleRetry = (e: Event) => {
            const customEvent = e as CustomEvent<{ msgId: string }>;
            const state = useAppStore.getState();
            const failedMsg = state.messages.find(m => m.id === customEvent.detail.msgId);
            const chat = state.currentChat;
            if (!failedMsg || !chat) return;

            useAppStore.setState((s) => ({
                messages: s.messages.map((m) =>
                    m.id === failedMsg.id ? { ...m, is_pending: true, is_failed: false } : m
                ),
            }));

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
    }, []);

    useEffect(() => {
        if (!currentChat) {
            setMessages([]);
            return;
        }
        if (!currentUser) return;
        fetchMessages(currentChat.id);
    }, [currentChat?.id, currentUser?.id, fetchMessages]);

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
                if (status === 'SUBSCRIBED') {
                    channelHealthy.current = true;
                }
                if (status === 'TIMED_OUT' || status === 'CLOSED' || status === 'CHANNEL_ERROR') {
                    channelHealthy.current = false;
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
        sendSystemMessage,
        nukeChat,
        sendTypingEvent,
        retryFetch,
        deleteObjectsFromStorage,
    };
}
