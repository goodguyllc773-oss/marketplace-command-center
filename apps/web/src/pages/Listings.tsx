import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ListingFilters } from "../api.js";
import { Card, money } from "../components/Card.js";

const STATUSES = ["DRAFT", "ACTIVE", "SOLD", "REMOVED"];

function metric(n: number | null): string {
  return n === null ? "N/A" : String(n);
}

export default function Listings() {
  const qc = useQueryClient();
  const [platformId, setPlatformId] = useState("");
  const [status, setStatus] = useState("");
  const [needsDelistingOnly, setNeedsDelistingOnly] = useState(false);
  const [unlinkedOnly, setUnlinkedOnly] = useState(false);
  const [q, setQ] = useState("");

  const platformsQuery = useQuery({ queryKey: ["platforms"], queryFn: api.platforms.list });
  const inventoryQuery = useQuery({ queryKey: ["inventory", {}], queryFn: () => api.inventory.list() });

  const filters: ListingFilters = {
    platformId: platformId || undefined,
    status: status || undefined,
    needsDelisting: needsDelistingOnly ? true : undefined,
    unlinkedOnly: unlinkedOnly ? true : undefined,
    q: q || undefined,
  };
  const listingsQuery = useQuery({ queryKey: ["listings", filters], queryFn: () => api.listings.list(filters) });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["listings"] });
  const linkMutation = useMutation({
    mutationFn: ({ id, inventoryItemId }: { id: string; inventoryItemId: string | null }) =>
      api.listings.link(id, inventoryItemId),
    onSuccess: invalidate,
  });
  const dismissMutation = useMutation({
    mutationFn: (id: string) => api.listings.update(id, { needsDelisting: false }),
    onSuccess: invalidate,
  });

  const listings = listingsQuery.data ?? [];
  const inventoryItems = inventoryQuery.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Listings</h1>
        <p className="text-sm text-slate-400">
          Every listing across every account. Link listings that are the same physical item to one Inventory item.
        </p>
      </div>

      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search title…"
            className="flex-1 rounded-md border border-base-700 bg-base-800 px-2 py-1.5 text-sm"
          />
          <select
            value={platformId}
            onChange={(e) => setPlatformId(e.target.value)}
            className="rounded-md border border-base-700 bg-base-800 px-2 py-1.5 text-sm"
          >
            <option value="">All platforms</option>
            {platformsQuery.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-md border border-base-700 bg-base-800 px-2 py-1.5 text-sm"
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-xs text-slate-400">
            <input type="checkbox" checked={needsDelistingOnly} onChange={(e) => setNeedsDelistingOnly(e.target.checked)} />
            Needs delisting
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-400">
            <input type="checkbox" checked={unlinkedOnly} onChange={(e) => setUnlinkedOnly(e.target.checked)} />
            Unlinked only
          </label>
        </div>

        {listingsQuery.isLoading && <div className="text-slate-400">Loading…</div>}
        {listings.length === 0 && !listingsQuery.isLoading && <div className="text-sm text-slate-500">No listings match these filters.</div>}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-base-700 text-left text-xs uppercase text-slate-500">
                <th className="py-2">Listing</th>
                <th className="py-2">Platform / Account</th>
                <th className="py-2 text-right">Price</th>
                <th className="py-2">Status</th>
                <th className="py-2 text-right">Views</th>
                <th className="py-2 text-right">Likes</th>
                <th className="py-2 text-right">Watchers</th>
                <th className="py-2 text-right">Offers</th>
                <th className="py-2 text-right">Msgs</th>
                <th className="py-2">Inventory link</th>
              </tr>
            </thead>
            <tbody>
              {listings.map((l) => (
                <tr key={l.id} className="border-b border-base-800">
                  <td className="py-2">
                    {l.url ? (
                      <a href={l.url} target="_blank" rel="noreferrer" className="text-slate-100 hover:text-accent hover:underline">
                        {l.title}
                      </a>
                    ) : (
                      <span className="text-slate-100">{l.title}</span>
                    )}
                    {l.needsDelisting && (
                      <div className="mt-0.5 flex items-center gap-2">
                        <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-400">
                          NEEDS DELISTING
                        </span>
                        <button
                          onClick={() => dismissMutation.mutate(l.id)}
                          className="text-[10px] text-slate-400 underline hover:text-slate-200"
                        >
                          dismiss
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="py-2 text-slate-400">
                    {l.platformAccount.platform.name} / {l.platformAccount.label}
                  </td>
                  <td className="py-2 text-right">{money(l.price)}</td>
                  <td className="py-2 text-slate-300">{l.status}</td>
                  <td className="py-2 text-right text-slate-400">{metric(l.views)}</td>
                  <td className="py-2 text-right text-slate-400">{metric(l.likes)}</td>
                  <td className="py-2 text-right text-slate-400">{metric(l.watchers)}</td>
                  <td className="py-2 text-right text-slate-400">{metric(l.offerCount)}</td>
                  <td className="py-2 text-right text-slate-400">{metric(l.messageCount)}</td>
                  <td className="py-2">
                    <select
                      value={l.inventoryItem?.id ?? ""}
                      onChange={(e) => linkMutation.mutate({ id: l.id, inventoryItemId: e.target.value || null })}
                      className="rounded-md border border-base-700 bg-base-800 px-1.5 py-1 text-xs"
                    >
                      <option value="">Unlinked</option>
                      {inventoryItems.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.title}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
