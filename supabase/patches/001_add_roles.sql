-- ============================================
-- ARCTIC CHAT — PATCH: Add God + Normal User Roles
-- ============================================
-- Run this in Supabase SQL Editor AFTER the main schema

-- 1. Drop and recreate the role CHECK constraint
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check 
  CHECK (role IN ('god', 'management', 'developer', 'staff', 'trial_staff', 'normal_user'));

-- 2. Add last_seen column for online status (avoids using realtime presence)
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen DESC);

-- 3. Update the admin RLS policies to use god role (weight 200)
-- Drop old whitelist admin policies and recreate for god-only
DROP POLICY IF EXISTS "whitelist_insert_admin" ON whitelist;
DROP POLICY IF EXISTS "whitelist_delete_admin" ON whitelist;

CREATE POLICY "whitelist_insert_god"
  ON whitelist FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
        AND users.role = 'god'
    )
  );

CREATE POLICY "whitelist_delete_god"
  ON whitelist FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
        AND users.role = 'god'
    )
  );

-- 4. Function to update last_seen (called from client heartbeat)
CREATE OR REPLACE FUNCTION update_last_seen()
RETURNS void AS $$
BEGIN
  UPDATE users SET last_seen = NOW() WHERE id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Done! Now your roles are: god, management, developer, staff, trial_staff, normal_user
