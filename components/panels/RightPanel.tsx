'use client';

import { X, User, Image as ImageIcon, Link, File } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import styles from './RightPanel.module.scss';

export default function RightPanel() {
  const { currentChat, isRightPanelOpen, setIsRightPanelOpen } = useAppStore();

  if (!isRightPanelOpen || !currentChat) {
    return null;
  }

  return (
    <>
      {/* Overlay for mobile/tablet */}
      <div 
        className={`${styles.overlay} hidden-desktop`}
        onClick={() => setIsRightPanelOpen(false)}
      />

      <aside className={styles.panel}>
        {/* Header */}
        <div className={styles.header}>
          <h3>Chat Details</h3>
          <button
            className={styles.closeButton}
            onClick={() => setIsRightPanelOpen(false)}
            aria-label="Close details panel"
          >
            <X size={20} />
          </button>
        </div>

        {/* Chat Info Section */}
        <div className={styles.section}>
          <div className={styles.chatProfile}>
            <div className={styles.chatAvatarLarge}>
              {currentChat.pfp_url ? (
                <img src={currentChat.pfp_url} alt={currentChat.name || 'Chat'} />
              ) : (
                <div className={styles.avatarPlaceholder}>
                  {currentChat.name?.charAt(0).toUpperCase() || 'C'}
                </div>
              )}
            </div>
            <h2 className={styles.chatName}>{currentChat.name || 'Direct Message'}</h2>
            {currentChat.description && (
              <p className={styles.chatDescription}>{currentChat.description}</p>
            )}
          </div>
        </div>

        {/* Members Section (for groups) */}
        {currentChat.type === 'group' && (
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <User size={18} />
              <h4>Members</h4>
            </div>
            <div className={styles.membersList}>
              <div className={styles.memberItem}>
                <div className={styles.memberAvatar}>A</div>
                <div className={styles.memberInfo}>
                  <span className={styles.memberName}>Admin User</span>
                  <span className={styles.memberRole}>Owner</span>
                </div>
              </div>
              {/* More members would be listed here */}
            </div>
          </div>
        )}

        {/* Media Gallery Section */}
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <ImageIcon size={18} />
            <h4>Media</h4>
          </div>
          <div className={styles.mediaGrid}>
            <div className={styles.emptyMedia}>
              <p>No media shared yet</p>
            </div>
          </div>
        </div>

        {/* Links Section */}
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <Link size={18} />
            <h4>Links</h4>
          </div>
          <div className={styles.linksList}>
            <div className={styles.emptyLinks}>
              <p>No links shared yet</p>
            </div>
          </div>
        </div>

        {/* Files Section */}
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <File size={18} />
            <h4>Files</h4>
          </div>
          <div className={styles.filesList}>
            <div className={styles.emptyFiles}>
              <p>No files shared yet</p>
            </div>
          </div>
        </div>

        {/* Storage Info */}
        <div className={styles.section}>
          <div className={styles.storageInfo}>
            <span className={styles.storageLabel}>Storage Used</span>
            <span className={styles.storageValue}>
              {(currentChat.storage_used_bytes / (1024 * 1024)).toFixed(2)} MB
            </span>
          </div>
        </div>
      </aside>
    </>
  );
}
