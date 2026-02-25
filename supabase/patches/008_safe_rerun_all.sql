-- ============================================
-- ARCTIC CHAT PATCH 008: Safe re-run of all policies
-- ============================================
-- This patch is IDEMPOTENT — safe to run multiple times.
-- It drops all policies first, then recreates them.
-- ============================================

-- ============================================================
-- 1. ADD MISSING COLUMNS (safe — IF NOT EXISTS)
-- ============================================================
ALTER TABLE messages ADD COLUMN IF NOT EXISTS mentions JSONB DEFAULT '[]'::jsonb;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id UUID REFERENCES messages(id) ON DELETE SET NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS link_preview JSONB;

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS chat_id UUID REFERENCES chats(id) ON DELETE CASCADE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_to_role_weight INTEGER;

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check
  CHECK (status IN ('pending', 'in_progress', 'in_review', 'completed'));

-- ============================================================
-- 2. CREATE TABLES (safe — IF NOT EXISTS)
-- ============================================================
CREATE TABLE IF NOT EXISTS message_edit_history (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id   UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  old_text     TEXT NOT NULL,
  edited_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS task_comments (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS group_timeouts (
  chat_id     UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  timed_until TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS feedback (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message     TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes (safe — IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS idx_edit_history_message_id ON message_edit_history(message_id);
CREATE INDEX IF NOT EXISTS idx_task_comments_task_id ON task_comments(task_id);
CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_chat_id ON tasks(chat_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to_user_id);

-- ============================================================
-- 3. ENABLE RLS (safe to re-run)
-- ============================================================
ALTER TABLE message_edit_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_timeouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 4. DROP ALL EXISTING POLICIES (safe — IF EXISTS)
-- ============================================================
-- messages
DROP POLICY IF EXISTS "messages_update_own" ON messages;

-- message_edit_history
DROP POLICY IF EXISTS "edit_history_read_participant" ON message_edit_history;
DROP POLICY IF EXISTS "edit_history_insert_sender" ON message_edit_history;

-- task_comments
DROP POLICY IF EXISTS "task_comments_read_participant" ON task_comments;
DROP POLICY IF EXISTS "task_comments_insert_participant" ON task_comments;

-- group_timeouts
DROP POLICY IF EXISTS "group_timeouts_read_participant" ON group_timeouts;
DROP POLICY IF EXISTS "group_timeouts_write_admin" ON group_timeouts;

-- feedback
DROP POLICY IF EXISTS "feedback_insert_own" ON feedback;
DROP POLICY IF EXISTS "feedback_read_admin" ON feedback;

-- tasks
DROP POLICY IF EXISTS "tasks_read_by_role" ON tasks;
DROP POLICY IF EXISTS "tasks_insert_developer" ON tasks;
DROP POLICY IF EXISTS "tasks_update_creator_or_higher" ON tasks;
DROP POLICY IF EXISTS "tasks_delete_creator_or_higher" ON tasks;

-- ============================================================
-- 5. RECREATE ALL POLICIES
-- ============================================================

-- messages: sender can update own messages (edit/delete)
CREATE POLICY "messages_update_own"
  ON messages FOR UPDATE TO authenticated
  USING (sender_id = auth.uid())
  WITH CHECK (sender_id = auth.uid());

-- message_edit_history
CREATE POLICY "edit_history_read_participant"
  ON message_edit_history FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM messages m
      JOIN chat_participants cp ON cp.chat_id = m.chat_id
      WHERE m.id = message_edit_history.message_id
        AND cp.user_id = auth.uid()
    )
  );

CREATE POLICY "edit_history_insert_sender"
  ON message_edit_history FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM messages m
      WHERE m.id = message_edit_history.message_id
        AND m.sender_id = auth.uid()
    )
  );

-- task_comments
CREATE POLICY "task_comments_read_participant"
  ON task_comments FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tasks t
      JOIN chat_participants cp ON cp.chat_id = t.chat_id
      WHERE t.id = task_comments.task_id AND cp.user_id = auth.uid()
    )
  );

CREATE POLICY "task_comments_insert_participant"
  ON task_comments FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM tasks t
      JOIN chat_participants cp ON cp.chat_id = t.chat_id
      WHERE t.id = task_comments.task_id AND cp.user_id = auth.uid()
    )
  );

-- group_timeouts
CREATE POLICY "group_timeouts_read_participant"
  ON group_timeouts FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM chat_participants cp
      WHERE cp.chat_id = group_timeouts.chat_id AND cp.user_id = auth.uid()
    )
  );

CREATE POLICY "group_timeouts_write_admin"
  ON group_timeouts FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM chat_participants cp
      WHERE cp.chat_id = group_timeouts.chat_id
        AND cp.user_id = auth.uid()
        AND cp.group_role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM chat_participants cp
      WHERE cp.chat_id = group_timeouts.chat_id
        AND cp.user_id = auth.uid()
        AND cp.group_role IN ('owner', 'admin')
    )
  );

-- feedback
CREATE POLICY "feedback_insert_own"
  ON feedback FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "feedback_read_admin"
  ON feedback FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role_weight >= 200
    )
  );

-- tasks
CREATE POLICY "tasks_read_by_role"
  ON tasks FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
        AND u.role_weight >= tasks.target_role_weight
    )
  );

CREATE POLICY "tasks_insert_developer"
  ON tasks FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
        AND u.role_weight >= 80
    )
  );

CREATE POLICY "tasks_update_creator_or_higher"
  ON tasks FOR UPDATE TO authenticated
  USING (
    assigned_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
        AND u.role_weight > (
          SELECT u2.role_weight FROM users u2 WHERE u2.id = tasks.assigned_by
        )
    )
  );

CREATE POLICY "tasks_delete_creator_or_higher"
  ON tasks FOR DELETE TO authenticated
  USING (
    assigned_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
        AND u.role_weight > (
          SELECT u2.role_weight FROM users u2 WHERE u2.id = tasks.assigned_by
        )
    )
  );

-- ============================================================
-- 6. ENABLE REALTIME (safe — errors are ignored if already added)
-- ============================================================
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE message_edit_history;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE task_comments;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE group_timeouts;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE feedback;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- DONE ✅ All policies, tables, columns, and realtime are set.
-- ============================================================
