'use client';

import { useState, useCallback } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { supabase } from '@/lib/supabase';
import { encryptMessage, decryptMessage } from '@/lib/crypto';
import type { Task, TaskComment, User } from '@/types';
import {
    X,
    ChevronRight,
    CheckCircle2,
    Clock,
    Circle,
    AlertCircle,
    Send,
    Loader2,
    Trash2,
    AlertTriangle
} from 'lucide-react';
import styles from './TaskThreadModal.module.scss';

interface Props {
    task: Task & { assigner?: User; assignee?: User };
    onClose: () => void;
}

const STATUS_CONFIG = {
    pending: { label: 'Pending', icon: <Circle size={14} />, color: '#94a3b8' },
    in_progress: { label: 'In Progress', icon: <Clock size={14} />, color: '#f59e0b' },
    in_review: { label: 'In Review', icon: <AlertCircle size={14} />, color: '#8b5cf6' },
    completed: { label: 'Done', icon: <CheckCircle2 size={14} />, color: '#10b981' },
} as const;

export default function TaskThreadModal({ task, onClose }: Props) {
    const { currentUser } = useAppStore();
    const [comments, setComments] = useState<TaskComment[]>([]);
    const [loadedComments, setLoadedComments] = useState(false);
    const [loadingComments, setLoadingComments] = useState(false);
    const [commentText, setCommentText] = useState('');
    const [sendingComment, setSendingComment] = useState(false);
    const [currentStatus, setCurrentStatus] = useState(task.status);
    const [changingStatus, setChangingStatus] = useState(false);

    const canChangeStatus =
        currentUser &&
        (currentUser.id === task.assigned_by ||
            currentUser.role_weight > (task.target_role_weight || 0));

    const canDelete =
        currentUser &&
        (currentUser.id === task.assigned_by ||
            currentUser.role_weight > (task.assigner?.role_weight ?? 0));

    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deleting, setDeleting] = useState(false);

    const handleDeleteTask = async () => {
        if (!canDelete || deleting) return;
        setDeleting(true);
        await supabase.from('tasks').delete().eq('id', task.id);
        onClose();
    };

    // Load comments on open
    useState(() => {
        if (loadedComments) return;
        setLoadingComments(true);
        supabase
            .from('task_comments')
            .select('*, user:user_id(id, display_name, pfp_url, role_weight)')
            .eq('task_id', task.id)
            .order('created_at', { ascending: true })
            .then(async ({ data }) => {
                if (data) {
                    const decrypted = await Promise.all(
                        data.map(async (c) => ({
                            ...c,
                            text: await decryptMessage(c.text).catch(() => c.text),
                        }))
                    );
                    setComments(decrypted as TaskComment[]);
                }
                setLoadedComments(true);
                setLoadingComments(false);
            });
    });

    const handleSendComment = useCallback(async () => {
        if (!commentText.trim() || !currentUser || sendingComment) return;
        setSendingComment(true);
        const encrypted = await encryptMessage(commentText.trim());
        const { data, error } = await supabase
            .from('task_comments')
            .insert({ task_id: task.id, user_id: currentUser.id, text: encrypted })
            .select('*, user:user_id(id, display_name, pfp_url, role_weight)')
            .single();
        setSendingComment(false);
        if (!error && data) {
            const decrypted = { ...data, text: commentText.trim() } as TaskComment;
            setComments((prev) => [...prev, decrypted]);
            setCommentText('');
        }
    }, [commentText, currentUser, sendingComment, task.id]);

    const handleStatusChange = useCallback(async (newStatus: Task['status']) => {
        if (!canChangeStatus || changingStatus) return;
        setChangingStatus(true);
        const { error } = await supabase
            .from('tasks')
            .update({ status: newStatus })
            .eq('id', task.id);
        setChangingStatus(false);
        if (!error) setCurrentStatus(newStatus);
    }, [canChangeStatus, changingStatus, task.id]);

    const statusCfg = STATUS_CONFIG[currentStatus] || STATUS_CONFIG.pending;

    return (
        <div className={styles.overlay} onClick={onClose}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className={styles.header}>
                    <div className={styles.headerLeft}>
                        <div className={styles.taskBadge}>
                            <ChevronRight size={14} /> Task
                        </div>
                        <h2 className={styles.taskTitle}>{task.title}</h2>
                    </div>
                    <div className={styles.headerRight}>
                        {canDelete && (
                            <button className={styles.deleteIconBtn} onClick={() => setShowDeleteConfirm(true)} title="Delete Task">
                                <Trash2 size={18} />
                            </button>
                        )}
                        <button className={styles.closeBtn} onClick={onClose}>
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {showDeleteConfirm && (
                    <div className={styles.deleteConfirmBanner}>
                        <AlertTriangle size={16} />
                        <span>Are you sure you want to delete this task?</span>
                        <div className={styles.deleteConfirmActions}>
                            <button onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
                            <button className={styles.confirmBtn} onClick={handleDeleteTask} disabled={deleting}>
                                {deleting ? 'Deleting...' : 'Delete'}
                            </button>
                        </div>
                    </div>
                )}

                {/* Meta */}
                <div className={styles.meta}>
                    <div className={styles.metaRow}>
                        <span className={styles.metaLabel}>Assigned By</span>
                        <span className={styles.metaValue}>
                            {task.assigner?.display_name || 'Unknown'}
                        </span>
                    </div>
                    <div className={styles.metaRow}>
                        <span className={styles.metaLabel}>Assigned To</span>
                        <span className={styles.metaValue}>
                            {task.assignee?.display_name || 'Unknown'}
                        </span>
                    </div>
                    <div className={styles.metaRow}>
                        <span className={styles.metaLabel}>Status</span>
                        <div className={styles.statusBadge} style={{ color: statusCfg.color }}>
                            {statusCfg.icon} {statusCfg.label}
                        </div>
                    </div>
                </div>

                {/* Status Change (authorized users) */}
                {canChangeStatus && (
                    <div className={styles.statusRow}>
                        {(Object.entries(STATUS_CONFIG) as [Task['status'], typeof STATUS_CONFIG[keyof typeof STATUS_CONFIG]][]).map(([key, cfg]) => (
                            <button
                                key={key}
                                className={`${styles.statusBtn} ${currentStatus === key ? styles.statusActive : ''}`}
                                style={{ '--status-color': cfg.color } as React.CSSProperties}
                                onClick={() => handleStatusChange(key as Task['status'])}
                                disabled={changingStatus || currentStatus === key}
                            >
                                {cfg.icon} {cfg.label}
                            </button>
                        ))}
                    </div>
                )}

                {/* Comments */}
                <div className={styles.comments}>
                    {loadingComments && (
                        <div className={styles.loading}>
                            <Loader2 size={18} className={styles.spin} /> Loading comments…
                        </div>
                    )}
                    {comments.map((c) => (
                        <div key={c.id} className={styles.comment}>
                            <div className={styles.commentAvatar}>
                                <span>{c.user?.display_name?.[0]?.toUpperCase() || '?'}</span>
                            </div>
                            <div className={styles.commentBody}>
                                <div className={styles.commentHeader}>
                                    <span className={styles.commentAuthor}>{c.user?.display_name}</span>
                                    <span className={styles.commentTime}>
                                        {new Date(c.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                </div>
                                <p className={styles.commentText}>{c.text}</p>
                            </div>
                        </div>
                    ))}
                    {!loadingComments && comments.length === 0 && (
                        <div className={styles.noComments}>No comments yet. Be the first!</div>
                    )}
                </div>

                {/* Comment Input */}
                <div className={styles.inputRow}>
                    <textarea
                        className={styles.commentInput}
                        placeholder="Add a comment…"
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendComment(); }
                        }}
                        rows={2}
                    />
                    <button
                        className={styles.sendBtn}
                        onClick={handleSendComment}
                        disabled={sendingComment || !commentText.trim()}
                    >
                        {sendingComment ? <Loader2 size={16} className={styles.spin} /> : <Send size={16} />}
                    </button>
                </div>
            </div>
        </div>
    );
}
