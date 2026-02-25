-- ============================================
-- ARCTIC CHAT — PATCH: get_or_create_dm_chat_v2
-- ============================================

CREATE OR REPLACE FUNCTION get_or_create_dm_chat_v2(target_user_id UUID)
RETURNS UUID AS $$
BEGIN
  -- Re-uses the robust logic from patch 002
  RETURN create_dm_chat(auth.uid(), target_user_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
