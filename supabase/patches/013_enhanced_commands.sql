-- ═══════════════════════════════════════════════════════════════
-- PATCH 013: Enhanced Group Commands + Ban List
-- ═══════════════════════════════════════════════════════════════

-- 1. Create ban_list table to track banned users (so they can be unbanned)
CREATE TABLE IF NOT EXISTS group_bans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    banned_by UUID NOT NULL REFERENCES users(id),
    reason TEXT DEFAULT 'No reason provided',
    banned_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (chat_id, user_id)
);

ALTER TABLE group_bans ENABLE ROW LEVEL SECURITY;

-- Ban list: members can read (to see if they are banned)
CREATE POLICY "group_bans_read"
    ON group_bans FOR SELECT TO authenticated
    USING (user_id = auth.uid());

-- Admins/owner can see all bans for their group
CREATE POLICY "group_bans_read_admin"
    ON group_bans FOR SELECT TO authenticated
    USING (
        chat_id IN (
            SELECT chat_id FROM chat_participants 
            WHERE user_id = auth.uid() AND group_role IN ('owner', 'admin')
        )
    );

-- 2. Group mutes table (can't send messages but still in group)
CREATE TABLE IF NOT EXISTS group_mutes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    muted_until TIMESTAMPTZ, -- NULL = indefinite
    reason TEXT DEFAULT 'No reason provided',
    muted_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (chat_id, user_id)
);

ALTER TABLE group_mutes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "group_mutes_read_participant"
    ON group_mutes FOR SELECT TO authenticated
    USING (
        chat_id IN (SELECT chat_id FROM chat_participants WHERE user_id = auth.uid())
    );

-- 3. Drop old RPC and recreate with full support
DROP FUNCTION IF EXISTS execute_group_command(UUID, UUID, TEXT, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION execute_group_command(
    p_chat_id UUID,
    p_target_user_id UUID,
    p_action TEXT,
    p_timeout_until TIMESTAMPTZ DEFAULT NULL,
    p_reason TEXT DEFAULT 'No reason provided',
    p_duration_mins INT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_role TEXT;
    v_target_role TEXT;
    v_target_name TEXT;
BEGIN
    -- 1. Get caller's role
    SELECT group_role INTO v_caller_role
    FROM chat_participants
    WHERE chat_id = p_chat_id AND user_id = auth.uid();

    IF v_caller_role IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'You are not a member of this group');
    END IF;

    -- 2. Get target's role and name
    SELECT cp.group_role, u.display_name 
    INTO v_target_role, v_target_name
    FROM chat_participants cp
    JOIN users u ON u.id = cp.user_id
    WHERE cp.chat_id = p_chat_id AND cp.user_id = p_target_user_id;

    IF v_target_role IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Target user not found in this group');
    END IF;

    -- ── BAN ──────────────────────────────────────────────────────
    IF p_action = 'ban' THEN
        IF v_caller_role NOT IN ('owner', 'admin') THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Only admins and owner can ban');
        END IF;
        IF v_target_role = 'owner' THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Cannot ban the group owner');
        END IF;
        IF v_caller_role = 'admin' AND v_target_role = 'admin' THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Admins cannot ban other admins, only the owner can');
        END IF;

        -- Remove from group
        DELETE FROM chat_participants WHERE chat_id = p_chat_id AND user_id = p_target_user_id;
        -- Record the ban
        INSERT INTO group_bans (chat_id, user_id, banned_by, reason)
        VALUES (p_chat_id, p_target_user_id, auth.uid(), p_reason)
        ON CONFLICT (chat_id, user_id) DO UPDATE SET reason = EXCLUDED.reason, banned_at = now();

        RETURN jsonb_build_object('ok', true, 'name', v_target_name);

    -- ── UNBAN ─────────────────────────────────────────────────────
    ELSIF p_action = 'unban' THEN
        IF v_caller_role NOT IN ('owner', 'admin') THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Only admins and owner can unban');
        END IF;
        -- Just remove from ban list (they will need to be re-invited)
        DELETE FROM group_bans WHERE chat_id = p_chat_id AND user_id = p_target_user_id;
        RETURN jsonb_build_object('ok', true, 'name', v_target_name);

    -- ── TIMEOUT ───────────────────────────────────────────────────
    ELSIF p_action = 'timeout' THEN
        IF v_caller_role NOT IN ('owner', 'admin') THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Only admins and owner can timeout');
        END IF;
        IF v_target_role = 'owner' THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Cannot timeout the group owner');
        END IF;
        IF v_caller_role = 'admin' AND v_target_role = 'admin' THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Admins cannot timeout other admins');
        END IF;

        INSERT INTO group_timeouts (chat_id, user_id, timed_until)
        VALUES (p_chat_id, p_target_user_id, p_timeout_until)
        ON CONFLICT (chat_id, user_id) DO UPDATE SET timed_until = EXCLUDED.timed_until;

        RETURN jsonb_build_object('ok', true, 'name', v_target_name);

    -- ── UNTIMEOUT ─────────────────────────────────────────────────
    ELSIF p_action = 'untimeout' THEN
        IF v_caller_role NOT IN ('owner', 'admin') THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Only admins and owner can remove timeouts');
        END IF;

        DELETE FROM group_timeouts WHERE chat_id = p_chat_id AND user_id = p_target_user_id;
        RETURN jsonb_build_object('ok', true, 'name', v_target_name);

    -- ── MUTE ──────────────────────────────────────────────────────
    ELSIF p_action = 'mute' THEN
        IF v_caller_role NOT IN ('owner', 'admin') THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Only admins and owner can mute users');
        END IF;
        IF v_target_role = 'owner' THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Cannot mute the group owner');
        END IF;

        INSERT INTO group_mutes (chat_id, user_id, muted_until, reason)
        VALUES (p_chat_id, p_target_user_id, p_timeout_until, p_reason)
        ON CONFLICT (chat_id, user_id) DO UPDATE SET muted_until = EXCLUDED.muted_until, reason = EXCLUDED.reason;

        RETURN jsonb_build_object('ok', true, 'name', v_target_name);

    -- ── UNMUTE ────────────────────────────────────────────────────
    ELSIF p_action = 'unmute' THEN
        IF v_caller_role NOT IN ('owner', 'admin') THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Only admins and owner can unmute users');
        END IF;

        DELETE FROM group_mutes WHERE chat_id = p_chat_id AND user_id = p_target_user_id;
        RETURN jsonb_build_object('ok', true, 'name', v_target_name);

    -- ── PROMOTE ───────────────────────────────────────────────────
    ELSIF p_action = 'promote' THEN
        IF v_caller_role != 'owner' THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Only the group owner can promote members');
        END IF;
        IF v_target_role = 'owner' THEN
            RETURN jsonb_build_object('ok', false, 'error', 'User is already the owner');
        END IF;
        IF v_target_role = 'admin' THEN
            RETURN jsonb_build_object('ok', false, 'error', 'User is already an admin');
        END IF;

        UPDATE chat_participants SET group_role = 'admin'
        WHERE chat_id = p_chat_id AND user_id = p_target_user_id;

        RETURN jsonb_build_object('ok', true, 'name', v_target_name);

    -- ── DEMOTE ────────────────────────────────────────────────────
    ELSIF p_action = 'demote' THEN
        IF v_caller_role != 'owner' THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Only the group owner can demote admins');
        END IF;
        IF v_target_role = 'owner' THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Cannot demote the group owner');
        END IF;
        IF v_target_role = 'member' THEN
            RETURN jsonb_build_object('ok', false, 'error', 'User is already a member');
        END IF;

        UPDATE chat_participants SET group_role = 'member'
        WHERE chat_id = p_chat_id AND user_id = p_target_user_id;

        RETURN jsonb_build_object('ok', true, 'name', v_target_name);

    END IF;

    RETURN jsonb_build_object('ok', false, 'error', 'Unknown action: ' || p_action);
END;
$$;

-- 4. Grant access to authenticated users
GRANT EXECUTE ON FUNCTION execute_group_command TO authenticated;
