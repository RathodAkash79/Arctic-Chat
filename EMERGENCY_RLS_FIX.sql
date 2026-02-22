-- ============================================
-- ARCTIC CHAT - EMERGENCY RLS FIX
-- ============================================
-- Run this in Supabase SQL Editor if migration 003 didn't work
-- This will fix the "row-level security policy" error for users table

-- ============================================
-- STEP 1: Drop conflicting policies (if they exist)
-- ============================================
-- Safe to run - won't error if policies don't exist

DO $$
BEGIN
  DROP POLICY IF EXISTS "Users can insert own profile" ON users;
  RAISE NOTICE 'Dropped old policy if it existed';
EXCEPTION WHEN OTHERS THEN NULL;
END
$$;

-- ============================================
-- STEP 2: Create correct INSERT policy
-- ============================================
-- This allows authenticated users to insert ONLY their own profile
CREATE POLICY "Users can insert own profile"
ON users FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = id);

-- ============================================
-- STEP 3: Verify all required policies exist
-- ============================================
-- Safe to create - PostgreSQL will ignore if they already exist

DROP POLICY IF EXISTS "Users can read own profile" ON users;
CREATE POLICY "Users can read own profile"
ON users FOR SELECT
TO authenticated
USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can read chat participants profiles" ON users;
CREATE POLICY "Users can read chat participants profiles"
ON users FOR SELECT
TO authenticated
USING (
  id IN (
    SELECT cp.user_id
    FROM chat_participants cp
    WHERE cp.chat_id IN (
      SELECT chat_id FROM chat_participants WHERE user_id = auth.uid()
    )
  )
);

DROP POLICY IF EXISTS "Users can update own profile" ON users;
CREATE POLICY "Users can update own profile"
ON users FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Admins can update user roles and status" ON users;
CREATE POLICY "Admins can update user roles and status"
ON users FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND role_weight >= 80
  )
);

-- ============================================
-- STEP 4: Verify whitelist table has demo email
-- ============================================
INSERT INTO whitelist (email, created_at)
VALUES ('admin@arcticnodes.io', NOW())
ON CONFLICT (email) DO NOTHING;

-- ============================================
-- STEP 5: Verify demo admin user profile exists
-- ============================================
INSERT INTO users (
  id,
  email,
  display_name,
  pfp_url,
  role,
  role_weight,
  status,
  created_at
)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'admin@arcticnodes.io',
  'Admin',
  'https://ui-avatars.com/api/?name=Admin&background=0E82C3&color=fff',
  'admin',
  100,
  'active',
  NOW()
)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- SUCCESS MESSAGE
-- ============================================
-- If you see this without errors, everything is fixed:
-- ✅ INSERT policy added for user signup
-- ✅ All SELECT/UPDATE policies verified
-- ✅ Demo admin setup complete
-- ✅ Whitelist configured

-- Now you can:
-- 1. Create auth user: admin@arcticnodes.io in Supabase Auth UI
-- 2. Add your email to whitelist table
-- 3. Try signup again - should work now!
