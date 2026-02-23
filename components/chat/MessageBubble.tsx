'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { resolveImageUrl } from '@/lib/utils';
import type { Message } from '@/types';
import { Pencil, Trash2, Reply, X, Check } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { encryptMessage, decryptMessage } from '@/lib/crypto';
import styles from './MessageBubble.module.scss';

interface Props {
    message: Message;
    isOwn: boolean;
    showTail: boolean;
    showName: boolean;
    isGroup: boolean;
    onReply?: (msg: Message) => void;
}

function formatMsgTime(dateStr: string) {
    const d = new Date(dateStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function MessageBubble({
    message,
    isOwn,
    showTail,
    showName,
    isGroup,
    onReply,
}: Props) {
    const { currentChat, currentUser, messages } = useAppStore();
    const [displayText, setDisplayText] = useState<string | null>(null);
    const [replySourceText, setReplySourceText] = useState<string | null>(null);
    const [editing, setEditing] = useState(false);
    const [editText, setEditText] = useState('');
    const [saving, setSaving] = useState(false);

    // Decrypt message text on mount
    useEffect(() => {
        if (message.is_deleted || !message.text || message.text === '[Media]') {
            setDisplayText(null);
            return;
        }
        decryptMessage(message.text).then(setDisplayText).catch(() => setDisplayText(message.text));
    }, [message.text, message.is_deleted]);

    // Find and decrypt reply source
    const replySource = useMemo(() => {
        if (!message.reply_to_id) return null;
        return messages.find((m) => m.id === message.reply_to_id) || null;
    }, [message.reply_to_id, messages]);

    useEffect(() => {
        if (!replySource) { setReplySourceText(null); return; }
        if (replySource.is_deleted) { setReplySourceText('Message deleted'); return; }
        decryptMessage(replySource.text)
            .then(setReplySourceText)
            .catch(() => setReplySourceText(replySource.text));
    }, [replySource]);

    const mediaUrl = useMemo(
        () => (message.media_url ? resolveImageUrl(message.media_url) : null),
        [message.media_url]
    );

    const senderName = useMemo(() => {
        if (!isGroup || isOwn || !showName) return null;
        const p = currentChat?.participants?.find((p) => p.user_id === message.sender_id);
        return p?.user?.display_name || 'User';
    }, [isGroup, isOwn, showName, currentChat, message.sender_id]);

    // Can edit within 15 mins of creation
    const canEdit = useMemo(() => {
        if (!isOwn || message.is_deleted) return false;
        return Date.now() - new Date(message.created_at).getTime() < 15 * 60 * 1000;
    }, [isOwn, message.created_at, message.is_deleted]);

    const handleDelete = useCallback(async () => {
        await supabase
            .from('messages')
            .update({ is_deleted: true, text: '[deleted]' })
            .eq('id', message.id);
        useAppStore.setState((s) => ({
            messages: s.messages.map((m) =>
                m.id === message.id ? { ...m, is_deleted: true, text: '[deleted]' } : m
            ),
        }));
    }, [message.id]);

    const handleStartEdit = useCallback(() => {
        setEditText(displayText || '');
        setEditing(true);
    }, [displayText]);

    const handleSaveEdit = useCallback(async () => {
        if (!editText.trim() || saving) return;
        setSaving(true);
        const encrypted = await encryptMessage(editText.trim());
        const { error } = await supabase
            .from('messages')
            .update({ text: encrypted, edited_at: new Date().toISOString() })
            .eq('id', message.id);
        setSaving(false);
        if (!error) {
            useAppStore.setState((s) => ({
                messages: s.messages.map((m) =>
                    m.id === message.id
                        ? { ...m, text: encrypted, edited_at: new Date().toISOString() }
                        : m
                ),
            }));
            setEditing(false);
        }
    }, [editText, saving, message.id]);

    const handleReply = useCallback(() => {
        onReply?.(message);
    }, [message, onReply]);

    if (message.is_deleted) {
        return (
            <div className={`${styles.wrapper} ${isOwn ? styles.own : styles.other}`}>
                <div className={`${styles.bubble} ${styles.deleted}`}>
                    <span className={styles.deletedText}>🚫 This message was deleted</span>
                </div>
            </div>
        );
    }

    return (
        <div
            className={`${styles.wrapper} ${isOwn ? styles.own : styles.other} ${showTail ? styles.tail : ''}`}
        >
            {/* Context Action Buttons */}
            <div className={`${styles.actions} ${isOwn ? styles.actionsOwn : styles.actionsOther}`}>
                {onReply && (
                    <button className={styles.actionBtn} onClick={handleReply} title="Reply">
                        <Reply size={13} />
                    </button>
                )}
                {isOwn && canEdit && (
                    <button className={styles.actionBtn} onClick={handleStartEdit} title="Edit">
                        <Pencil size={13} />
                    </button>
                )}
                {isOwn && (
                    <button
                        className={`${styles.actionBtn} ${styles.danger}`}
                        onClick={handleDelete}
                        title="Delete"
                    >
                        <Trash2 size={13} />
                    </button>
                )}
            </div>

            <div className={`${styles.bubble} ${mediaUrl ? styles.mediaBubble : ''}`}>
                {senderName && <span className={styles.senderName}>{senderName}</span>}

                {/* Reply Preview */}
                {replySource && (
                    <div className={styles.replyPreview}>
                        <span className={styles.replyAuthor}>
                            {replySource.sender_id === currentUser?.id
                                ? 'You'
                                : currentChat?.participants?.find(
                                    (p) => p.user_id === replySource.sender_id
                                )?.user?.display_name || 'User'}
                        </span>
                        <span className={styles.replyText}>
                            {replySource.media_url ? '📷 Photo' : replySourceText || '...'}
                        </span>
                    </div>
                )}

                {mediaUrl && (
                    <a
                        href={mediaUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.mediaImage}
                    >
                        <img src={mediaUrl} alt="" loading="lazy" />
                    </a>
                )}

                {/* Edit Mode */}
                {editing ? (
                    <div className={styles.editArea}>
                        <textarea
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            className={styles.editInput}
                            rows={2}
                            autoFocus
                        />
                        <div className={styles.editActions}>
                            <button
                                className={styles.editSave}
                                onClick={handleSaveEdit}
                                disabled={saving}
                            >
                                <Check size={14} />
                            </button>
                            <button
                                className={styles.editCancel}
                                onClick={() => setEditing(false)}
                            >
                                <X size={14} />
                            </button>
                        </div>
                    </div>
                ) : (
                    displayText && (
                        <span className={styles.text}>
                            {displayText.split(/(https?:\/\/[^\s]+)/g).map((part, i) =>
                                part.match(/^https?:\/\//) ? (
                                    <a
                                        key={i}
                                        href={part}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className={styles.link}
                                    >
                                        {part}
                                    </a>
                                ) : (
                                    <span key={i}>{part}</span>
                                )
                            )}
                        </span>
                    )
                )}

                <span className={styles.meta}>
                    {message.edited_at && (
                        <span className={styles.edited}>edited</span>
                    )}
                    <span className={styles.time}>{formatMsgTime(message.created_at)}</span>
                </span>
            </div>
        </div>
    );
}
