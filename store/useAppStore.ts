'use client';

import { create } from 'zustand';
import type { User, Chat, Message } from '@/types';

interface AppState {
  // User State
  currentUser: User | null;
  setCurrentUser: (user: User | null) => void;

  // Chat State
  currentChat: Chat | null;
  setCurrentChat: (chat: Chat | null) => void;
  chats: Chat[];
  setChats: (chats: Chat[]) => void;

  // Messages State
  messages: Message[];
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;

  // UI State
  isRightPanelOpen: boolean;
  setIsRightPanelOpen: (isOpen: boolean) => void;
  isMobileChatOpen: boolean;
  setIsMobileChatOpen: (isOpen: boolean) => void;

  // Typing Indicators (Map of chat_id -> user_id[])
  typingUsers: Record<string, string[]>;
  setTypingUsers: (chatId: string, userIds: string[]) => void;

  // Theme
  theme: 'light' | 'dark';
  toggleTheme: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  // User State
  currentUser: null,
  setCurrentUser: (user) => set({ currentUser: user }),

  // Chat State
  currentChat: null,
  setCurrentChat: (chat) => set({ currentChat: chat }),
  chats: [],
  setChats: (chats) => set({ chats }),

  // Messages State
  messages: [],
  setMessages: (messages) => set({ messages }),
  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),

  // UI State
  isRightPanelOpen: false,
  setIsRightPanelOpen: (isOpen) => set({ isRightPanelOpen: isOpen }),
  isMobileChatOpen: false,
  setIsMobileChatOpen: (isOpen) => set({ isMobileChatOpen: isOpen }),

  // Typing Indicators
  typingUsers: {},
  setTypingUsers: (chatId, userIds) =>
    set((state) => ({
      typingUsers: { ...state.typingUsers, [chatId]: userIds },
    })),

  // Theme
  theme:
    typeof window !== 'undefined'
      ? (localStorage.getItem('theme') as 'light' | 'dark') || 'dark'
      : 'dark',
  toggleTheme: () =>
    set((state) => {
      const newTheme = state.theme === 'dark' ? 'light' : 'dark';
      if (typeof window !== 'undefined') {
        localStorage.setItem('theme', newTheme);
        document.documentElement.setAttribute('data-theme', newTheme);
      }
      return { theme: newTheme };
    }),
}));
