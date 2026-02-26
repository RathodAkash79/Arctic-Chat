-- ============================================
-- ARCTIC CHAT PATCH 016: Fix Feedback Insert RLS
-- ============================================
-- This patch ensures the feedback table has the correct RLS policy for inserting data.

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

-- Drop existing to avoid conflicts
DROP POLICY IF EXISTS "feedback_insert_own" ON feedback;

-- Recreate policy to allow authenticated users to insert their own feedback
CREATE POLICY "feedback_insert_own"
  ON feedback FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Done
