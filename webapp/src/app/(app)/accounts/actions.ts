"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser, isAdmin } from "@/lib/current-user";

async function requireAdmin() {
  const account = await getCurrentUser();
  if (!account) redirect("/login");
  if (!isAdmin(account)) {
    return { error: "Only admins can manage accounts" };
  }
  return null;
}

function optionalInt(value: FormDataEntryValue | null): number | null {
  const s = value?.toString().trim();
  return s ? parseInt(s, 10) : null;
}

// Creates the Supabase Auth login AND the tbl_user_accounts row together --
// this is the one-step path that avoids the exact problem that motivated
// this feature: adding a login via the Supabase dashboard alone leaves it
// with nowhere to get a branch/rights from.
export async function createAccount(formData: FormData) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const email = (formData.get("email") as string)?.trim();
  const username = (formData.get("username") as string)?.trim();
  const branchId = optionalInt(formData.get("branch_id"));
  const rights = formData.get("rights") as string;

  if (!email || !username || !branchId || !rights) {
    return { error: "Email, username, branch, and rights are required" };
  }

  const headerList = await headers();
  const origin = headerList.get("origin") ?? `https://${headerList.get("host")}`;
  const admin = createAdminClient();
  const { data: authUser, error: authError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${origin}/reset-password`,
  });

  if (authError || !authUser.user) {
    return { error: authError?.message ?? "Failed to create the login" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tbl_user_accounts")
    .insert({
      auth_user_id: authUser.user.id,
      email,
      username,
      branch_id: branchId,
      rights,
    })
    .select("id")
    .single();

  if (error) {
    // roll back the auth user so a failed insert doesn't leave an orphaned login
    await admin.auth.admin.deleteUser(authUser.user.id);
    return { error: error.message };
  }

  revalidatePath("/accounts");
  redirect(`/accounts/${data.id}`);
}

export async function updateAccount(accountId: number, formData: FormData) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const email = (formData.get("email") as string)?.trim();
  const username = (formData.get("username") as string)?.trim();
  const branchId = optionalInt(formData.get("branch_id"));
  const rights = formData.get("rights") as string;
  const status = (formData.get("status") as string) || "ACTIVE";

  if (!email || !username || !branchId || !rights) {
    return { error: "Email, username, branch, and rights are required" };
  }

  const supabase = await createClient();
  const { data: existing, error: fetchError } = await supabase
    .from("tbl_user_accounts")
    .select("auth_user_id, email")
    .eq("id", accountId)
    .single();

  if (fetchError || !existing) {
    return { error: fetchError?.message ?? "Account not found" };
  }

  if (email !== existing.email) {
    const admin = createAdminClient();
    const { error: authError } = await admin.auth.admin.updateUserById(existing.auth_user_id, { email });
    if (authError) {
      return { error: authError.message };
    }
  }

  const { error } = await supabase
    .from("tbl_user_accounts")
    .update({ email, username, branch_id: branchId, rights, status })
    .eq("id", accountId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/accounts");
  revalidatePath(`/accounts/${accountId}`);
  redirect(`/accounts/${accountId}`);
}

// Sets a new password directly, bypassing email entirely -- the password is
// never stored anywhere (not in tbl_user_accounts, not logged); it's handed
// straight to Supabase Auth, same as the reset-password flow does.
export async function setAccountPassword(accountId: number, formData: FormData) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const password = formData.get("password") as string;
  if (!password || password.length < 6) {
    return { error: "Password must be at least 6 characters" };
  }

  const supabase = await createClient();
  const { data: existing, error: fetchError } = await supabase
    .from("tbl_user_accounts")
    .select("auth_user_id")
    .eq("id", accountId)
    .single();

  if (fetchError || !existing) {
    return { error: fetchError?.message ?? "Account not found" };
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(existing.auth_user_id, { password });
  if (error) {
    return { error: error.message };
  }

  return { success: true };
}
