'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/useAppStore';
import type { User } from '@/types';
import {
    Users,
    Shield,
    Ban,
    Clock,
    Plus,
    Trash2,
    ChevronDown,
    Database,
} from 'lucide-react';
import styles from './admin.module.scss';

export default function AdminPage() {
    const router = useRouter();
    const { currentUser } = useAppStore();
    const [users, setUsers] = useState<User[]>([]);
    const [whitelist, setWhitelist] = useState<{ id: string; email: string; created_at: string }[]>([]);
    const [newEmail, setNewEmail] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [activeTab, setActiveTab] = useState<'users' | 'whitelist' | 'analytics'>('users');
    const [storageStats, setStorageStats] = useState<{ chat_id: string; name: string; storage_used_bytes: number }[]>([]);

    // Role guard: only role_weight >= 200
    useEffect(() => {
        if (!currentUser) return;
        if (currentUser.role_weight < 200) {
            router.replace('/');
        }
    }, [currentUser, router]);

    useEffect(() => {
        if (!currentUser || currentUser.role_weight < 200) return;
        fetchData();
    }, [currentUser]);

    const fetchData = async () => {
        setLoading(true);
        const [{ data: usersData }, { data: whiteData }, { data: statsData }] = await Promise.all([
            supabase.from('users').select('*').order('role_weight', { ascending: false }),
            supabase.from('whitelist').select('*').order('created_at', { ascending: false }),
            supabase.from('chats').select('id, name, storage_used_bytes').order('storage_used_bytes', { ascending: false }),
        ]);
        setUsers((usersData || []) as User[]);
        setWhitelist(whiteData || []);
        setStorageStats((statsData || []) as { chat_id: string; name: string; storage_used_bytes: number }[]);
        setLoading(false);
    };

    const handleAddWhitelist = async () => {
        if (!newEmail.trim() || !currentUser) return;
        setSaving(true);
        const { data, error } = await supabase
            .from('whitelist')
            .insert({ email: newEmail.toLowerCase().trim(), added_by: currentUser.id })
            .select()
            .single();
        setSaving(false);
        if (!error && data) {
            setWhitelist((w) => [data, ...w]);
            setNewEmail('');
        }
    };

    const handleRemoveWhitelist = async (id: string) => {
        await supabase.from('whitelist').delete().eq('id', id);
        setWhitelist((w) => w.filter((e) => e.id !== id));
    };

    const handleRoleChange = async (userId: string, newWeight: number) => {
        const roleMap: Record<number, string> = {
            200: 'god',
            100: 'management',
            80: 'developer',
            50: 'staff',
            20: 'trial_staff',
            10: 'normal_user',
        };
        await supabase
            .from('users')
            .update({ role_weight: newWeight, role: roleMap[newWeight] || 'staff' })
            .eq('id', userId);
        setUsers((u) => u.map((user) => user.id === userId ? { ...user, role_weight: newWeight } : user));
    };

    const handleBan = async (userId: string, ban: boolean) => {
        await supabase
            .from('users')
            .update({ status: ban ? 'banned' : 'active' })
            .eq('id', userId);
        setUsers((u) => u.map((user) => user.id === userId ? { ...user, status: ban ? 'banned' : 'active' } : user));
    };

    const handleTimeout = async (userId: string, hours: number) => {
        const until = new Date(Date.now() + hours * 3600000).toISOString();
        await supabase
            .from('users')
            .update({ status: 'timeout', timeout_until: until })
            .eq('id', userId);
        setUsers((u) =>
            u.map((user) => user.id === userId ? { ...user, status: 'timeout', timeout_until: until } : user)
        );
    };

    if (!currentUser || currentUser.role_weight < 200) return null;

    const totalStorage = storageStats.reduce((a, c) => a + (c.storage_used_bytes || 0), 0);

    return (
        <div className={styles.page}>
            <div className={styles.sidebar}>
                <h2 className={styles.adminTitle}>
                    <Shield size={20} /> God Mode
                </h2>
                <nav className={styles.nav}>
                    {[
                        { id: 'users', icon: <Users size={16} />, label: 'Users' },
                        { id: 'whitelist', icon: <Plus size={16} />, label: 'Whitelist' },
                        { id: 'analytics', icon: <Database size={16} />, label: 'Analytics' },
                    ].map((tab) => (
                        <button
                            key={tab.id}
                            className={`${styles.navBtn} ${activeTab === tab.id ? styles.active : ''}`}
                            onClick={() => setActiveTab(tab.id as typeof activeTab)}
                        >
                            {tab.icon} {tab.label}
                        </button>
                    ))}
                </nav>
                <div className={styles.stats}>
                    <div className={styles.statCard}>
                        <span className={styles.statValue}>{users.length}</span>
                        <span className={styles.statLabel}>Total Users</span>
                    </div>
                    <div className={styles.statCard}>
                        <span className={styles.statValue}>{users.filter((u) => u.status === 'active').length}</span>
                        <span className={styles.statLabel}>Active</span>
                    </div>
                    <div className={styles.statCard}>
                        <span className={styles.statValue}>{(totalStorage / 1024 / 1024).toFixed(1)} MB</span>
                        <span className={styles.statLabel}>Storage Used</span>
                    </div>
                </div>
            </div>

            <div className={styles.content}>
                {loading ? (
                    <div className={styles.loadingState}><div className={styles.spinner} /></div>
                ) : (
                    <>
                        {/* USERS TAB */}
                        {activeTab === 'users' && (
                            <div className={styles.section}>
                                <h3 className={styles.sectionTitle}>User Management</h3>
                                <div className={styles.userList}>
                                    {users.map((user) => (
                                        <div key={user.id} className={`${styles.userCard} ${user.status !== 'active' ? styles.inactive : ''}`}>
                                            <div className={styles.userAvatar}>
                                                {user.pfp_url ? (
                                                    <img src={user.pfp_url} alt="" />
                                                ) : (
                                                    <span>{user.display_name[0]?.toUpperCase()}</span>
                                                )}
                                            </div>
                                            <div className={styles.userInfo}>
                                                <p className={styles.userName}>{user.display_name}</p>
                                                <p className={styles.userEmail}>{user.email}</p>
                                                {user.status !== 'active' && (
                                                    <span className={styles.statusBadge}>{user.status}</span>
                                                )}
                                            </div>
                                            <div className={styles.userActions}>
                                                {user.id !== currentUser.id && (
                                                    <>
                                                        <select
                                                            className={styles.roleSelect}
                                                            value={user.role_weight}
                                                            onChange={(e) => handleRoleChange(user.id, Number(e.target.value))}
                                                        >
                                                            <option value={200}>God (200)</option>
                                                            <option value={100}>Management (100)</option>
                                                            <option value={80}>Developer (80)</option>
                                                            <option value={50}>Staff (50)</option>
                                                            <option value={20}>Trial Staff (20)</option>
                                                            <option value={10}>Normal (10)</option>
                                                        </select>
                                                        <button
                                                            className={`${styles.actionBtn} ${user.status === 'banned' ? styles.unban : styles.ban}`}
                                                            onClick={() => handleBan(user.id, user.status !== 'banned')}
                                                            title={user.status === 'banned' ? 'Unban' : 'Ban'}
                                                        >
                                                            <Ban size={14} />
                                                        </button>
                                                        <button
                                                            className={styles.actionBtn}
                                                            onClick={() => handleTimeout(user.id, 24)}
                                                            title="Timeout 24h"
                                                        >
                                                            <Clock size={14} />
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* WHITELIST TAB */}
                        {activeTab === 'whitelist' && (
                            <div className={styles.section}>
                                <h3 className={styles.sectionTitle}>Whitelist Management</h3>
                                <div className={styles.addRow}>
                                    <input
                                        className={styles.emailInput}
                                        placeholder="email@example.com"
                                        value={newEmail}
                                        onChange={(e) => setNewEmail(e.target.value)}
                                        type="email"
                                    />
                                    <button
                                        className={styles.addBtn}
                                        onClick={handleAddWhitelist}
                                        disabled={saving || !newEmail.trim()}
                                    >
                                        {saving ? 'Adding...' : 'Add Email'}
                                    </button>
                                </div>
                                <div className={styles.whitelistTable}>
                                    {whitelist.map((entry) => (
                                        <div key={entry.id} className={styles.whitelistRow}>
                                            <span className={styles.whitelistEmail}>{entry.email}</span>
                                            <span className={styles.whitelistDate}>
                                                {new Date(entry.created_at).toLocaleDateString()}
                                            </span>
                                            <button
                                                className={styles.removeBtn}
                                                onClick={() => handleRemoveWhitelist(entry.id)}
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* ANALYTICS TAB */}
                        {activeTab === 'analytics' && (
                            <div className={styles.section}>
                                <h3 className={styles.sectionTitle}>Storage Analytics</h3>
                                <p className={styles.analyticsNote}>
                                    ⚠️ Note: Message content is private. Only storage metadata is shown.
                                </p>
                                <div className={styles.analyticsList}>
                                    {storageStats.map((chat) => (
                                        <div key={chat.chat_id} className={styles.analyticsRow}>
                                            <span className={styles.chatName}>{chat.name || 'DM Chat'}</span>
                                            <div className={styles.barWrapper}>
                                                <div
                                                    className={styles.bar}
                                                    style={{
                                                        width: `${Math.min(100, ((chat.storage_used_bytes || 0) / Math.max(totalStorage, 1)) * 100)}%`,
                                                    }}
                                                />
                                            </div>
                                            <span className={styles.bytes}>
                                                {((chat.storage_used_bytes || 0) / 1024 / 1024).toFixed(2)} MB
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
