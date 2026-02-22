-- ============================================
-- ARCTIC CHAT - FIXES & DEMO DATA
-- ============================================
-- This migration fixes RLS policies and adds a demo admin user

-- ============================================
-- FIX: Add missing INSERT policy for users table
-- ============================================
-- Allow authenticated users to insert their own profile (signup flow)
CREATE POLICY "Users can insert own profile"
ON users FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = id);

-- ============================================
-- DEMO ADMIN USER (Can be deleted anytime)
-- ============================================
-- UUID for demo admin: 00000000-0000-0000-0000-000000000001
-- Email: admin@arcticnodes.io
-- Password: Must be created via Supabase Auth UI or via service_role API

-- First, add demo admin email to whitelist
INSERT INTO whitelist (email, created_at) 
VALUES ('admin@arcticnodes.io', NOW())
ON CONFLICT (email) DO NOTHING;

-- Insert demo admin user profile
INSERT INTO users (
  id,
  email,
  display_name,
  pfp_url,
  role,
  role_weight,
  status,
  created_at,
  updated_at
)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'admin@arcticnodes.io',
  'Admin',
  'https://ui-avatars.com/api/?name=Admin&background=0E82C3&color=fff',
  'admin',
  100,
  'active',
  NOW(),
  NOW()
)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- NOTES FOR DEVELOPER
-- ============================================
-- Demo Admin Details:
-- Email: admin@arcticnodes.io
-- Role: admin (role_weight: 100 - highest privilege)
-- Status: active

-- To fully activate:
-- 1. Go to Supabase Auth → Users
-- 2. Create a real auth user with email: admin@arcticnodes.io
-- 3. Set password via "Reset Password" or create with temporary password
-- 4. This profile is already linked (id matches)

-- To delete demo user later:
-- DELETE FROM users WHERE id = '00000000-0000-0000-0000-000000000001';
-- DELETE FROM whitelist WHERE email = 'admin@arcticnodes.io';
