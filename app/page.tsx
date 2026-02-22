'use client';

import LeftSidebar from '@/components/panels/LeftSidebar';
import MiddlePanel from '@/components/panels/MiddlePanel';
import RightPanel from '@/components/panels/RightPanel';
import { useAppStore } from '@/store/useAppStore';
import styles from './page.module.scss';

export default function Home() {
  const { isMobileChatOpen, isRightPanelOpen } = useAppStore();

  return (
    <main className={styles.main}>
      {/* Left Panel - Sidebar */}
      <div
        className={`${styles.leftPanel} ${
          isMobileChatOpen ? styles.hidden : ''
        }`}
      >
        <LeftSidebar />
      </div>

      {/* Middle Panel - Chat */}
      <div
        className={`${styles.middlePanel} ${
          isMobileChatOpen ? styles.visible : ''
        }`}
      >
        <MiddlePanel />
      </div>

      {/* Right Panel - Details (Conditional) */}
      {isRightPanelOpen && (
        <div className={styles.rightPanel}>
          <RightPanel />
        </div>
      )}
    </main>
  );
}
