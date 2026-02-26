-- 1. Drop existing policies to be safe
DROP POLICY IF EXISTS "group_timeouts_read_participant" ON group_timeouts;
DROP POLICY IF EXISTS "group_timeouts_write_admin" ON group_timeouts;

-- 2. Make sure RLS is enabled
ALTER TABLE group_timeouts ENABLE ROW LEVEL SECURITY;

-- 3. Simplified read policy: anyone in the chat can read timeouts
CREATE POLICY "group_timeouts_select"
  ON group_timeouts FOR SELECT TO authenticated
  USING (
    chat_id IN (
      SELECT chat_id FROM chat_participants WHERE user_id = auth.uid()
    )
  );

-- 4. Simplified insert policy: only owner/admin can insert/timeout
CREATE POLICY "group_timeouts_insert"
  ON group_timeouts FOR INSERT TO authenticated
  WITH CHECK (
    chat_id IN (
      SELECT chat_id FROM chat_participants 
      WHERE user_id = auth.uid() AND group_role IN ('owner', 'admin')
    )
  );

-- 5. Simplified update policy: only owner/admin can update an existing timeout
CREATE POLICY "group_timeouts_update"
  ON group_timeouts FOR UPDATE TO authenticated
  USING (
    chat_id IN (
      SELECT chat_id FROM chat_participants 
      WHERE user_id = auth.uid() AND group_role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    chat_id IN (
      SELECT chat_id FROM chat_participants 
      WHERE user_id = auth.uid() AND group_role IN ('owner', 'admin')
    )
  );

-- 6. Simplified delete policy: only owner/admin can remove a timeout (e.g. untimeout command in future)
CREATE POLICY "group_timeouts_delete"
  ON group_timeouts FOR DELETE TO authenticated
  USING (
    chat_id IN (
      SELECT chat_id FROM chat_participants 
      WHERE user_id = auth.uid() AND group_role IN ('owner', 'admin')
    )
  );
