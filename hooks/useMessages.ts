'use client';

import { useEffect, useCallback, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/useAppStore';
import type { Message, User } from '@/types';

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

            const msgs = (data || []).reverse(); // oldest first for display
            setMessages(msgs as Message[]);
            setHasMore(msgs.length >= PAGE_SIZE);
            setLoadingMessages(false);
        },
        [setMessages]
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
        prependMessages(older);
        setHasMore(older.length >= PAGE_SIZE);
        setLoadingMessages(false);
    }, [currentChat, hasMore, loadingMessages, messages, prependMessages]);

    // Send a message
    const sendMessage = useCallback(
        async (text: string) => {
            if (!currentUser || !currentChat || !text.trim()) return;

            setSendingMessage(true);

            const { error } = await supabase.from('messages').insert({
                chat_id: currentChat.id,
                sender_id: currentUser.id,
                text: text.trim(),
            });

            if (error) {
                console.error('Failed to send message:', error);
            }

            setSendingMessage(false);
        },
        [currentUser, currentChat]
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
                (payload) => {
                    const newMsg = payload.new as Message;
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
