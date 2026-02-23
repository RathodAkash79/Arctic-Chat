'use client';

import { create } from 'zustand';
import type { User, ChatListItem, Message } from '@/types';

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
      // Avoid duplicates
      if (state.messages.some((m) => m.id === message.id)) return state;
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
