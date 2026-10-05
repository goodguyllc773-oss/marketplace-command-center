import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type Offer } from "../api.js";
import { Card, money } from "../components/Card.js";

const ROLE_TABS = [
  { id: "", label: "All" },
  { id: "SELLING", label: "On my listings" },
  { id: "BUYING", label: "I'm buying" },
] as const;

const STATUS_TONE: Record<string, string> = {
  PENDING: "bg-amber-500/15 text-amber-300",
  SENT: "bg-sky-500/15 text-sky-300",
  ACCEPTED: "bg-emerald-500/15 text-emerald-300",
  COUNTERED: "bg-amber-500/15 text-amber-300",
  DECLINED: "bg-rose-500/15 text-rose-300",
  EXPIRED: "bg-slate-500/15 text-slate-400",
  ITEM_SOLD: "bg-slate-500/15 text-slate-400",
};

export default function Offers() {
  const [role, setRole] = useState<"" | "SELLING" | "BUYING">("");
  const offersQuery = useQuery({
    queryKey: ["offers", role],
    queryFn: () => api.offers.list(role || undefined),
    refetchInterval: 30_000,
  });
  const offers = offersQuery.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Offers</h1>
        <p className="text-sm text-slate-400">
          Offers on your listings, and Depop offers where you're the buyer (read from the Depop Offers tab by the MCC
          Depop Reader extension).
        </p>
      </div>

      <Card>
        <div className="mb-3 flex gap-1">
          {ROLE_TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setRole(t.id)}
              className={`rounded-md px-3 py-1.5 text-sm ${role === t.id ? "bg-base-700 text-white" : "text-slate-400 hover:text-slate-200"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {offersQuery.isLoading && <div className="text-slate-400">Loading…</div>}
        {!offersQuery.isLoading && offers.length === 0 && (
          <div className="text-sm text-slate-500">
            No offers yet. Depop offers appear once the Depop Reader extension has read your Offers tab.
          </div>
        )}
        {offers.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2">Item</th>
                  <th className="py-2">Offer</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">Deadline</th>
                  <th className="py-2">Account</th>
                  <th className="py-2 text-right">Updated</th>
                </tr>
              </thead>
              <tbody>
                {offers.map((o) => (
                  <OfferRow key={o.id} offer={o} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function OfferRow({ offer: o }: { offer: Offer }) {
  const title = o.listing?.title ?? o.itemTitle ?? "Unknown item";
  const url = o.itemUrl ?? o.listing?.url ?? null;
  const who = o.offeredBy === "SELLER" ? "Seller's offer" : o.role === "BUYING" ? "Your offer" : "Buyer's offer";
  return (
    <tr className="border-t border-base-700 align-top">
      <td className="py-2 pr-3">
        {url ? (
          <a href={url} target="_blank" rel="noreferrer" className="text-white hover:underline">
            {title} ↗
          </a>
        ) : (
          <span className="text-white">{title}</span>
        )}
        <div className="text-xs text-slate-500">{o.role === "BUYING" ? "You're buying" : "On your listing"}</div>
      </td>
      <td className="py-2 pr-3">
        <div className="text-white">{money(o.amount)}</div>
        <div className="text-xs text-slate-500">
          {who}
          {o.originalPrice != null && <> · was {money(o.originalPrice)}</>}
        </div>
      </td>
      <td className="py-2 pr-3">
        <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_TONE[o.status] ?? "bg-slate-500/15 text-slate-300"}`}>
          {o.statusLabel ?? o.status}
        </span>
      </td>
      <td className="py-2 pr-3 text-slate-400">{o.deadlineLabel ?? "—"}</td>
      <td className="py-2 pr-3 text-slate-400">
        {o.platformAccount.platform.name.replace(/\s*\(Live\)$/i, "")} / {o.platformAccount.label}
      </td>
      <td className="py-2 text-right text-slate-500">{new Date(o.updatedAt).toLocaleString()}</td>
    </tr>
  );
}
