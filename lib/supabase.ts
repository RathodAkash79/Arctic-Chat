import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. Check .env.local'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});

// ── Tab-switch recovery ─────────────────────────────────────────────
// When the user switches tabs and comes back, the Supabase HTTP connection
// pool and auth token may have gone stale. refreshSession() makes an actual
// network request to Supabase (unlike getSession which only reads local storage),
// which revives the internal fetch transport and gets a fresh access token.
if (typeof window !== 'undefined') {
  let isRefreshing = false;
  let hiddenAt: number | null = null;
  const RELOAD_THRESHOLD_MS = 30 * 1000; // 30 seconds

  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
    } else if (document.visibilityState === 'visible') {
      // If the user was away for more than the threshold, reload the entire page
      if (hiddenAt && Date.now() - hiddenAt > RELOAD_THRESHOLD_MS) {
        console.log('[Tab recovery] Away for > 30 seconds, reloading page as requested.');
        window.location.reload();
        return;
      }
      hiddenAt = null;

      if (!isRefreshing) {
        isRefreshing = true;
        try {
          const { data, error } = await supabase.auth.refreshSession();
          if (error) {
            console.warn('[Tab recovery] Session refresh failed:', error.message);
          } else {
            console.log('[Tab recovery] Session refreshed, token valid until:',
              data.session?.expires_at ? new Date(data.session.expires_at * 1000).toLocaleTimeString() : 'unknown'
            );
          }
        } catch (err) {
          console.warn('[Tab recovery] refreshSession error:', err);
        } finally {
          isRefreshing = false;
        }
      }
    }
  });
}

// Server-side client (for API routes)
export const createServerClient = () => {
  return createClient(
    supabaseUrl,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
};
