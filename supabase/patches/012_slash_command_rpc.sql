-- 1. Add is_system to messages so we can render centered system messages
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_system BOOLEAN DEFAULT false;

-- 2. Create the SECURITY DEFINER RPC to bypass RLS for group admin actions safely!
CREATE OR REPLACE FUNCTION execute_group_command(
    p_chat_id UUID,
    p_target_user_id UUID,
    p_action TEXT, -- 'ban', 'promote', 'demote', 'timeout'
    p_timeout_until TIMESTAMPTZ DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER -- Bypasses RLS! Very important for admin actions
SET search_path = public
AS $$
DECLARE
    v_caller_role TEXT;
    v_target_role TEXT;
BEGIN
    -- 1. Get the caller's role in this chat
    SELECT group_role INTO v_caller_role
    FROM chat_participants
    WHERE chat_id = p_chat_id AND user_id = auth.uid();

    -- If caller isn't even in the chat, fail
    IF v_caller_role IS NULL THEN
        RETURN FALSE;
    END IF;

    -- 2. Get the target's role in this chat
    SELECT group_role INTO v_target_role
    FROM chat_participants
    WHERE chat_id = p_chat_id AND user_id = p_target_user_id;

    -- If target isn't in the chat, fail
    IF v_target_role IS NULL THEN
        RETURN FALSE;
    END IF;

    -- 3. Execute actions with strict permissions
    IF p_action = 'ban' THEN
        IF v_caller_role IN ('owner', 'admin') AND v_target_role != 'owner' THEN
            DELETE FROM chat_participants 
            WHERE chat_id = p_chat_id AND user_id = p_target_user_id;
            RETURN TRUE;
        END IF;

    ELSIF p_action = 'timeout' THEN
        IF v_caller_role IN ('owner', 'admin') AND v_target_role != 'owner' THEN
            -- Upsert into group_timeouts
            INSERT INTO group_timeouts (chat_id, user_id, timed_until)
            VALUES (p_chat_id, p_target_user_id, p_timeout_until)
            ON CONFLICT (chat_id, user_id) 
            DO UPDATE SET timed_until = EXCLUDED.timed_until;
            RETURN TRUE;
        END IF;

    ELSIF p_action = 'promote' THEN
        IF v_caller_role = 'owner' AND v_target_role != 'owner' THEN
            UPDATE chat_participants 
            SET group_role = 'admin' 
            WHERE chat_id = p_chat_id AND user_id = p_target_user_id;
            RETURN TRUE;
        END IF;

    ELSIF p_action = 'demote' THEN
        IF v_caller_role = 'owner' AND v_target_role != 'owner' THEN
            UPDATE chat_participants 
            SET group_role = 'member' 
            WHERE chat_id = p_chat_id AND user_id = p_target_user_id;
            RETURN TRUE;
        END IF;
    END IF;

    -- If permissions didn't match or invalid action
    RETURN FALSE;
END;
$$;
