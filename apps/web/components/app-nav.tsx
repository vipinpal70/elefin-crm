"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

type Group = "Elefin" | "XM" | "TC" | "Admin";

interface NavItem {
  href: string;
  label: string;
  group: Group;
}

/** Broker-scoped sections (sheet-plan.md §9) — Elefin's book, XM's book, unconfirmed uploads, then admin. */
const ITEMS: NavItem[] = [
  { href: "/elefin/dashboard", label: "Dashboard", group: "Elefin" },
  { href: "/elefin/clients", label: "Clients", group: "Elefin" },
  { href: "/elefin/analytics", label: "Analytics", group: "Elefin" },
  { href: "/elefin/commission", label: "Commission", group: "Elefin" },
  { href: "/elefin/funding", label: "Funding", group: "Elefin" },
  { href: "/elefin/positions", label: "Positions", group: "Elefin" },
  { href: "/elefin/referral-codes", label: "Referral codes", group: "Elefin" },
  { href: "/elefin/alerts", label: "Alerts", group: "Elefin" },

  { href: "/xm/dashboard", label: "Dashboard", group: "XM" },
  { href: "/xm/clients", label: "Clients", group: "XM" },

  { href: "/tc/clients", label: "Unconfirmed", group: "TC" },

  { href: "/imports", label: "Imports", group: "Admin" },
  { href: "/elefin/sync", label: "Sync status", group: "Admin" },
  { href: "/elefin/api-log", label: "API log", group: "Admin" },
  { href: "/settings", label: "Settings", group: "Admin" },
];

const GROUPS: Group[] = ["Elefin", "XM", "TC", "Admin"];

const GROUP_ACTIVE: Record<Group, string> = {
  Elefin: "bg-accent-bg text-accent",
  XM: "bg-xm-accent-bg text-xm-accent",
  TC: "bg-tc-accent-bg text-tc-accent",
  Admin: "bg-sunken text-ink",
};

const GROUP_LABEL: Record<Group, string> = {
  Elefin: "text-muted",
  XM: "text-xm-accent",
  TC: "text-tc-accent",
  Admin: "text-muted",
};

const STORAGE_KEY = "elefin-crm:nav-collapsed";

function loadCollapsed(): Partial<Record<Group, boolean>> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function AppNav() {
  const pathname = usePathname();
  const activeGroup = ITEMS.find(
    (item) => pathname === item.href || pathname.startsWith(item.href + "/"),
  )?.group;

  // Every group starts expanded on first render (matches the previous always-open
  // behaviour); a viewer's collapse choices are then remembered per browser.
  const [collapsed, setCollapsed] = useState<Partial<Record<Group, boolean>>>({});
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setCollapsed(loadCollapsed());
    setHydrated(true);
  }, []);

  const toggle = (group: Group) => {
    setCollapsed((prev) => {
      const next = { ...prev, [group]: !prev[group] };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* private window / storage disabled — collapse state just won't persist */
      }
      return next;
    });
  };

  return (
    <nav className="flex flex-col gap-2.5 p-2.5 text-[13px]">
      {GROUPS.map((group) => {
        // While the persisted state is loading, keep the active group's section open
        // so a hard refresh on e.g. /xm/clients doesn't flash it shut.
        const isCollapsed = hydrated ? !!collapsed[group] : group !== activeGroup && !!activeGroup;
        const items = ITEMS.filter((item) => item.group === group);
        return (
          <div key={group}>
            <button
              type="button"
              onClick={() => toggle(group)}
              aria-expanded={!isCollapsed}
              className={cn(
                "flex w-full items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] transition hover:bg-sunken",
                GROUP_LABEL[group],
              )}
            >
              <svg
                viewBox="0 0 16 16"
                className={cn("h-2.5 w-2.5 shrink-0 fill-current transition-transform", !isCollapsed && "rotate-90")}
                aria-hidden="true"
              >
                <path d="M5 3l6 5-6 5V3z" />
              </svg>
              <span>{group}</span>
            </button>
            {!isCollapsed ? (
              <div className="mt-0.5 flex flex-col gap-0.5">
                {items.map((item) => {
                  const active = pathname === item.href || pathname.startsWith(item.href + "/");
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "block rounded-md py-1 pl-6 pr-2 transition",
                        active ? cn("font-medium", GROUP_ACTIVE[group]) : "text-ink-2 hover:bg-sunken hover:text-ink",
                      )}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
