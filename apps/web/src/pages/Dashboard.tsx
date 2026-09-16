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

export default function Dashboard() {
  const summaryQuery = useQuery({ queryKey: ["dashboard-summary"], queryFn: api.dashboard.summary });
  const byPlatformQuery = useQuery({ queryKey: ["dashboard-by-platform"], queryFn: api.dashboard.byPlatform });

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
