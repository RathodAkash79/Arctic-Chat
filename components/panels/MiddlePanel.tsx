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
  const userScrolledUp = useRef(false); // true = user manually scrolled up, pause autoscroll
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [replyToDecrypted, setReplyToDecrypted] = useState<string>('');
  const [editingMessage, setEditingMessage] = useState<{ id: string; text: string } | null>(null);

  const initialScrollDone = useRef(false);

  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant' });
  }, []);

  // Reset scroll state when chat changes
  useEffect(() => {
    prevMessageCountRef.current = 0;
    userScrolledUp.current = false;
    initialScrollDone.current = false;
    setShowScrollBtn(false);
  }, [currentChat?.id]);

  // Auto-scroll on new messages unless user scrolled up
  useEffect(() => {
    const isNewMessages = messages.length > prevMessageCountRef.current;
    const isInitialLoad = prevMessageCountRef.current === 0;

    if (isNewMessages) {
      if (!userScrolledUp.current || isInitialLoad) {
        // Run after DOM has painted
        requestAnimationFrame(() => {
          scrollToBottom(!isInitialLoad);
          if (isInitialLoad) {
            // Unblock pagination after scroll finishes settling
            setTimeout(() => {
              initialScrollDone.current = true;
            }, 150);
          }
        });
      }
    }
    prevMessageCountRef.current = messages.length;
  }, [messages.length, scrollToBottom]);

  // Preserve scroll position after older messages are prepended
  const prevScrollHeightRef = useRef(0);
  const isLoadingOlderRef = useRef(false);

  useEffect(() => {
    if (isLoadingOlderRef.current && messagesContainerRef.current) {
      const container = messagesContainerRef.current;
      const newScrollHeight = container.scrollHeight;
      const diff = newScrollHeight - prevScrollHeightRef.current;
      container.scrollTop += diff;
      isLoadingOlderRef.current = false;
    }
  });

  // Detect scroll position — set userScrolledUp flag
  const loadMoreDebounce = useRef(false);
  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const distFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;

    const scrolledUp = distFromBottom > 80;

    // Don't update scroll flags if we're still doing initial scroll layout
    if (initialScrollDone.current) {
      userScrolledUp.current = scrolledUp;
      setShowScrollBtn(scrolledUp);

      // Load more when scrolled to top (debounced)
      if (container.scrollTop < 50 && hasMore && !loadingMessages && !loadMoreDebounce.current) {
        loadMoreDebounce.current = true;
        // Capture current scroll height before prepend
        prevScrollHeightRef.current = container.scrollHeight;
        isLoadingOlderRef.current = true;
        loadMore();
        setTimeout(() => { loadMoreDebounce.current = false; }, 500);
      }
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
      const isOwn = msg.sender_id === currentUser?.id;
      const showName = !prev || prev.sender_id !== msg.sender_id;
      // showTail = first message of a new sender group (where the chat-bubble tail triangle renders)
      const showTail = showName;
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

  // Multi-pin system: store array of pinned message IDs in localStorage per chat
  const getPinnedKey = useCallback(() =>
    currentChat ? `pinned_msgs_${currentChat.id}` : null, [currentChat]);

  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [showPinnedModal, setShowPinnedModal] = useState(false);

  // Load pinned IDs when chat changes
  useEffect(() => {
    const key = getPinnedKey();
    if (!key) { setPinnedIds([]); return; }
    try {
      const stored = JSON.parse(localStorage.getItem(key) || '[]');
      setPinnedIds(Array.isArray(stored) ? stored : []);
    } catch { setPinnedIds([]); }
  }, [currentChat?.id, getPinnedKey]);

  const handlePin = useCallback((msgId: string) => {
    const key = getPinnedKey();
    if (!key) return;
    setPinnedIds((prev) => {
      const already = prev.includes(msgId);
      const next = already ? prev.filter((id) => id !== msgId) : [msgId, ...prev];
      try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, [getPinnedKey]);

  // Resolve pinned messages from the store
  const pinnedMessages = useMemo(() =>
    pinnedIds.map((id) => messages.find((m) => m.id === id)).filter(Boolean) as typeof messages,
    [pinnedIds, messages]
  );

  // Decrypt latest pinned message for banner preview
  const latestPinned = pinnedMessages[0] || null;
  const [latestPinnedText, setLatestPinnedText] = useState('');
  useEffect(() => {
    if (!latestPinned?.text) { setLatestPinnedText(''); return; }
    import('@/lib/crypto').then(({ decryptMessage }) =>
      decryptMessage(latestPinned.text)
        .then(setLatestPinnedText)
        .catch(() => setLatestPinnedText(latestPinned.text))
    );
  }, [latestPinned?.text]);

  // Empty state
  if (!currentChat) {
    return (
      <div className={styles.panel}>
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>
            <img src="/icon.svg" width={48} height={48} alt="Arctic Chat" />
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
      {/* Pinned Message Banner - Arctic theme */}
      {pinnedMessages.length > 0 && (
        <div
          className={styles.pinnedBanner}
          onClick={() => pinnedMessages.length > 1 && setShowPinnedModal(true)}
          style={{ cursor: pinnedMessages.length > 1 ? 'pointer' : 'default' }}
        >
          <span className={styles.pinnedIcon}>📌</span>
          <div className={styles.pinnedContent}>
            <span className={styles.pinnedLabel}>
              {pinnedMessages.length > 1
                ? `${pinnedMessages.length} Pinned Messages`
                : 'Pinned Message'}
            </span>
            {pinnedMessages.length === 1 && (
              <span className={styles.pinnedText}>
                {latestPinned?.media_url ? '📷 Photo' : (latestPinnedText || '...')}
              </span>
            )}
          </div>
          {pinnedMessages.length === 1 && latestPinned && (
            <button
              className={styles.pinnedUnpin}
              onClick={(e) => { e.stopPropagation(); handlePin(latestPinned.id); }}
              title="Unpin"
            >
              ×
            </button>
          )}
        </div>
      )}

      {/* Pinned Messages Modal */}
      {showPinnedModal && (
        <div className={styles.pinnedModalOverlay} onClick={() => setShowPinnedModal(false)}>
          <div className={styles.pinnedModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.pinnedModalHeader}>
              <span>📌 Pinned Messages</span>
              <button onClick={() => setShowPinnedModal(false)}>×</button>
            </div>
            <div className={styles.pinnedModalList}>
              {pinnedMessages.map((m) => (
                <div key={m.id} className={styles.pinnedModalItem}>
                  <span className={styles.pinnedModalText}>
                    {m.media_url ? '📷 Photo' : m.text}
                  </span>
                  <button
                    className={styles.pinnedModalUnpin}
                    onClick={() => handlePin(m.id)}
                    title="Unpin"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

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
            onReply={async (msg) => {
              setReplyTo(msg);
              const { decryptMessage } = await import('@/lib/crypto');
              const plain = await decryptMessage(msg.text).catch(() => msg.text);
              setReplyToDecrypted(msg.media_url ? '📷 Photo' : plain);
            }}
            onEditRequest={(msg, decryptedText) => setEditingMessage({ id: msg.id, text: decryptedText })}
            onPin={(msg) => handlePin(msg.id)}
            isPinned={pinnedIds.includes(msg.id)}
          />
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* Scroll to Bottom FAB */}
      {showScrollBtn && (
        <button
          className={styles.scrollFab}
          onClick={() => {
            userScrolledUp.current = false;
            setShowScrollBtn(false);
            scrollToBottom();
          }}
        >
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
              {replyTo.media_url ? '📷 Photo' : (replyToDecrypted || replyTo.text).slice(0, 60) + (replyToDecrypted.length > 60 ? '...' : '')}
            </span>
          </div>
          <button className={styles.replyBarClose} onClick={() => setReplyTo(null)}>
            <XIcon size={14} />
          </button>
        </div>
      )}

      {/* Message Input */}
      <MessageInput
        onSend={(text, media, replyToId, isDisappearing, mentions) => {
          sendMessage(text, media, replyTo?.id || replyToId, isDisappearing, mentions);
          setReplyTo(null);
        }}
        onTyping={sendTypingEvent}
        chatId={currentChat.id}
        participants={currentChat.participants || []}
        callerGroupRole={currentChat.type === 'group' ? currentChat.participants?.find((p) => p.user_id === currentUser?.id)?.group_role : undefined}
        editingMessage={editingMessage}
        onEditSave={async (id, newText) => {
          const { supabase } = await import('@/lib/supabase');
          const { encryptMessage } = await import('@/lib/crypto');
          const encrypted = await encryptMessage(newText).catch(() => newText);
          const { error } = await supabase
            .from('messages')
            .update({ text: encrypted, edited_at: new Date().toISOString() })
            .eq('id', id);
          if (!error) {
            useAppStore.setState((s) => ({
              messages: s.messages.map((m) =>
                m.id === id ? { ...m, text: encrypted, edited_at: new Date().toISOString() } : m
              ),
            }));
          } else {
            console.error('Edit failed:', error.message);
          }
          setEditingMessage(null);
        }}
        onEditCancel={() => setEditingMessage(null)}
      />
    </div>
  );
}
