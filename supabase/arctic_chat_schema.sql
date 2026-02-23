-- ============================================
-- ARCTIC CHAT - COMPLETE DATABASE SCHEMA
-- ============================================
-- Run this entire file in Supabase SQL Editor
-- It will DROP existing tables and recreate everything cleanly.
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- CLEAN SLATE: Drop existing tables (order matters for FK dependencies)
-- ============================================
DROP TABLE IF EXISTS tasks CASCADE;
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS chat_participants CASCADE;
DROP TABLE IF EXISTS chats CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS whitelist CASCADE;

-- Drop existing functions
DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;
DROP FUNCTION IF EXISTS update_chat_last_message() CASCADE;
DROP FUNCTION IF EXISTS create_dm_chat(UUID, UUID) CASCADE;


-- ============================================
-- TABLE: whitelist (Gatekeeper)
-- ============================================
-- Only whitelisted emails can register. Admin adds emails here.
CREATE TABLE whitelist (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  added_by UUID, -- Will reference users(id) after users table is created
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_whitelist_email ON whitelist(LOWER(email));


-- ============================================
-- TABLE: users (Identity & Roles)
-- ============================================
-- Linked to Supabase Auth via auth.users(id)
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  pfp_url TEXT DEFAULT '',
  role TEXT NOT NULL DEFAULT 'staff'
    CHECK (role IN ('management', 'developer', 'staff', 'trial_staff')),
  role_weight INTEGER NOT NULL DEFAULT 50,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'banned', 'timeout')),
  timeout_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add foreign key from whitelist.added_by -> users.id
ALTER TABLE whitelist
  ADD CONSTRAINT fk_whitelist_added_by
  FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX idx_users_email ON users(LOWER(email));
CREATE INDEX idx_users_role_weight ON users(role_weight);
CREATE INDEX idx_users_status ON users(status);


-- ============================================
-- TABLE: chats (Metadata & Group Info)
-- ============================================
CREATE TABLE chats (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type TEXT NOT NULL CHECK (type IN ('dm', 'group')),
  name TEXT,
  description TEXT,
  pfp_url TEXT,
  theme_wallpaper TEXT,
  storage_used_bytes BIGINT DEFAULT 0,
  last_message TEXT,
  last_message_time TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_chats_last_message_time ON chats(last_message_time DESC);


-- ============================================
-- TABLE: chat_participants (Junction Table)
-- ============================================
CREATE TABLE chat_participants (
  chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_role TEXT NOT NULL DEFAULT 'member'
    CHECK (group_role IN ('owner', 'admin', 'member')),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (chat_id, user_id)
);

CREATE INDEX idx_chat_participants_user_id ON chat_participants(user_id);
CREATE INDEX idx_chat_participants_chat_id ON chat_participants(chat_id);


-- ============================================
-- TABLE: messages (Core Payload)
-- ============================================
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL, -- Encrypted on client side before sending
  media_url TEXT,
  is_compressed BOOLEAN DEFAULT true,
  is_disappearing BOOLEAN DEFAULT false,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_chat_created ON messages(chat_id, created_at DESC);
CREATE INDEX idx_messages_sender ON messages(sender_id);
CREATE INDEX idx_messages_expires ON messages(expires_at) WHERE expires_at IS NOT NULL;


-- ============================================
-- TABLE: tasks (Arctic Manage Integration)
-- ============================================
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  description TEXT,
  assigned_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_role_weight INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tasks_target_role ON tasks(target_role_weight);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_assigned_by ON tasks(assigned_by);


-- ============================================
-- TRIGGER: Auto-update tasks.updated_at
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();


-- ============================================
-- TRIGGER: Auto-update chats.last_message on new message
-- ============================================
CREATE OR REPLACE FUNCTION update_chat_last_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE chats
    SET last_message = NEW.text,
        last_message_time = NEW.created_at
    WHERE id = NEW.chat_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_chat_last_message
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION update_chat_last_message();


-- ============================================
-- FUNCTION: Create or find existing DM chat (Idempotent)
-- ============================================
CREATE OR REPLACE FUNCTION create_dm_chat(user_id_1 UUID, user_id_2 UUID)
RETURNS UUID AS $$
DECLARE
  existing_chat_id UUID;
  new_chat_id UUID;
BEGIN
  -- Check if DM already exists between these two users
  SELECT cp1.chat_id INTO existing_chat_id
    FROM chat_participants cp1
    JOIN chat_participants cp2 ON cp1.chat_id = cp2.chat_id
    JOIN chats c ON c.id = cp1.chat_id
    WHERE cp1.user_id = user_id_1
      AND cp2.user_id = user_id_2
      AND c.type = 'dm'
    LIMIT 1;

  IF existing_chat_id IS NOT NULL THEN
    RETURN existing_chat_id;
  END IF;

  -- Create new DM chat
  INSERT INTO chats (type) VALUES ('dm') RETURNING id INTO new_chat_id;

  -- Add both participants
  INSERT INTO chat_participants (chat_id, user_id, group_role)
    VALUES
      (new_chat_id, user_id_1, 'member'),
      (new_chat_id, user_id_2, 'member');

  RETURN new_chat_id;
END;
$$ LANGUAGE plpgsql;


-- ============================================
-- PERMISSIONS: Grant access to authenticated users
-- ============================================
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO anon;
GRANT SELECT ON whitelist TO anon;


-- ============================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================

-- ---- WHITELIST ----
ALTER TABLE whitelist ENABLE ROW LEVEL SECURITY;

-- Anyone (including anon for signup check) can read whitelist emails
CREATE POLICY "whitelist_read_all"
  ON whitelist FOR SELECT
  TO authenticated, anon
  USING (true);

-- Only admins (role_weight >= 80) can insert into whitelist
CREATE POLICY "whitelist_insert_admin"
  ON whitelist FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
        AND users.role_weight >= 80
    )
  );

-- Only admins can delete from whitelist
CREATE POLICY "whitelist_delete_admin"
  ON whitelist FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
        AND users.role_weight >= 80
    )
  );


-- ---- USERS ----
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- All authenticated users can view all user profiles
CREATE POLICY "users_read_all"
  ON users FOR SELECT
  TO authenticated
  USING (true);

-- Users can insert their own profile (id must match auth.uid())
CREATE POLICY "users_insert_own"
  ON users FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

-- Users can update their own profile only
CREATE POLICY "users_update_own"
  ON users FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());


-- ---- CHATS ----
ALTER TABLE chats ENABLE ROW LEVEL SECURITY;

-- Users can only see chats they are a participant of
CREATE POLICY "chats_read_participant"
  ON chats FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM chat_participants
      WHERE chat_participants.chat_id = chats.id
        AND chat_participants.user_id = auth.uid()
    )
  );

-- Any authenticated user can create a chat
CREATE POLICY "chats_insert_authenticated"
  ON chats FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Only participants can update chat metadata
CREATE POLICY "chats_update_participant"
  ON chats FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM chat_participants
      WHERE chat_participants.chat_id = chats.id
        AND chat_participants.user_id = auth.uid()
    )
  );


-- ---- CHAT_PARTICIPANTS ----
ALTER TABLE chat_participants ENABLE ROW LEVEL SECURITY;

-- Users can see participants of chats they belong to
CREATE POLICY "participants_read_member"
  ON chat_participants FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM chat_participants AS cp
      WHERE cp.chat_id = chat_participants.chat_id
        AND cp.user_id = auth.uid()
    )
  );

-- Authenticated users can add participants (for creating chats/groups)
CREATE POLICY "participants_insert_authenticated"
  ON chat_participants FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Only owners/admins can remove participants
CREATE POLICY "participants_delete_admin"
  ON chat_participants FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM chat_participants AS cp
      WHERE cp.chat_id = chat_participants.chat_id
        AND cp.user_id = auth.uid()
        AND cp.group_role IN ('owner', 'admin')
    )
  );


-- ---- MESSAGES ----
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Users can read messages in chats they participate in
CREATE POLICY "messages_read_participant"
  ON messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM chat_participants
      WHERE chat_participants.chat_id = messages.chat_id
        AND chat_participants.user_id = auth.uid()
    )
  );

-- Users can send messages to chats they participate in
CREATE POLICY "messages_insert_participant"
  ON messages FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM chat_participants
      WHERE chat_participants.chat_id = messages.chat_id
        AND chat_participants.user_id = auth.uid()
    )
  );

-- Users can only delete their own messages
CREATE POLICY "messages_delete_own"
  ON messages FOR DELETE
  TO authenticated
  USING (sender_id = auth.uid());

-- Users can only update their own messages (for edit feature)
CREATE POLICY "messages_update_own"
  ON messages FOR UPDATE
  TO authenticated
  USING (sender_id = auth.uid())
  WITH CHECK (sender_id = auth.uid());


-- ---- TASKS ----
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- Users can see tasks targeted at their role weight or below
CREATE POLICY "tasks_read_by_role"
  ON tasks FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
        AND users.role_weight >= tasks.target_role_weight
    )
  );

-- Users with role_weight >= 50 can create tasks
CREATE POLICY "tasks_insert_authorized"
  ON tasks FOR INSERT
  TO authenticated
  WITH CHECK (
    assigned_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
        AND users.role_weight >= 50
    )
  );

-- Task creator or higher-ranked users can update tasks
CREATE POLICY "tasks_update_authorized"
  ON tasks FOR UPDATE
  TO authenticated
  USING (
    assigned_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM users u1, users u2
      WHERE u1.id = auth.uid()
        AND u2.id = tasks.assigned_by
        AND u1.role_weight > u2.role_weight
    )
  );

-- Task creator or higher-ranked users can delete tasks
CREATE POLICY "tasks_delete_authorized"
  ON tasks FOR DELETE
  TO authenticated
  USING (
    assigned_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM users u1, users u2
      WHERE u1.id = auth.uid()
        AND u2.id = tasks.assigned_by
        AND u1.role_weight > u2.role_weight
    )
  );


-- ============================================
-- ENABLE REALTIME (for live chat updates)
-- ============================================
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE chat_participants;
ALTER PUBLICATION supabase_realtime ADD TABLE chats;


-- ============================================
-- SEED DATA: Whitelist your first email for testing
-- ============================================
-- ⚠️ CHANGE THIS to your actual email before running!
INSERT INTO whitelist (email) VALUES ('admin@arcticnodes.io');
-- Add more emails as needed:
-- INSERT INTO whitelist (email) VALUES ('teammate@arcticnodes.io');


-- ============================================
-- DONE! ✅
-- ============================================
-- Next steps:
-- 1. Go to Supabase Dashboard → Table Editor to verify all 6 tables exist
-- 2. Add your real email to the whitelist table
-- 3. Test signup at http://localhost:3000/auth/signup
