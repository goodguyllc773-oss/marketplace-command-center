import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type RangeSummary } from "../api.js";
import { Card, StatTile, money } from "../components/Card.js";

function RangeCard({ title, data }: { title: string; data: RangeSummary }) {
  return (
    <Card title={title}>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <div className="text-lg font-semibold text-white">{money(data.revenue)}</div>
          <div className="text-xs text-slate-400">Revenue</div>
        </div>
        <div>
          <div className={`text-lg font-semibold ${data.profit >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
            {money(data.profit)}
          </div>
          <div className="text-xs text-slate-400">Profit</div>
        </div>
        <div>
          <div className="text-lg font-semibold text-white">{data.itemsSold}</div>
          <div className="text-xs text-slate-400">Items Sold</div>
        </div>
      </div>
    </Card>
  );
}

function FinancialBreakdown({ title, data }: { title: string; data: RangeSummary }) {
  const rows: [string, string][] = [
    ["Cost of goods", money(data.costOfGoods)],
    ["Platform fees", money(data.platformFees)],
    ["Payment fees", money(data.paymentFees)],
    ["Shipping (net)", money(data.shippingNet)],
    ["Discounts", money(data.discounts)],
    ["Refunds", money(data.refunds)],
    ["Other expenses", money(data.expenses)],
  ];
  return (
    <Card title={title}>
      <div className="mb-3 grid grid-cols-3 gap-3 text-center">
        <div>
          <div className="text-lg font-semibold text-white">{(data.profitMargin * 100).toFixed(1)}%</div>
          <div className="text-xs text-slate-400">Profit margin</div>
        </div>
        <div>
          <div className="text-lg font-semibold text-white">{money(data.avgSalePrice)}</div>
          <div className="text-xs text-slate-400">Avg sale price</div>
        </div>
        <div>
          <div className={`text-lg font-semibold ${data.avgProfitPerItem >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
            {money(data.avgProfitPerItem)}
          </div>
          <div className="text-xs text-slate-400">Avg profit / item</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-base-800 pt-3 text-sm md:grid-cols-4">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-2">
            <span className="text-slate-500">{label}</span>
            <span className="text-slate-300">{value}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function Dashboard() {
  const summaryQuery = useQuery({ queryKey: ["dashboard-summary"], queryFn: () => api.dashboard.summary() });
  const byPlatformQuery = useQuery({ queryKey: ["dashboard-by-platform"], queryFn: api.dashboard.byPlatform });

  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(todayIso());
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | null>(null);
  const customQuery = useQuery({
    queryKey: ["dashboard-summary-custom", customRange],
    queryFn: () => api.dashboard.summary({ from: `${customRange!.from}T00:00:00.000Z`, to: `${customRange!.to}T23:59:59.999Z` }),
    enabled: !!customRange,
  });

  if (summaryQuery.isLoading) return <div className="text-slate-400">Loading dashboard…</div>;
  if (summaryQuery.isError) return <ErrorPanel error={summaryQuery.error} />;

  const s = summaryQuery.data!;
  const health = s.watchdogHealth;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Dashboard</h1>
        <p className="text-sm text-slate-400">Snapshot across every connected platform and account.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatTile label="Unread Messages" value={String(s.unreadMessages)} tone={s.unreadMessages > 0 ? "warn" : undefined} />
        <StatTile label="Pending Offers" value={String(s.pendingOffers)} tone={s.pendingOffers > 0 ? "warn" : undefined} />
        <StatTile label="Active Listings" value={String(s.activeListings)} />
        <StatTile label="Inventory Value" value={money(s.inventoryValue)} />
        <StatTile
          label="Watchdogs Running"
          value={`${health.running}`}
          tone={health.error > 0 || health.authRequired > 0 ? "danger" : health.stale > 0 ? "warn" : "ok"}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <RangeCard title="Today" data={s.today} />
        <RangeCard title="This Week" data={s.week} />
        <RangeCard title="This Month" data={s.month} />
        <RangeCard title="All Time" data={s.allTime} />
      </div>

      <FinancialBreakdown title="Financial Breakdown — All Time" data={s.allTime} />

      <Card title="Custom date range">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-md border border-base-700 bg-base-800 px-2 py-1.5 text-sm" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-md border border-base-700 bg-base-800 px-2 py-1.5 text-sm" />
          </label>
          <button
            onClick={() => setCustomRange({ from, to })}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-base-950 hover:bg-accent/90"
          >
            Apply
          </button>
        </div>
        {customQuery.data && (
          <div className="mt-4">
            <FinancialBreakdown title={`${from} to ${to}`} data={customQuery.data.custom!} />
          </div>
        )}
      </Card>

      <Card title="Revenue & Profit by Platform / Account">
        {byPlatformQuery.isLoading && <div className="text-slate-400">Loading…</div>}
        {byPlatformQuery.data && byPlatformQuery.data.length === 0 && (
          <div className="text-sm text-slate-500">No accounts yet — add one on the Accounts page.</div>
        )}
        {byPlatformQuery.data && byPlatformQuery.data.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-base-700 text-left text-xs uppercase text-slate-500">
                <th className="py-2">Platform</th>
                <th className="py-2">Account</th>
                <th className="py-2 text-right">Revenue</th>
                <th className="py-2 text-right">Profit</th>
                <th className="py-2 text-right">Items Sold</th>
              </tr>
            </thead>
            <tbody>
              {byPlatformQuery.data.map((row) => (
                <tr key={row.platformAccountId} className="border-b border-base-800">
                  <td className="py-2">{row.platform}</td>
                  <td className="py-2 text-slate-300">{row.account}</td>
                  <td className="py-2 text-right">{money(row.revenue)}</td>
                  <td className={`py-2 text-right ${row.profit >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{money(row.profit)}</td>
                  <td className="py-2 text-right">{row.itemsSold}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function ErrorPanel({ error }: { error: unknown }) {
  return (
    <Card title="Couldn't reach the API" className="border-rose-800">
      <p className="text-sm text-rose-300">{error instanceof Error ? error.message : "Unknown error"}</p>
      <p className="mt-2 text-xs text-slate-400">
        Make sure the server is running (`npm run dev --workspace=apps/server`) and that the API key in
        apps/web/.env matches apps/server/.env.
      </p>
    </Card>
  );
}
