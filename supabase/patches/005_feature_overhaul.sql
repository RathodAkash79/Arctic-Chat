-- ============================================================
-- ARCTIC CHAT — PATCH 005: Feature Overhaul Migration
-- ============================================================
-- SAFE: Additive only. Does NOT drop any existing tables.
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- ============================================================

-- ============================================================
-- 1. ALTER: messages — add mentions column
-- ============================================================
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS mentions JSONB DEFAULT '[]'::jsonb;

-- ============================================================
-- 2. ALTER: tasks — add chat linkage + assigned_to_user_id
-- ============================================================
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS chat_id UUID REFERENCES chats(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_to_role_weight INTEGER;

-- Update status enum to include 'in_review'
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check
  CHECK (status IN ('pending', 'in_progress', 'in_review', 'completed'));

CREATE INDEX IF NOT EXISTS idx_tasks_chat_id ON tasks(chat_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to_user_id);

-- ============================================================
-- 3. NEW TABLE: message_edit_history
-- ============================================================
CREATE TABLE IF NOT EXISTS message_edit_history (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id   UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  old_text     TEXT NOT NULL,
  edited_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_edit_history_message_id ON message_edit_history(message_id);

ALTER TABLE message_edit_history ENABLE ROW LEVEL SECURITY;

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

-- ============================================================
-- 4. NEW TABLE: task_comments
-- ============================================================
CREATE TABLE IF NOT EXISTS task_comments (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_comments_task_id ON task_comments(task_id);

ALTER TABLE task_comments ENABLE ROW LEVEL SECURITY;

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

-- ============================================================
-- 5. NEW TABLE: group_timeouts
-- ============================================================
CREATE TABLE IF NOT EXISTS group_timeouts (
  chat_id     UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  timed_until TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (chat_id, user_id)
);

ALTER TABLE group_timeouts ENABLE ROW LEVEL SECURITY;

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

-- ============================================================
-- 6. NEW TABLE: feedback
-- ============================================================
CREATE TABLE IF NOT EXISTS feedback (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message     TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback(created_at DESC);

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

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

-- ============================================================
-- 7. ENABLE REALTIME on new tables
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE message_edit_history;
ALTER PUBLICATION supabase_realtime ADD TABLE task_comments;
ALTER PUBLICATION supabase_realtime ADD TABLE group_timeouts;
ALTER PUBLICATION supabase_realtime ADD TABLE feedback;

-- ============================================================
-- DONE ✅
-- ============================================================
