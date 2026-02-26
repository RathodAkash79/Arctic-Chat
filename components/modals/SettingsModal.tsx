'use client';

import { useState, useCallback, useRef } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { supabase } from '@/lib/supabase';
import { encryptMessage } from '@/lib/crypto';
import { compressImage } from '@/lib/imageCompression';
import {
    X,
    User,
    Lock,
    Palette,
    MessageSquarePlus,
    Sun,
    Moon,
    Monitor,
    Check,
    Loader2,
    Camera,
} from 'lucide-react';
import type { Theme } from '@/types';
import styles from './SettingsModal.module.scss';

const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
    });
};

const base64ToBlob = async (base64: string): Promise<Blob> => {
    const res = await fetch(base64);
    return res.blob();
};

type Tab = 'profile' | 'security' | 'appearance' | 'feedback';

export default function SettingsModal() {
    const { currentUser, setCurrentUser, theme, setTheme, setIsSettingsOpen } = useAppStore();
    const [activeTab, setActiveTab] = useState<Tab>('profile');

    // Profile tab state
    const [displayName, setDisplayName] = useState(currentUser?.display_name || '');
    const [avatarBase64, setAvatarBase64] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [savingName, setSavingName] = useState(false);
    const [nameSaved, setNameSaved] = useState(false);
    const [nameError, setNameError] = useState('');

    // Security tab state
    const [sendingReset, setSendingReset] = useState(false);
    const [resetSent, setResetSent] = useState(false);

    // Feedback tab state
    const [feedbackText, setFeedbackText] = useState('');
    const [sendingFeedback, setSendingFeedback] = useState(false);
    const [feedbackSent, setFeedbackSent] = useState(false);
    const [feedbackError, setFeedbackError] = useState('');

    const processAvatar = async (file: File) => {
        if (!file.type.startsWith('image/')) {
            alert('Please upload an image file.');
            return;
        }
        try {
            const { blob } = await compressImage(file, false);
            const base64 = await blobToBase64(blob);
            setAvatarBase64(base64);
        } catch {
            alert('Image compression failed');
        }
    };

    const handleAvatarSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) await processAvatar(file);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragging(false);

        const file = e.dataTransfer.files?.[0];
        if (file) {
            await processAvatar(file);
        }
    };

    const handleSaveProfile = useCallback(async () => {
        if (!displayName.trim() || !currentUser) return;

        let hasChanges = false;
        if (displayName.trim() !== currentUser.display_name) hasChanges = true;
        if (avatarBase64) hasChanges = true;

        if (!hasChanges) {
            setNameSaved(true);
            setTimeout(() => setNameSaved(false), 2000);
            return;
        }

        setSavingName(true);
        setNameError('');

        let pfpUrl = currentUser.pfp_url;

        if (avatarBase64) {
            try {
                const avatarBlob = await base64ToBlob(avatarBase64);
                const formData = new FormData();
                formData.append('file', avatarBlob, 'profile-avatar.webp');
                formData.append('purpose', 'profile');

                const res = await fetch('/api/upload', { method: 'POST', body: formData });
                const data = await res.json();
                if (data.url) {
                    pfpUrl = data.url;
                } else {
                    throw new Error('Upload failed');
                }
            } catch (err) {
                console.error("Failed to upload avatar:", err);
                setNameError('Failed to upload avatar');
                setSavingName(false);
                return;
            }
        }

        const { error } = await supabase
            .from('users')
            .update({ display_name: displayName.trim(), pfp_url: pfpUrl })
            .eq('id', currentUser.id);

        setSavingName(false);

        if (error) {
            setNameError('Failed to update profile. Please try again.');
        } else {
            setCurrentUser({ ...currentUser, display_name: displayName.trim(), pfp_url: pfpUrl });
            setAvatarBase64(null);
            setNameSaved(true);
            setTimeout(() => setNameSaved(false), 2000);
        }
    }, [displayName, avatarBase64, currentUser, setCurrentUser]);

    const handlePasswordReset = useCallback(async () => {
        if (!currentUser?.email) return;
        setSendingReset(true);
        await supabase.auth.resetPasswordForEmail(currentUser.email, {
            redirectTo: `${window.location.origin}/auth/reset-password`,
        });
        setSendingReset(false);
        setResetSent(true);
    }, [currentUser]);

    const handleFeedback = useCallback(async () => {
        if (!feedbackText.trim() || !currentUser) return;
        setSendingFeedback(true);
        setFeedbackError('');

        try {
            const encrypted = await encryptMessage(feedbackText.trim());
            const { error } = await supabase.from('feedback').insert({
                user_id: currentUser.id,
                message: encrypted,
            });

            if (error) throw error;
            setFeedbackSent(true);
            setFeedbackText('');
            setTimeout(() => setFeedbackSent(false), 3000);
        } catch {
            setFeedbackError('Failed to submit feedback. Please try again.');
        } finally {
            setSendingFeedback(false);
        }
    }, [feedbackText, currentUser]);

    const tabs: { id: Tab; icon: React.ReactNode; label: string }[] = [
        { id: 'profile', icon: <User size={18} />, label: 'Profile' },
        { id: 'security', icon: <Lock size={18} />, label: 'Security' },
        { id: 'appearance', icon: <Palette size={18} />, label: 'Appearance' },
        { id: 'feedback', icon: <MessageSquarePlus size={18} />, label: 'Feedback' },
    ];

    return (
        <div className={styles.overlay} onClick={() => setIsSettingsOpen(false)}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className={styles.header}>
                    <h2 className={styles.title}>Settings</h2>
                    <button
                        className={styles.closeBtn}
                        onClick={() => setIsSettingsOpen(false)}
                        aria-label="Close settings"
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className={styles.body}>
                    {/* Sidebar Tabs */}
                    <nav className={styles.tabs}>
                        {tabs.map((tab) => (
                            <button
                                key={tab.id}
                                className={`${styles.tab} ${activeTab === tab.id ? styles.tabActive : ''}`}
                                onClick={() => setActiveTab(tab.id)}
                            >
                                {tab.icon}
                                <span>{tab.label}</span>
                            </button>
                        ))}
                    </nav>

                    {/* Tab Content */}
                    <div className={styles.content}>
                        {/* ── PROFILE TAB ── */}
                        {activeTab === 'profile' && (
                            <div className={styles.section}>
                                <h3 className={styles.sectionTitle}>Profile</h3>

                                <div className={styles.profileHeader}>
                                    <div
                                        className={`${styles.profileAvatar} ${isDragging ? styles.dragging : ''}`}
                                        onClick={() => fileInputRef.current?.click()}
                                        onDragOver={handleDragOver}
                                        onDragLeave={handleDragLeave}
                                        onDrop={handleDrop}
                                    >
                                        {avatarBase64 || currentUser?.pfp_url ? (
                                            <img src={avatarBase64 || currentUser?.pfp_url} alt="" />
                                        ) : (
                                            <Camera size={24} />
                                        )}
                                        <div className={styles.avatarOverlay}>
                                            <Camera size={20} />
                                        </div>
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            accept="image/*"
                                            onChange={handleAvatarSelect}
                                            style={{ display: 'none' }}
                                        />
                                    </div>
                                    <div className={styles.profileHeaderInfo}>
                                        <div className={styles.field} style={{ marginBottom: 0 }}>
                                            <label className={styles.label}>Email</label>
                                            <div className={styles.readonlyField}>
                                                {currentUser?.email}
                                            </div>
                                            <span className={styles.hint}>Email cannot be changed here.</span>
                                        </div>
                                    </div>
                                </div>

                                <div className={styles.field}>
                                    <label className={styles.label} htmlFor="display-name">
                                        Display Name
                                    </label>
                                    <div className={styles.inputRow}>
                                        <input
                                            id="display-name"
                                            type="text"
                                            className={styles.input}
                                            value={displayName}
                                            onChange={(e) => setDisplayName(e.target.value)}
                                            placeholder="Your display name"
                                            maxLength={32}
                                            onKeyDown={(e) => e.key === 'Enter' && handleSaveProfile()}
                                        />
                                        <button
                                            className={`${styles.saveBtn} ${nameSaved ? styles.saveBtnSuccess : ''}`}
                                            onClick={handleSaveProfile}
                                            disabled={savingName || !displayName.trim() || (displayName.trim() === currentUser?.display_name && !avatarBase64)}
                                        >
                                            {savingName ? (
                                                <Loader2 size={16} className={styles.spin} />
                                            ) : nameSaved ? (
                                                <><Check size={16} /> Saved</>
                                            ) : (
                                                'Save'
                                            )}
                                        </button>
                                    </div>
                                    {nameError && <span className={styles.error}>{nameError}</span>}
                                </div>
                            </div>
                        )}

                        {/* ── SECURITY TAB ── */}
                        {activeTab === 'security' && (
                            <div className={styles.section}>
                                <h3 className={styles.sectionTitle}>Security</h3>

                                <div className={styles.card}>
                                    <div className={styles.cardInfo}>
                                        <h4>Password</h4>
                                        <p>Send a reset link to <strong>{currentUser?.email}</strong>. Click the link in the email to set a new password.</p>
                                    </div>
                                    {resetSent ? (
                                        <div className={styles.successBadge}>
                                            <Check size={16} /> Reset email sent!
                                        </div>
                                    ) : (
                                        <button
                                            className={styles.dangerBtn}
                                            onClick={handlePasswordReset}
                                            disabled={sendingReset}
                                        >
                                            {sendingReset ? (
                                                <Loader2 size={16} className={styles.spin} />
                                            ) : (
                                                'Send Reset Email'
                                            )}
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* ── APPEARANCE TAB ── */}
                        {activeTab === 'appearance' && (
                            <div className={styles.section}>
                                <h3 className={styles.sectionTitle}>Appearance</h3>

                                <div className={styles.field}>
                                    <label className={styles.label}>Theme</label>
                                    <div className={styles.themeOptions}>
                                        {(
                                            [
                                                { value: 'light', icon: <Sun size={20} />, label: 'Light' },
                                                { value: 'dark', icon: <Moon size={20} />, label: 'Dark' },
                                                { value: 'system', icon: <Monitor size={20} />, label: 'System' },
                                            ] as { value: Theme; icon: React.ReactNode; label: string }[]
                                        ).map((opt) => (
                                            <button
                                                key={opt.value}
                                                className={`${styles.themeBtn} ${theme === opt.value ? styles.themeActive : ''}`}
                                                onClick={() => setTheme(opt.value)}
                                            >
                                                {opt.icon}
                                                <span>{opt.label}</span>
                                                {theme === opt.value && (
                                                    <Check size={14} className={styles.themeCheck} />
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                    <span className={styles.hint}>
                                        &ldquo;System&rdquo; follows your OS dark/light preference.
                                    </span>
                                </div>
                            </div>
                        )}

                        {/* ── FEEDBACK TAB ── */}
                        {activeTab === 'feedback' && (
                            <div className={styles.section}>
                                <h3 className={styles.sectionTitle}>Feedback & Reports</h3>
                                <p className={styles.sectionDesc}>
                                    Report a bug, suggest an improvement, or share any concern. Your message is encrypted before storage.
                                </p>

                                <div className={styles.field}>
                                    <label className={styles.label} htmlFor="feedback-text">
                                        Your message
                                    </label>
                                    <textarea
                                        id="feedback-text"
                                        className={styles.textarea}
                                        value={feedbackText}
                                        onChange={(e) => setFeedbackText(e.target.value)}
                                        placeholder="Describe your feedback or report..."
                                        rows={5}
                                        maxLength={2000}
                                    />
                                    <span className={styles.charCount}>
                                        {feedbackText.length} / 2000
                                    </span>
                                </div>

                                {feedbackError && (
                                    <div className={styles.errorBox}>{feedbackError}</div>
                                )}
                                {feedbackSent && (
                                    <div className={styles.successBox}>
                                        <Check size={16} /> Thank you! Your feedback has been submitted.
                                    </div>
                                )}

                                <button
                                    className={styles.submitBtn}
                                    onClick={handleFeedback}
                                    disabled={sendingFeedback || !feedbackText.trim()}
                                >
                                    {sendingFeedback ? (
                                        <><Loader2 size={16} className={styles.spin} /> Sending...</>
                                    ) : (
                                        'Submit Feedback'
                                    )}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
