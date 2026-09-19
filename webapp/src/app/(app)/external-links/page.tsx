import { ExternalLink } from "lucide-react";
import { getCurrentUser } from "@/lib/current-user";
import { EXTERNAL_LINKS } from "@/config/external-links";
import type { Rights } from "@/lib/current-user";

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
        <h1 className="text-2xl font-semibold text-gray-900">External Links</h1>
        <p className="mt-1 text-sm text-gray-500">
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
            className="group flex items-start gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-all hover:border-indigo-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
          >
            <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 transition-colors group-hover:bg-indigo-100">
              <ExternalLink className="h-5 w-5" strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <p className="font-medium text-gray-900 group-hover:text-indigo-700">
                {link.label}
              </p>
              {link.description && (
                <p className="mt-1 text-sm text-gray-500">{link.description}</p>
              )}
            </div>
          </a>
        ))}
      </div>

      {visible.length === 0 && (
        <p className="text-sm text-gray-500">No links available for your account.</p>
      )}
    </div>
  );
}
