"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const ITEMS: Array<{ href: string; label: string; group?: string }> = [
  { href: "/", label: "Dashboard" },
  { href: "/clients", label: "Clients" },
  { href: "/analytics", label: "Analytics" },
  { href: "/commission", label: "Commission" },
  { href: "/funding", label: "Funding" },
  { href: "/positions", label: "Positions" },
  { href: "/referral-codes", label: "Referral codes" },
  { href: "/alerts", label: "Alerts" },
  { href: "/sync", label: "Sync status", group: "Admin" },
  { href: "/settings", label: "Settings", group: "Admin" },
];

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-0.5 p-2.5 text-[13px]">
      {ITEMS.map((item, i) => {
        const active =
          item.href === "/"
            ? pathname === "/"
            : pathname === item.href || pathname.startsWith(item.href + "/");
        const showGroup = item.group && ITEMS[i - 1]?.group !== item.group;
        return (
          <div key={item.href}>
            {showGroup ? (
              <p className="mb-1 mt-2.5 px-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted">
                {item.group}
              </p>
            ) : null}
            <Link
              href={item.href}
              className={cn(
                "block rounded-md px-2 py-1 transition",
                active
                  ? "bg-accent-bg font-medium text-accent"
                  : "text-ink-2 hover:bg-sunken hover:text-ink",
              )}
            >
              {item.label}
            </Link>
          </div>
        );
      })}
    </nav>
  );
}
