import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Server-side Supabase client. Reads/writes the session via Next.js cookies,
// and always goes through the anon key -- RLS (defined in OSEM_schema.sql)
// is what actually enforces branch scoping and admin-only writes, this
// client doesn't bypass it.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // called from a Server Component -- middleware refreshes the
            // session instead, this can be safely ignored
          }
        },
      },
    }
  );
}
