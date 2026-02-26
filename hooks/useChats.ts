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
        if (!currentUser) return;

        // Step 1 & 2 in parallel with Step 3
        // We fetch the chat details (via inner join to confirm membership) 
        // and all participants (via RPC) simultaneously.
        interface RpcParticipant { chat_id: string; user_id: string; group_role: string; joined_at: string; nickname?: string }

        const [chatsRes, participantsRes] = await Promise.all([
            supabase
                .from('chats')
                .select(`
                    *,
                    chat_participants!inner(user_id)
                `)
                .eq('chat_participants.user_id', currentUser.id)
                .order('last_message_time', { ascending: false, nullsFirst: true }),
            supabase.rpc('get_my_chat_participants') as unknown as Promise<{ data: RpcParticipant[] | null }>
        ]);

        const chatRows = chatsRes.data || [];
        const allParticipants = participantsRes.data || [];

        if (chatsRes.error || !chatRows.length) {
            setChats([]);
            return;
        }

        // Step 4: Fetch user info for all participants
        const participantUserIds = [...new Set(allParticipants.map(p => p.user_id))];
        const { data: users } = await supabase.from('users').select('*').in('id', participantUserIds);


        const usersMap = new Map((users || []).map((u) => {
            const user = u as User;
            user.pfp_url = resolveImageUrl(user.pfp_url);
            return [user.id, user];
        }));

        // Step 5: Build ChatListItem array
        const chatList: ChatListItem[] = chatRows.map((chat) => {
            const participants: ChatParticipant[] = ((allParticipants || []) as RpcParticipant[])
                .filter((p) => p.chat_id === chat.id)
                .map((p) => ({
                    chat_id: p.chat_id,
                    user_id: p.user_id,
                    group_role: p.group_role as ChatParticipant['group_role'],
                    joined_at: p.joined_at,
                    nickname: p.nickname,
                    user: usersMap.get(p.user_id),
                }));

            let dm_user: User | undefined;
            if (chat.type === 'dm') {
                const otherParticipant = participants.find((p) => p.user_id !== currentUser.id);
                dm_user = otherParticipant?.user;
            }

            return {
                ...chat,
                participants,
                dm_user,
                is_pinned: (() => {
                    try {
                        const stored = JSON.parse(localStorage.getItem(`pinned_chats_${currentUser.id}`) || '{}');
                        if (chat.id in stored) return stored[chat.id];
                    } catch { /* ignore */ }
                    return participants.find((p) => p.user_id === currentUser.id)?.is_pinned || false;
                })(),
            } as ChatListItem;
        });

        setChats(chatList);

        // SYNC CURRENT CHAT: update its reference from the new list
        const state = useAppStore.getState();
        if (state.currentChat) {
            const updated = chatList.find(c => c.id === state.currentChat?.id);
            if (updated) {
                state.setCurrentChat(updated);
            } else {
                state.setCurrentChat(null);
            }
        }
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

    // Re-fetch chat list when Supabase refreshes the auth token in the background
    useEffect(() => {
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            (event) => {
                if (event === 'TOKEN_REFRESHED' && currentUser) {
                    console.log('[useChats] Token refreshed — re-fetching chats');
                    fetchChats();
                }
            }
        );
        return () => subscription.unsubscribe();
    }, [currentUser, fetchChats]);



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
