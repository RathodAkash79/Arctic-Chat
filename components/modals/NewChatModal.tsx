'use client';

import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/useAppStore';
import { useChats } from '@/hooks/useChats';
import { X, Search as SearchIcon, MessageSquare } from 'lucide-react';
import type { User } from '@/types';
import styles from './NewChatModal.module.scss';

export default function NewChatModal() {
    const { currentUser, setIsNewChatModalOpen, onlineUsers } = useAppStore();
    const { fetchChats, openChat } = useChats();
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<User[]>([]);
    const [searching, setSearching] = useState(false);
    const [creating, setCreating] = useState(false);

    const searchUsers = useCallback(
        async (q: string) => {
            if (!q.trim() || !currentUser) {
                setResults([]);
                return;
            }

            setSearching(true);
            const { data } = await supabase
                .from('users')
                .select('*')
                .neq('id', currentUser.id)
                .or(`display_name.ilike.%${q}%,email.ilike.%${q}%`)
                .limit(10);

            setResults((data || []) as User[]);
            setSearching(false);
        },
        [currentUser]
    );

    const handleSearch = (value: string) => {
        setQuery(value);
        searchUsers(value);
    };

    const startDM = async (user: User) => {
        if (!currentUser || creating) return;
        setCreating(true);

        try {
            // Use the create_dm_chat postgres function (idempotent)
            const { data, error } = await supabase.rpc('create_dm_chat', {
                user_id_1: currentUser.id,
                user_id_2: user.id,
            });

            if (error) {
                console.error('Failed to create DM:', error.message, error.details, error.hint);
                setCreating(false);
                return;
            }

            // Refresh chat list and open the new/existing chat
            await fetchChats();
            const chatId = data as string;
            const chats = useAppStore.getState().chats;
            const chat = chats.find((c) => c.id === chatId);
            if (chat) {
                openChat(chat);
            }

            setIsNewChatModalOpen(false);
        } catch (err) {
            console.error('Error creating DM:', err);
        } finally {
            setCreating(false);
        }
    };

    return (
        <div className={styles.overlay} onClick={() => setIsNewChatModalOpen(false)}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className={styles.header}>
                    <h3>New Conversation</h3>
                    <button
                        className={styles.closeBtn}
                        onClick={() => setIsNewChatModalOpen(false)}
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Search */}
                <div className={styles.searchBar}>
                    <SearchIcon size={16} className={styles.searchIcon} />
                    <input
                        type="text"
                        placeholder="Search by name or email..."
                        value={query}
                        onChange={(e) => handleSearch(e.target.value)}
                        autoFocus
                    />
                </div>

                {/* Results */}
                <div className={styles.results}>
                    {searching && (
                        <div className={styles.loadingState}>Searching...</div>
                    )}

                    {!searching && query && results.length === 0 && (
                        <div className={styles.emptyState}>No users found</div>
                    )}

                    {!searching && !query && (
                        <div className={styles.emptyState}>
                            Type a name or email to search
                        </div>
                    )}

                    {results.map((user) => (
                        <button
                            key={user.id}
                            className={styles.userItem}
                            onClick={() => startDM(user)}
                            disabled={creating}
                        >
                            <div className={styles.userAvatarWrapper}>
                                <div className={styles.userAvatar}>
                                    {user.pfp_url ? (
                                        <img src={user.pfp_url} alt="" />
                                    ) : (
                                        <span>{user.display_name[0]?.toUpperCase()}</span>
                                    )}
                                </div>
                                {onlineUsers.includes(user.id) && (
                                    <div className={styles.onlineDot} title="Online" />
                                )}
                            </div>
                            <div className={styles.userInfo}>
                                <span className={styles.userName}>{user.display_name}</span>
                                <span className={styles.userEmail}>{user.email}</span>
                            </div>
                            <MessageSquare size={18} className={styles.chatIcon} />
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
