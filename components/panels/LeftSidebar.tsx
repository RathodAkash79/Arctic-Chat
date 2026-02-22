'use client';

import { useState } from 'react';
import { Search, Settings, Moon, Sun } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import styles from './LeftSidebar.module.scss';

export default function LeftSidebar() {
  const { currentUser, theme, toggleTheme, chats, currentChat, setCurrentChat } = useAppStore();
  const [searchQuery, setSearchQuery] = useState('');

  const filteredChats = chats.filter((chat) => {
    const chatName = chat.name || 'Direct Message';
    return chatName.toLowerCase().includes(searchQuery.toLowerCase());
  });

  return (
    <aside className={styles.sidebar}>
      {/* Header Section */}
      <div className={styles.header}>
        <div className={styles.profile}>
          {currentUser?.pfp_url ? (
            <img
              src={currentUser.pfp_url}
              alt={currentUser.display_name}
              className={styles.avatar}
            />
          ) : (
            <div className={styles.avatarPlaceholder}>
              {currentUser?.display_name?.charAt(0).toUpperCase() || 'U'}
            </div>
          )}
          <div className={styles.userInfo}>
            <h3 className={styles.userName}>{currentUser?.display_name || 'User'}</h3>
            <span className={styles.userRole}>{currentUser?.role || 'staff'}</span>
          </div>
        </div>
        <div className={styles.actions}>
          <button
            onClick={toggleTheme}
            className={styles.iconButton}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          </button>
          <button className={styles.iconButton} aria-label="Settings">
            <Settings size={20} />
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className={styles.searchContainer}>
        <Search size={18} className={styles.searchIcon} />
        <input
          type="text"
          placeholder="Search chats..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className={styles.searchInput}
        />
      </div>

      {/* Pinned Workspace/Tasks Card */}
      <div className={styles.workspaceCard}>
        <div className={styles.workspaceIcon}>📋</div>
        <div className={styles.workspaceContent}>
          <h4>Workspace</h4>
          <p>View tasks & assignments</p>
        </div>
      </div>

      {/* Chat List */}
      <div className={styles.chatList}>
        {filteredChats.length === 0 ? (
          <div className={styles.emptyState}>
            <p>No chats yet</p>
            <span>Start a conversation</span>
          </div>
        ) : (
          filteredChats.map((chat) => (
            <div
              key={chat.id}
              className={`${styles.chatItem} ${
                currentChat?.id === chat.id ? styles.active : ''
              }`}
              onClick={() => setCurrentChat(chat)}
            >
              <div className={styles.chatAvatar}>
                {chat.pfp_url ? (
                  <img src={chat.pfp_url} alt={chat.name || 'Chat'} />
                ) : (
                  <div className={styles.chatAvatarPlaceholder}>
                    {chat.name?.charAt(0).toUpperCase() || 'C'}
                  </div>
                )}
              </div>
              <div className={styles.chatInfo}>
                <div className={styles.chatHeader}>
                  <h4 className={styles.chatName}>
                    {chat.name || 'Direct Message'}
                  </h4>
                  {chat.last_message_time && (
                    <span className={styles.chatTime}>
                      {new Date(chat.last_message_time).toLocaleTimeString('en-US', {
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </span>
                  )}
                </div>
                <div className={styles.chatFooter}>
                  <p className={styles.lastMessage}>
                    {chat.last_message || 'No messages yet'}
                  </p>
                  {chat.unread_count && chat.unread_count > 0 && (
                    <span className={styles.unreadBadge}>{chat.unread_count}</span>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
