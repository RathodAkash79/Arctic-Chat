'use client';

import { useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/useAppStore';
import type { ChatListItem, ChatParticipant, User } from '@/types';
import { resolveImageUrl } from '@/lib/utils';

export function useChats() {
    const {
        currentUser,
        chats,
        setChats,
        setCurrentChat,
        updateChatLastMessage,
    } = useAppStore();

    // Fetch all chats the user participates in
    const fetchChats = useCallback(async () => {
        if (!currentUser) {
            console.log('[fetchChats] No currentUser, skipping');
            return;
        }

        console.log('[fetchChats] Fetching for user:', currentUser.id);

        // 1. Get chat_ids the user is in
        const { data: participantRows, error: pErr } = await supabase
            .from('chat_participants')
            .select('chat_id')
            .eq('user_id', currentUser.id);

        console.log('[fetchChats] Step 1 - Participant rows:', participantRows?.length, 'Error:', pErr?.message);

        if (pErr || !participantRows?.length) {
            setChats([]);
            return;
        }

        const chatIds = participantRows.map((p) => p.chat_id);
        console.log('[fetchChats] Chat IDs:', chatIds);

        // 2. Fetch chats
        const { data: chatRows, error: cErr } = await supabase
            .from('chats')
            .select('*')
            .in('id', chatIds)
            .order('last_message_time', { ascending: false, nullsFirst: true });

        console.log('[fetchChats] Step 2 - Chat rows:', chatRows?.length, 'Error:', cErr?.message);

        if (cErr || !chatRows) {
            setChats([]);
            return;
        }

        // 3. Fetch all participants for these chats via SECURITY DEFINER function
        //    (Direct query causes RLS infinite recursion — this bypasses it)
        interface RpcParticipant { chat_id: string; user_id: string; group_role: string; joined_at: string }
        const { data: allParticipants } = await supabase.rpc('get_my_chat_participants') as { data: RpcParticipant[] | null };

        console.log('[fetchChats] Step 3 - All participants:', allParticipants?.length);

        // 4. Fetch user info for all participants
        const participantUserIds = [
            ...new Set((allParticipants || []).map((p: RpcParticipant) => p.user_id)),
        ];

        const { data: users } = await supabase
            .from('users')
            .select('*')
            .in('id', participantUserIds);

        console.log('[fetchChats] Step 4 - Users:', users?.length);

        const usersMap = new Map((users || []).map((u) => {
            const user = u as User;
            user.pfp_url = resolveImageUrl(user.pfp_url);
            return [user.id, user];
        }));

        // 5. Build ChatListItem array
        const chatList: ChatListItem[] = chatRows.map((chat) => {
            const participants: ChatParticipant[] = (allParticipants || [])
                .filter((p: RpcParticipant) => p.chat_id === chat.id)
                .map((p: RpcParticipant) => ({
                    chat_id: p.chat_id,
                    user_id: p.user_id,
                    group_role: p.group_role as ChatParticipant['group_role'],
                    joined_at: p.joined_at,
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
                // Read pin state from localStorage (always works), fallback to DB column
                is_pinned: (() => {
                    try {
                        const stored = JSON.parse(localStorage.getItem(`pinned_chats_${currentUser.id}`) || '{}');
                        if (chat.id in stored) return stored[chat.id];
                    } catch { /* ignore */ }
                    return participants.find((p) => p.user_id === currentUser.id)?.is_pinned || false;
                })(),
            } as ChatListItem;
        });

        console.log('[fetchChats] Final chat list:', chatList.length);
        setChats(chatList);
    }, [currentUser, setChats]);

    // Initial fetch
    useEffect(() => {
        if (!currentUser) return;
        fetchChats();
    }, [currentUser, fetchChats]);

    // Realtime subscription for new messages and new chats
    useEffect(() => {
        if (!currentUser) return;

        // Listen for chats being updated (e.g., new message triggers last_message update)
        const chatsChannel = supabase
            .channel(`user-chats-updates-${currentUser.id}`)
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
            // Listen for user being added to a new chat
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'chat_participants',
                    filter: `user_id=eq.${currentUser.id}`,
                },
                () => {
                    // Refetch all chats if added to a new one
                    fetchChats();
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(chatsChannel);
        };
    }, [currentUser, updateChatLastMessage, fetchChats]);



    // Open a chat — also pushes its URL so each chat has a unique route
    const openChat = useCallback(
        (chat: ChatListItem) => {
            setCurrentChat(chat);
            useAppStore.getState().setIsMobileChatOpen(true);
            // Update the URL to /[chatId] without a full page reload
            if (typeof window !== 'undefined') {
                window.history.pushState(null, '', `/${chat.id}`);
            }
        },
        [setCurrentChat]
    );

    return { chats, fetchChats, openChat };
}
