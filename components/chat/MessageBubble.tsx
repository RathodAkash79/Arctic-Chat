'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAppStore } from '@/store/useAppStore';
import { resolveImageUrl } from '@/lib/utils';
import type { Message, MessageEditHistory } from '@/types';
import { ChevronDown, Clock, AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { decryptMessage } from '@/lib/crypto';
import styles from './MessageBubble.module.scss';

interface Props {
    message: Message;
    isOwn: boolean;
    showTail: boolean;
    showName: boolean;
    isGroup: boolean;
    onReply?: (msg: Message) => void;
    onEditRequest?: (msg: Message, decryptedText: string) => void;
    onPin?: (msg: Message) => void;
    isPinned?: boolean;
}

function formatMsgTime(dateStr: string) {
    const d = new Date(dateStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const FIFTEEN_MINUTES = 15 * 60 * 1000;

export default function MessageBubble({
    message,
    isOwn,
    showTail,
    showName,
    isGroup,
    onReply,
    onEditRequest,
    onPin,
    isPinned,
}: Props) {
    const router = useRouter();
    const { currentChat, currentUser, messages, setCurrentChat, setIsMobileChatOpen } = useAppStore();
    const [displayText, setDisplayText] = useState<string | null>(null);
    const [replySourceText, setReplySourceText] = useState<string | null>(null);
    const [showHistory, setShowHistory] = useState(false);
    const [editHistory, setEditHistory] = useState<MessageEditHistory[]>([]);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [showDropdown, setShowDropdown] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);


    // Close dropdown on outside click
    useEffect(() => {
        if (!showDropdown) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setShowDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showDropdown]);

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

    // Sender info for group chats (other people's messages)
    const senderParticipant = useMemo(() => {
        if (!isGroup || isOwn || !showName) return null;
        return currentChat?.participants?.find((p) => p.user_id === message.sender_id) || null;
    }, [isGroup, isOwn, showName, currentChat, message.sender_id]);

    const senderName = senderParticipant?.user?.display_name || 'User';

    // 15-minute window check (updated reactively would need a timer, but useMemo is ok for render)
    const isWithin15Min = useMemo(
        () => Date.now() - new Date(message.created_at).getTime() < FIFTEEN_MINUTES,
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [message.created_at]
    );

    const canEdit = isOwn && !message.is_deleted && isWithin15Min;
    const canDelete = isOwn && !message.is_deleted && isWithin15Min;

    // Open DM with sender
    const handleClickSender = useCallback(async () => {
        if (!senderParticipant || !currentUser) return;
        const targetUserId = senderParticipant.user_id;
        if (targetUserId === currentUser.id) return;

        // FAST PATH: Check if DM already in local store
        const existingLocal = useAppStore.getState().chats.find(
            (c) => c.type === 'dm' && c.participants?.some((p) => p.user_id === targetUserId)
        );
        if (existingLocal) {
            setCurrentChat(existingLocal);
            setIsMobileChatOpen(true);
            router.push(`/${existingLocal.id}`);
            return;
        }

        try {
            const { data, error } = await supabase.rpc('get_or_create_dm_chat_v2', {
                target_user_id: targetUserId,
            });
            if (error) {
                console.error('RPC Error details:', error);
                throw new Error(error.message || 'Unknown RPC error');
            }
            if (data) {
                router.push(`/${data}`);
            }
        } catch (err: any) {
            console.error('Failed to open DM:', err.message || err);
        }
    }, [senderParticipant, currentUser, router, setCurrentChat, setIsMobileChatOpen]);

    const handleScrollToMessage = (id: string) => {
        const el = document.getElementById(`msg-${id}`);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add(styles.highlightFade);
            setTimeout(() => el.classList.remove(styles.highlightFade), 2000);
        }
    };

    const handleDelete = useCallback(async () => {
        if (!canDelete) return;
        const { error } = await supabase
            .from('messages')
            .update({ is_deleted: true, text: '[deleted]' })
            .eq('id', message.id);
        if (error) {
            console.error('Delete failed:', error.message, error.code, error.hint);
            return;
        }
        useAppStore.setState((s) => ({
            messages: s.messages.map((m) =>
                m.id === message.id ? { ...m, is_deleted: true, text: '[deleted]' } : m
            ),
        }));
    }, [message.id, canDelete]);


    const handleShowHistory = useCallback(async () => {
        if (showHistory) { setShowHistory(false); return; }
        setLoadingHistory(true);
        const { data } = await supabase
            .from('message_edit_history')
            .select('*')
            .eq('message_id', message.id)
            .order('edited_at', { ascending: false });

        if (data) {
            const decrypted = await Promise.all(
                data.map(async (h) => ({
                    ...h,
                    old_text: await decryptMessage(h.old_text).catch(() => h.old_text),
                }))
            );
            setEditHistory(decrypted as MessageEditHistory[]);
        }
        setLoadingHistory(false);
        setShowHistory(true);
    }, [showHistory, message.id]);

    const handleReply = useCallback(() => {
        onReply?.(message);
    }, [message, onReply]);

    // Render text with @mention highlighting
    const renderTextWithMentions = useCallback((text: string) => {
        const mentions = message.mentions || [];
        if (mentions.length === 0) {
            // Still parse URLs
            return text.split(/(https?:\/\/[^\s]+)/g).map((part, i) =>
                part.match(/^https?:\/\//) ? (
                    <a key={i} href={part} target="_blank" rel="noopener noreferrer" className={styles.link}>{part}</a>
                ) : <span key={i}>{part}</span>
            );
        }

        // Build regex from mention names
        const names = mentions.map((m) => m.display_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        const mentionRegex = new RegExp(`(@(?:${names.join('|')}))`, 'g');

        return text.split(/(https?:\/\/[^\s]+)/g).flatMap((urlPart, ui) => {
            if (urlPart.match(/^https?:\/\//)) {
                return [<a key={`u${ui}`} href={urlPart} target="_blank" rel="noopener noreferrer" className={styles.link}>{urlPart}</a>];
            }
            return urlPart.split(mentionRegex).map((seg, si) => {
                const isMention = mentionRegex.test(seg);
                if (isMention) {
                    const mentionName = seg.replace(/^@/, '');
                    const mUser = mentions.find(m => m.display_name === mentionName);
                    return (
                        <span
                            key={`m${ui}-${si}`}
                            className={styles.mention}
                            onClick={async (e) => {
                                e.stopPropagation();
                                if (mUser) {
                                    // FAST PATH: Check if DM already in local store
                                    const existingLocal = useAppStore.getState().chats.find(
                                        (c) => c.type === 'dm' && c.participants?.some((p) => p.user_id === mUser.id)
                                    );
                                    if (existingLocal) {
                                        setCurrentChat(existingLocal);
                                        setIsMobileChatOpen(true);
                                        router.push(`/${existingLocal.id}`);
                                        return;
                                    }

                                    try {
                                        const { data, error } = await supabase.rpc('get_or_create_dm_chat_v2', { target_user_id: mUser.id });
                                        if (error) throw error;
                                        if (data) router.push(`/${data}`);
                                    } catch (err: any) {
                                        console.error('Mention DM failed:', err.message || err);
                                    }
                                }
                            }}
                        >
                            {seg}
                        </span>
                    );
                }
                return <span key={`t${ui}-${si}`}>{seg}</span>;
            });
        });
    }, [message.mentions, router, setCurrentChat, setIsMobileChatOpen]);

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
            id={`msg-${message.id}`}
            className={`${styles.wrapper} ${isOwn ? styles.own : styles.other} ${showTail ? styles.tail : ''}`}
            onDoubleClick={handleReply}
        >
            <div className={`${styles.bubble} ${mediaUrl ? styles.mediaBubble : ''}`}>
                {/* Sender Name INSIDE bubble (group, other people) */}
                {senderParticipant && (
                    <div
                        className={styles.senderRow}
                        onClick={handleClickSender}
                        title={`Open DM with ${senderName}`}
                    >
                        <span className={styles.senderName}>{senderName}</span>
                    </div>
                )}

                {/* 3-Dots Dropdown Menu */}
                {(onReply || canEdit || canDelete) && (
                    <div className={styles.dropdownContainer} ref={dropdownRef}>
                        <button
                            className={styles.chevronBtn}
                            onClick={(e) => { e.stopPropagation(); setShowDropdown(!showDropdown); }}
                        >
                            <ChevronDown size={14} />
                        </button>
                        {showDropdown && (
                            <div className={styles.dropdownMenu}>
                                {onReply && (
                                    <button onClick={(e) => { e.stopPropagation(); setShowDropdown(false); handleReply(); }}>
                                        Reply
                                    </button>
                                )}
                                {canEdit && (
                                    <button onClick={(e) => { e.stopPropagation(); setShowDropdown(false); onEditRequest?.(message, displayText || ''); }}>
                                        Edit
                                    </button>
                                )}
                                {onPin && (
                                    <button onClick={(e) => { e.stopPropagation(); setShowDropdown(false); onPin(message); }}>
                                        {isPinned ? '📌 Unpin' : '📌 Pin'}
                                    </button>
                                )}
                                {canDelete && (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setShowDropdown(false); handleDelete(); }}
                                        className={styles.dangerItem}
                                    >
                                        Delete
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                )}
                {/* Reply Preview */}
                {replySource && (
                    <div
                        className={styles.replyPreview}
                        onClick={(e) => {
                            e.stopPropagation();
                            handleScrollToMessage(message.reply_to_id!);
                        }}
                    >
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

                {/* Instagram Style Edit History (Inline) */}
                {showHistory && editHistory.length > 0 && (
                    <div className={styles.inlineHistory}>
                        {loadingHistory && <div className={styles.historyLoading}>Loading…</div>}
                        {editHistory.map((h) => (
                            <div key={h.id} className={styles.historyEntry}>
                                <p className={styles.historyText}>{h.old_text}</p>
                            </div>
                        ))}
                    </div>
                )}

                {/* Message Text */}
                {displayText && (
                    <span className={styles.text}>
                        {renderTextWithMentions(displayText)}
                    </span>
                )}

                {/* Time + Sending indicator */}
                <span className={styles.metaContainer}>
                    {message.edited_at && (
                        <span
                            className={styles.editedTag}
                            onClick={handleShowHistory}
                            title="View old text"
                        >
                            {showHistory ? 'hide edits' : 'edited'}
                        </span>
                    )}
                    <span className={styles.time}>{formatMsgTime(message.created_at)}</span>
                    {message.is_pending && isOwn && !message.is_failed && (
                        <span className={styles.pendingIcon} title="Sending...">
                            <Clock size={10} />
                        </span>
                    )}
                    {message.is_failed && isOwn && (
                        <span
                            className={styles.failedIcon}
                            title="Failed to send. Tap to retry."
                            onClick={(e) => {
                                e.stopPropagation();
                                window.dispatchEvent(new CustomEvent('retry-message', { detail: { msgId: message.id } }));
                            }}
                        >
                            <AlertCircle size={14} />
                            <span className={styles.retryText}>Retry</span>
                        </span>
                    )}
                </span>
            </div>
        </div>
    );
}
