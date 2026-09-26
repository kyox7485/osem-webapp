import { getCurrentUser, isAdmin, isHqAdmin } from "@/lib/current-user";
import { AdminRecordProvider } from "@/components/admin-record-controls";
import { SignOutButton } from "@/components/sign-out-button";
import { NavLoadingProvider } from "@/components/nav-loading";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { Sidebar, type SidebarItem, type SidebarFooterInfo } from "@/components/sidebar";
import { PageHeaderProvider, PageHeaderSlot } from "@/components/page-header";
import { getServerTranslator } from "@/lib/i18n/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const account = await getCurrentUser();
  const { t } = await getServerTranslator();

  if (!account) {
    // Authenticated in Supabase Auth but no matching tbl_user_accounts row
    // -- can't do anything useful in the app (branch_id/rights come from
    // there). Rendered inline rather than redirected: redirecting to
    // /login would bounce right back here (middleware sends an
    // authenticated user away from /login), causing an infinite redirect
    // loop / blank page.
    return (
      <div className="flex min-h-screen items-center justify-center bg-app px-4">
        <div className="w-full max-w-sm rounded-lg border border-line bg-surface p-8 text-center shadow-sm">
          <h1 className="mb-2 text-lg font-semibold text-fg">{t("Account not set up")}</h1>
          <p className="mb-6 text-sm text-fg-subtle">
            {t(
              "You're signed in, but this login isn't linked to a user account yet. Ask an admin to add you under Accounts, then sign out and back in."
            )}
          </p>
          <SignOutButton />
        </div>
      </div>
    );
  }

  // One soft accent per module -- makes the rail scannable at a glance
  // instead of a stack of same-colour rows.
  const navItems: SidebarItem[] = [
    { href: "/residents", label: t("Residents"), icon: "Users", tint: "bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300" },
    { href: "/clinical", label: t("Clinical"), icon: "Stethoscope", tint: "bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300" },
    { href: "/physiotherapy", label: t("Physiotherapy"), icon: "Activity", tint: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300" },
    { href: "/staff", label: t("Staff"), icon: "IdCard", tint: "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300" },
    { href: "/external-links", label: t("External Links"), icon: "Link2", tint: "bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300" },
    ...(isAdmin(account) ? ([{ href: "/accounts", label: t("Accounts"), icon: "ShieldCheck", tint: "bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300" }] as SidebarItem[]) : []),
  ];

  const initial = account.username?.trim()?.[0]?.toUpperCase() ?? "?";

  const footer: SidebarFooterInfo = {
    branchName: account.branch_name || t("All branches"),
    rights: account.rights,
    username: account.username,
    initial,
  };

  return (
    <NavLoadingProvider>
      <PageHeaderProvider>
        <div className="flex min-h-screen bg-app">
          <Sidebar items={navItems} homeLabel={t("OSEM home")} footer={footer} />

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-10 border-b border-line bg-surface/90 shadow-sm backdrop-blur">
              <div className="flex items-center gap-3 px-6 py-3.5">
                <PageHeaderSlot />
                <ThemeToggle />
                <LanguageSwitcher />
              </div>
              <div className="h-0.5 bg-gradient-to-r from-blue-500 via-indigo-500 to-rose-400" />
            </header>
            <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6">
              {/* Edit/Delete record buttons are shown to HQ ADMIN logins only. */}
              <AdminRecordProvider enabled={isHqAdmin(account)}>{children}</AdminRecordProvider>
            </main>
          </div>
        </div>
      </PageHeaderProvider>
    </NavLoadingProvider>
  );
}
