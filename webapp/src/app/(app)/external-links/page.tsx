import { ExternalLink } from "lucide-react";
import { getCurrentUser } from "@/lib/current-user";
import { EXTERNAL_LINKS } from "@/config/external-links";
import type { Rights } from "@/lib/current-user";
import { QrCode } from "@/components/qr-code";

const RIGHTS_RANK: Record<Rights, number> = { STAFF: 0, MODERATOR: 1, ADMIN: 2 };

function canView(userRights: Rights, minRights?: Rights): boolean {
  if (!minRights) return true;
  return RIGHTS_RANK[userRights] >= RIGHTS_RANK[minRights];
}

export default async function ExternalLinksPage() {
  const account = await getCurrentUser();
  const rights: Rights = account?.rights ?? "STAFF";

  const visible = EXTERNAL_LINKS.filter((link) => canView(rights, link.minRights));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-fg">External Links</h1>
        <p className="mt-1 text-sm text-fg-subtle">
          Quick access to frequently used tools and forms.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {visible.map((link) => (
          <a
            key={link.url}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-start gap-4 rounded-xl border border-line bg-surface p-5 shadow-sm transition-all hover:border-indigo-300 dark:hover:border-indigo-700 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
          >
            <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 transition-colors group-hover:bg-indigo-100 dark:group-hover:bg-indigo-900/40">
              <ExternalLink className="h-5 w-5" strokeWidth={2} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-fg group-hover:text-indigo-700 dark:group-hover:text-indigo-300">
                {link.label}
              </p>
              {link.description && (
                <p className="mt-1 text-sm text-fg-subtle">{link.description}</p>
              )}
            </div>
            <QrCode value={link.url} label={`QR code for ${link.label}`} />
          </a>
        ))}
      </div>

      {visible.length === 0 && (
        <p className="text-sm text-fg-subtle">No links available for your account.</p>
      )}
    </div>
  );
}
