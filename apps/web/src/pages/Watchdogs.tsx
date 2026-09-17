import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Watchdog, type PlatformAccount } from "../api.js";
import { Card } from "../components/Card.js";

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diffMs / 1000);
  if (secs < 5) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

interface StatusInfo {
  icon: string;
  label: string;
  tone: string;
}

function statusFor(acc: PlatformAccount, wd: Watchdog | null): StatusInfo {
  if (!wd || wd.state === "STOPPED") return { icon: "⚫", label: "STOPPED", tone: "text-slate-400" };
  if (acc.status === "AUTH_REQUIRED") return { icon: "🔴", label: "AUTH REQUIRED", tone: "text-rose-400" };
  if (wd.state === "ERROR") return { icon: "🚨", label: "ERROR", tone: "text-rose-400" };
  if (wd.state === "STALE") return { icon: "🟡", label: "STALE", tone: "text-amber-400" };
  if (wd.state === "RUNNING" && acc.status === "CONNECTED") return { icon: "🟢", label: "ONLINE", tone: "text-emerald-400" };
  return { icon: "🔴", label: acc.status, tone: "text-rose-400" };
}

export default function Watchdogs() {
  const qc = useQueryClient();
  const watchdogsQuery = useQuery({ queryKey: ["watchdogs"], queryFn: api.watchdogs.list, refetchInterval: 10_000 });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["watchdogs"] });
    qc.invalidateQueries({ queryKey: ["accounts"] });
    qc.invalidateQueries({ queryKey: ["dashboard-summary"] });
  };

  const startMutation = useMutation({ mutationFn: api.watchdogs.start, onSuccess: invalidate });
  const stopMutation = useMutation({ mutationFn: api.watchdogs.stop, onSuccess: invalidate });
  const restartMutation = useMutation({ mutationFn: api.watchdogs.restart, onSuccess: invalidate });
  const syncMutation = useMutation({ mutationFn: api.accounts.sync, onSuccess: invalidate });
  const [healthResult, setHealthResult] = useState<Record<string, { ok: boolean; error?: string }>>({});
  const healthMutation = useMutation({
    mutationFn: api.watchdogs.healthCheck,
    onSuccess: (result, accountId) => {
      setHealthResult((r) => ({ ...r, [accountId]: result }));
      invalidate();
    },
  });
  const configMutation = useMutation({
    mutationFn: ({ accountId, data }: { accountId: string; data: { intervalMs?: number; staleAfterMs?: number } }) =>
      api.watchdogs.updateConfig(accountId, data),
    onSuccess: invalidate,
  });

  const watchdogs = watchdogsQuery.data ?? [];
  const summary = {
    online: watchdogs.filter((w) => w.state === "RUNNING" && w.platformAccount.status === "CONNECTED").length,
    stale: watchdogs.filter((w) => w.state === "STALE").length,
    error: watchdogs.filter((w) => w.state === "ERROR" || w.platformAccount.status === "AUTH_REQUIRED").length,
    stopped: watchdogs.filter((w) => w.state === "STOPPED").length,
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Watchdogs</h1>
        <p className="text-sm text-slate-400">Health center — one card per account.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <SummaryTile label="Online" value={summary.online} tone="text-emerald-400" />
        <SummaryTile label="Stale" value={summary.stale} tone="text-amber-400" />
        <SummaryTile label="Error / Auth" value={summary.error} tone="text-rose-400" />
        <SummaryTile label="Stopped" value={summary.stopped} tone="text-slate-400" />
      </div>

      {watchdogsQuery.isLoading && <div className="text-slate-400">Loading…</div>}
      {watchdogs.length === 0 && !watchdogsQuery.isLoading && (
        <Card>
          <div className="text-sm text-slate-500">No accounts yet — add one on the Accounts page.</div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {watchdogs.map((wd) => {
          const acc = wd.platformAccount;
          const status = statusFor(acc, wd);
          const isRunning = wd.state !== "STOPPED";
          const health = healthResult[acc.id];
          return (
            <Card key={wd.id}>
              <div className="mb-2 flex items-start justify-between">
                <div>
                  <div className="text-sm font-semibold text-white">
                    {acc.platform.name} / {acc.label}
                  </div>
                  <div className={`text-sm font-medium ${status.tone}`}>
                    {status.icon} {status.label}
                  </div>
                </div>
              </div>

              <div className="mb-3 space-y-1 text-xs text-slate-400">
                <div>Last sync: {timeAgo(wd.lastSuccessAt)}</div>
                <div>Last event: {timeAgo(wd.lastEventAt)}</div>
                {wd.lastError && <div className="text-rose-400">Last error: {wd.lastError}</div>}
                {health && (
                  <div className={health.ok ? "text-emerald-400" : "text-rose-400"}>
                    Health check: {health.ok ? "OK" : health.error}
                  </div>
                )}
              </div>

              <div className="mb-3 flex flex-wrap gap-2">
                {!isRunning ? (
                  <ActionButton onClick={() => startMutation.mutate(acc.id)}>Start</ActionButton>
                ) : (
                  <ActionButton onClick={() => stopMutation.mutate(acc.id)}>Stop</ActionButton>
                )}
                <ActionButton onClick={() => restartMutation.mutate(acc.id)}>Restart</ActionButton>
                <ActionButton onClick={() => healthMutation.mutate(acc.id)}>Health check</ActionButton>
                <ActionButton onClick={() => syncMutation.mutate(acc.id)}>Sync now</ActionButton>
              </div>

              <ConfigRow
                wd={wd}
                onSave={(data) => configMutation.mutate({ accountId: acc.id, data })}
              />
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function ConfigRow({ wd, onSave }: { wd: Watchdog; onSave: (data: { intervalMs?: number; staleAfterMs?: number }) => void }) {
  const [intervalSec, setIntervalSec] = useState(String(wd.intervalMs / 1000));
  const [staleSec, setStaleSec] = useState(String(wd.staleAfterMs / 1000));

  return (
    <div className="flex items-end gap-2 border-t border-base-800 pt-3">
      <label className="flex flex-col gap-1 text-[10px] text-slate-500">
        Sync every (s)
        <input
          type="number"
          min={5}
          value={intervalSec}
          onChange={(e) => setIntervalSec(e.target.value)}
          className="w-16 rounded border border-base-700 bg-base-800 px-1.5 py-1 text-xs"
        />
      </label>
      <label className="flex flex-col gap-1 text-[10px] text-slate-500">
        Stale after (s)
        <input
          type="number"
          min={10}
          value={staleSec}
          onChange={(e) => setStaleSec(e.target.value)}
          className="w-16 rounded border border-base-700 bg-base-800 px-1.5 py-1 text-xs"
        />
      </label>
      <button
        onClick={() => onSave({ intervalMs: Number(intervalSec) * 1000, staleAfterMs: Number(staleSec) * 1000 })}
        className="rounded border border-base-600 px-2 py-1 text-[10px] text-slate-300 hover:bg-base-700"
      >
        Save
      </button>
    </div>
  );
}

function SummaryTile({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-lg border border-base-700 bg-base-900 p-4">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

function ActionButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-md border border-base-600 px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-base-700">
      {children}
    </button>
  );
}
