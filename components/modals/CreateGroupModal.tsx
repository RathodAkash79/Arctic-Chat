'use client';

import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/useAppStore';
import { useChats } from '@/hooks/useChats';
import { compressImage } from '@/lib/imageCompression';
import { X, Search as SearchIcon, Users, Camera, Check } from 'lucide-react';
import type { User } from '@/types';
import styles from './CreateGroupModal.module.scss';

interface Props {
    onClose: () => void;
}

export default function CreateGroupModal({ onClose }: Props) {
    const { currentUser } = useAppStore();
    const { fetchChats, openChat } = useChats();
    const [step, setStep] = useState<'members' | 'details'>('members');

    // Step 1: Member selection
    const [query, setQuery] = useState('');
    const [searchResults, setSearchResults] = useState<User[]>([]);
    const [selectedMembers, setSelectedMembers] = useState<User[]>([]);
    const [searching, setSearching] = useState(false);

    // Step 2: Group details
    const [groupName, setGroupName] = useState('');
    const [groupDesc, setGroupDesc] = useState('');
    const [groupAvatar, setGroupAvatar] = useState<string | null>(null);
    const [avatarBlob, setAvatarBlob] = useState<Blob | null>(null);
    const [creating, setCreating] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const close = () => onClose();

    // Search users
    const searchUsers = useCallback(
        async (q: string) => {
            if (!q.trim() || !currentUser) {
                setSearchResults([]);
                return;
            }
            setSearching(true);
            const { data } = await supabase
                .from('users')
                .select('*')
                .neq('id', currentUser.id)
                .or(`display_name.ilike.%${q}%,email.ilike.%${q}%`)
                .limit(10);
            setSearchResults((data || []) as User[]);
            setSearching(false);
        },
        [currentUser]
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

    // Avatar upload
    const handleAvatarSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const { blob, previewUrl } = await compressImage(file, false);
            setGroupAvatar(previewUrl);
            setAvatarBlob(blob);
        } catch {
            alert('Image compression failed');
        }
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    // Create the group
    const createGroup = async () => {
        if (!currentUser || !groupName.trim() || selectedMembers.length < 1) return;
        setCreating(true);

        try {
            // Upload avatar if set
            let pfpUrl: string | null = null;
            if (avatarBlob) {
                const formData = new FormData();
                formData.append('file', avatarBlob, 'group-avatar.webp');
                formData.append('purpose', 'profile');
                const res = await fetch('/api/upload', { method: 'POST', body: formData });
                const data = await res.json();
                if (data.url) pfpUrl = data.url;
            }

            // Use the create_group_chat RPC (SECURITY DEFINER, bypasses RLS)
            const memberIds = selectedMembers.map((m) => m.id);
            const { data: chatId, error } = await supabase.rpc('create_group_chat', {
                p_name: groupName.trim(),
                p_description: groupDesc.trim() || null,
                p_pfp_url: pfpUrl,
                p_member_ids: memberIds,
            });

            if (error) {
                console.error('Failed to create group:', error.message, error.details, error.hint);
                setCreating(false);
                return;
            }

            // Refresh and open
            await fetchChats();
            const chats = useAppStore.getState().chats;
            const newChat = chats.find((c) => c.id === chatId);
            if (newChat) openChat(newChat);

            close();
        } catch (err) {
            console.error('Error creating group:', err);
        } finally {
            setCreating(false);
        }
    };

    return (
        <div className={styles.overlay} onClick={close}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className={styles.header}>
                    <h3>{step === 'members' ? 'Select Members' : 'Group Details'}</h3>
                    <button className={styles.closeBtn} onClick={close}>
                        <X size={20} />
                    </button>
                </div>

                {step === 'members' && (
                    <>
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

                        {/* Selected chips */}
                        {selectedMembers.length > 0 && (
                            <div className={styles.chips}>
                                {selectedMembers.map((m) => (
                                    <button
                                        key={m.id}
                                        className={styles.chip}
                                        onClick={() => toggleMember(m)}
                                    >
                                        <span>{m.display_name}</span>
                                        <X size={12} />
                                    </button>
                                ))}
                            </div>
                        )}

                        {/* Results */}
                        <div className={styles.results}>
                            {searching && <div className={styles.emptyState}>Searching...</div>}
                            {!searching && query && searchResults.length === 0 && (
                                <div className={styles.emptyState}>No users found</div>
                            )}
                            {!searching && !query && (
                                <div className={styles.emptyState}>Type a name or email to search</div>
                            )}
                            {searchResults.map((user) => {
                                const isSelected = selectedMembers.some((m) => m.id === user.id);
                                return (
                                    <button
                                        key={user.id}
                                        className={`${styles.userItem} ${isSelected ? styles.selected : ''}`}
                                        onClick={() => toggleMember(user)}
                                    >
                                        <div className={styles.userAvatar}>
                                            {user.pfp_url ? (
                                                <img src={user.pfp_url} alt="" />
                                            ) : (
                                                <span>{user.display_name[0]?.toUpperCase()}</span>
                                            )}
                                        </div>
                                        <div className={styles.userInfo}>
                                            <span className={styles.userName}>{user.display_name}</span>
                                            <span className={styles.userEmail}>{user.email}</span>
                                        </div>
                                        {isSelected && (
                                            <div className={styles.checkIcon}>
                                                <Check size={16} />
                                            </div>
                                        )}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Next button */}
                        <div className={styles.footer}>
                            <button
                                className={styles.nextBtn}
                                disabled={selectedMembers.length < 1}
                                onClick={() => setStep('details')}
                            >
                                <Users size={16} />
                                <span>Next ({selectedMembers.length} selected)</span>
                            </button>
                        </div>
                    </>
                )}

                {step === 'details' && (
                    <>
                        <div className={styles.detailsForm}>
                            {/* Group Avatar */}
                            <div
                                className={styles.groupAvatar}
                                onClick={() => fileInputRef.current?.click()}
                            >
                                {groupAvatar ? (
                                    <img src={groupAvatar} alt="" />
                                ) : (
                                    <Camera size={24} />
                                )}
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*"
                                    onChange={handleAvatarSelect}
                                    style={{ display: 'none' }}
                                />
                            </div>

                            {/* Group Name */}
                            <div className={styles.inputGroup}>
                                <label>Group Name *</label>
                                <input
                                    type="text"
                                    placeholder="Enter group name"
                                    value={groupName}
                                    onChange={(e) => setGroupName(e.target.value)}
                                    maxLength={50}
                                    autoFocus
                                />
                            </div>

                            {/* Description */}
                            <div className={styles.inputGroup}>
                                <label>Description (optional)</label>
                                <textarea
                                    placeholder="What's this group about?"
                                    value={groupDesc}
                                    onChange={(e) => setGroupDesc(e.target.value)}
                                    maxLength={200}
                                    rows={2}
                                />
                            </div>
                        </div>

                        {/* Footer */}
                        <div className={styles.footer}>
                            <button className={styles.backBtn} onClick={() => setStep('members')}>
                                Back
                            </button>
                            <button
                                className={styles.createBtn}
                                disabled={!groupName.trim() || creating}
                                onClick={createGroup}
                            >
                                {creating ? 'Creating...' : 'Create Group'}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
