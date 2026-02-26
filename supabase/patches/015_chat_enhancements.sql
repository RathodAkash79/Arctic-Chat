-- Patch 015: Chat Enhancements (Group Nicknames & Missing RLS fixes)

-- 1. Add nickname column to chat_participants
ALTER TABLE chat_participants ADD COLUMN IF NOT EXISTS nickname TEXT;

-- 2. Create RPC to set group nickname
CREATE OR REPLACE FUNCTION set_group_nickname(p_chat_id UUID, p_nickname TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Verify caller is a member
    IF NOT EXISTS (SELECT 1 FROM chat_participants WHERE chat_id = p_chat_id AND user_id = auth.uid()) THEN
        RAISE EXCEPTION 'Not a member of this chat';
    END IF;

    -- Update the nickname (null means use display_name)
    UPDATE chat_participants
    SET nickname = NULLIF(trim(p_nickname), '')
    WHERE chat_id = p_chat_id AND user_id = auth.uid();
END;
$$;

-- 3. Update get_my_chat_participants to include nickname
CREATE OR REPLACE FUNCTION get_my_chat_participants()
RETURNS TABLE (
    chat_id UUID,
    user_id UUID,
    group_role TEXT,
    joined_at TIMESTAMPTZ,
    nickname TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT cp.chat_id, cp.user_id, cp.group_role, cp.joined_at, cp.nickname
    FROM chat_participants cp
    JOIN chat_participants my_cp ON cp.chat_id = my_cp.chat_id
    WHERE my_cp.user_id = auth.uid();
END;
$$;
