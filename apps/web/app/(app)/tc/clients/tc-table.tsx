"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { confirmTraderAction, confirmManyTradersAction } from "@/lib/actions/imports";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { TcQuery, TcRow, TcSortKey } from "@/lib/tc-data";

// Kept local (not imported from lib/tc-data.ts) so this client component never
// pulls that file's mongoose-backed runtime code into the browser bundle.
function tcSortHref(q: TcQuery, col: TcSortKey, dir: "asc" | "desc"): string {
  const p = new URLSearchParams();
  if (q.q) p.set("q", q.q);
  if (q.broker) p.set("broker", q.broker);
  if (q.flagged) p.set("flagged", "1");
  if (q.tag) p.set("tag", q.tag);
  if (col !== "needsReview") p.set("sort", col);
  if (dir !== "asc") p.set("dir", dir);
  const s = p.toString();
  return `/tc/clients${s ? `?${s}` : ""}`;
}

function SortTh({ q, col, label }: { q: TcQuery; col: TcSortKey; label: string }) {
  const active = q.sort === col;
  const nextDir = active && q.dir === "asc" ? "desc" : "asc";
  const arrow = active ? (q.dir === "desc" ? " ↓" : " ↑") : "";
  return (
    <th className="px-3 py-1.5 font-medium">
      <Link href={tcSortHref(q, col, nextDir)} className={cn("hover:text-ink", active && "text-ink")}>
        {label}
        {arrow}
      </Link>
    </th>
  );
}

export function TcTable({ rows, q }: { rows: TcRow[]; q: TcQuery }) {
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<Record<string, "elefin" | "xm">>({});
  const [rowMsg, setRowMsg] = useState<Record<string, string>>({});
  const [rowLinkId, setRowLinkId] = useState<Record<string, string>>({});
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);

  const visible = useMemo(() => rows.filter((r) => !done[r._id]), [rows, done]);
  const allSelected = visible.length > 0 && visible.every((r) => selected.has(r._id));

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = (checked: boolean) => {
    setSelected(checked ? new Set(visible.map((r) => r._id)) : new Set());
  };

  const confirmOne = (row: TcRow, decision: "elefin" | "xm") => {
    setRowMsg((m) => ({ ...m, [row._id]: "" }));
    let clientId: number | undefined;
    if (decision === "elefin") {
      const raw = rowLinkId[row._id] ?? (row.linkedClientId != null ? String(row.linkedClientId) : "");
      clientId = Number(raw);
      if (!raw.trim() || !Number.isInteger(clientId)) {
        setRowMsg((m) => ({ ...m, [row._id]: "Enter a valid Elefin client id first." }));
        return;
      }
    }
    start(async () => {
      const res = await confirmTraderAction(row._id, decision, clientId);
      if (res.error) setRowMsg((m) => ({ ...m, [row._id]: res.error! }));
      else setDone((m) => ({ ...m, [row._id]: decision }));
    });
  };

  const bulkConfirm = (decision: "elefin" | "xm") => {
    setBulkMsg(null);
    const ids = [...selected];
    if (!ids.length) {
      setBulkMsg("Select at least one row first.");
      return;
    }
    start(async () => {
      const res = await confirmManyTradersAction(ids, decision);
      const skippedIds = new Set(res.skipped.map((s) => s.id));
      setDone((m) => {
        const next = { ...m };
        for (const id of ids) if (!skippedIds.has(id)) next[id] = decision;
        return next;
      });
      setSelected(new Set());
      setBulkMsg(
        res.skipped.length
          ? `Confirmed ${res.confirmed}. Skipped ${res.skipped.length}: ${res.skipped
              .map((s) => `${s.name} (${s.reason})`)
              .join("; ")}`
          : `Confirmed ${res.confirmed} row${res.confirmed === 1 ? "" : "s"} → ${decision === "elefin" ? "Elefin" : "XM"}.`,
      );
    });
  };

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-rule bg-sunken px-3 py-2 text-[12px]">
        <span className="font-medium text-ink-2">{selected.size} selected</span>
        <Button size="sm" variant="secondary" disabled={pending || !selected.size} onClick={() => bulkConfirm("elefin")}>
          Confirm selected → Elefin
        </Button>
        <Button size="sm" variant="secondary" disabled={pending || !selected.size} onClick={() => bulkConfirm("xm")}>
          Confirm selected → XM
        </Button>
        <span className="text-muted">
          Elefin only works for rows with a suggested match — the rest come back skipped.
        </span>
        {bulkMsg ? <span className="w-full text-ink-2">{bulkMsg}</span> : null}
      </div>

      <div className="overflow-x-auto rounded-xl border border-rule bg-raised shadow-card">
        <table className="w-full min-w-[1040px] text-[13px]">
          <thead>
            <tr className="border-b border-rule-2 text-left text-[11px] uppercase tracking-[0.08em] text-muted">
              <th className="px-3 py-1.5 font-medium">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => toggleAll(e.target.checked)}
                  className="h-3.5 w-3.5 accent-tc-accent"
                  aria-label="Select all"
                />
              </th>
              <SortTh q={q} col="name" label="Name" />
              <SortTh q={q} col="email" label="Email" />
              <SortTh q={q} col="mt5Login" label="MT5 login" />
              <SortTh q={q} col="brokerNormalized" label="Detected broker" />
              <SortTh q={q} col="linkedClientName" label="Suggested match" />
              <SortTh q={q} col="needsReview" label="Review" />
              <th className="px-3 py-1.5 font-medium">Confirm</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-muted">
                  Nothing waiting — every uploaded row has been confirmed.
                </td>
              </tr>
            ) : (
              visible.map((r) => (
                <tr
                  key={r._id}
                  className={cn("border-b border-rule last:border-0 hover:bg-sunken", r.needsReview && "bg-tc-accent-bg/40")}
                >
                  <td className="px-3 py-1.5">
                    <input
                      type="checkbox"
                      checked={selected.has(r._id)}
                      onChange={() => toggle(r._id)}
                      className="h-3.5 w-3.5 accent-tc-accent"
                      aria-label={`Select ${r.name || r._id}`}
                    />
                  </td>
                  <td className="px-3 py-1.5">{r.name || "—"}</td>
                  <td className="px-3 py-1.5 text-ink-2">{r.email || "—"}</td>
                  <td className="px-3 py-1.5 font-mono text-[12px] text-ink-2">{r.mt5Login || "—"}</td>
                  <td className="px-3 py-1.5 text-ink-2">{r.brokerNormalized}</td>
                  <td className="px-3 py-1.5 text-ink-2">
                    {r.linkedClientName ? `${r.linkedClientName} (${r.matchMethod})` : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-[11px] text-err">{r.reviewReason ?? ""}</td>
                  <td className="px-3 py-1.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <input
                        type="number"
                        defaultValue={r.linkedClientId ?? ""}
                        onChange={(e) => setRowLinkId((m) => ({ ...m, [r._id]: e.target.value }))}
                        placeholder="client id"
                        className="h-7 w-20 rounded border border-rule-2 bg-raised px-1.5 text-[12px] text-ink placeholder:text-muted"
                      />
                      <Button size="sm" variant="secondary" disabled={pending} onClick={() => confirmOne(r, "elefin")}>
                        → Elefin
                      </Button>
                      <Button size="sm" variant="secondary" disabled={pending} onClick={() => confirmOne(r, "xm")}>
                        → XM
                      </Button>
                      {rowMsg[r._id] ? <span className="text-[11px] text-err">{rowMsg[r._id]}</span> : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
