'use client';

import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/useAppStore';
import { useChats } from '@/hooks/useChats';
import { X, Search as SearchIcon, Check } from 'lucide-react';
import type { User } from '@/types';
import styles from './AddMemberModal.module.scss';

interface Props {
    onClose: () => void;
}

export default function AddMemberModal({ onClose }: Props) {
    const { currentUser, currentChat } = useAppStore();
    const { fetchChats } = useChats();

    const [query, setQuery] = useState('');
    const [searchResults, setSearchResults] = useState<User[]>([]);
    const [selectedMembers, setSelectedMembers] = useState<User[]>([]);
    const [searching, setSearching] = useState(false);
    const [adding, setAdding] = useState(false);

    // Search users not already in the group
    const searchUsers = useCallback(
        async (q: string) => {
            if (!q.trim() || !currentUser || !currentChat) {
                setSearchResults([]);
                return;
            }
            setSearching(true);

            // Get list of user IDs already in the group
            const existingIds = currentChat.participants?.map(p => p.user_id) || [];

            // Build the query
            let sQuery = supabase
                .from('users')
                .select('*')
                .or(`display_name.ilike.%${q}%,email.ilike.%${q}%`)
                .limit(10);

            // Exclude existing members
            if (existingIds.length > 0) {
                // Supabase doesn't have a direct "not_in" helper function that takes an array easily like .in()
                // It has filter('id', 'not.in', '(a,b,c)')
                sQuery = sQuery.filter('id', 'not.in', `(${existingIds.join(',')})`);
            }

            const { data } = await sQuery;

            setSearchResults((data || []) as User[]);
            setSearching(false);
        },
        [currentUser, currentChat]
    );

    const handleSearch = (value: string) => {
        setQuery(value);
        searchUsers(value);
    };

    const toggleMember = (user: User) => {
        setSelectedMembers((prev) =>
            prev.some((m) => m.id === user.id)
                ? prev.filter((m) => m.id !== user.id)
                : [...prev, user]
        );
    };

    const handleAddMembers = async () => {
        if (!currentChat || selectedMembers.length === 0 || !currentUser) return;
        setAdding(true);

        try {
            // Add each selected member using the RPC
            const promises = selectedMembers.map((user) =>
                supabase.rpc('add_group_member', {
                    p_chat_id: currentChat.id,
                    p_user_id: user.id
                })
            );

            await Promise.all(promises);

            // Refresh chat list to fetch updated participants
            fetchChats();
            onClose();
        } catch (error) {
            console.error('Failed to add members:', error);
            alert('Failed to add members. Do you have permission?');
        } finally {
            setAdding(false);
        }
    };

    return (
        <div className={styles.overlay} onClick={onClose}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                <div className={styles.header}>
                    <h2>Add Members</h2>
                    <button className={styles.closeBtn} onClick={onClose}>
                        <X size={20} />
                    </button>
                </div>

                <div className={styles.body}>
                    {/* Selected Members Chips */}
                    {selectedMembers.length > 0 && (
                        <div className={styles.selectedArea}>
                            {selectedMembers.map((m) => (
                                <div key={m.id} className={styles.chip}>
                                    <div className={styles.chipAvatar}>
                                        {m.pfp_url ? (
                                            <img src={m.pfp_url} alt="" />
                                        ) : (
                                            <span>{m.display_name?.[0]?.toUpperCase() || '?'}</span>
                                        )}
                                    </div>
                                    <span>{m.display_name || 'User'}</span>
                                    <button onClick={() => toggleMember(m)}>
                                        <X size={12} strokeWidth={3} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Search Input */}
                    <div className={styles.searchBar}>
                        <SearchIcon size={18} className={styles.searchIcon} />
                        <input
                            type="text"
                            placeholder="Search names or email..."
                            value={query}
                            onChange={(e) => handleSearch(e.target.value)}
                            autoFocus
                        />
                        {searching && <div className={styles.spinner} />}
                    </div>

                    {/* Search Results */}
                    <div className={styles.results}>
                        {searchResults.map((user) => {
                            const isSelected = selectedMembers.some((m) => m.id === user.id);
                            return (
                                <div
                                    key={user.id}
                                    className={`${styles.userRow} ${isSelected ? styles.selected : ''}`}
                                    onClick={() => toggleMember(user)}
                                >
                                    <div className={styles.userAvatar}>
                                        {user.pfp_url ? (
                                            <img src={user.pfp_url} alt="" />
                                        ) : (
                                            <span>{user.display_name?.[0]?.toUpperCase() || '?'}</span>
                                        )}
                                    </div>
                                    <div className={styles.userInfo}>
                                        <h4>{user.display_name}</h4>
                                        <p>{user.email}</p>
                                    </div>
                                    <div className={styles.checkCircle}>
                                        {isSelected && <Check size={14} strokeWidth={3} />}
                                    </div>
                                </div>
                            );
                        })}

                        {query.trim() && !searching && searchResults.length === 0 && (
                            <div className={styles.noResults}>No users found.</div>
                        )}
                        {!query.trim() && searchResults.length === 0 && (
                            <div className={styles.hintText}>Search for people to add to <b>{currentChat?.name}</b></div>
                        )}
                    </div>
                </div>

                <div className={styles.footer}>
                    {selectedMembers.length > 0 ? (
                        <button
                            className={styles.primaryBtn}
                            onClick={handleAddMembers}
                            disabled={adding}
                        >
                            {adding ? 'Adding...' : `Add ${selectedMembers.length} member${selectedMembers.length > 1 ? 's' : ''}`}
                        </button>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
