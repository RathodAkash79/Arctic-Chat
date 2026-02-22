# Arctic Chat - Comprehensive Product Requirements & Features (PRD)

## 1. Product Vision
Arctic Chat is a proprietary, closed-ecosystem communication and workspace platform exclusively for the Arcticnodes team. It prioritizes data sovereignty (custom object storage), strict access control (whitelist-only), high performance (instant rendering), and role-based workflow management.

---

## 2. User Authentication & Onboarding
* **Whitelist-Gated Entry:** Users cannot freely register. The admin must first add their email to the `whitelist` table. The sign-up form will reject any non-whitelisted emails.
* **Profile Setup:** Upon first login, users must set their `display_name` and upload a profile picture (`pfp_url`) to the custom object storage.
* **Secure Password Reset:** Users cannot change passwords directly from the UI. Clicking "Update Password" triggers a Supabase confirmation modal, which then sends a secure password reset link to their email.
* **Session Management:** Single concurrent session preferred, but multi-device is supported via Supabase Auth tokens.

---

## 3. Core Messaging Engine (The Chat Experience)
* **1-on-1 DMs & Group Chats:** Users can search the directory via email to start a DM or create custom groups.
* **Real-time Presence:** * "Online/Offline" status visible under the user's name.
    * "Typing..." indicator localized to the specific chat (powered by Supabase WebSockets).
* **Smart Rendering (Zero Lag):** Chat container uses `flex-direction: column-reverse`. The latest 20 messages load instantly without scroll-jumping.
* **Pagination (Chunking):** Scrolling up dynamically fetches the next 20 messages.
* **Floating Down Arrow (FAB):** Appears when the user scrolls up past 200px. Clicking it instantly snaps back to the newest message.
* **Message UI/UX:** * WhatsApp-style chat bubbles. Consecutive messages from the same sender are grouped, with the "tail" only appearing on the last bubble of the block.
    * **[PRO ADDITION]** Message Replies: Swipe right (on touch) or click a "Reply" icon to quote a previous message.
    * **[PRO ADDITION]** Edit & Delete: Senders can edit a message within 15 minutes, or "Delete for Everyone" (leaves a "This message was deleted" tombstone).
    * **[PRO ADDITION]** Link Previews: Automatically fetch and display metadata (title, image) for URLs shared in the chat.

---

## 4. Media & Custom Object Storage (90GB Self-Hosted)
* **Direct Uploads:** Media files bypass the database and upload directly to the custom object storage via Next.js API secure routes.
* **Smart Image Compression (Client-Side):**
    * *Normal Mode:* Canvas API compresses images to WebP (70% quality, max 1080px width) to save bandwidth and storage.
    * *HD Toggle:* Compresses at 90% quality, max 2048px width for detailed screenshots/designs.
* **The "24-Hour Nuke" Feature:** A toggle switch next to the attach button. If ON, the message gets an `expires_at` timestamp. A background Cron Job permanently deletes the image from object storage and the message from the database after 24 hours.
* **Media Gallery & "Eye Icon" Deep Linking:**
    * The Right Panel contains a grid of all shared media/links.
    * Clicking the "Eye 👁️" icon on an image clears the current message state and instantly queries the exact chunk of chat where that image was sent (+/- 10 messages).
    * Highlights the target message and shows a "⏬ Go to Latest" button to return.



---

## 5. The "Workspace" (Role-Based Task Management)
* **Role Hierarchy:** Management (Weight: 100) > Developer (80) > Staff (50) > Trial Staff (20).
* **The Task Board:** Pinned at the very top of the chat list. It does not look like a normal chat; it renders as a Feed of "Task Cards".
* **Visibility Logic:** * A 'Developer' sees tasks assigned to Developer, Staff, and Trial Staff groups.
    * A 'Trial Staff' only sees their specific group's tasks.
* **Task Card Features:**
    * Shows Title, Assignee, Assigner, and Status (Pending, In Progress, Completed).
    * **[PRO ADDITION]** Task Threads: Clicking a Task Card opens a dedicated sub-thread (mini-chat) for updates regarding that specific task.
* **Deletion Rules:** Tasks can only be deleted by the user who created them (`assigned_by`) OR a user with a higher `role_weight`. Assignees can only change the status to 'Completed'.

---

## 6. Admin Control Panel (The "God Mode")
* **Access Control:** Hidden from standard users. Only accessible via a gear icon if `role_weight >= 80`.
* **Dashboard Analytics:** * Total registered users vs Active accounts.
    * Total `storage_used_bytes` per chat room (Admin cannot read messages, only metadata).
* **Whitelist Management:** UI to input an email and authorize it for registration.
* **Role Delegation:** Admin can promote/demote users (e.g., changing a Staff to Developer).
* **Moderation (Ban & Timeout):**
    * Admins can temporarily "Timeout" a user (sets a `timeout_until` timestamp, putting the app in read-only mode for them).
    * Admins can permanently "Ban" an account.

---

## 7. Group Moderation & Hierarchy
* **Group Creation:** The creator becomes the "Owner".
* **Delegation:** Owners can promote normal members to "Admin".
* **Admin Limits:** Admins can add new members and remove standard members, but CANNOT remove the Owner or other Admins. Owners have absolute control.

---

## 8. UI/UX & Theming (SCSS)
* **3-Panel Desktop Layout:**
    * *Left:* Sidebar (Profile, Search, Pinned Tasks, Chat List).
    * *Middle:* Active Chat Room (Header, Message Area, Input Field).
    * *Right:* Slide-out Info Panel (Chat Stats, Media Gallery).
* **Dynamic Theming:** Deep SCSS integration utilizing `_variables.scss` for a flawless, lag-free Dark Mode / Light Mode switch based on the `data-theme` attribute.
* **Chat Customization:** Users can set a custom wallpaper URL for individual chats from their settings.
* **[PRO ADDITION] PWA (Progressive Web App):** Configure `manifest.json` and service workers so the Arcticnodes team can "Install" the web app on their Windows/Mac/Android devices like a native desktop application.

---

## 9. Security & Privacy Defaults
* **Payload Encryption:** Messages are symmetrically encrypted on the client side before being sent to Supabase. Even if the database is compromised, message contents remain unreadable without the environment keys.
* **No Metadata Leakage:** The Admin panel explicitly hides *who* is talking to *whom* in DMs to maintain intra-team privacy. It only shows aggregated storage data.
* **Environment Variables:** All Supabase keys and Custom Object Storage API keys will be strictly maintained in `.env.local`.
