'use client';

import { useState } from 'react';
import type { Task, User } from '@/types';
import { CheckCircle2, Clock, Circle, AlertCircle, ChevronRight } from 'lucide-react';
import TaskThreadModal from './TaskThreadModal';
import styles from './TaskCard.module.scss';

interface Props {
    task: Task & { assigner?: User; assignee?: User };
}

const STATUS_CONFIG = {
    pending: { label: 'Pending', icon: <Circle size={13} />, color: '#94a3b8' },
    in_progress: { label: 'In Progress', icon: <Clock size={13} />, color: '#f59e0b' },
    in_review: { label: 'In Review', icon: <AlertCircle size={13} />, color: '#8b5cf6' },
    completed: { label: 'Done', icon: <CheckCircle2 size={13} />, color: '#10b981' },
} as const;

export default function TaskCard({ task }: Props) {
    const [showThread, setShowThread] = useState(false);
    const cfg = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending;

    return (
        <>
            <div className={styles.card} onClick={() => setShowThread(true)}>
                <div className={styles.header}>
                    <div className={styles.taskLabel}>
                        <ChevronRight size={13} />
                        Task
                    </div>
                    <div
                        className={styles.statusBadge}
                        style={{ color: cfg.color, borderColor: `${cfg.color}40` }}
                    >
                        {cfg.icon}
                        <span>{cfg.label}</span>
                    </div>
                </div>

                <p className={styles.title}>{task.title}</p>

                <div className={styles.footer}>
                    <div className={styles.user}>
                        <div className={styles.avatar}>
                            <span>{task.assigner?.display_name?.[0]?.toUpperCase() || '?'}</span>
                        </div>
                        <span className={styles.userName}>
                            {task.assigner?.display_name || 'Unknown'}
                        </span>
                        <span className={styles.arrow}>→</span>
                        <div className={styles.avatar}>
                            <span>{task.assignee?.display_name?.[0]?.toUpperCase() || '?'}</span>
                        </div>
                        <span className={styles.userName}>
                            {task.assignee?.display_name || 'Unknown'}
                        </span>
                    </div>
                    <span className={styles.threadHint}>Tap to open thread</span>
                </div>
            </div>

            {showThread && (
                <TaskThreadModal task={task} onClose={() => setShowThread(false)} />
            )}
        </>
    );
}
