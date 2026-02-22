-- ============================================
-- ARCTIC CHAT - ROW LEVEL SECURITY POLICIES
-- ============================================
-- This ensures users can only access data they're authorized to see

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE whitelist ENABLE ROW LEVEL SECURITY;

-- ============================================
-- USERS TABLE POLICIES
-- ============================================

-- Users can read their own profile
CREATE POLICY "Users can read own profile"
ON users FOR SELECT
TO authenticated
USING (auth.uid() = id);

-- Users can read profiles of people they chat with
CREATE POLICY "Users can read chat participants profiles"
ON users FOR SELECT
TO authenticated
USING (
  id IN (
      SELECT cp.user_id
          FROM chat_participants cp
              WHERE cp.chat_id IN (
                    SELECT chat_id FROM chat_participants WHERE user_id = auth.uid()
                        )
                          )
                          );

                          -- Users can update their own profile
                          CREATE POLICY "Users can update own profile"
                          ON users FOR UPDATE
                          TO authenticated
                          USING (auth.uid() = id)
                          WITH CHECK (auth.uid() = id);

                          -- Only admins (role_weight >= 80) can update other users' roles/status
                          CREATE POLICY "Admins can update user roles and status"
                          ON users FOR UPDATE
                          TO authenticated
                          USING (
                            EXISTS (
                                SELECT 1 FROM users
                                    WHERE id = auth.uid() AND role_weight >= 80
                                      )
                                      );

                                      -- ============================================
                                      -- WHITELIST TABLE POLICIES
                                      -- ============================================

                                      -- Only admins can read whitelist
                                      CREATE POLICY "Admins can read whitelist"
                                      ON whitelist FOR SELECT
                                      TO authenticated
                                      USING (
                                        EXISTS (
                                            SELECT 1 FROM users
                                                WHERE id = auth.uid() AND role_weight >= 80
                                                  )
                                                  );

                                                  -- Only admins can add to whitelist
                                                  CREATE POLICY "Admins can insert into whitelist"
                                                  ON whitelist FOR INSERT
                                                  TO authenticated
                                                  WITH CHECK (
                                                    EXISTS (
                                                        SELECT 1 FROM users
                                                            WHERE id = auth.uid() AND role_weight >= 80
                                                              )
                                                              );

                                                              -- ============================================
                                                              -- CHATS TABLE POLICIES
                                                              -- ============================================

                                                              -- Users can read chats they're participants in
                                                              CREATE POLICY "Users can read their chats"
                                                              ON chats FOR SELECT
                                                              TO authenticated
                                                              USING (
                                                                id IN (
                                                                    SELECT chat_id FROM chat_participants WHERE user_id = auth.uid()
                                                                      )
                                                                      );

                                                                      -- Users can create chats
                                                                      CREATE POLICY "Users can create chats"
                                                                      ON chats FOR INSERT
                                                                      TO authenticated
                                                                      WITH CHECK (true);

                                                                      -- Only group admins/owners can update chat details
                                                                      CREATE POLICY "Chat admins can update chat details"
                                                                      ON chats FOR UPDATE
                                                                      TO authenticated
                                                                      USING (
                                                                        id IN (
                                                                            SELECT chat_id FROM chat_participants
                                                                                WHERE user_id = auth.uid()
                                                                                    AND group_role IN ('owner', 'admin')
                                                                                      )
                                                                                      );

                                                                                      -- ============================================
                                                                                      -- CHAT_PARTICIPANTS TABLE POLICIES
                                                                                      -- ============================================

                                                                                      -- Users can read participants of chats they're in
                                                                                      CREATE POLICY "Users can read chat participants"
                                                                                      ON chat_participants FOR SELECT
                                                                                      TO authenticated
                                                                                      USING (
                                                                                        chat_id IN (
                                                                                            SELECT chat_id FROM chat_participants WHERE user_id = auth.uid()
                                                                                              )
                                                                                              );

                                                                                              -- Chat owners/admins can add participants
                                                                                              CREATE POLICY "Chat admins can add participants"
                                                                                              ON chat_participants FOR INSERT
                                                                                              TO authenticated
                                                                                              WITH CHECK (
                                                                                                chat_id IN (
                                                                                                    SELECT chat_id FROM chat_participants
                                                                                                        WHERE user_id = auth.uid()
                                                                                                            AND group_role IN ('owner', 'admin')
                                                                                                              )
                                                                                                              );

                                                                                                              -- Chat owners/admins can remove participants (but not owners)
                                                                                                              CREATE POLICY "Chat admins can remove participants"
                                                                                                              ON chat_participants FOR DELETE
                                                                                                              TO authenticated
                                                                                                              USING (
                                                                                                                chat_id IN (
                                                                                                                    SELECT chat_id FROM chat_participants
                                                                                                                        WHERE user_id = auth.uid()
                                                                                                                            AND group_role IN ('owner', 'admin')
                                                                                                                              )
                                                                                                                                AND group_role != 'owner'
                                                                                                                                );

                                                                                                                                -- Users can leave chats (remove themselves)
                                                                                                                                CREATE POLICY "Users can leave chats"
                                                                                                                                ON chat_participants FOR DELETE
                                                                                                                                TO authenticated
                                                                                                                                USING (user_id = auth.uid());

                                                                                                                                -- ============================================
                                                                                                                                -- MESSAGES TABLE POLICIES
                                                                                                                                -- ============================================

                                                                                                                                -- Users can read messages from chats they're in
                                                                                                                                CREATE POLICY "Users can read messages from their chats"
                                                                                                                                ON messages FOR SELECT
                                                                                                                                TO authenticated
                                                                                                                                USING (
                                                                                                                                  chat_id IN (
                                                                                                                                      SELECT chat_id FROM chat_participants WHERE user_id = auth.uid()
                                                                                                                                        )
                                                                                                                                        );

                                                                                                                                        -- Users can send messages to chats they're in
                                                                                                                                        CREATE POLICY "Users can send messages to their chats"
                                                                                                                                        ON messages FOR INSERT
                                                                                                                                        TO authenticated
                                                                                                                                        WITH CHECK (
                                                                                                                                          sender_id = auth.uid()
                                                                                                                                            AND chat_id IN (
                                                                                                                                                SELECT chat_id FROM chat_participants WHERE user_id = auth.uid()
                                                                                                                                                  )
                                                                                                                                                  );

                                                                                                                                                  -- Users can delete their own messages
                                                                                                                                                  CREATE POLICY "Users can delete own messages"
                                                                                                                                                  ON messages FOR DELETE
                                                                                                                                                  TO authenticated
                                                                                                                                                  USING (sender_id = auth.uid());

                                                                                                                                                  -- Users can update their own messages (for editing within 15 min)
                                                                                                                                                  CREATE POLICY "Users can edit own messages"
                                                                                                                                                  ON messages FOR UPDATE
                                                                                                                                                  TO authenticated
                                                                                                                                                  USING (
                                                                                                                                                    sender_id = auth.uid()
                                                                                                                                                      AND created_at > NOW() - INTERVAL '15 minutes'
                                                                                                                                                      )
                                                                                                                                                      WITH CHECK (sender_id = auth.uid());

                                                                                                                                                      -- ============================================
                                                                                                                                                      -- TASKS TABLE POLICIES
                                                                                                                                                      -- ============================================

                                                                                                                                                      -- Users can read tasks assigned to their role level or below
                                                                                                                                                      CREATE POLICY "Users can read tasks for their role"
                                                                                                                                                      ON tasks FOR SELECT
                                                                                                                                                      TO authenticated
                                                                                                                                                      USING (
                                                                                                                                                        target_role_weight <= (
                                                                                                                                                            SELECT role_weight FROM users WHERE id = auth.uid()
                                                                                                                                                              )
                                                                                                                                                              );

                                                                                                                                                              -- Users can create tasks for roles below their level
                                                                                                                                                              CREATE POLICY "Users can create tasks"
                                                                                                                                                              ON tasks FOR INSERT
                                                                                                                                                              TO authenticated
                                                                                                                                                              WITH CHECK (
                                                                                                                                                                assigned_by = auth.uid()
                                                                                                                                                                  AND target_role_weight < (
                                                                                                                                                                      SELECT role_weight FROM users WHERE id = auth.uid()
                                                                                                                                                                        )
                                                                                                                                                                        );

                                                                                                                                                                        -- Task creators can update their own tasks
                                                                                                                                                                        CREATE POLICY "Task creators can update own tasks"
                                                                                                                                                                        ON tasks FOR UPDATE
                                                                                                                                                                        TO authenticated
                                                                                                                                                                        USING (assigned_by = auth.uid())
                                                                                                                                                                        WITH CHECK (assigned_by = auth.uid());

                                                                                                                                                                        -- Higher role weight users can update any task
                                                                                                                                                                        CREATE POLICY "Higher roles can update any task"
                                                                                                                                                                        ON tasks FOR UPDATE
                                                                                                                                                                        TO authenticated
                                                                                                                                                                        USING (
                                                                                                                                                                          EXISTS (
                                                                                                                                                                              SELECT 1 FROM users u
                                                                                                                                                                                  WHERE u.id = auth.uid()
                                                                                                                                                                                      AND u.role_weight > (
                                                                                                                                                                                            SELECT role_weight FROM users WHERE id = tasks.assigned_by
                                                                                                                                                                                                )
                                                                                                                                                                                                  )
                                                                                                                                                                                                  );

                                                                                                                                                                                                  -- Task creators or higher roles can delete tasks
                                                                                                                                                                                                  CREATE POLICY "Task creators and higher roles can delete tasks"
                                                                                                                                                                                                  ON tasks FOR DELETE
                                                                                                                                                                                                  TO authenticated
                                                                                                                                                                                                  USING (
                                                                                                                                                                                                    assigned_by = auth.uid()
                                                                                                                                                                                                      OR EXISTS (
                                                                                                                                                                                                          SELECT 1 FROM users u
                                                                                                                                                                                                              WHERE u.id = auth.uid()
                                                                                                                                                                                                                  AND u.role_weight > (
                                                                                                                                                                                                                        SELECT role_weight FROM users WHERE id = tasks.assigned_by
                                                                                                                                                                                                                            )
                                                                                                                                                                                                                              )
                                                                                                                                                                                                                              );

                                                                                                                                                                                                                              -- ============================================
                                                                                                                                                                                                                              -- REALTIME PUBLICATION
                                                                                                                                                                                                                              -- ============================================
                                                                                                                                                                                                                              -- Enable Realtime for specific tables

                                                                                                                                                                                                                              -- Messages (for live chat)
                                                                                                                                                                                                                              ALTER PUBLICATION supabase_realtime ADD TABLE messages;

                                                                                                                                                                                                                              -- Chat participants (for member updates)
                                                                                                                                                                                                                              ALTER PUBLICATION supabase_realtime ADD TABLE chat_participants;

                                                                                                                                                                                                                              -- Tasks (for live task updates)
                                                                                                                                                                                                                              ALTER PUBLICATION supabase_realtime ADD TABLE tasks; 