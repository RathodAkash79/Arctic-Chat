'use client';

import { useState, useRef, useEffect } from 'react';
import { ArrowLeft, MoreVertical, Send, Paperclip, Smile } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import styles from './MiddlePanel.module.scss';

export default function MiddlePanel() {
  const {
    currentChat,
    messages,
    currentUser,
    setIsMobileChatOpen,
    isRightPanelOpen,
    setIsRightPanelOpen,
  } = useAppStore();
  
  const [messageText, setMessageText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [messageText]);

  const handleSendMessage = () => {
    if (messageText.trim() && currentChat) {
      // TODO: Implement message sending with encryption
      console.log('Sending message:', messageText);
      setMessageText('');
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  if (!currentChat) {
    return (
      <div className={styles.emptyState}>
        <div className={styles.emptyContent}>
          <h2>Welcome to Arctic Chat</h2>
          <p>Select a chat to start messaging</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      {/* Chat Header */}
      <div className={styles.header}>
        <button
          className={`${styles.backButton} hidden-desktop`}
          onClick={() => setIsMobileChatOpen(false)}
          aria-label="Back to chat list"
        >
          <ArrowLeft size={20} />
        </button>

        <div className={styles.chatInfo} onClick={() => setIsRightPanelOpen(!isRightPanelOpen)}>
          <div className={styles.chatAvatar}>
            {currentChat.pfp_url ? (
              <img src={currentChat.pfp_url} alt={currentChat.name || 'Chat'} />
            ) : (
              <div className={styles.avatarPlaceholder}>
                {currentChat.name?.charAt(0).toUpperCase() || 'C'}
              </div>
            )}
          </div>
          <div className={styles.chatDetails}>
            <h3>{currentChat.name || 'Direct Message'}</h3>
            <span className={styles.status}>Online</span>
          </div>
        </div>

        <button className={styles.iconButton} aria-label="More options">
          <MoreVertical size={20} />
        </button>
      </div>

      {/* Messages Container */}
      <div className={styles.messagesContainer}>
        {messages.length === 0 ? (
          <div className={styles.noMessages}>
            <p>No messages yet. Start the conversation! 👋</p>
          </div>
        ) : (
          <div className={styles.messagesList}>
            {messages.map((message, index) => {
              const isSent = message.sender_id === currentUser?.id;
              const prevMessage = index > 0 ? messages[index - 1] : null;
              const isGrouped = prevMessage?.sender_id === message.sender_id;

              return (
                <div
                  key={message.id}
                  className={`${styles.messageWrapper} ${
                    isSent ? styles.sent : styles.received
                  } ${isGrouped ? styles.grouped : ''}`}
                >
                  {!isSent && !isGrouped && (
                    <div className={styles.senderName}>
                      {message.sender?.display_name || 'Unknown'}
                    </div>
                  )}
                  <div className={styles.messageBubble}>
                    <p className={styles.messageText}>{message.text}</p>
                    <span className={styles.messageTime}>
                      {new Date(message.created_at).toLocaleTimeString('en-US', {
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className={styles.inputContainer}>
        <button className={styles.attachButton} aria-label="Attach file">
          <Paperclip size={20} />
        </button>

        <textarea
          ref={textareaRef}
          value={messageText}
          onChange={(e) => setMessageText(e.target.value)}
          onKeyDown={handleKeyPress}
          placeholder="Type a message..."
          className={styles.messageInput}
          rows={1}
        />

        <button className={styles.emojiButton} aria-label="Add emoji">
          <Smile size={20} />
        </button>

        <button
          className={styles.sendButton}
          onClick={handleSendMessage}
          disabled={!messageText.trim()}
          aria-label="Send message"
        >
          <Send size={20} />
        </button>
      </div>
    </div>
  );
}
