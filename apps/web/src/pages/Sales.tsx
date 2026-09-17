import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Sale, type SaleEditableFields, type SaleFilters } from "../api.js";
import { Card, money } from "../components/Card.js";

const emptyEdit = { purchaseCost: "", shippingCost: "", shippingRevenue: "", discount: "", refundAmount: "", otherCosts: "" };

export default function Sales() {
  const qc = useQueryClient();
  const [platformId, setPlatformId] = useState("");
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [edit, setEdit] = useState(emptyEdit);

  const platformsQuery = useQuery({ queryKey: ["platforms"], queryFn: api.platforms.list });
  const filters: SaleFilters = { platformId: platformId || undefined, q: q || undefined };
  const salesQuery = useQuery({ queryKey: ["sales", filters], queryFn: () => api.sales.list(filters) });

  const sales = salesQuery.data ?? [];
  const selected = sales.find((s) => s.id === selectedId) ?? null;

  useEffect(() => {
    if (selected) {
      setEdit({
        purchaseCost: String(selected.purchaseCost),
        shippingCost: String(selected.shippingCost),
        shippingRevenue: String(selected.shippingRevenue),
        discount: String(selected.discount),
        refundAmount: String(selected.refundAmount),
        otherCosts: String(selected.otherCosts),
      });
    }
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateMutation = useMutation({
    mutationFn: (data: SaleEditableFields) => api.sales.update(selectedId!, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sales"] });
      qc.invalidateQueries({ queryKey: ["dashboard-summary"] });
      qc.invalidateQueries({ queryKey: ["dashboard-by-platform"] });
    },
  });

  const totals = sales.reduce(
    (acc, s) => ({
      revenue: acc.revenue + s.salePrice + s.shippingRevenue,
      profit: acc.profit + s.netProfit,
    }),
    { revenue: 0, profit: 0 },
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Sales</h1>
        <p className="text-sm text-slate-400">
          Every completed sale. Cost of goods is pulled from a linked inventory item automatically; shipping,
          discounts, refunds and other costs are entered here since platforms don't report them.
        </p>
      </div>

      <div className="grid grid-cols-[1fr_320px] gap-4">
        <Card>
          <div className="mb-3 flex gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search listing title…"
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
          </div>

          {salesQuery.isLoading && <div className="text-slate-400">Loading…</div>}
          {sales.length === 0 && !salesQuery.isLoading && <div className="text-sm text-slate-500">No sales yet.</div>}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-base-700 text-left text-xs uppercase text-slate-500">
                  <th className="py-2">Listing</th>
                  <th className="py-2">Platform / Account</th>
                  <th className="py-2">Sold</th>
                  <th className="py-2 text-right">Price</th>
                  <th className="py-2 text-right">Fees</th>
                  <th className="py-2 text-right">Net profit</th>
                  <th className="py-2 text-right">Margin</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((s) => (
                  <tr
                    key={s.id}
                    onClick={() => setSelectedId(s.id)}
                    className={`cursor-pointer border-b border-base-800 hover:bg-base-800 ${selectedId === s.id ? "bg-base-800" : ""}`}
                  >
                    <td className="py-2">
                      {s.order.listing.title}
                      {s.refundAmount > 0 && (
                        <span className="ml-2 rounded-full bg-rose-500/20 px-1.5 py-0.5 text-[10px] text-rose-400">
                          REFUNDED
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-slate-400">
                      {s.order.platformAccount.platform.name} / {s.order.platformAccount.label}
                    </td>
                    <td className="py-2 text-slate-400">{new Date(s.soldAt).toLocaleDateString()}</td>
                    <td className="py-2 text-right">{money(s.salePrice)}</td>
                    <td className="py-2 text-right text-slate-400">{money(s.platformFees + s.paymentFees)}</td>
                    <td className={`py-2 text-right ${s.netProfit >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {money(s.netProfit)}
                    </td>
                    <td className="py-2 text-right text-slate-400">{(s.profitMargin * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
              {sales.length > 0 && (
                <tfoot>
                  <tr className="border-t border-base-700 text-xs uppercase text-slate-500">
                    <td className="py-2" colSpan={3}>
                      Total ({sales.length})
                    </td>
                    <td className="py-2 text-right text-slate-300">{money(totals.revenue)}</td>
                    <td />
                    <td className={`py-2 text-right ${totals.profit >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {money(totals.profit)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </Card>

        <Card title={selected ? "Edit sale" : undefined}>
          {!selected && <div className="text-sm text-slate-500">Select a sale to edit its cost/shipping/refund details.</div>}
          {selected && (
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                updateMutation.mutate({
                  purchaseCost: Number(edit.purchaseCost) || 0,
                  shippingCost: Number(edit.shippingCost) || 0,
                  shippingRevenue: Number(edit.shippingRevenue) || 0,
                  discount: Number(edit.discount) || 0,
                  refundAmount: Number(edit.refundAmount) || 0,
                  otherCosts: Number(edit.otherCosts) || 0,
                });
              }}
            >
              <div className="text-sm font-medium text-white">{selected.order.listing.title}</div>
              <div className="text-xs text-slate-500">
                Sale price {money(selected.salePrice)} · platform fees {money(selected.platformFees)} · payment fees{" "}
                {money(selected.paymentFees)}
              </div>

              <NumberField label="Cost of goods" value={edit.purchaseCost} onChange={(v) => setEdit((f) => ({ ...f, purchaseCost: v }))} />
              <NumberField label="Shipping cost (you paid)" value={edit.shippingCost} onChange={(v) => setEdit((f) => ({ ...f, shippingCost: v }))} />
              <NumberField label="Shipping revenue (buyer paid)" value={edit.shippingRevenue} onChange={(v) => setEdit((f) => ({ ...f, shippingRevenue: v }))} />
              <NumberField label="Discount" value={edit.discount} onChange={(v) => setEdit((f) => ({ ...f, discount: v }))} />
              <NumberField label="Refund amount" value={edit.refundAmount} onChange={(v) => setEdit((f) => ({ ...f, refundAmount: v }))} />
              <NumberField label="Other costs" value={edit.otherCosts} onChange={(v) => setEdit((f) => ({ ...f, otherCosts: v }))} />

              <button
                type="submit"
                disabled={updateMutation.isPending}
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-base-950 hover:bg-accent/90 disabled:opacity-50"
              >
                Save
              </button>

              <div className="rounded-md border border-base-700 bg-base-800/50 p-2 text-xs text-slate-400">
                Net profit updates once you save — it's the formula from the plan: sale price + shipping revenue,
                minus cost of goods, platform fees, payment fees, shipping cost, discount, refund, and other costs.
              </div>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-400">
      {label}
      <input
        type="number"
        step="0.01"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-base-700 bg-base-800 px-2 py-1.5 text-sm text-slate-100"
      />
    </label>
  );
}
