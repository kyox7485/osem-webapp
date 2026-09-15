"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = { href: string; label: string };

export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <>
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${
              active ? "bg-indigo-50 text-indigo-700" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </>
  );
}
