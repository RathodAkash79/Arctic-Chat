'use client';

import { useRef, useEffect, useMemo, useCallback, useState } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { useMessages } from '@/hooks/useMessages';
import MessageBubble from '@/components/chat/MessageBubble';
import MessageInput from '@/components/chat/MessageInput';
import type { Message } from '@/types';
import {
  ArrowLeft,
  Info,
  MessageSquare,
  ChevronDown,
  X as XIcon,
} from 'lucide-react';
import styles from './MiddlePanel.module.scss';

export default function MiddlePanel() {
  const {
    currentUser,
    currentChat,
    setIsMobileChatOpen,
    setIsRightPanelOpen,
    isRightPanelOpen,
    typingUsers,
    onlineUsers,
  } = useAppStore();

  const {
    messages,
    loadingMessages,
    hasMore,
    sendMessage,
    sendTypingEvent,
    loadMore,
  } = useMessages();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const prevMessageCountRef = useRef(0);
  const [replyTo, setReplyTo] = useState<Message | null>(null);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (messages.length > prevMessageCountRef.current) {
      // Only auto-scroll if user is near the bottom
      const container = messagesContainerRef.current;
      if (container) {
        const isNearBottom =
          container.scrollHeight - container.scrollTop - container.clientHeight < 100;
        if (isNearBottom || messages.length - prevMessageCountRef.current === messages.length) {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
      }
    }
    prevMessageCountRef.current = messages.length;
  }, [messages.length]);

  // Detect scroll position for "scroll to bottom" FAB
  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const distFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    setShowScrollBtn(distFromBottom > 200);

    // Load more when scrolled to top
    if (container.scrollTop < 50 && hasMore && !loadingMessages) {
      loadMore();
    }
  }, [hasMore, loadingMessages, loadMore]);

  // Resolve chat display info
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

  const isChatOnline = useMemo(() => {
    if (!currentChat || currentChat.type !== 'dm') return false;
    return currentChat.dm_user?.id ? onlineUsers.includes(currentChat.dm_user.id) : false;
  }, [currentChat, onlineUsers]);

  // Message grouping: consecutive messages from same sender
  const groupedProps = useMemo(() => {
    return messages.map((msg, i) => {
      const prev = messages[i - 1];
      const next = messages[i + 1];
      const isOwn = msg.sender_id === currentUser?.id;
      const showName = !prev || prev.sender_id !== msg.sender_id;
      const showTail = !next || next.sender_id !== msg.sender_id;
      return { isOwn, showName, showTail };
    });
  }, [messages, currentUser?.id]);

  // Derived typing text
  const typingUserNames = useMemo(() => {
    if (!currentChat || !typingUsers[currentChat.id]) return [];
    const ids = typingUsers[currentChat.id].filter(id => id !== currentUser?.id);
    return ids.map(id => {
      // For groups, look up participant
      if (currentChat.type === 'group') {
        const p = currentChat.participants?.find((p) => p.user_id === id);
        return p?.user?.display_name || 'Someone';
      }
      // For DMs, it's just the dm_user
      return currentChat.dm_user?.display_name || 'Someone';
    });
  }, [currentChat, typingUsers, currentUser]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Empty state
  if (!currentChat) {
    return (
      <div className={styles.panel}>
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>
            <MessageSquare size={48} strokeWidth={1} />
          </div>
          <h3>Arctic Chat</h3>
          <p>Select a conversation or start a new one</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      {/* Chat Header */}
      <div className={styles.chatHeader}>
        <button
          className={styles.backBtn}
          onClick={() => {
            setIsMobileChatOpen(false);
            useAppStore.getState().setCurrentChat(null);
          }}
        >
          <ArrowLeft size={20} />
        </button>

        <div className={styles.headerAvatarWrapper}>
          <div className={styles.headerAvatar}>
            {chatDisplayAvatar ? (
              <img src={chatDisplayAvatar} alt="" />
            ) : (
              <span>{chatDisplayName[0]?.toUpperCase() || '?'}</span>
            )}
          </div>
          {isChatOnline && <div className={styles.onlineDot} title="Online" />}
        </div>

        <div className={styles.headerInfo}>
          <h3>{chatDisplayName}</h3>
        </div>

        <button
          className={`${styles.infoBtn} ${isRightPanelOpen ? styles.active : ''}`}
          onClick={() => setIsRightPanelOpen(!isRightPanelOpen)}
        >
          <Info size={20} />
        </button>
      </div>

      {/* Messages Area */}
      <div
        className={styles.messagesArea}
        ref={messagesContainerRef}
        onScroll={handleScroll}
      >
        {loadingMessages && messages.length === 0 && (
          <div className={styles.loadingState}>
            <div className={styles.spinner} />
          </div>
        )}

        {hasMore && messages.length > 0 && (
          <div className={styles.loadMoreIndicator}>
            {loadingMessages ? (
              <div className={styles.spinnerSmall} />
            ) : (
              <span>Scroll up for older messages</span>
            )}
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            isOwn={groupedProps[i].isOwn}
            showName={groupedProps[i].showName}
            showTail={groupedProps[i].showTail}
            isGroup={currentChat.type === 'group'}
            onReply={(msg) => setReplyTo(msg)}
          />
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* Scroll to Bottom FAB */}
      {showScrollBtn && (
        <button className={styles.scrollFab} onClick={scrollToBottom}>
          <ChevronDown size={20} />
        </button>
      )}

      {/* Typing Indicator */}
      {typingUserNames.length > 0 && (
        <div className={styles.typingIndicator}>
          <div className={styles.typingDots}>
            <span /><span /><span />
          </div>
          <span>
            {typingUserNames.length <= 2
              ? typingUserNames.join(' and ')
              : `${typingUserNames.length} people`}{' '}
            {typingUserNames.length === 1 ? 'is' : 'are'} typing
          </span>
        </div>
      )}

      {/* Reply Preview Bar */}
      {replyTo && (
        <div className={styles.replyBar}>
          <div className={styles.replyBarContent}>
            <span className={styles.replyBarLabel}>Replying to:</span>
            <span className={styles.replyBarText}>
              {replyTo.media_url ? '📷 Photo' : replyTo.text.slice(0, 60) + '...'}
            </span>
          </div>
          <button className={styles.replyBarClose} onClick={() => setReplyTo(null)}>
            <XIcon size={14} />
          </button>
        </div>
      )}

      {/* Message Input */}
      <MessageInput onSend={(text, media) => { sendMessage(text, media, replyTo?.id); setReplyTo(null); }} onTyping={sendTypingEvent} />
    </div>
  );
}
