-- ============================================
-- ARCTIC CHAT — PATCH 002: Fix DM + Group creation
-- ============================================
-- Run this in Supabase SQL Editor AFTER patch 001

-- 1. Recreate create_dm_chat with SECURITY DEFINER
--    This bypasses RLS so the function can insert participants for both users
CREATE OR REPLACE FUNCTION create_dm_chat(user_id_1 UUID, user_id_2 UUID)
RETURNS UUID AS $$
DECLARE
  existing_chat_id UUID;
  new_chat_id UUID;
BEGIN
  -- Check if DM already exists between these two users
  SELECT cp1.chat_id INTO existing_chat_id
    FROM chat_participants cp1
    JOIN chat_participants cp2 ON cp1.chat_id = cp2.chat_id
    JOIN chats c ON c.id = cp1.chat_id
    WHERE cp1.user_id = user_id_1
      AND cp2.user_id = user_id_2
      AND c.type = 'dm'
    LIMIT 1;

  IF existing_chat_id IS NOT NULL THEN
    RETURN existing_chat_id;
  END IF;

  -- Create new DM chat
  INSERT INTO chats (type) VALUES ('dm') RETURNING id INTO new_chat_id;

  -- Add both participants
  INSERT INTO chat_participants (chat_id, user_id, group_role)
    VALUES
      (new_chat_id, user_id_1, 'member'),
      (new_chat_id, user_id_2, 'member');

  RETURN new_chat_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Create a helper for group creation too (SECURITY DEFINER)
--    This ensures the creator can add participants for other users
CREATE OR REPLACE FUNCTION create_group_chat(
  p_name TEXT,
  p_description TEXT DEFAULT NULL,
  p_pfp_url TEXT DEFAULT NULL,
  p_member_ids UUID[] DEFAULT '{}'
)
RETURNS UUID AS $$
DECLARE
  new_chat_id UUID;
  member_id UUID;
BEGIN
  -- Create the group chat
  INSERT INTO chats (type, name, description, pfp_url)
    VALUES ('group', p_name, p_description, p_pfp_url)
    RETURNING id INTO new_chat_id;

  -- Add the caller as owner
  INSERT INTO chat_participants (chat_id, user_id, group_role)
    VALUES (new_chat_id, auth.uid(), 'owner');

  -- Add all members
  FOREACH member_id IN ARRAY p_member_ids
  LOOP
    INSERT INTO chat_participants (chat_id, user_id, group_role)
      VALUES (new_chat_id, member_id, 'member');
  END LOOP;

  RETURN new_chat_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Done! Both DM and group creation now bypass RLS internally.
