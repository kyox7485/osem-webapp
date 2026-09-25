"use server";

import { headers } from "next/headers";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Sends the password-reset email from the server with an implicit-flow
// client, so the link carries its own session (#access_token=...) and works
// in ANY browser or device -- the same shape admin invites already use, which
// /reset-password consumes via setSession.
//
// Don't move this back to the @supabase/ssr browser client: that one is
// PKCE-mode, which parks a one-time code verifier in the requesting
// browser's storage for the requesting origin. The link then only works if
// opened in that same browser on that same host -- a reset requested on
// osem-webapp-osemmedicare-4819.vercel.app but linked to
// osem-webapp.vercel.app (or opened on a phone) always failed with
// "link is invalid or has expired".
export async function requestPasswordReset(email: string) {
  const trimmed = email.trim();
  if (!trimmed) return { error: "Email is required" };

  const headerList = await headers();
  const requestOrigin = headerList.get("origin") ?? `https://${headerList.get("host")}`;
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? requestOrigin).replace(/\/+$/, "");

  const supabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { flowType: "implicit", autoRefreshToken: false, persistSession: false } }
  );
  const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
    redirectTo: `${appUrl}/reset-password`,
  });
  if (error) return { error: error.message };
  return { error: null };
}
