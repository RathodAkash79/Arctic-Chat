-- ═══════════════════════════════════════════════════════════════
-- PATCH 014: Command Fixes, New Commands & Ban List Query
-- ═══════════════════════════════════════════════════════════════
-- APPLY THIS IN SUPABASE SQL EDITOR

-- ─────────────────────────────────────────────────────────────
-- 1. Add slowmode_seconds column to chats (if not exists)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE chats ADD COLUMN IF NOT EXISTS slowmode_seconds INT DEFAULT 0;

-- ─────────────────────────────────────────────────────────────
-- 2. Timeout/Mute check helpers (used by the send-message guard)
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION is_user_timed_out(p_chat_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM group_timeouts
        WHERE chat_id = p_chat_id
          AND user_id = p_user_id
          AND timed_until > now()
    );
$$;

CREATE OR REPLACE FUNCTION is_user_muted(p_chat_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM group_mutes
        WHERE chat_id = p_chat_id
          AND user_id = p_user_id
          AND (muted_until IS NULL OR muted_until > now())
    );
$$;

GRANT EXECUTE ON FUNCTION is_user_timed_out TO authenticated;
GRANT EXECUTE ON FUNCTION is_user_muted TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 3. get_user_group_status — returns timeout/mute state for caller
--    Called before sendMessage to enforce guards client-side with DB truth
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_user_group_status(p_chat_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_timeout_row RECORD;
    v_is_muted BOOLEAN;
BEGIN
    -- Check timeout
    SELECT timed_until INTO v_timeout_row
    FROM group_timeouts
    WHERE chat_id = p_chat_id AND user_id = auth.uid() AND timed_until > now()
    LIMIT 1;

    -- Check mute
    SELECT EXISTS (
        SELECT 1 FROM group_mutes
        WHERE chat_id = p_chat_id
          AND user_id = auth.uid()
          AND (muted_until IS NULL OR muted_until > now())
    ) INTO v_is_muted;

    RETURN jsonb_build_object(
        'is_timed_out', (v_timeout_row IS NOT NULL),
        'timed_until', (v_timeout_row.timed_until),
        'is_muted', v_is_muted
    );
END;
$$;

GRANT EXECUTE ON FUNCTION get_user_group_status TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 4. get_group_ban_list — returns banned users for admins/owner
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_group_ban_list(p_chat_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_role TEXT;
    v_result JSONB;
BEGIN
    -- Only admins/owner can view ban list
    SELECT group_role INTO v_caller_role
    FROM chat_participants
    WHERE chat_id = p_chat_id AND user_id = auth.uid();

    IF v_caller_role IS NULL OR v_caller_role NOT IN ('owner', 'admin') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Only admins and owner can view ban list');
    END IF;

    SELECT jsonb_build_object(
        'ok', true,
        'bans', COALESCE(jsonb_agg(
            jsonb_build_object(
                'user_id', gb.user_id,
                'display_name', u.display_name,
                'pfp_url', u.pfp_url,
                'reason', gb.reason,
                'banned_at', gb.banned_at,
                'banned_by_name', bu.display_name
            ) ORDER BY gb.banned_at DESC
        ), '[]'::jsonb)
    ) INTO v_result
    FROM group_bans gb
    JOIN users u ON u.id = gb.user_id
    JOIN users bu ON bu.id = gb.banned_by
    WHERE gb.chat_id = p_chat_id;

    RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_group_ban_list TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 5. Drop and recreate execute_group_command with new actions:
--    kick, warn, slowmode, nuke
-- ─────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS execute_group_command(UUID, UUID, TEXT, TIMESTAMPTZ, TEXT, INT);

CREATE OR REPLACE FUNCTION execute_group_command(
    p_chat_id UUID,
    p_target_user_id UUID DEFAULT NULL,
    p_action TEXT DEFAULT NULL,
    p_timeout_until TIMESTAMPTZ DEFAULT NULL,
    p_reason TEXT DEFAULT 'No reason provided',
    p_duration_mins INT DEFAULT NULL,
    p_slowmode_secs INT DEFAULT 0
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
    v_media_urls JSONB;
BEGIN
    -- 1. Get caller's role
    SELECT group_role INTO v_caller_role
    FROM chat_participants
    WHERE chat_id = p_chat_id AND user_id = auth.uid();

    IF v_caller_role IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'You are not a member of this group');
    END IF;

    -- ── SLOWMODE ──────────────────────────────────────────────
    IF p_action = 'slowmode' THEN
        IF v_caller_role != 'owner' THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Only the group owner can set slowmode');
        END IF;

        UPDATE chats SET slowmode_seconds = p_slowmode_secs WHERE id = p_chat_id;
        RETURN jsonb_build_object('ok', true, 'slowmode_secs', p_slowmode_secs);
    END IF;

    -- ── NUKE ──────────────────────────────────────────────────
    IF p_action = 'nuke' THEN
        IF v_caller_role != 'owner' THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Only the group owner can nuke all messages');
        END IF;

        -- Collect all media URLs before deleting
        SELECT COALESCE(jsonb_agg(media_url) FILTER (WHERE media_url IS NOT NULL), '[]'::jsonb)
        INTO v_media_urls
        FROM messages
        WHERE chat_id = p_chat_id AND media_url IS NOT NULL;

        -- Delete all messages
        DELETE FROM messages WHERE chat_id = p_chat_id;

        RETURN jsonb_build_object('ok', true, 'media_urls', v_media_urls);
    END IF;

    -- 2. For target-based actions: get target's role and name
    IF p_target_user_id IS NOT NULL THEN
        SELECT cp.group_role, u.display_name
        INTO v_target_role, v_target_name
        FROM chat_participants cp
        JOIN users u ON u.id = cp.user_id
        WHERE cp.chat_id = p_chat_id AND cp.user_id = p_target_user_id;

        -- For unban, user might not be a participant — look up from users table
        IF v_target_name IS NULL THEN
            SELECT display_name INTO v_target_name FROM users WHERE id = p_target_user_id;
        END IF;
    END IF;

    -- ── BAN ──────────────────────────────────────────────────
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
        IF p_target_user_id = auth.uid() THEN
            RETURN jsonb_build_object('ok', false, 'error', 'You cannot ban yourself');
        END IF;

        DELETE FROM chat_participants WHERE chat_id = p_chat_id AND user_id = p_target_user_id;
        INSERT INTO group_bans (chat_id, user_id, banned_by, reason)
        VALUES (p_chat_id, p_target_user_id, auth.uid(), p_reason)
        ON CONFLICT (chat_id, user_id) DO UPDATE SET reason = EXCLUDED.reason, banned_at = now(), banned_by = EXCLUDED.banned_by;

        RETURN jsonb_build_object('ok', true, 'name', v_target_name);

    -- ── UNBAN ─────────────────────────────────────────────────
    ELSIF p_action = 'unban' THEN
        IF v_caller_role NOT IN ('owner', 'admin') THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Only admins and owner can unban');
        END IF;

        DELETE FROM group_bans WHERE chat_id = p_chat_id AND user_id = p_target_user_id;
        RETURN jsonb_build_object('ok', true, 'name', v_target_name);

    -- ── KICK ──────────────────────────────────────────────────
    ELSIF p_action = 'kick' THEN
        IF v_caller_role NOT IN ('owner', 'admin') THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Only admins and owner can kick');
        END IF;
        IF v_target_role = 'owner' THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Cannot kick the group owner');
        END IF;
        IF v_caller_role = 'admin' AND v_target_role = 'admin' THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Admins cannot kick other admins');
        END IF;
        IF p_target_user_id = auth.uid() THEN
            RETURN jsonb_build_object('ok', false, 'error', 'You cannot kick yourself');
        END IF;

        DELETE FROM chat_participants WHERE chat_id = p_chat_id AND user_id = p_target_user_id;
        RETURN jsonb_build_object('ok', true, 'name', v_target_name);

    -- ── TIMEOUT ───────────────────────────────────────────────
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
        IF p_target_user_id = auth.uid() THEN
            RETURN jsonb_build_object('ok', false, 'error', 'You cannot timeout yourself');
        END IF;

        INSERT INTO group_timeouts (chat_id, user_id, timed_until)
        VALUES (p_chat_id, p_target_user_id, p_timeout_until)
        ON CONFLICT (chat_id, user_id) DO UPDATE SET timed_until = EXCLUDED.timed_until;

        RETURN jsonb_build_object('ok', true, 'name', v_target_name);

    -- ── UNTIMEOUT ─────────────────────────────────────────────
    ELSIF p_action = 'untimeout' THEN
        IF v_caller_role NOT IN ('owner', 'admin') THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Only admins and owner can remove timeouts');
        END IF;

        DELETE FROM group_timeouts WHERE chat_id = p_chat_id AND user_id = p_target_user_id;
        RETURN jsonb_build_object('ok', true, 'name', v_target_name);

    -- ── MUTE ──────────────────────────────────────────────────
    ELSIF p_action = 'mute' THEN
        IF v_caller_role NOT IN ('owner', 'admin') THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Only admins and owner can mute users');
        END IF;
        IF v_target_role = 'owner' THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Cannot mute the group owner');
        END IF;
        IF v_caller_role = 'admin' AND v_target_role = 'admin' THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Admins cannot mute other admins');
        END IF;

        INSERT INTO group_mutes (chat_id, user_id, muted_until, reason)
        VALUES (p_chat_id, p_target_user_id, p_timeout_until, p_reason)
        ON CONFLICT (chat_id, user_id) DO UPDATE SET muted_until = EXCLUDED.muted_until, reason = EXCLUDED.reason;

        RETURN jsonb_build_object('ok', true, 'name', v_target_name);

    -- ── UNMUTE ────────────────────────────────────────────────
    ELSIF p_action = 'unmute' THEN
        IF v_caller_role NOT IN ('owner', 'admin') THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Only admins and owner can unmute users');
        END IF;

        DELETE FROM group_mutes WHERE chat_id = p_chat_id AND user_id = p_target_user_id;
        RETURN jsonb_build_object('ok', true, 'name', v_target_name);

    -- ── WARN ──────────────────────────────────────────────────
    ELSIF p_action = 'warn' THEN
        IF v_caller_role NOT IN ('owner', 'admin') THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Only admins and owner can warn users');
        END IF;
        IF v_target_role = 'owner' THEN
            RETURN jsonb_build_object('ok', false, 'error', 'Cannot warn the group owner');
        END IF;

        RETURN jsonb_build_object('ok', true, 'name', v_target_name);

    -- ── PROMOTE ───────────────────────────────────────────────
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

    -- ── DEMOTE ────────────────────────────────────────────────
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

GRANT EXECUTE ON FUNCTION execute_group_command TO authenticated;
