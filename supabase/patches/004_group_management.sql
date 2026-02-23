-- ============================================
-- ARCTIC CHAT — PATCH 004: Group Management
-- ============================================
-- Adds SECURITY DEFINER RPCs for adding, removing, 
-- and promoting members in group chats.
-- ============================================

-- ==========================================================
-- 1. Add Group Member (Admins and Owners only)
-- ==========================================================
CREATE OR REPLACE FUNCTION add_group_member(p_chat_id UUID, p_user_id UUID)
RETURNS VOID AS $$
DECLARE
    v_caller_role TEXT;
    v_chat_type TEXT;
BEGIN
    -- Check if chat is a group
    SELECT type INTO v_chat_type FROM chats WHERE id = p_chat_id;
    IF v_chat_type != 'group' THEN
        RAISE EXCEPTION 'Cannot add members to a direct message';
    END IF;

    -- Get caller's role in this group
    SELECT group_role INTO v_caller_role 
    FROM chat_participants 
    WHERE chat_id = p_chat_id AND user_id = auth.uid();

    -- Check permissions
    IF v_caller_role NOT IN ('owner', 'admin') THEN
        RAISE EXCEPTION 'Only owners and admins can add members';
    END IF;

    -- Insert new member
    INSERT INTO chat_participants (chat_id, user_id, group_role)
    VALUES (p_chat_id, p_user_id, 'member')
    ON CONFLICT (chat_id, user_id) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ==========================================================
-- 2. Remove Group Member (Kick)
-- ==========================================================
CREATE OR REPLACE FUNCTION remove_group_member(p_chat_id UUID, p_target_user_id UUID)
RETURNS VOID AS $$
DECLARE
    v_caller_role TEXT;
    v_target_role TEXT;
BEGIN
    -- Get caller's role
    SELECT group_role INTO v_caller_role 
    FROM chat_participants 
    WHERE chat_id = p_chat_id AND user_id = auth.uid();

    -- Get target's role
    SELECT group_role INTO v_target_role 
    FROM chat_participants 
    WHERE chat_id = p_chat_id AND user_id = p_target_user_id;

    -- If target is not in group, do nothing
    IF v_target_role IS NULL THEN
        RETURN;
    END IF;

    -- Permissions logic:
    -- Owner can remove anyone except themselves
    -- Admin can only remove members
    IF v_caller_role = 'owner' AND p_target_user_id != auth.uid() THEN
        -- Allow
    ELSIF v_caller_role = 'admin' AND v_target_role = 'member' THEN
        -- Allow
    ELSE
        RAISE EXCEPTION 'You do not have permission to remove this user';
    END IF;

    -- Remove user
    DELETE FROM chat_participants 
    WHERE chat_id = p_chat_id AND user_id = p_target_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ==========================================================
-- 3. Update Group Role (Promote/Demote)
-- ==========================================================
CREATE OR REPLACE FUNCTION update_group_role(p_chat_id UUID, p_target_user_id UUID, p_new_role TEXT)
RETURNS VOID AS $$
DECLARE
    v_caller_role TEXT;
BEGIN
    -- Validate role
    IF p_new_role NOT IN ('owner', 'admin', 'member') THEN
        RAISE EXCEPTION 'Invalid role specified';
    END IF;

    -- Get caller's role
    SELECT group_role INTO v_caller_role 
    FROM chat_participants 
    WHERE chat_id = p_chat_id AND user_id = auth.uid();

    -- Only owners can change roles
    IF v_caller_role != 'owner' THEN
        RAISE EXCEPTION 'Only the group owner can change roles';
    END IF;

    -- Prevent changing your own role directly (use transfer ownership instead)
    IF p_target_user_id = auth.uid() THEN
        RAISE EXCEPTION 'Cannot change your own role directly';
    END IF;

    -- Update the role
    UPDATE chat_participants 
    SET group_role = p_new_role
    WHERE chat_id = p_chat_id AND user_id = p_target_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ==========================================================
-- 4. Leave Group
-- ==========================================================
CREATE OR REPLACE FUNCTION leave_group(p_chat_id UUID)
RETURNS VOID AS $$
DECLARE
    v_caller_role TEXT;
    v_owner_count INT;
    v_next_owner UUID;
BEGIN
    -- Check caller role
    SELECT group_role INTO v_caller_role 
    FROM chat_participants 
    WHERE chat_id = p_chat_id AND user_id = auth.uid();

    IF v_caller_role IS NULL THEN
        RETURN; -- Not in group
    END IF;

    -- If caller is an owner, handle ownership transfer if needed
    IF v_caller_role = 'owner' THEN
        SELECT COUNT(*) INTO v_owner_count 
        FROM chat_participants 
        WHERE chat_id = p_chat_id AND group_role = 'owner';

        -- If they are the LAST owner
        IF v_owner_count <= 1 THEN
            -- Try to find the oldest admin or member to promote
            SELECT user_id INTO v_next_owner
            FROM chat_participants
            WHERE chat_id = p_chat_id AND user_id != auth.uid()
            ORDER BY 
                CASE WHEN group_role = 'admin' THEN 1 ELSE 2 END, 
                joined_at ASC
            LIMIT 1;

            -- If there is someone else, promote them to owner
            IF v_next_owner IS NOT NULL THEN
                UPDATE chat_participants 
                SET group_role = 'owner' 
                WHERE chat_id = p_chat_id AND user_id = v_next_owner;
            ELSE
                -- If no one else is in the group, we could delete the group entirely.
                -- For now, let's just let them leave and the group becomes empty.
                -- (A scheduled function or trigger could clean up empty groups later).
            END IF;
        END IF;
    END IF;

    -- Delete self
    DELETE FROM chat_participants 
    WHERE chat_id = p_chat_id AND user_id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Done!
