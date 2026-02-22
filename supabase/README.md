# Arctic Chat - Database Setup

## Overview
This folder contains SQL migration files to set up the Arctic Chat database schema in Supabase.

## Migration Files

1. **001_initial_schema.sql** - Creates all tables, indexes, triggers, and functions
2. **002_row_level_security.sql** - Configures Row Level Security policies for privacy

## How to Run Migrations

### Method 1: Supabase Dashboard (Recommended)

1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Create a new query
4. Copy and paste the contents of `001_initial_schema.sql`
5. Click **Run** to execute
6. Repeat steps 3-5 for `002_row_level_security.sql`

### Method 2: Supabase CLI

```bash
# Install Supabase CLI
npm install -g supabase

# Login to Supabase
supabase login

# Link your project
supabase link --project-ref <your-project-ref>

# Apply migrations
supabase db push
```

## Database Schema

### Tables Created

- **whitelist** - Email whitelist for registration gatekeeping
- **users** - User profiles with roles and status
- **chats** - Chat metadata (DM/Group)
- **chat_participants** - Junction table for chat membership
- **messages** - Encrypted message payload
- **tasks** - Role-based task management

### Key Features

✅ **Automatic Triggers**
- `last_message` and `last_message_time` auto-update when messages are inserted
- `updated_at` timestamp auto-updates for tasks

✅ **Helper Functions**
- `create_dm_chat(user_id_1, user_id_2)` - Idempotent DM creation

✅ **Row Level Security**
- Users can only read messages from chats they're in
- Role-based task visibility
- Admin-only whitelist management

✅ **Realtime Subscriptions**
- Enabled for: `messages`, `chat_participants`, `tasks`

## Verification

After running migrations, verify with these queries:

```sql
-- Check all tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public';

-- Check RLS is enabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public';

-- Test DM creation function
SELECT create_dm_chat(
  '<user-id-1>'::uuid, 
    '<user-id-2>'::uuid
    );
    ```

    ## Role Weights Reference

    | Role         | Weight | Capabilities                          |
    |--------------|--------|---------------------------------------|
    | Management   | 100    | Full admin access access           |
    | Developer    | 80     | Admin panel, whitelist management     |
    | Staff        | 50     | Standard user                         |
    | Trial Staff  | 20     | Limited access                        |

    ## Next Steps

    1. Run migrations in your Supabase project
    2. Create your first admin user via Supabase Auth
    3. Manually set their `role_weight` to 100 in the `users` table
    4. Use the admin panel to add emails to the whitelist
