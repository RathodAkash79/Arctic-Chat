# 🚨 RLS Error Fix - Follow These Steps

## Problem
Getting error: "new row violates row-level security policy for table users" when signing up

## Solution
Run the emergency fix script directly in Supabase

---

## ✅ Step 1: Go to Supabase SQL Editor

1. Open [Supabase Dashboard](https://supabase.com)
2. Select your project
3. Go to **SQL Editor** (left sidebar)
4. Click **"New Query"**

---

## ✅ Step 2: Copy & Paste the Fix Script

Open this file: `/EMERGENCY_RLS_FIX.sql`

Copy ALL the code from that file.

Paste it into the Supabase SQL Editor query box.

---

## ✅ Step 3: Run the Query

Click the **"Run"** button (bottom right of editor)

You should see:
```
Query executed successfully
```

If you see errors, **paste the error message below and I'll fix it**.

---

## ✅ Step 4: Verify It Worked

After running, you should see in the Supabase logs:
```
✅ INSERT policy added for user signup
✅ All SELECT/UPDATE policies verified
✅ Demo admin setup complete
```

---

## ✅ Step 5: Create Demo Admin in Auth

Now in Supabase, go to **Authentication → Users**

Click **"Invite user"** or **"Create new user"**
- Email: `admin@arcticnodes.io`
- Password: Set anything (e.g., `Admin123456`)
- Click **"Create user"**

---

## ✅ Step 6: Add Your Email to Whitelist

Go to **Table Editor → Select "whitelist" table**

Click **"Insert"** → **"Insert row"**

Add your email (e.g., `your.email@company.com`)

Click **"Save"**

---

## ✅ Step 7: Test Signup

Open: **http://localhost:3000/auth/signup**

Fill in:
- Email: Your email from Step 6
- Password: `TestPass123`
- Confirm: `TestPass123`

Click **"Sign Up"**

This should now work! ✅

---

## If You Still Get the Error

Message me with:
1. The exact error message
2. What email you're trying to use
3. The screenshot from Supabase

I'll fix it immediately.

---

## 🔒 Security Check
- ✅ No policies removed
- ✅ Only INSERT policy added (needed for signup)
- ✅ All security maintained
- ✅ Demo user can be deleted anytime

Your app is secure. ✅
