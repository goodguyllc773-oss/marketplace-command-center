import type { ReactNode } from "react";

export function Card({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-base-700 bg-base-900 p-4 ${className}`}>
      {title && <div className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-400">{title}</div>}
      {children}
    </div>
  );
}

export function StatTile({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "danger" }) {
  const toneClass = tone === "ok" ? "text-emerald-400" : tone === "warn" ? "text-amber-400" : tone === "danger" ? "text-rose-400" : "text-white";
  return (
    <div className="rounded-lg border border-base-700 bg-base-900 p-4">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

const formatterCache = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export function money(n: number): string {
  return formatterCache.format(n);
}
