'use client';

import { useState, useRef, useCallback, KeyboardEvent, useEffect } from 'react';
import { Send, Paperclip, X, Sparkles, Clock } from 'lucide-react';
import { compressImage, formatFileSize } from '@/lib/imageCompression';
import { useAppStore } from '@/store/useAppStore';
import { executeSlashCommand, executeTaskCommand } from '@/lib/slashCommands';
import type { MentionedUser, ChatParticipant, GroupRole } from '@/types';
import styles from './MessageInput.module.scss';

interface Props {
    onSend: (text: string, mediaUrl?: string, replyToId?: string, isDisappearing?: boolean, mentions?: MentionedUser[]) => void;
    onTyping?: (isTyping: boolean) => void;
    disabled?: boolean;
    isWorkspace?: boolean;      // only /task commands allowed
    chatId?: string;
    participants?: ChatParticipant[];
    callerGroupRole?: GroupRole;
    onSystemMessage?: (text: string) => void; // for /help etc
    // Edit mode: when set, the input bar becomes an edit bar
    editingMessage?: { id: string; text: string } | null;
    onEditSave?: (id: string, newText: string) => void;
    onEditCancel?: () => void;
}

const SLASH_COMMANDS = [
    { cmd: '/ban', desc: 'Remove user from group' },
    { cmd: '/to', desc: 'Timeout user (minutes)' },
    { cmd: '/promote', desc: 'Promote to admin' },
    { cmd: '/demote', desc: 'Remove admin' },
    { cmd: '/help', desc: 'Show all commands' },
];

export default function MessageInput({
    onSend,
    onTyping,
    disabled,
    isWorkspace = false,
    chatId,
    participants = [],
    callerGroupRole,
    onSystemMessage,
    editingMessage,
    onEditSave,
    onEditCancel,
}: Props) {
    const { currentUser } = useAppStore();
    const [text, setText] = useState('');
    const [mediaPreview, setMediaPreview] = useState<string | null>(null);
    const [mediaFile, setMediaFile] = useState<Blob | null>(null);
    const [mediaInfo, setMediaInfo] = useState<string>('');
    const [hdMode, setHdMode] = useState(false);
    const [isDisappearing, setIsDisappearing] = useState(false);
    const [compressing, setCompressing] = useState(false);
    const [uploading, setUploading] = useState(false);

    // Mention popup
    const [mentionQuery, setMentionQuery] = useState('');
    const [mentionResults, setMentionResults] = useState<ChatParticipant[]>([]);
    const [showMentionPopup, setShowMentionPopup] = useState(false);
    const [selectedMentions, setSelectedMentions] = useState<MentionedUser[]>([]);
    const mentionStartRef = useRef<number>(-1);

    // Slash command popup
    const [showSlashPopup, setShowSlashPopup] = useState(false);
    const [slashFilter, setSlashFilter] = useState('');

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const typingRef = useRef(false);

    const isAdmin = callerGroupRole === 'owner' || callerGroupRole === 'admin';

    // Auto-resize textarea
    const adjustHeight = useCallback(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.style.height = 'auto';
        const maxHeight = 120;
        el.style.height = Math.min(el.scrollHeight, maxHeight) + 'px';
    }, []);

    // Pre-fill input when entering edit mode
    useEffect(() => {
        if (editingMessage) {
            setText(editingMessage.text);
            setTimeout(() => {
                const el = textareaRef.current;
                if (el) {
                    el.focus();
                    el.setSelectionRange(el.value.length, el.value.length);
                    adjustHeight();
                }
            }, 50);
        } else {
            // Reset text when edit is cancelled
            setText('');
        }
    }, [editingMessage, adjustHeight]);

    // Detect @mention and / command typing
    const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const val = e.target.value;
        const cursor = e.target.selectionStart ?? val.length;
        setText(val);
        adjustHeight();

        // --- Slash commands ---
        if (val.startsWith('/') && !val.includes(' ')) {
            setSlashFilter(val.slice(1).toLowerCase());
            setShowSlashPopup(true);
        } else {
            setShowSlashPopup(false);
        }

        // --- @mention detection ---
        const before = val.slice(0, cursor);
        const atIdx = before.lastIndexOf('@');
        if (atIdx !== -1 && (atIdx === 0 || /\s/.test(before[atIdx - 1]))) {
            const query = before.slice(atIdx + 1);
            if (!query.includes(' ')) {
                mentionStartRef.current = atIdx;
                setMentionQuery(query.toLowerCase());
                setShowMentionPopup(true);
            } else {
                setShowMentionPopup(false);
            }
        } else {
            setShowMentionPopup(false);
        }

        // Typing indicator
        if (onTyping) {
            if (!typingRef.current) {
                onTyping(true);
                typingRef.current = true;
            }
            if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
            typingTimeoutRef.current = setTimeout(() => {
                onTyping(false);
                typingRef.current = false;
            }, 3000);
        }
    };

    // Filter participants for mention
    useEffect(() => {
        if (!showMentionPopup) return;
        const q = mentionQuery;
        const filtered = participants.filter(
            (p) =>
                p.user_id !== currentUser?.id &&
                p.user?.display_name?.toLowerCase().includes(q)
        ).slice(0, 6);
        setMentionResults(filtered);
    }, [mentionQuery, showMentionPopup, participants, currentUser?.id]);

    const insertMention = useCallback((participant: ChatParticipant) => {
        const name = participant.user?.display_name || 'User';
        const start = mentionStartRef.current;
        if (start === -1) return;
        const before = text.slice(0, start);
        const after = text.slice(text.indexOf(' ', start + 1) === -1 ? text.length : text.indexOf(' ', start + 1));
        const newText = `${before}@${name} ${after}`;
        setText(newText);
        setSelectedMentions((prev) => {
            if (prev.some((m) => m.id === participant.user_id)) return prev;
            return [...prev, { id: participant.user_id, display_name: name }];
        });
        setShowMentionPopup(false);
        mentionStartRef.current = -1;
        setTimeout(() => textareaRef.current?.focus(), 0);
    }, [text]);

    const insertSlashCommand = useCallback((cmd: string) => {
        setText(cmd + ' ');
        setShowSlashPopup(false);
        setTimeout(() => textareaRef.current?.focus(), 0);
    }, []);

    // File selection
    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) { alert('Only images are supported'); return; }
        setCompressing(true);
        try {
            const { blob, previewUrl } = await compressImage(file, hdMode);
            setMediaPreview(previewUrl);
            setMediaFile(blob);
            setMediaInfo(`${formatFileSize(file.size)} → ${formatFileSize(blob.size)} (${hdMode ? 'HD' : 'Standard'})`);
        } catch (err) {
            console.error('Compression failed:', err);
            alert('Image compression failed');
        }
        setCompressing(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    // Upload + send
    const uploadAndSend = async () => {
        let mediaUrl: string | undefined;

        if (mediaFile) {
            setUploading(true);
            try {
                const formData = new FormData();
                formData.append('file', mediaFile, 'image.webp');
                formData.append('purpose', 'chat');
                const res = await fetch('/api/upload', { method: 'POST', body: formData });
                const data = await res.json();
                if (data.url) {
                    mediaUrl = data.url;
                } else {
                    setUploading(false);
                    return;
                }
            } catch {
                setUploading(false);
                return;
            }
            setUploading(false);
        }

        onSend(text, mediaUrl, undefined, isDisappearing, selectedMentions.length > 0 ? selectedMentions : undefined);

        if (onTyping && typingRef.current) {
            onTyping(false);
            typingRef.current = false;
        }
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

        setText('');
        setMediaPreview(null);
        setMediaFile(null);
        setMediaInfo('');
        setIsDisappearing(false);
        setSelectedMentions([]);
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
    };

    const handleSend = async () => {
        if (disabled || uploading || compressing) return;
        const trimmed = text.trim();

        // Edit mode: save the edit via the callback instead of sending a new message
        if (editingMessage) {
            if (trimmed && trimmed !== editingMessage.text) {
                onEditSave?.(editingMessage.id, trimmed);
            }
            onEditCancel?.(); // always exit edit mode
            setText('');
            if (textareaRef.current) textareaRef.current.style.height = 'auto';
            return;
        }

        // Workspace: only /task allowed
        if (isWorkspace) {
            if (!trimmed.startsWith('/task')) {
                onSystemMessage?.('⚠️ Only /task commands are allowed in Workspace chats.');
                return;
            }
            if (!currentUser || !chatId) return;
            const result = await executeTaskCommand(trimmed, chatId, currentUser.id, participants);
            onSystemMessage?.(result.systemText || result.message);
            setText('');
            return;
        }

        // Slash command (group admins only)
        if (trimmed.startsWith('/') && isAdmin && chatId && currentUser) {
            const result = await executeSlashCommand(
                trimmed,
                chatId,
                currentUser.id,
                callerGroupRole || 'member',
                currentUser.role_weight,
                participants
            );
            onSystemMessage?.(result.systemText || result.message);
            setText('');
            return;
        }

        if (!trimmed && !mediaFile) return;
        uploadAndSend();
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
        if (e.key === 'Escape') {
            setShowMentionPopup(false);
            setShowSlashPopup(false);
            if (editingMessage) onEditCancel?.();
        }
    };

    const clearMedia = () => {
        setMediaPreview(null);
        setMediaFile(null);
        setMediaInfo('');
    };

    const canSend = (text.trim() || mediaFile) && !disabled && !uploading && !compressing;
    const filteredSlashCmds = SLASH_COMMANDS.filter((c) => c.cmd.includes(slashFilter));

    return (
        <div className={`${styles.inputBar} ${editingMessage ? styles.editMode : ''}`}>
            {/* Edit Mode Banner */}
            {editingMessage && (
                <div className={styles.editBanner}>
                    <span>✏️ Editing message</span>
                    <button className={styles.editBannerClose} onClick={() => onEditCancel?.()}>
                        <X size={14} />
                    </button>
                </div>
            )}
            {/* Media Preview */}
            {mediaPreview && (
                <div className={styles.mediaPreview}>
                    <img src={mediaPreview} alt="Preview" />
                    <div className={styles.mediaOverlay}>
                        <span className={styles.mediaSize}>{mediaInfo}</span>
                        <button className={styles.mediaClear} onClick={clearMedia}>
                            <X size={16} />
                        </button>
                    </div>
                </div>
            )}

            {/* Mention popup */}
            {showMentionPopup && mentionResults.length > 0 && (
                <div className={styles.mentionPopup}>
                    {mentionResults.map((p) => (
                        <button
                            key={p.user_id}
                            className={styles.mentionItem}
                            onMouseDown={(e) => { e.preventDefault(); insertMention(p); }}
                        >
                            <div className={styles.mentionAvatar}>
                                {p.user?.pfp_url ? (
                                    <img src={p.user.pfp_url} alt="" />
                                ) : (
                                    <span>{p.user?.display_name?.[0]?.toUpperCase()}</span>
                                )}
                            </div>
                            <span className={styles.mentionName}>{p.user?.display_name}</span>
                        </button>
                    ))}
                </div>
            )}

            {/* Slash command popup */}
            {showSlashPopup && filteredSlashCmds.length > 0 && isAdmin && (
                <div className={styles.slashPopup}>
                    {filteredSlashCmds.map((c) => (
                        <button
                            key={c.cmd}
                            className={styles.slashItem}
                            onMouseDown={(e) => { e.preventDefault(); insertSlashCommand(c.cmd); }}
                        >
                            <span className={styles.slashCmd}>{c.cmd}</span>
                            <span className={styles.slashDesc}>{c.desc}</span>
                        </button>
                    ))}
                </div>
            )}

            <div className={styles.inputWrapper}>
                {/* Attach Button */}
                <button
                    className={styles.attachBtn}
                    onClick={() => fileInputRef.current?.click()}
                    disabled={compressing || uploading || isWorkspace}
                    title="Attach image"
                >
                    <Paperclip size={18} />
                </button>

                {mediaFile && (
                    <>
                        <button
                            className={`${styles.hdBtn} ${hdMode ? styles.hdActive : ''}`}
                            onClick={() => setHdMode(!hdMode)}
                        >
                            <Sparkles size={14} /><span>HD</span>
                        </button>
                        <button
                            className={`${styles.hdBtn} ${isDisappearing ? styles.hdActive : ''}`}
                            onClick={() => setIsDisappearing(!isDisappearing)}
                        >
                            <Clock size={14} /><span>24h</span>
                        </button>
                    </>
                )}

                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileSelect}
                    style={{ display: 'none' }}
                />

                <textarea
                    ref={textareaRef}
                    className={styles.textarea}
                    placeholder={
                        isWorkspace
                            ? 'Type /task @user Description...'
                            : 'Type a message... (@ to mention, / for commands)'
                    }
                    value={text}
                    onChange={handleTextChange}
                    onKeyDown={handleKeyDown}
                    disabled={disabled || uploading}
                    rows={1}
                />

                <button
                    className={`${styles.sendBtn} ${canSend ? styles.active : ''}`}
                    onClick={handleSend}
                    disabled={!canSend}
                >
                    {uploading ? (
                        <div className={styles.spinnerTiny} />
                    ) : (
                        <Send size={18} />
                    )}
                </button>
            </div>
        </div>
    );
}
