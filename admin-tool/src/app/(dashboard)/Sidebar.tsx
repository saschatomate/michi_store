"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Gem, Upload, Link2, LogOut } from "lucide-react";
import { logout } from "@/lib/auth-actions";

const NAV_ITEMS = [
  { href: "/", label: "Produkte", icon: Gem },
  { href: "/import", label: "Import", icon: Upload },
  { href: "/mapping", label: "Mapping", icon: Link2 },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-zinc-200/80 bg-white">
      <div className="flex h-16 items-center gap-2.5 border-b border-zinc-200/80 px-5">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-600 font-display text-sm font-semibold text-white shadow-sm shadow-indigo-600/30">
          M
        </div>
        <span className="font-display text-base font-semibold tracking-wide text-zinc-900">
          Marinell Admin
        </span>
      </div>

      <nav className="flex-1 space-y-0.5 px-3 py-4">
        {NAV_ITEMS.map((item) => {
          const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-indigo-50 text-indigo-700"
                  : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
              }`}
            >
              <Icon size={16} strokeWidth={2} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-zinc-200/80 p-3">
        <form action={logout}>
          <button
            type="submit"
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
          >
            <LogOut size={16} strokeWidth={2} />
            Abmelden
          </button>
        </form>
      </div>
    </aside>
  );
}
