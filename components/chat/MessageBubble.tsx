'use client';

import { useMemo } from 'react';
import { useAppStore } from '@/store/useAppStore';
import type { Message } from '@/types';
import styles from './MessageBubble.module.scss';

interface Props {
    message: Message;
    isOwn: boolean;
    showTail: boolean; // Last message in a consecutive group from same sender
    showName: boolean; // First message in group (show sender name in group chats)
    isGroup: boolean;
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
}: Props) {
    const { currentChat } = useAppStore();

    // Resolve sender name for group chats
    const senderName = useMemo(() => {
        if (!isGroup || isOwn || !showName) return null;
        const participant = currentChat?.participants?.find(
            (p) => p.user_id === message.sender_id
        );
        return participant?.user?.display_name || 'User';
    }, [isGroup, isOwn, showName, currentChat, message.sender_id]);

    return (
        <div
            className={`${styles.wrapper} ${isOwn ? styles.own : styles.other} ${showTail ? styles.tail : ''
                }`}
        >
            <div className={styles.bubble}>
                {senderName && (
                    <span className={styles.senderName}>{senderName}</span>
                )}
                <span className={styles.text}>{message.text}</span>
                <span className={styles.meta}>
                    <span className={styles.time}>{formatMsgTime(message.created_at)}</span>
                </span>
            </div>
        </div>
    );
}
