'use client';

import { useState, useMemo } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { useChats } from '@/hooks/useChats';
import { useAuth } from '@/hooks/useAuth';
import NewChatModal from '@/components/modals/NewChatModal';
import CreateGroupModal from '@/components/modals/CreateGroupModal';
import {
  Search,
  Plus,
  Settings,
  Moon,
  Sun,
  LogOut,
  MessageSquare,
  Users,
} from 'lucide-react';
import styles from './LeftSidebar.module.scss';

function formatTime(dateStr?: string) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const oneDay = 86400000;

  if (diff < oneDay && date.getDate() === now.getDate()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (diff < oneDay * 2) return 'Yesterday';
  if (diff < oneDay * 7) {
    return date.toLocaleDateString([], { weekday: 'short' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function LeftSidebar() {
  const { currentUser, signOut } = useAuth();
  const { chats, openChat } = useChats();
  const {
    currentChat,
    theme,
    toggleTheme,
    onlineUsers,
    isNewChatModalOpen,
    setIsNewChatModalOpen,
  } = useAppStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showFabMenu, setShowFabMenu] = useState(false);
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);

  const filteredChats = useMemo(() => {
    if (!searchQuery.trim()) return chats;
    const q = searchQuery.toLowerCase();
    return chats.filter((chat) => {
      if (chat.type === 'dm') {
        return chat.dm_user?.display_name.toLowerCase().includes(q);
      }
      return chat.name?.toLowerCase().includes(q);
    });
  }, [chats, searchQuery]);

  return (
    <div className={styles.sidebar}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.userInfo}>
          <div className={styles.avatar}>
            {currentUser?.pfp_url ? (
              <img src={currentUser.pfp_url} alt="" />
            ) : (
              <span>{currentUser?.display_name?.[0]?.toUpperCase() || '?'}</span>
            )}
          </div>
          <div className={styles.userDetails}>
            <h2>{currentUser?.display_name || 'Arctic Chat'}</h2>
          </div>
        </div>
        <div className={styles.headerActions}>
          <button
            className={styles.iconBtn}
            onClick={() => setShowSettings(!showSettings)}
            title="Settings"
          >
            <Settings size={20} />
          </button>
        </div>
      </div>

      {/* Settings Menu */}
      {showSettings && (
        <div className={styles.settingsMenu}>
          <button onClick={toggleTheme}>
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
          </button>
          <button onClick={signOut}>
            <LogOut size={16} />
            <span>Sign Out</span>
          </button>
        </div>
      )}

      {/* Search */}
      <div className={styles.searchBar}>
        <Search size={16} className={styles.searchIcon} />
        <input
          type="text"
          placeholder="Search chats..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Chat List */}
      <div className={styles.chatList}>
        {filteredChats.length === 0 && (
          <div className={styles.emptyState}>
            <p>No chats yet</p>
            <span>Start a new conversation</span>
          </div>
        )}

        {filteredChats.map((chat) => {
          const isActive = currentChat?.id === chat.id;
          const displayName =
            chat.type === 'dm'
              ? chat.dm_user?.display_name || 'User'
              : chat.name || 'Group';
          const displayAvatar =
            chat.type === 'dm' ? chat.dm_user?.pfp_url : chat.pfp_url;
          const isOnline =
            chat.type === 'dm' &&
            chat.dm_user?.id &&
            onlineUsers.includes(chat.dm_user.id);

          return (
            <button
              key={chat.id}
              className={`${styles.chatItem} ${isActive ? styles.active : ''}`}
              onClick={() => openChat(chat)}
            >
              <div className={styles.chatAvatarWrapper}>
                <div className={styles.chatAvatar}>
                  {displayAvatar ? (
                    <img src={displayAvatar} alt="" />
                  ) : (
                    <span>{displayName[0]?.toUpperCase() || '?'}</span>
                  )}
                </div>
                {isOnline && <div className={styles.onlineDot} title="Online" />}
              </div>
              <div className={styles.chatInfo}>
                <div className={styles.chatTop}>
                  <span className={styles.chatName}>{displayName}</span>
                  <span className={styles.chatTime}>
                    {formatTime(chat.last_message_time)}
                  </span>
                </div>
                <p className={styles.chatPreview}>
                  {chat.last_message || 'No messages yet'}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* FAB Menu */}
      {showFabMenu && (
        <div className={styles.fabMenu}>
          <button
            onClick={() => {
              setShowFabMenu(false);
              setIsNewChatModalOpen(true);
            }}
          >
            <MessageSquare size={16} />
            <span>New DM</span>
          </button>
          <button
            onClick={() => {
              setShowFabMenu(false);
              setIsCreateGroupOpen(true);
            }}
          >
            <Users size={16} />
            <span>New Group</span>
          </button>
        </div>
      )}

      {/* FAB */}
      <button
        className={`${styles.fab} ${showFabMenu ? styles.fabActive : ''}`}
        onClick={() => setShowFabMenu(!showFabMenu)}
        title="New conversation"
      >
        <Plus size={24} />
      </button>

      {/* Modals */}
      {isNewChatModalOpen && <NewChatModal />}
      {isCreateGroupOpen && <CreateGroupModal onClose={() => setIsCreateGroupOpen(false)} />}
    </div>
  );
}
