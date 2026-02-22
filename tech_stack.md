# Arctic Chat - Technical Architecture & Stack Documentation

## 1. Project Overview
**Arctic Chat** is a high-performance, privacy-first, internal communication and workspace OS built exclusively for the Arcticnodes team. It combines WhatsApp-like fluid chat experiences with role-based task management, custom object storage, and strict whitelist-only access.

---

## 2. Core Technology Stack
* **Frontend Framework:** Next.js (App Router)
    * *Why:* For robust API routes (backend-in-frontend capabilities), optimized image rendering (`<Image>`), and seamless routing.
* **Styling:** SCSS (Sass Modules)
    * *Why:* To create a highly scalable, nested, and variable-driven design system (`_variables.scss`) for instant Dark/Light mode toggling without JavaScript lag.
* **Database & Auth:** Supabase (PostgreSQL)
    * *Why:* To leverage relational data structuring, Row Level Security (RLS) for rock-solid privacy, and built-in WebSockets for Realtime presence.
* **Media Storage:** Custom 90GB Object Storage (Self-hosted)
    * *Why:* Complete data sovereignty. Next.js API routes will securely communicate with this storage via custom REST APIs.
* **State Management (Suggestion):** Zustand or React Context
    * *Why:* To manage complex local states like `currentChat`, `userRole`, and `isTyping` without prop-drilling across the 3-panel UI.

---

## 3. Database Schema (Supabase PostgreSQL)



We are using a relational model. Below are the exact tables and columns required:

### A. `whitelist` (Gatekeeper Table)
* `id` (uuid, primary key)
* `email` (text, unique)
* `added_by` (uuid, references users.id)
* `created_at` (timestamp)

### B. `users` (Identity & Roles)
* `id` (uuid, matches Supabase Auth UID)
* `email` (text, unique)
* `display_name` (text)
* `pfp_url` (text, from custom object storage)
* `role` (text) - Enum: 'management', 'developer', 'staff', 'trial_staff'
* `role_weight` (int) - Management=100, Developer=80, Staff=50, Trial=20
* `status` (text) - Enum: 'active', 'banned', 'timeout'
* `timeout_until` (timestamp, nullable)
* `created_at` (timestamp)

### C. `chats` (Metadata & Group Info)
* `id` (uuid, primary key)
* `type` (text) - Enum: 'dm', 'group'
* `name` (text, nullable)
* `description` (text, nullable)
* `pfp_url` (text, nullable)
* `theme_wallpaper` (text, default: null)
* `storage_used_bytes` (bigint, default: 0)
* `last_message` (text)
* `last_message_time` (timestamp)

### D. `chat_participants` (Junction Table for Relations)
* `chat_id` (uuid, references chats.id)
* `user_id` (uuid, references users.id)
* `group_role` (text) - Enum: 'owner', 'admin', 'member'

### E. `messages` (The Core Payload)
* `id` (uuid, primary key)
* `chat_id` (uuid, references chats.id)
* `sender_id` (uuid, references users.id)
* `text` (text) - **Encrypted String (Application-Level Payload Encryption)**
* `media_url` (text, nullable)
* `is_compressed` (boolean, default: true)
* `is_disappearing` (boolean, default: false)
* `expires_at` (timestamp, nullable) - Set to created_at + 24 hours if disappearing is true
* `created_at` (timestamp)

### F. `tasks` (Arctic Manage Replacement)
* `id` (uuid, primary key)
* `title` (text)
* `description` (text, nullable)
* `assigned_by` (uuid, references users.id)
* `target_role_weight` (int) - The role group this task is broadcasted to
* `status` (text) - Enum: 'pending', 'in_progress', 'completed'
* `created_at` (timestamp)

---

## 4. Feature Implementation Logic & Workflows

### 4.1. Authentication & Security
* **Whitelist Flow:** On sign-up attempt, a Supabase Edge Function (or Next.js API route) triggers, checking if the email exists in the `whitelist` table. If not, Auth fails immediately.
* **Payload Encryption (No E2EE overhead):** Before a message leaves the client (Next.js frontend), it is encrypted using an application-wide symmetric key (stored securely in environment variables). Supabase only stores the encrypted string. The admin panel can never read the message text, only the metadata.
* **Row Level Security (RLS):** Supabase RLS policies will enforce that a user can only `SELECT` messages where their `user_id` exists in `chat_participants` for that `chat_id`.

### 4.2. Chat Rendering Engine (Performance Optimized)
* **CSS Hack for Instant Render:** The chat message container must use `display: flex; flex-direction: column-reverse;`. 
* **Pagination:** Fetch only the latest 20 messages initially (`.order('created_at', { ascending: false }).limit(20)`).
* **Floating Action Button (FAB):** Track scroll position. Show a downward arrow when the user scrolls up. Clicking it executes `element.scrollTo({ top: 0, behavior: 'smooth' })`.
* **Message Bubbles:** Use SCSS `::before` pseudo-elements. Only render the "WhatsApp-like tail" on the *last* message of a consecutive block sent by the same user.

### 4.3. Custom Media Storage & Compression
* **Client-Side Compression:** When a user attaches an image, intercept the file using the HTML5 Canvas API.
    * *Normal Mode (Default):* Compress to WebP format, 70% quality, max width 1080px.
    * *HD Toggle ON:* Compress to WebP/JPEG, 90% quality, max width 2048px.
* **Upload Flow:** Send the compressed blob to a Next.js API route (`/api/upload`). The Next.js server securely communicates with the custom 90GB Object Storage, uploads it, and returns the URL to be saved in the `messages` table.

### 4.4. The 24-Hour Nuke (Disappearing Messages)
* When a user toggles "24Hr Delete", the message gets an `expires_at` timestamp.
* **Cron Job:** A Vercel Cron Job hits a Next.js API endpoint (`/api/cron/cleanup`) every hour.
* **Action:** It queries Supabase for messages where `expires_at < now()`. It first hits the Custom Object Storage API to delete the physical image, then deletes the row from the Supabase `messages` table.

### 4.5. Media Gallery & "Eye" Icon (Message Jumping)
* Clicking the `Eye` icon on an image in the Right Panel DOES NOT scroll the DOM (to avoid fetching massive chat histories).
* **Action:** It clears the current Redux/Zustand message state, queries Supabase for that exact `message_id`'s timestamp, and fetches `10 messages before` and `10 messages after`.
* A temporary UI state highlights the target message. A floating "Go to Latest" button appears to revert back to the bottom of the chat.

### 4.6. Role-Based Task Board (Pinned at Top)
* The top of the Chat List features a pinned "Workspace/Tasks" UI.
* Clicking it routes to a specialized feed based on the user's `role_weight`. 
* **Logic:** A `Management` (100) user sees tasks assigned to `Developer` (80), `Staff` (50), etc. A `Trial Staff` (20) only sees tasks assigned to their tier.
* Tasks are rendered as Cards, not chat bubbles. Deletion is restricted via RLS to `user_id == assigned_by` OR `user.role_weight > assigned_by_role_weight`.

### 4.7. Realtime Presence (Online/Typing)
* Utilize **Supabase Realtime Channels**. 
* Track `online` status globally.
* Track `typing` status localized to a specific `chat_id`. Broadcast `isTyping` events to the channel instead of writing to the database to save costs and reduce latency.

### 4.8. Admin Dashboard
* **Access:** Protected by Next.js Middleware. Only accessible if `role_weight >= 80` (Developer/Management).
* **Capabilities:** * Add emails to `whitelist`.
    * Promote/Demote roles (updates `role_weight`).
    * Manage User Status (Ban, Timeout until specific date).
    * View Analytics: Total users, active accounts, and total `storage_used_bytes` per chat.
