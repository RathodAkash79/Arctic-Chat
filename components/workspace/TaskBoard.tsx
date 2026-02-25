'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/useAppStore';
import type { Task, User, TaskStatus } from '@/types';
import { Plus, CheckCircle2, Clock, Circle, Trash2, ChevronUp, Users } from 'lucide-react';
import { WORKSPACE_TIERS } from '@/types';
import TaskThreadModal from './TaskThreadModal';
import styles from './TaskBoard.module.scss';

const STATUS_LABELS: Record<TaskStatus, string> = {
    pending: 'Pending',
    in_progress: 'In Progress',
    in_review: 'In Review',
    completed: 'Completed',
};

export default function TaskBoard() {
    const { currentUser } = useAppStore();
    const [tasks, setTasks] = useState<(Task & { assigner?: User })[]>([]);
    const [loading, setLoading] = useState(true);
    const [showCreate, setShowCreate] = useState(false);
    const [newTitle, setNewTitle] = useState('');
    const [newDesc, setNewDesc] = useState('');
    const [newTargetWeight, setNewTargetWeight] = useState(50);
    const [saving, setSaving] = useState(false);
    const [selectedTask, setSelectedTask] = useState<(Task & { assigner?: User }) | null>(null);

    const canCreate = (currentUser?.role_weight ?? 0) >= 80;

    const fetchTasks = useCallback(async () => {
        if (!currentUser) return;
        setLoading(true);

        const { data } = await supabase
            .from('tasks')
            .select('*, assigner:users!assigned_by(*)')
            .order('created_at', { ascending: false });

        setTasks((data || []) as (Task & { assigner?: User })[]);
        setLoading(false);
    }, [currentUser]);

    useEffect(() => {
        fetchTasks();
    }, [fetchTasks]);

    // Realtime task updates
    useEffect(() => {
        const channel = supabase
            .channel('task-board')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => {
                fetchTasks();
            })
            .subscribe();
        return () => { supabase.removeChannel(channel); };
    }, [fetchTasks]);

    const handleCreate = async () => {
        if (!currentUser || !newTitle.trim()) return;
        setSaving(true);
        const { data, error } = await supabase
            .from('tasks')
            .insert({
                title: newTitle.trim(),
                description: newDesc.trim() || null,
                assigned_by: currentUser.id,
                target_role_weight: newTargetWeight,
                status: 'pending',
            })
            .select('*, assigner:users!assigned_by(*)')
            .single();

        setSaving(false);
        if (!error && data) {
            setTasks((t) => [data as Task & { assigner?: User }, ...t]);
            setNewTitle('');
            setNewDesc('');
            setShowCreate(false);
        }
    };

    const visibleTiers = WORKSPACE_TIERS.filter((t) => t.min_weight <= (currentUser?.role_weight || 0));
    const [selectedTier, setSelectedTier] = useState<number>(20);

    useEffect(() => {
        if (currentUser && visibleTiers.length > 0 && !visibleTiers.find((t) => t.min_weight === selectedTier)) {
            setSelectedTier(visibleTiers[0].min_weight);
        }
    }, [currentUser, visibleTiers, selectedTier]);

    const filteredTasks = tasks.filter((t) => t.target_role_weight === selectedTier);

    const handleStatusChange = async (taskId: string, status: Task['status']) => {
        await supabase.from('tasks').update({ status }).eq('id', taskId);
        setTasks((t) => t.map((tk) => tk.id === taskId ? { ...tk, status } : tk));
    };

    const handleDelete = async (taskId: string) => {
        await supabase.from('tasks').delete().eq('id', taskId);
        setTasks((t) => t.filter((tk) => tk.id !== taskId));
    };

    const StatusIcon = ({ status }: { status: Task['status'] }) => {
        if (status === 'completed') return <CheckCircle2 size={16} className={styles.iconCompleted} />;
        if (status === 'in_progress') return <Clock size={16} className={styles.iconInProgress} />;
        return <Circle size={16} className={styles.iconPending} />;
    };

    if (!currentUser) return null;

    const currentTierLabel = WORKSPACE_TIERS.find((t) => t.min_weight === selectedTier)?.name || 'Tasks';

    return (
        <div className={styles.workspaceWrapper}>
            {/* Sidebar */}
            <div className={styles.sidebar}>
                <div className={styles.sidebarHeader}>
                    <h2>Workplace</h2>
                </div>
                <div className={styles.tierList}>
                    {visibleTiers.map((tier) => (
                        <button
                            key={tier.id}
                            className={`${styles.tierItem} ${selectedTier === tier.min_weight ? styles.tierActive : ''}`}
                            onClick={() => setSelectedTier(tier.min_weight)}
                        >
                            <div className={styles.tierAvatar}>
                                <Users size={18} />
                            </div>
                            <div className={styles.tierInfo}>
                                <span className={styles.tierName}>{tier.name}</span>
                                <span className={styles.tierMeta}>Rank {tier.min_weight}+</span>
                            </div>
                        </button>
                    ))}
                    {visibleTiers.length === 0 && (
                        <div className={styles.emptySidebar}>Insufficient permissions</div>
                    )}
                </div>
            </div>

            {/* Board */}
            <div className={styles.board}>
                {/* Header */}
                <div className={styles.header}>
                    <div>
                        <h2 className={styles.title}>{currentTierLabel} Group</h2>
                        <p className={styles.subtitle}>{filteredTasks.length} task{filteredTasks.length !== 1 ? 's' : ''}</p>
                    </div>
                    {canCreate && (
                        <button
                            className={styles.createBtn}
                            onClick={() => setShowCreate((v) => !v)}
                        >
                            {showCreate ? <ChevronUp size={18} /> : <Plus size={18} />}
                            {showCreate ? 'Cancel' : 'New Task'}
                        </button>
                    )}
                </div>

                {/* Create Form */}
                {showCreate && (
                    <div className={styles.createForm}>
                        <input
                            className={styles.formInput}
                            placeholder="Task title..."
                            value={newTitle}
                            onChange={(e) => setNewTitle(e.target.value)}
                            maxLength={120}
                        />
                        <textarea
                            className={styles.formTextarea}
                            placeholder="Description (optional)..."
                            value={newDesc}
                            onChange={(e) => setNewDesc(e.target.value)}
                            rows={2}
                        />
                        <div className={styles.formRow}>
                            <label className={styles.formLabel}>Assign to group:</label>
                            <select
                                className={styles.formSelect}
                                value={newTargetWeight}
                                onChange={(e) => setNewTargetWeight(Number(e.target.value))}
                            >
                                {visibleTiers.map((tier) => (
                                    <option key={tier.id} value={tier.min_weight}>
                                        {tier.name}
                                    </option>
                                ))}
                            </select>
                            <button
                                className={styles.submitBtn}
                                onClick={handleCreate}
                                disabled={saving || !newTitle.trim()}
                            >
                                {saving ? 'Saving...' : 'Create'}
                            </button>
                        </div>
                    </div>
                )}

                {/* Task List */}
                <div className={styles.list}>
                    {loading && (
                        <div className={styles.loadingState}>
                            <div className={styles.spinner} />
                        </div>
                    )}

                    {!loading && filteredTasks.length === 0 && (
                        <div className={styles.emptyState}>
                            <p>No tasks yet. {canCreate ? 'Create one above.' : ''}</p>
                        </div>
                    )}

                    {filteredTasks.map((task) => {
                        const canDelete =
                            task.assigned_by === currentUser.id ||
                            (currentUser.role_weight > (task.assigner?.role_weight ?? 0));

                        return (
                            <div key={task.id} className={`${styles.card} ${styles[task.status]}`} onClick={() => setSelectedTask(task)}>
                                <div className={styles.cardTop}>
                                    <div className={styles.statusWrapper}>
                                        <StatusIcon status={task.status} />
                                        <span className={`${styles.badge} ${styles[`badge_${task.status}`]}`}>
                                            {STATUS_LABELS[task.status]}
                                        </span>
                                    </div>
                                    <span className={styles.taskId}>
                                        #{task.id.slice(0, 6).toUpperCase()}
                                    </span>
                                </div>

                                <h3 className={styles.cardTitle}>{task.title}</h3>
                                {task.description && (
                                    <p className={styles.cardDesc}>{task.description}</p>
                                )}

                                <div className={styles.cardMeta}>
                                    <span>By {task.assigner?.display_name || 'Unknown'}</span>
                                    <span>{new Date(task.created_at).toLocaleDateString()}</span>
                                </div>

                                <div className={styles.cardActions} onClick={(e) => e.stopPropagation()}>
                                    {task.status !== 'completed' && (
                                        <select
                                            className={styles.statusSelect}
                                            value={task.status}
                                            onChange={(e) =>
                                                handleStatusChange(task.id, e.target.value as Task['status'])
                                            }
                                        >
                                            <option value="pending">Pending</option>
                                            <option value="in_progress">In Progress</option>
                                            <option value="completed">Completed</option>
                                        </select>
                                    )}
                                    {canDelete && (
                                        <button
                                            className={styles.deleteBtn}
                                            onClick={(e) => { e.stopPropagation(); handleDelete(task.id); }}
                                            title="Delete task"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {selectedTask && (
                <TaskThreadModal task={selectedTask} onClose={() => setSelectedTask(null)} />
            )}
        </div>
    );
}
