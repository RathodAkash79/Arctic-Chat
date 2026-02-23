-- ============================================
-- ARCTIC CHAT — PATCH 003: Fix RLS infinite recursion
-- ============================================
-- PROBLEM: chat_participants policies reference themselves → infinite recursion
-- 
-- SOLUTION: 
-- 1. Remove ALL self-referencing policies
-- 2. Keep only simple direct-check policies  
-- 3. Create a SECURITY DEFINER function to fetch chat data (bypasses RLS)
-- ============================================

-- =====================
-- STEP 1: Drop ALL broken policies on chat_participants
-- =====================
DROP POLICY IF EXISTS "participants_read_member" ON chat_participants;
DROP POLICY IF EXISTS "participants_read_own" ON chat_participants;
DROP POLICY IF EXISTS "participants_read_chat_members" ON chat_participants;

-- Simple policy: you can see YOUR OWN rows only (no self-reference)
CREATE POLICY "participants_read_own"
  ON chat_participants FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- =====================
-- STEP 2: Fix chats policy (was referencing chat_participants which has recursion)
-- =====================
DROP POLICY IF EXISTS "chats_read_participant" ON chats;

-- Simple: you can see chats where you're a participant
-- This subquery hits chat_participants but only YOUR rows (safe, no recursion)
CREATE POLICY "chats_read_my_chats"
  ON chats FOR SELECT
  TO authenticated
  USING (
    id IN (SELECT cp.chat_id FROM chat_participants cp WHERE cp.user_id = auth.uid())
  );

-- =====================
-- STEP 3: Fix chats UPDATE
-- =====================
DROP POLICY IF EXISTS "chats_update_participant" ON chats;

CREATE POLICY "chats_update_my_chats"
  ON chats FOR UPDATE
  TO authenticated
  USING (
    id IN (SELECT cp.chat_id FROM chat_participants cp WHERE cp.user_id = auth.uid())
  );

-- =====================
-- STEP 4: Fix messages policies
-- =====================
DROP POLICY IF EXISTS "messages_read_participant" ON messages;

CREATE POLICY "messages_read_my_chats"
  ON messages FOR SELECT
  TO authenticated
  USING (
    chat_id IN (SELECT cp.chat_id FROM chat_participants cp WHERE cp.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "messages_insert_participant" ON messages;

CREATE POLICY "messages_insert_my_chats"
  ON messages FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND chat_id IN (SELECT cp.chat_id FROM chat_participants cp WHERE cp.user_id = auth.uid())
  );


-- =====================
-- STEP 5: SECURITY DEFINER function to get ALL participants of user's chats
-- This bypasses RLS so we can see OTHER members too
-- =====================
CREATE OR REPLACE FUNCTION get_my_chat_participants()
RETURNS TABLE (
  chat_id UUID,
  user_id UUID,
  group_role TEXT,
  joined_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
    SELECT cp.chat_id, cp.user_id, cp.group_role, cp.joined_at
    FROM chat_participants cp
    WHERE cp.chat_id IN (
      SELECT cp2.chat_id FROM chat_participants cp2 WHERE cp2.user_id = auth.uid()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Done! No more recursion.
