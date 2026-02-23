-- SQL to enable Realtime Replication on necessary tables

-- Drop the publication if it already exists to recreate it
DROP PUBLICATION IF EXISTS supabase_realtime;

-- Create the publication for Realtime
CREATE PUBLICATION supabase_realtime;

-- Add relevant tables to the publication
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE chats;
ALTER PUBLICATION supabase_realtime ADD TABLE users;
ALTER PUBLICATION supabase_realtime ADD TABLE chat_participants;

-- Notes:
-- This allows clients to listen to INSERT, UPDATE, DELETE events on these tables.
-- RLS policies will still apply to the realtime broadcasts.
