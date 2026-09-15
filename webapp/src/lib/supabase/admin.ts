import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role client -- bypasses RLS entirely. Server-only: never import
// this from a client component, and never send SUPABASE_SERVICE_ROLE_KEY to
// the browser. Used only for Supabase Auth admin operations (creating /
// inviting / updating login accounts) that the anon key can't perform.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
