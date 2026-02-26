'use client';

import { useState, useRef, useCallback, KeyboardEvent, useEffect } from 'react';
import { Send, Paperclip, X, Sparkles, Clock } from 'lucide-react';
import { compressImage, formatFileSize } from '@/lib/imageCompression';
import { useAppStore } from '@/store/useAppStore';
import { executeSlashCommand, executeTaskCommand } from '@/lib/slashCommands';
import { supabase } from '@/lib/supabase';
import { useChats } from '@/hooks/useChats';
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
    { cmd: '/ban', usage: '/ban @user [reason]', desc: 'Ban user (admin/owner)', fields: [{ name: 'user', placeholder: '@username' }, { name: 'reason', placeholder: 'Optional reason' }] },
    { cmd: '/unban', usage: '/unban @user', desc: 'Unban user (admin/owner)', fields: [{ name: 'user', placeholder: '@username' }] },
    { cmd: '/to', usage: '/to @user [mins] [reason]', desc: 'Timeout user (admin/owner)', fields: [{ name: 'user', placeholder: '@username' }, { name: 'duration', placeholder: 'mins' }, { name: 'reason', placeholder: 'Optional reason' }] },
    { cmd: '/untimeout', usage: '/untimeout @user', desc: 'Remove timeout (admin/owner)', fields: [{ name: 'user', placeholder: '@username' }] },
    { cmd: '/mute', usage: '/mute @user [reason]', desc: 'Mute user (admin/owner)', fields: [{ name: 'user', placeholder: '@username' }, { name: 'reason', placeholder: 'Optional reason' }] },
    { cmd: '/unmute', usage: '/unmute @user', desc: 'Unmute user (admin/owner)', fields: [{ name: 'user', placeholder: '@username' }] },
    { cmd: '/kick', usage: '/kick @user [reason]', desc: 'Kick user (admin/owner)', fields: [{ name: 'user', placeholder: '@username' }, { name: 'reason', placeholder: 'Optional reason' }] },
    { cmd: '/warn', usage: '/warn @user [reason]', desc: 'Warn user (admin/owner)', fields: [{ name: 'user', placeholder: '@username' }, { name: 'reason', placeholder: 'Reason' }] },
    { cmd: '/announce', usage: '/announce [message]', desc: 'Send announcement (admin/owner)', fields: [{ name: 'message', placeholder: 'Your announcement...' }] },
    { cmd: '/promote', usage: '/promote @user', desc: 'Make admin (owner only)', fields: [{ name: 'user', placeholder: '@username' }] },
    { cmd: '/demote', usage: '/demote @user', desc: 'Remove admin (owner only)', fields: [{ name: 'user', placeholder: '@username' }] },
    { cmd: '/slowmode', usage: '/slowmode [seconds]', desc: 'Set slowmode (owner only)', fields: [{ name: 'seconds', placeholder: '0 to disable' }] },
    { cmd: '/nuke', usage: '/nuke', desc: 'Delete ALL messages (owner only)', fields: [] },
    { cmd: '/help', usage: '/help', desc: 'Show all commands', fields: [] },
];

const TASK_COMMAND = { cmd: '/task', usage: '/task @user description', desc: 'Assign task', fields: [{ name: 'user', placeholder: '@username' }, { name: 'description', placeholder: 'Task description' }] };

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
    const { fetchChats } = useChats();
    const [text, setText] = useState(() => {
        if (typeof window !== 'undefined' && chatId) {
            return localStorage.getItem(`draft_${chatId}_${currentUser?.id}`) || '';
        }
        return '';
    });
    const [mediaPreview, setMediaPreview] = useState<string | null>(null);
    const [mediaFile, setMediaFile] = useState<Blob | null>(null);
    const [mediaInfo, setMediaInfo] = useState<string>('');
    const [hdMode, setHdMode] = useState(false);
    const [isDisappearing, setIsDisappearing] = useState(false);
    const [compressing, setCompressing] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [slowmodeUntil, setSlowmodeUntil] = useState<number | null>(null);
    const slowmodeRef = useRef<number | null>(null);

    // Mention popup
    const [mentionQuery, setMentionQuery] = useState('');
    const [mentionResults, setMentionResults] = useState<ChatParticipant[]>([]);
    const [showMentionPopup, setShowMentionPopup] = useState(false);
    const [selectedMentions, setSelectedMentions] = useState<MentionedUser[]>([]);
    const mentionStartRef = useRef<number>(-1);

    // Slash command popup
    const [showSlashPopup, setShowSlashPopup] = useState(false);
    const [slashFilter, setSlashFilter] = useState('');

    // Command Mode State
    const [activeCommand, setActiveCommand] = useState<string | null>(null);
    const [commandArgs, setCommandArgs] = useState<string[]>([]);
    const commandInputRefs = useRef<(HTMLInputElement | null)[]>([]);

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const typingRef = useRef(false);

    // ── Slowmode Countdown ──
    useEffect(() => {
        if (!slowmodeUntil) return;
        const interval = setInterval(() => {
            const remaining = slowmodeUntil - Date.now();
            if (remaining <= 0) {
                setSlowmodeUntil(null);
                clearInterval(interval);
            }
        }, 1000);
        return () => clearInterval(interval);
    }, [slowmodeUntil]);

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
            setActiveCommand(null);
            setTimeout(() => {
                const el = textareaRef.current;
                if (el) {
                    el.focus();
                    el.setSelectionRange(el.value.length, el.value.length);
                    adjustHeight();
                }
            }, 50);
        } else {
            setText('');
        }
    }, [editingMessage, adjustHeight]);

    // Detect @mention and / command typing
    const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const val = e.target.value;
        const cursor = e.target.selectionStart ?? val.length;
        setText(val);

        // Save draft
        if (chatId && currentUser) {
            localStorage.setItem(`draft_${chatId}_${currentUser.id}`, val);
        }
        adjustHeight();

        // --- Slash commands ---
        if (val.startsWith('/')) {
            const firstWord = val.split(/\s+/)[0];
            setSlashFilter(firstWord.slice(1).toLowerCase());
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

        setSelectedMentions((prev) => {
            if (prev.some((m) => m.id === participant.user_id)) return prev;
            return [...prev, { id: participant.user_id, display_name: name }];
        });

        if (activeCommand) {
            setCommandArgs((prev) => {
                const arr = [...prev];
                arr[0] = `@${name} `; // Append space for natural flow
                return arr;
            });
            setShowMentionPopup(false);
            setTimeout(() => {
                if (commandInputRefs.current.length > 1) {
                    commandInputRefs.current[1]?.focus();
                } else {
                    commandInputRefs.current[0]?.focus();
                }
            }, 0);
        } else {
            const start = mentionStartRef.current;
            if (start === -1) return;
            const before = text.slice(0, start);
            const after = text.slice(text.indexOf(' ', start + 1) === -1 ? text.length : text.indexOf(' ', start + 1));
            const newText = `${before}@${name} ${after}`;
            setText(newText);
            setShowMentionPopup(false);
            mentionStartRef.current = -1;
            setTimeout(() => textareaRef.current?.focus(), 0);
        }
    }, [text, activeCommand]);

    const handleSendOverride = async (overrideText: string) => {
        await processSend(overrideText);
    };

    const insertSlashCommand = useCallback((cmdDef: { cmd: string, fields: any[] }) => {
        setText('');
        setShowSlashPopup(false);

        if (cmdDef.cmd === '/help') {
            handleSendOverride(cmdDef.cmd);
            return;
        }

        setActiveCommand(cmdDef.cmd);
        setCommandArgs(Array(cmdDef.fields.length).fill(''));

        setTimeout(() => {
            if (cmdDef.fields.length > 0) {
                commandInputRefs.current[0]?.focus();

                // If the first field is 'user' and the user clicked it, trigger mention popup immediately
                if (cmdDef.fields[0].name === 'user') {
                    setMentionQuery('');
                    setShowMentionPopup(true);
                }
            }
        }, 0);
    }, []);

    const resetInput = () => {
        setText('');
        if (chatId && currentUser) {
            localStorage.removeItem(`draft_${chatId}_${currentUser.id}`);
        }
        setActiveCommand(null);
        setCommandArgs([]);
        setSelectedMentions([]);
        setShowMentionPopup(false);
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
        setTimeout(() => textareaRef.current?.focus(), 0);
    }

    const processSend = async (finalRawInput: string) => {
        if (disabled || uploading || compressing) return;

        const trimmed = finalRawInput;

        // Edit mode
        if (editingMessage) {
            if (trimmed && trimmed !== editingMessage.text) {
                onEditSave?.(editingMessage.id, trimmed);
            }
            onEditCancel?.();
            setText('');
            if (textareaRef.current) textareaRef.current.style.height = 'auto';
            return;
        }

        // Workspace
        if (isWorkspace) {
            if (!trimmed.startsWith('/task')) {
                onSystemMessage?.('⚠️ Only /task commands are allowed in Workspace chats.');
                return;
            }
            if (!currentUser || !chatId) return;
            const result = await executeTaskCommand(trimmed, chatId, currentUser.id, participants, selectedMentions);
            onSystemMessage?.(result.systemText || result.message);
            resetInput();
            return;
        }

        // Slash command
        if (trimmed.startsWith('/') && isAdmin && chatId && currentUser) {
            const result = await executeSlashCommand(
                trimmed,
                chatId,
                currentUser.id,
                callerGroupRole || 'member',
                currentUser.role_weight,
                participants,
                selectedMentions,
                async (urls) => {
                    const { data: { session } } = await supabase.auth.getSession();
                    if (!session) return;
                    await fetch('/api/media/delete', {
                        method: 'POST',
                        body: JSON.stringify({ keys: urls }),
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${session.access_token}`
                        }
                    });
                }
            );
            onSystemMessage?.(result.systemText || result.message);

            if (result.success) {
                const cmdName = trimmed.split(' ')[0].toLowerCase();
                // Refresh chats if a moderation command was used to sync participant roles/bans
                if (['/promote', '/demote', '/kick', '/ban', '/unban'].includes(cmdName)) {
                    fetchChats();
                }
            }

            // Handle slowmode update if it was the slowmode command
            if (trimmed.startsWith('/slowmode')) {
                // The actual enforcement is done server-side, but we can refresh local UI
                // by optionally re-fetching chat data if needed.
            }

            resetInput();
            return;
        }

        if (!trimmed && !mediaFile) return;
        uploadAndSend(trimmed);
    };

    const handleSendBtn = async () => {
        let finalRawInput = text.trim();

        if (activeCommand && activeCommand !== '/help') {
            if (!commandArgs[0]) {
                commandInputRefs.current[0]?.focus();
                return;
            }
            finalRawInput = activeCommand + ' ' + commandArgs.join(' ').trim();
        }

        await processSend(finalRawInput);
    };

    const uploadAndSend = async (finalText: string) => {
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

        onSend(finalText, mediaUrl, undefined, isDisappearing, selectedMentions.length > 0 ? selectedMentions : undefined);

        // Update slowmode if applicable
        const currentChat = useAppStore.getState().currentChat;
        if (currentChat?.slowmode_seconds && !isAdmin) {
            const until = Date.now() + (currentChat.slowmode_seconds * 1000);
            setSlowmodeUntil(until);
            slowmodeRef.current = until;
        }

        if (onTyping && typingRef.current) {
            onTyping(false);
            typingRef.current = false;
        }
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

        resetInput();
        clearMedia();
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendBtn();
        }
        if (e.key === 'Escape') {
            setShowMentionPopup(false);
            setShowSlashPopup(false);
            if (editingMessage) onEditCancel?.();
        }
    };

    // --- Command Mode Specific Handlers ---
    const activeCmdDef = isWorkspace && activeCommand === '/task'
        ? TASK_COMMAND
        : SLASH_COMMANDS.find(c => c.cmd === activeCommand);

    const handleCommandArgChange = (index: number, val: string) => {
        const newArgs = [...commandArgs];
        newArgs[index] = val;
        setCommandArgs(newArgs);

        if (index === 0) {
            const query = val.replace(/^@/, '').toLowerCase();
            setMentionQuery(query);
            setShowMentionPopup(true);
        }
    };

    const handleCommandKeyDown = (e: KeyboardEvent<HTMLInputElement>, index: number) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (showMentionPopup && mentionResults.length > 0 && index === 0) {
                insertMention(mentionResults[0]);
                return;
            }
            if (index < (activeCmdDef?.fields.length || 0) - 1) {
                commandInputRefs.current[index + 1]?.focus();
            } else {
                handleSendBtn();
            }
        } else if (e.key === 'Backspace' && !commandArgs[index]) {
            e.preventDefault();
            if (index > 0) {
                commandInputRefs.current[index - 1]?.focus();
            } else {
                setActiveCommand(null);
                setCommandArgs([]);
                setTimeout(() => textareaRef.current?.focus(), 0);
                setShowMentionPopup(false);
            }
        } else if (e.key === 'Escape') {
            setShowMentionPopup(false);
            setActiveCommand(null);
            setTimeout(() => textareaRef.current?.focus(), 0);
        } else if (e.key === 'Tab') {
            e.preventDefault();
            if (showMentionPopup && mentionResults.length > 0 && index === 0) {
                insertMention(mentionResults[0]);
                return;
            }
            if (index < (activeCmdDef?.fields.length || 0) - 1) {
                commandInputRefs.current[index + 1]?.focus();
            } else {
                handleSendBtn();
            }
        }
    };

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

    const clearMedia = () => {
        setMediaPreview(null);
        setMediaFile(null);
        setMediaInfo('');
    };

    const canSend = ((activeCommand && commandArgs[0]) || text.trim() || mediaFile) && !disabled && !uploading && !compressing;
    const filteredSlashCmds = (isWorkspace ? [TASK_COMMAND] : SLASH_COMMANDS).filter((c) => c.cmd.includes(slashFilter));

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
            {showSlashPopup && filteredSlashCmds.length > 0 && (isAdmin || isWorkspace) && (
                <div className={styles.slashPopup}>
                    {filteredSlashCmds.map((c) => (
                        <button
                            key={c.cmd}
                            className={styles.slashItem}
                            onMouseDown={(e) => { e.preventDefault(); insertSlashCommand(c); }}
                        >
                            <span className={styles.slashCmd}>{c.usage}</span>
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
                    disabled={compressing || uploading || isWorkspace || !!activeCommand}
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

                {activeCommand && activeCmdDef ? (
                    <div className={styles.commandBar}>
                        <div className={styles.commandBadge}>{activeCommand}</div>
                        {activeCmdDef.fields.map((f, i) => (
                            <div key={f.name} className={styles.commandField}>
                                <span className={styles.fieldLabel}>{f.name}:</span>
                                <input
                                    ref={el => { commandInputRefs.current[i] = el; }}
                                    className={styles.commandInput}
                                    placeholder={f.placeholder}
                                    value={commandArgs[i] || ''}
                                    onChange={e => handleCommandArgChange(i, e.target.value)}
                                    onKeyDown={e => handleCommandKeyDown(e, i)}
                                    disabled={disabled || uploading}
                                    style={{ width: commandArgs[i]?.length > 8 ? `${Math.max(commandArgs[i].length * 0.55, 3)}rem` : undefined }}
                                />
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className={styles.textareaContainer}>
                        {/* The highlight overlay sits exactly behind the textarea text */}
                        <div className={styles.highlights}>
                            {text.split(/(@[\w\s]+)/g).map((chunk, i) => {
                                const isMention = chunk.startsWith('@') && selectedMentions.some(m => m.display_name === chunk.slice(1));
                                return (
                                    <span key={i} className={isMention ? styles.mentionHighlight : ''}>
                                        {chunk}
                                    </span>
                                );
                            })}
                        </div>
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
                    </div>
                )}

                <button
                    className={`${styles.sendBtn} ${canSend ? styles.active : ''} ${slowmodeUntil ? styles.slowmode : ''}`}
                    onClick={handleSendBtn}
                    disabled={!canSend || !!slowmodeUntil}
                >
                    {uploading ? (
                        <div className={styles.spinnerTiny} />
                    ) : slowmodeUntil ? (
                        <span className={styles.slowmodeText}>{Math.ceil((slowmodeUntil - Date.now()) / 1000)}s</span>
                    ) : (
                        <Send size={18} />
                    )}
                </button>
            </div>
        </div>
    );
}
