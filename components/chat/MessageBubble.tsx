'use client';

import { useMemo } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { resolveImageUrl } from '@/lib/utils';
import type { Message } from '@/types';
import styles from './MessageBubble.module.scss';

interface Props {
    message: Message;
    isOwn: boolean;
    showTail: boolean;
    showName: boolean;
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

    const senderName = useMemo(() => {
        if (!isGroup || isOwn || !showName) return null;
        const participant = currentChat?.participants?.find(
            (p) => p.user_id === message.sender_id
        );
        return participant?.user?.display_name || 'User';
    }, [isGroup, isOwn, showName, currentChat, message.sender_id]);

    const mediaUrl = useMemo(
        () => (message.media_url ? resolveImageUrl(message.media_url) : null),
        [message.media_url]
    );

    const hasText = message.text && message.text !== '[Media]';

    return (
        <div
            className={`${styles.wrapper} ${isOwn ? styles.own : styles.other} ${showTail ? styles.tail : ''
                }`}
        >
            <div className={`${styles.bubble} ${mediaUrl ? styles.mediaBubble : ''}`}>
                {senderName && (
                    <span className={styles.senderName}>{senderName}</span>
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
                {hasText && (
                    <span className={styles.text}>
                        {message.text.split(/(https?:\/\/[^\s]+)/g).map((part, i) => {
                            if (part.match(/(https?:\/\/[^\s]+)/)) {
                                return (
                                    <a
                                        key={i}
                                        href={part}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className={styles.link}
                                    >
                                        {part}
                                    </a>
                                );
                            }
                            return <span key={i}>{part}</span>;
                        })}
                    </span>
                )}
                <span className={styles.meta}>
                    <span className={styles.time}>
                        {formatMsgTime(message.created_at)}
                    </span>
                </span>
            </div>
        </div>
    );
}

