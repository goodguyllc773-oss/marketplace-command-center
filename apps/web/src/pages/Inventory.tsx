import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type InventoryFilters, type InventoryItem } from "../api.js";
import { Card, money } from "../components/Card.js";

const STATUSES = ["INVENTORY", "LISTED", "RESERVED", "SOLD", "PAID", "SHIPPED", "DELIVERED", "RETURNED", "REFUNDED"];

const emptyForm = { sku: "", title: "", category: "", brand: "", purchaseCost: "", condition: "", location: "", notes: "" };

export default function Inventory() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [showAdd, setShowAdd] = useState(false);

  const filters: InventoryFilters = { status: status || undefined, q: q || undefined };
  const listQuery = useQuery({ queryKey: ["inventory", filters], queryFn: () => api.inventory.list(filters) });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["inventory"] });

  const createMutation = useMutation({
    mutationFn: () =>
      api.inventory.create({
        title: form.title,
        sku: form.sku || undefined,
        category: form.category || undefined,
        brand: form.brand || undefined,
        purchaseCost: form.purchaseCost ? Number(form.purchaseCost) : undefined,
        condition: form.condition || undefined,
        location: form.location || undefined,
        notes: form.notes || undefined,
      }),
    onSuccess: () => {
      invalidate();
      setForm(emptyForm);
      setShowAdd(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<InventoryItem> }) => api.inventory.update(id, data),
    onSuccess: invalidate,
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => api.inventory.remove(id),
    onSuccess: () => {
      invalidate();
      setSelectedId(null);
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: (listingId: string) => api.listings.link(listingId, null),
    onSuccess: invalidate,
  });

  const items = listQuery.data ?? [];
  const selected = items.find((i) => i.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Inventory</h1>
          <p className="text-sm text-slate-400">Physical items you own — each can be linked to listings on multiple platforms.</p>
        </div>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-base-950 hover:bg-accent/90"
        >
          {showAdd ? "Cancel" : "Add item"}
        </button>
      </div>

      {showAdd && (
        <Card title="New inventory item">
          <form
            className="grid grid-cols-2 gap-3 md:grid-cols-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (form.title.trim()) createMutation.mutate();
            }}
          >
            <TextField label="Title *" value={form.title} onChange={(v) => setForm((f) => ({ ...f, title: v }))} />
            <TextField label="SKU" value={form.sku} onChange={(v) => setForm((f) => ({ ...f, sku: v }))} />
            <TextField label="Category" value={form.category} onChange={(v) => setForm((f) => ({ ...f, category: v }))} />
            <TextField label="Brand" value={form.brand} onChange={(v) => setForm((f) => ({ ...f, brand: v }))} />
            <TextField
              label="Purchase cost"
              value={form.purchaseCost}
              onChange={(v) => setForm((f) => ({ ...f, purchaseCost: v }))}
              type="number"
            />
            <TextField label="Condition" value={form.condition} onChange={(v) => setForm((f) => ({ ...f, condition: v }))} />
            <TextField label="Location" value={form.location} onChange={(v) => setForm((f) => ({ ...f, location: v }))} />
            <TextField label="Notes" value={form.notes} onChange={(v) => setForm((f) => ({ ...f, notes: v }))} />
            <div className="col-span-full">
              <button
                type="submit"
                disabled={!form.title.trim() || createMutation.isPending}
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-base-950 hover:bg-accent/90 disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </form>
        </Card>
      )}

      <div className="grid grid-cols-[1fr_360px] gap-4">
        <Card>
          <div className="mb-3 flex gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search title, SKU, brand, category…"
              className="flex-1 rounded-md border border-base-700 bg-base-800 px-2 py-1.5 text-sm"
            />
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
          </div>

          {listQuery.isLoading && <div className="text-slate-400">Loading…</div>}
          {items.length === 0 && !listQuery.isLoading && <div className="text-sm text-slate-500">No inventory items yet.</div>}

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-base-700 text-left text-xs uppercase text-slate-500">
                <th className="py-2">Title</th>
                <th className="py-2">SKU</th>
                <th className="py-2">Status</th>
                <th className="py-2 text-right">Cost</th>
                <th className="py-2 text-right">Listings</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const needsDelisting = item.listings.some((l) => l.needsDelisting);
                return (
                  <tr
                    key={item.id}
                    onClick={() => setSelectedId(item.id)}
                    className={`cursor-pointer border-b border-base-800 hover:bg-base-800 ${selectedId === item.id ? "bg-base-800" : ""}`}
                  >
                    <td className="py-2">
                      {item.title}
                      {needsDelisting && (
                        <span className="ml-2 rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-400">
                          NEEDS DELISTING
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-slate-400">{item.sku ?? "—"}</td>
                    <td className="py-2 text-slate-300">{item.status}</td>
                    <td className="py-2 text-right">{item.purchaseCost != null ? money(item.purchaseCost) : "—"}</td>
                    <td className="py-2 text-right text-slate-400">{item.listings.length}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        <Card title={selected ? "Item detail" : undefined}>
          {!selected && <div className="text-sm text-slate-500">Select an item to see details and linked listings.</div>}
          {selected && (
            <div className="flex flex-col gap-4">
              <div>
                <div className="text-base font-semibold text-white">{selected.title}</div>
                <div className="text-xs text-slate-500">
                  {selected.sku && <>SKU {selected.sku} · </>}
                  {selected.brand && <>{selected.brand} · </>}
                  {selected.category}
                </div>
              </div>

              <label className="flex flex-col gap-1 text-xs text-slate-400">
                Status
                <select
                  value={selected.status}
                  onChange={(e) => updateMutation.mutate({ id: selected.id, data: { status: e.target.value } })}
                  className="rounded-md border border-base-700 bg-base-800 px-2 py-1.5 text-sm text-slate-100"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>

              {selected.notes && <div className="text-xs text-slate-400">{selected.notes}</div>}

              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
                  Linked listings ({selected.listings.length})
                </div>
                {selected.listings.length === 0 && (
                  <div className="text-xs text-slate-500">
                    None yet — link this item to listings from the Listings page.
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  {selected.listings.map((l) => (
                    <div key={l.id} className="flex items-center justify-between rounded-md border border-base-700 px-2 py-1.5 text-xs">
                      <div>
                        <div className="text-slate-200">{l.title}</div>
                        <div className="text-slate-500">
                          {l.platformAccount.platform.name} / {l.platformAccount.label} · {l.status} · {money(l.price)}
                          {l.needsDelisting && <span className="ml-1 text-amber-400">· needs delisting</span>}
                        </div>
                      </div>
                      <button
                        onClick={() => unlinkMutation.mutate(l.id)}
                        className="rounded border border-base-600 px-2 py-0.5 text-slate-300 hover:bg-base-700"
                      >
                        Unlink
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <button
                onClick={() => {
                  if (confirm(`Delete "${selected.title}"? Linked listings will just be unlinked, not deleted.`)) {
                    removeMutation.mutate(selected.id);
                  }
                }}
                className="self-start rounded-md border border-rose-800 px-2.5 py-1 text-xs text-rose-300 hover:bg-rose-950"
              >
                Delete item
              </button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-400">
      {label}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-base-700 bg-base-800 px-2 py-1.5 text-sm text-slate-100"
      />
    </label>
  );
}
