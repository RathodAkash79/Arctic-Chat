'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useAppStore } from '@/store/useAppStore';
import { useChats } from '@/hooks/useChats';
import LeftSidebar from '@/components/panels/LeftSidebar';
import MiddlePanel from '@/components/panels/MiddlePanel';
import RightPanel from '@/components/panels/RightPanel';
import styles from '../page.module.scss';

export default function ChatPage() {
    const { chatId } = useParams<{ chatId: string }>();
    const { isMobileChatOpen, isRightPanelOpen, chats, setCurrentChat, setIsMobileChatOpen } = useAppStore();
    useChats();

    // When chats load, activate the one matching the URL
    useEffect(() => {
        if (!chatId || !chats.length) return;
        const target = chats.find((c) => c.id === chatId);
        if (target) {
            setCurrentChat(target);
            setIsMobileChatOpen(true);
        }
    }, [chatId, chats, setCurrentChat, setIsMobileChatOpen]);

    return (
        <main className={styles.main}>
            <div className={`${styles.leftPanel} ${isMobileChatOpen ? styles.hidden : ''}`}>
                <LeftSidebar />
            </div>
            <div className={`${styles.middlePanel} ${isMobileChatOpen ? styles.visible : ''}`}>
                <MiddlePanel />
            </div>
            {isRightPanelOpen && (
                <div className={styles.rightPanel}>
                    <RightPanel />
                </div>
            )}
        </main>
    );
}
