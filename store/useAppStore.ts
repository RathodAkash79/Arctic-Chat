'use client';

import { create } from 'zustand';
import type { User, ChatListItem, Message, Theme } from '@/types';

// Apply theme to DOM
function applyTheme(theme: Theme) {
  if (typeof window === 'undefined') return;
  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'system';
  const stored = localStorage.getItem('theme') as Theme | null;
  return stored || 'system';
}

interface AppState {
  // User State
  currentUser: User | null;
  setCurrentUser: (user: User | null) => void;

  // Chat State
  currentChat: ChatListItem | null;
  setCurrentChat: (chat: ChatListItem | null) => void;
  chats: ChatListItem[];
  setChats: (chats: ChatListItem[]) => void;
  updateChatLastMessage: (chatId: string, message: string, time: string) => void;

  // Messages State
  messages: Message[];
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  prependMessages: (messages: Message[]) => void;

  // UI State
  isRightPanelOpen: boolean;
  setIsRightPanelOpen: (isOpen: boolean) => void;
  isMobileChatOpen: boolean;
  setIsMobileChatOpen: (isOpen: boolean) => void;
  isNewChatModalOpen: boolean;
  setIsNewChatModalOpen: (isOpen: boolean) => void;
  isSettingsOpen: boolean;
  setIsSettingsOpen: (isOpen: boolean) => void;

  // Typing Indicators (Map of chat_id -> user_id[])
  typingUsers: Record<string, string[]>;
  setTypingUsers: (chatId: string, userIds: string[]) => void;

  // Online Presence
  onlineUsers: string[];
  setOnlineUsers: (users: string[]) => void;

  // Theme
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

export const useAppStore = create<AppState>((set) => {
  const initialTheme = getInitialTheme();
  applyTheme(initialTheme);

  return {
    // User State
    currentUser: null,
    setCurrentUser: (user) => set({ currentUser: user }),

    // Chat State
    currentChat: null,
    setCurrentChat: (chat) => set({ currentChat: chat }),
    chats: [],
    setChats: (chats) => set({ chats }),
    updateChatLastMessage: (chatId, message, time) =>
      set((state) => ({
        chats: state.chats
          .map((c) =>
            c.id === chatId
              ? { ...c, last_message: message, last_message_time: time }
              : c
          )
          .sort((a, b) => {
            const ta = a.last_message_time ? new Date(a.last_message_time).getTime() : 0;
            const tb = b.last_message_time ? new Date(b.last_message_time).getTime() : 0;
            return tb - ta;
          }),
      })),

    // Messages State
    messages: [],
    setMessages: (messages) => set({ messages }),
    addMessage: (message) =>
      set((state) => {
        const exists = state.messages.some((m) => m.id === message.id);
        if (exists) {
          // Replace optimistic message with confirmed DB row (clears is_pending)
          return { messages: state.messages.map((m) => m.id === message.id ? message : m) };
        }
        return { messages: [...state.messages, message] };
      }),
    prependMessages: (older) =>
      set((state) => {
        const existingIds = new Set(state.messages.map((m) => m.id));
        const unique = older.filter((m) => !existingIds.has(m.id));
        return { messages: [...unique, ...state.messages] };
      }),

    // UI State
    isRightPanelOpen: false,
    setIsRightPanelOpen: (isOpen) => set({ isRightPanelOpen: isOpen }),
    isMobileChatOpen: false,
    setIsMobileChatOpen: (isOpen) => set({ isMobileChatOpen: isOpen }),
    isNewChatModalOpen: false,
    setIsNewChatModalOpen: (isOpen) => set({ isNewChatModalOpen: isOpen }),
    isSettingsOpen: false,
    setIsSettingsOpen: (isOpen) => set({ isSettingsOpen: isOpen }),

    // Typing Indicators
    typingUsers: {},
    setTypingUsers: (chatId, userIds) =>
      set((state) => ({
        typingUsers: { ...state.typingUsers, [chatId]: userIds },
      })),

    // Online Presence
    onlineUsers: [],
    setOnlineUsers: (users) => set({ onlineUsers: users }),

    // Theme — default to 'system'
    theme: initialTheme,
    setTheme: (theme: Theme) => {
      if (typeof window !== 'undefined') {
        localStorage.setItem('theme', theme);
        applyTheme(theme);
        // If system, watch for OS changes
        if (theme === 'system') {
          const mq = window.matchMedia('(prefers-color-scheme: dark)');
          const handler = (e: MediaQueryListEvent) => {
            document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
          };
          mq.removeEventListener('change', handler);
          mq.addEventListener('change', handler);
        }
      }
      set({ theme });
    },
    toggleTheme: () =>
      set((state) => {
        const next: Theme = state.theme === 'dark' ? 'light' : state.theme === 'light' ? 'system' : 'dark';
        if (typeof window !== 'undefined') {
          localStorage.setItem('theme', next);
          applyTheme(next);
        }
        return { theme: next };
      }),
  };
});
