-- ============================================
-- ARCTIC CHAT - DATABASE SCHEMA SETUP
-- ============================================
-- This migration creates all tables and relationships for Arctic Chat
-- Based on tech_stack.md specifications

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- TABLE: whitelist (Gatekeeper)
-- ============================================
CREATE TABLE IF NOT EXISTS whitelist (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT UNIQUE NOT NULL,
      added_by UUID,
        created_at TIMESTAMPTZ DEFAULT NOW()
        );

        -- Index for fast email lookups during registration
        CREATE INDEX idx_whitelist_email ON whitelist(email);

        -- ============================================
        -- TABLE: users (Identity & Roles)
        -- ============================================
        CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
            email TEXT UNIQUE NOT NULL,
              display_name TEXT NOT NULL,
                pfp_url TEXT,
                  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('management', 'developer', 'staff', 'trial_staff')),
                    role_weight INTEGER NOT NULL DEFAULT 50,
                      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'banned', 'timeout')),
                        timeout_until TIMESTAMPTZ,
                          created_at TIMESTAMPTZ DEFAULT NOW()
                          );

                          -- Foreign key for whitelist added_by
                          ALTER TABLE whitelist
                          ADD CONSTRAINT fk_whitelist_added_by 
                          FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE SET NULL;

                          -- Indexes for users table
                          CREATE INDEX idx_users_email ON users(email);
                          CREATE INDEX idx_users_role_weight ON users(role_weight);
                          CREATE INDEX idx_users_status ON users(status);

                          -- ============================================
                          -- TABLE: chats (Metadata & Group Info)
                          -- ============================================
                          CREATE TABLE IF NOT EXISTS chats (
                            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                              type TEXT NOT NULL CHECK (type IN ('dm', 'group')),
                                name TEXT,
                                  description TEXT,
                                    pfp_url TEXT,
                                      theme_wallpaper TEXT,
                                        storage_used_bytes BIGINT DEFAULT 0,
                                          last_message TEXT,
                                            last_message_time TIMESTAMPTZ,
                                              created_at TIMESTAMPTZ DEFAULT NOW()
                                              );

                                              -- Index for sorting by last message time
                                              CREATE INDEX idx_chats_last_message_time ON chats(last_message_time DESC);

                                              -- ============================================
                                              -- TABLE: chat_participants (Junction Table)
                                              -- ============================================
                                              CREATE TABLE IF NOT EXISTS chat_participants (
                                                chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
                                                  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                                                    group_role TEXT NOT NULL DEFAULT 'member' CHECK (group_role IN ('owner', 'admin', 'member')),
                                                      joined_at TIMESTAMPTZ DEFAULT NOW(),
                                                        PRIMARY KEY (chat_id, user_id)
                                                        );

                                                        -- Indexes for fast participant lookups
                                                        CREATE INDEX idx_chat_participants_user_id ON chat_participants(user_id);
                                                        CREATE INDEX idx_chat_participants_chat_id ON chat_participants(chat_id);

                                                        -- ============================================
                                                        -- TABLE: messages (Core Payload)
                                                        -- ============================================
                                                        CREATE TABLE IF NOT EXISTS messages (
                                                          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                                                            chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
                                                              sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                                                                text TEXT NOT NULL, -- Encrypted on client side
                                                                  media_url TEXT,
                                                                    is_compressed BOOLEAN DEFAULT true,
                                                                      is_disappearing BOOLEAN DEFAULT false,
                                                                        expires_at TIMESTAMPTZ,
                                                                          created_at TIMESTAMPTZ DEFAULT NOW()
                                                                          );

                                                                          -- Indexes for message queries (pagination, chronological order)
                                                                          CREATE INDEX idx_messages_chat_id_created_at ON messages(chat_id, created_at DESC);
                                                                          CREATE INDEX idx_messages_sender_id ON messages(sender_id);
                                                                          CREATE INDEX idx_messages_expires_at ON messages(expires_at) WHERE expires_at IS NOT NULL;

                                                                          -- ============================================
                                                                          -- TABLE: tasks (Arctic Manage Integration)
                                                                          -- ============================================
                                                                          CREATE TABLE IF NOT EXISTS tasks (
                                                                            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                                                                              title TEXT NOT NULL,
                                                                                description TEXT,
                                                                                  assigned_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                                                                                    target_role_weight INTEGER NOT NULL,
                                                                                      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed')),
                                                                                        created_at TIMESTAMPTZ DEFAULT NOW(),
                                                                                          updated_at TIMESTAMPTZ DEFAULT NOW()
                                                                                          );

                                                                                          -- Indexes for task queries
                                                                                          CREATE INDEX idx_tasks_target_role_weight ON tasks(target_role_weight);
                                                                                          CREATE INDEX idx_tasks_status ON tasks(status);
                                                                                          CREATE INDEX idx_tasks_assigned_by ON tasks(assigned_by);

                                                                                          -- ============================================
                                                                                          -- TRIGGER: Update tasks.updated_at
                                                                                          -- ============================================
                                                                                          CREATE OR REPLACE FUNCTION update_updated_at_column()
                                                                                          RETURNS TRIGGER AS $$
                                                                                          BEGIN
                                                                                            NEW.updated_at = NOW();
                                                                                              RETURN NEW;
                                                                                              END;
                                                                                              $$ LANGUAGE plpgsql;

                                                                                              CREATE TRIGGER update_tasks_updated_at
                                                                                              BEFORE UPDATE ON tasks
                                                                                              FOR EACH ROW
                                                                                              EXECUTE FUNCTION update_updated_at_column();

                                                                                              -- ============================================
                                                                                              -- TRIGGER: Update chats.last_message
                                                                                              -- ============================================
                                                                                              CREATE OR REPLACE FUNCTION update_chat_last_message()
                                                                                              RETURNS TRIGGER AS $$
                                                                                              BEGIN
                                                                                                UPDATE chats
                                                                                                  SET last_message = NEW.text,
                                                                                                        last_message_time = NEW.created_at
                                                                                                          WHERE id = NEW.chat_id;
                                                                                                            RETURN NEW;
                                                                                                            END;
                                                                                                            $$ LANGUAGE plpgsql;

                                                                                                            CREATE TRIGGER trigger_update_chat_last_message
                                                                                                            AFTER INSERT ON messages
                                                                                                            FOR EACH ROW
                                                                                                            EXECUTE FUNCTION update_chat_last_message();

                                                                                                            -- ============================================
                                                                                                            -- FUNCTION: Create DM Chat (Idempotent)
                                                                                                            -- ============================================
                                                                                                            CREATE OR REPLACE FUNCTION create_dm_chat(user_id_1 UUID, user_id_2 UUID)
                                                                                                            RETURNS UUID AS $$
                                                                                                            DECLARE
                                                                                                              existing_chat_id UUID;
                                                                                                                new_chat_id UUID;
                                                                                                                BEGIN
                                                                                                                  -- Check if DM already exists
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
                                                                                                                                                    
                                                                                                                                                      -- Add participants
                                                                                                                                                        INSERT INTO chat_participants (chat_id, user_id, group_role)
                                                                                                                                                          VALUES 
                                                                                                                                                              (new_chat_id, user_id_1, 'member'),
                                                                                                                                                                  (new_chat_id, user_id_2, 'member');
                                                                                                                                                                    
                                                                                                                                                                      RETURN new_chat_id;
                                                                                                                                                                      END;
                                                                                                                                                                      $$ LANGUAGE plpgsql;

                                                                                                                                                                      -- ============================================
                                                                                                                                                                      -- GRANT PERMISSIONS (for authenticated users)
                                                                                                                                                                      -- ============================================
                                                                                                                                                                      -- These will be refined with Row Level Security policies
                                                                                                                                                                      GRANT USAGE ON SCHEMA public TO authenticated;
                                                                                                                                                                      GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
                                                                                                                                                                      GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
