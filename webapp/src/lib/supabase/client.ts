import { createBrowserClient } from "@supabase/ssr";

// persistSession/autoRefreshToken are the supabase-js defaults already, but
// spelled out here so a signed-in user's session survives closing the
// browser and gets silently refreshed instead of dropping them back to
// /login -- see also the middleware, which refreshes the session cookie on
// every request. The remaining piece (how long a session can be refreshed
// before it must be re-entered) is a Supabase project setting, not
// something this client config controls: Dashboard -> Authentication ->
// Sessions -> "Time-box user sessions" / "Inactivity timeout".
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    }
  );
}
