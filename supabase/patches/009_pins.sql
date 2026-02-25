-- ============================================
-- ARCTIC CHAT PATCH 009: Pin Chat + Pin Message
-- ============================================

-- 1. Pin a chat per-user (in chat_participants)
ALTER TABLE chat_participants ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Pin a message per chat (store on chats table)
ALTER TABLE chats ADD COLUMN IF NOT EXISTS pinned_message_id UUID REFERENCES messages(id) ON DELETE SET NULL;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS pinned_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;

-- RLS for pin chat: any participant can update their own is_pinned
DROP POLICY IF EXISTS "chat_participants_update_own" ON chat_participants;
CREATE POLICY "chat_participants_update_own"
  ON chat_participants FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- RLS for pinning messages: only chat owner/admin can pin (via updating chats)
-- Already covered by existing chats UPDATE policy from the base schema.

-- Done ✅
