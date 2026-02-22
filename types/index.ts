// ============================================
// ARCTIC CHAT - TYPE DEFINITIONS
// ============================================

export type UserRole = 'management' | 'developer' | 'staff' | 'trial_staff';
export type UserStatus = 'active' | 'banned' | 'timeout';
export type ChatType = 'dm' | 'group';
export type GroupRole = 'owner' | 'admin' | 'member';
export type TaskStatus = 'pending' | 'in_progress' | 'completed';

// Role weight mapping for hierarchy
export const ROLE_WEIGHTS: Record<UserRole, number> = {
  management: 100,
  developer: 80,
  staff: 50,
  trial_staff: 20,
};

// User Interface
export interface User {
  id: string;
  email: string;
  display_name: string;
  pfp_url: string;
  role: UserRole;
  role_weight: number;
  status: UserStatus;
  timeout_until?: string;
  created_at: string;
  is_online?: boolean;
}

// Chat Interface
export interface Chat {
  id: string;
  type: ChatType;
  name?: string;
  description?: string;
  pfp_url?: string;
  theme_wallpaper?: string;
  storage_used_bytes: number;
  last_message?: string;
  last_message_time?: string;
  unread_count?: number;
}

// Chat Participant Interface
export interface ChatParticipant {
  chat_id: string;
  user_id: string;
  group_role: GroupRole;
  user?: User;
}

// Message Interface
export interface Message {
  id: string;
  chat_id: string;
  sender_id: string;
  text: string; // Encrypted
  media_url?: string;
  is_compressed: boolean;
  is_disappearing: boolean;
  expires_at?: string;
  created_at: string;
  sender?: User;
}

// Task Interface
export interface Task {
  id: string;
  title: string;
  description?: string;
  assigned_by: string;
  target_role_weight: number;
  status: TaskStatus;
  created_at: string;
  assigner?: User;
}

// Whitelist Interface
export interface Whitelist {
  id: string;
  email: string;
  added_by: string;
  created_at: string;
}
