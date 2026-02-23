'use client';

import { useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/useAppStore';
import type { ChatListItem, ChatParticipant, User } from '@/types';
import { resolveImageUrl } from '@/lib/utils';

const POLL_INTERVAL = 30_000; // Refresh chat list every 30s (saves realtime quota)

export function useChats() {
    const {
        currentUser,
        chats,
        setChats,
        setCurrentChat,
        updateChatLastMessage,
    } = useAppStore();
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Fetch all chats the user participates in
    const fetchChats = useCallback(async () => {
        if (!currentUser) return;

        // 1. Get chat_ids the user is in
        const { data: participantRows, error: pErr } = await supabase
            .from('chat_participants')
            .select('chat_id')
            .eq('user_id', currentUser.id);

        if (pErr || !participantRows?.length) {
            setChats([]);
            return;
        }

        const chatIds = participantRows.map((p) => p.chat_id);

        // 2. Fetch chats
        const { data: chatRows, error: cErr } = await supabase
            .from('chats')
            .select('*')
            .in('id', chatIds)
            .order('last_message_time', { ascending: false, nullsFirst: false });

        if (cErr || !chatRows) {
            setChats([]);
            return;
        }

        // 3. Fetch all participants for these chats (with user info)
        const { data: allParticipants } = await supabase
            .from('chat_participants')
            .select('chat_id, user_id, group_role, joined_at')
            .in('chat_id', chatIds);

        // 4. Fetch user info for all participants
        const participantUserIds = [
            ...new Set((allParticipants || []).map((p) => p.user_id)),
        ];

        const { data: users } = await supabase
            .from('users')
            .select('*')
            .in('id', participantUserIds);

        const usersMap = new Map((users || []).map((u) => {
            const user = u as User;
            user.pfp_url = resolveImageUrl(user.pfp_url);
            return [user.id, user];
        }));

        // 5. Build ChatListItem array
        const chatList: ChatListItem[] = chatRows.map((chat) => {
            const participants: ChatParticipant[] = (allParticipants || [])
                .filter((p) => p.chat_id === chat.id)
                .map((p) => ({
                    ...p,
                    user: usersMap.get(p.user_id),
                }));

            // For DMs, resolve the other user
            let dm_user: User | undefined;
            if (chat.type === 'dm') {
                const otherParticipant = participants.find(
                    (p) => p.user_id !== currentUser.id
                );
                dm_user = otherParticipant?.user;
            }

            return {
                ...chat,
                participants,
                dm_user,
            } as ChatListItem;
        });

        setChats(chatList);
    }, [currentUser, setChats]);

    // Start polling
    useEffect(() => {
        if (!currentUser) return;

        fetchChats();

        pollRef.current = setInterval(fetchChats, POLL_INTERVAL);

        return () => {
            if (pollRef.current) {
                clearInterval(pollRef.current);
                pollRef.current = null;
            }
        };
    }, [currentUser, fetchChats]);

    // Realtime subscription for new messages (to update chat list preview)
    useEffect(() => {
        if (!currentUser) return;

        const channel = supabase
            .channel(`user-chats-${currentUser.id}`)
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'chats',
                },
                (payload) => {
                    const updated = payload.new as { id: string; last_message?: string; last_message_time?: string };
                    if (updated.last_message && updated.last_message_time) {
                        updateChatLastMessage(updated.id, updated.last_message, updated.last_message_time);
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [currentUser, updateChatLastMessage]);

    // Open a chat
    const openChat = useCallback(
        (chat: ChatListItem) => {
            setCurrentChat(chat);
            // On mobile, open the chat panel
            useAppStore.getState().setIsMobileChatOpen(true);
        },
        [setCurrentChat]
    );

    return { chats, fetchChats, openChat };
}
