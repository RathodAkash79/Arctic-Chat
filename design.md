# Arctic Chat - UI/UX Design System & SCSS Architecture

## 1. Design Philosophy
* **Techie but Minimal:** Clean lines, ample whitespace (padding/margins), no cluttered borders. High data-density but visually breathable.
* **Fluid & Snappy:** Every hover, click, and panel slide must feel instantaneous. We use `0.2s ease` for micro-interactions and `0.3s cubic-bezier` for panel sliding.
* **Mobile-First Responsiveness:** The 3-panel desktop layout gracefully degrades into a swipeable single-panel experience on mobile devices.



---

## 2. Global Typography (Next.js `next/font/google`)
* **Primary Font (UI & Chat):** `Inter` or `Geist Sans`. (Highly legible, modern sans-serif).
* **Secondary Font (Code, Tasks, Stats):** `JetBrains Mono` or `Fira Code`. (Gives that distinct "Developer/Techie" vibe to numbers and IDs).
* **Weights:** `400` for regular messages, `500` for names/titles, `600` for active states/headers.

---

## 3. The Color Palette (SCSS Variables)
We are using a deeply contrasted "Arctic Slate" theme. The primary accent is a vibrant Ice Blue.

Create a `_variables.scss` file with the following tokens:

```scss
// Default (Light Theme - Clean & Professional)
:root {
  --bg-primary: #ffffff;      // Main chat background
  --bg-secondary: #f8fafc;    // Sidebars & panels
  --bg-hover: #f1f5f9;        // List item hover state
  
  --text-primary: #0f172a;    // Main text
  --text-secondary: #64748b;  // Timestamps, sub-text
  
  --accent-primary: #0ea5e9;  // The "Arctic Blue" (Buttons, Toggles, Links)
  --accent-hover: #0284c7;    
  
  --bubble-sent: #e0f2fe;     // Sent message bubble
  --bubble-received: #f1f5f9; // Received message bubble
  --text-sent: #0c4a6e;
  
  --border-light: #e2e8f0;    // Dividers
  
  --success: #10b981;         // Online dot, Completed tasks
  --danger: #ef4444;          // 24hr Nuke toggle active, Bans
  --warning: #f59e0b;         // Pending tasks
}

// Dark Theme (Default for Techies - Sleek & Easy on eyes)
[data-theme="dark"] {
  --bg-primary: #0f172a;      // Deep Slate (Main Chat)
  --bg-secondary: #020617;    // Very Dark Slate (Sidebars)
  --bg-hover: #1e293b;        // Subtle hover
  
  --text-primary: #f8fafc;
  --text-secondary: #94a3b8;
  
  --accent-primary: #38bdf8;  // Neon Ice Blue (Glows well on dark)
  --accent-hover: #7dd3fc;
  
  --bubble-sent: #0284c7;     // Deep blue for sent
  --bubble-received: #1e293b; // Slightly lighter slate for received
  --text-sent: #f0f9ff;
  
  --border-light: #334155;
}



4. Responsive Layout & Breakpoints
Using SCSS Media Queries for the 3-Panel system:

Desktop (xl: > 1024px):

Left Panel (Sidebar): 300px fixed width.

Middle Panel (Chat): flex: 1 (Takes remaining space).

Right Panel (Details): 350px fixed width (Slides in/out pushing the middle panel).

Tablet (md: 768px - 1024px):

Left Panel: 280px.

Middle Panel: flex: 1.

Right Panel: Becomes an absolute positioned "Slide-Over" drawer with a frosted glass background (backdrop-filter: blur(8px)).

Mobile (sm: < 768px):

1 Panel visible at a time.

Starts on Left Panel (Chat List).

Clicking a chat slides the Middle Panel in from the right (transform: translateX(0)).

A "Back" arrow appears in the Chat Header to return to the list.

5. Component-Specific UI/UX Details
A. Chat Bubbles & Text Area
Border Radius: border-radius: 12px;.

The "Tail": Use border-bottom-right-radius: 2px; for the sent messages (bottom-most in a group) to create that classic WhatsApp/Telegram tail look without messy SVG hacks.

Input Box: Floating design. box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);. It sits slightly above the bottom edge with rounded pill-like corners (border-radius: 24px;). Auto-expands up to 5 lines, then becomes scrollable.

B. Task Board (Arctic Manage Integration)
Visual Distinction: Tasks should NOT look like chat bubbles. They should be Cards.

Card UI: Give them a subtle border (1px solid var(--border-light)), a slight hover lift (transform: translateY(-2px)), and a status badge (e.g., a green pill for "Completed", yellow for "Pending").

Techie Touch: Display the Task ID (e.g., #TSK-001) in JetBrains Mono font at the top corner of the card.

C. Modals & Popups (The "Makkhan" Feel)
Use Glassmorphism for dropdown menus (Settings, Admin Gear) and Modals (Image Preview, Password Reset).

SCSS: background: rgba(var(--bg-secondary), 0.8); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.1);.

Animations: Modals should scale in transform: scale(0.95) to scale(1); opacity: 0 to 1; transition: 0.15s ease-out;.

D. The "Eye" Icon (Message Jumping)
When hovering over an image in the Right Panel Gallery, apply a dark overlay: background: rgba(0,0,0,0.5).

Reveal a sharp, glowing white Eye 👁️ icon in the center.

When clicked, the Middle Panel flashes a subtle highlight color (rgba(56, 189, 248, 0.2)) on the targeted message for 1.5 seconds so the user instantly knows where they landed.

E. Scrollbars
Hide default ugly browser scrollbars.

Use custom webkit scrollbars: Very thin (4px), dark grey track, and an ice-blue thumb on hover. Makes the app feel like a native desktop client.

6. Iconography
Use Lucide React or Phosphor Icons. They are clean, uniform, outline-based (techie look), and scale perfectly with our Next.js/React setup.
