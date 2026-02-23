-- ============================================
-- ARCTIC CHAT PATCH 006: Message Edit & Delete
-- ============================================
-- Adds is_deleted, edited_at, reply_to_id, and
-- link_preview fields to the messages table.
-- ============================================

-- Add columns for soft delete and edit tracking
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reply_to_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS link_preview JSONB;

-- Update RLS: Allow sender to update their own messages (edit, delete)
CREATE POLICY "messages_update_own"
  ON messages FOR UPDATE
  TO authenticated
  USING (sender_id = auth.uid())
  WITH CHECK (sender_id = auth.uid());
