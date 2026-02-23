'use client';

import { useMemo } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { X, Users } from 'lucide-react';
import styles from './RightPanel.module.scss';

export default function RightPanel() {
  const { currentChat, setIsRightPanelOpen } = useAppStore();

  const chatDisplayName = useMemo(() => {
    if (!currentChat) return '';
    if (currentChat.type === 'dm') {
      return currentChat.dm_user?.display_name || 'Chat';
    }
    return currentChat.name || 'Group';
  }, [currentChat]);

  const chatDisplayAvatar = useMemo(() => {
    if (!currentChat) return '';
    if (currentChat.type === 'dm') return currentChat.dm_user?.pfp_url || '';
    return currentChat.pfp_url || '';
  }, [currentChat]);

  if (!currentChat) return null;

  return (
    <div className={styles.panel}>
      {/* Header */}
      <div className={styles.header}>
        <h3>Chat Info</h3>
        <button
          className={styles.closeBtn}
          onClick={() => setIsRightPanelOpen(false)}
        >
          <X size={20} />
        </button>
      </div>

      {/* Chat Avatar & Name */}
      <div className={styles.profile}>
        <div className={styles.avatar}>
          {chatDisplayAvatar ? (
            <img src={chatDisplayAvatar} alt="" />
          ) : (
            <span>{chatDisplayName[0]?.toUpperCase() || '?'}</span>
          )}
        </div>
        <h4>{chatDisplayName}</h4>
        {currentChat.type === 'group' && currentChat.description && (
          <p className={styles.description}>{currentChat.description}</p>
        )}
      </div>

      {/* Participants */}
      {currentChat.participants && currentChat.participants.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <Users size={16} />
            <span>
              {currentChat.participants.length} participant
              {currentChat.participants.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className={styles.participantList}>
            {currentChat.participants.map((p) => (
              <div key={p.user_id} className={styles.participantItem}>
                <div className={styles.participantAvatar}>
                  {p.user?.pfp_url ? (
                    <img src={p.user.pfp_url} alt="" />
                  ) : (
                    <span>
                      {p.user?.display_name?.[0]?.toUpperCase() || '?'}
                    </span>
                  )}
                </div>
                <div className={styles.participantInfo}>
                  <span className={styles.participantName}>
                    {p.user?.display_name || 'User'}
                  </span>
                  {p.group_role !== 'member' && (
                    <span className={styles.participantRole}>
                      {p.group_role}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
