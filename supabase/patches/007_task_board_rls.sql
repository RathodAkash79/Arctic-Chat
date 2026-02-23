-- ============================================
-- ARCTIC CHAT PATCH 007: Task Board RLS
-- ============================================

-- Enable RLS on tasks (already created in schema)
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- Everyone with role_weight >= 20 can read tasks
-- filtered by target_role_weight <= their own role_weight
CREATE POLICY "tasks_read_by_role"
  ON tasks FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
        AND u.role_weight >= tasks.target_role_weight
    )
  );

-- Only developer+ (role_weight >= 80) can create tasks
CREATE POLICY "tasks_insert_developer"
  ON tasks FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
        AND u.role_weight >= 80
    )
  );

-- Creator can update (change status), or higher role can too
CREATE POLICY "tasks_update_creator_or_higher"
  ON tasks FOR UPDATE
  TO authenticated
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

-- Only creator or higher can delete
CREATE POLICY "tasks_delete_creator_or_higher"
  ON tasks FOR DELETE
  TO authenticated
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
