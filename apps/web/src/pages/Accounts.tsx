import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type PlatformAccount } from "../api.js";
import { Card } from "../components/Card.js";

const STATUS_DOT: Record<PlatformAccount["status"], string> = {
  CONNECTED: "bg-emerald-400",
  DISCONNECTED: "bg-slate-500",
  AUTH_REQUIRED: "bg-rose-400",
};

const WATCHDOG_LABEL: Record<string, { label: string; tone: string }> = {
  RUNNING: { label: "RUNNING", tone: "text-emerald-400" },
  STOPPED: { label: "STOPPED", tone: "text-slate-400" },
  ERROR: { label: "ERROR", tone: "text-rose-400" },
  AUTH_REQUIRED: { label: "AUTH REQUIRED", tone: "text-rose-400" },
  STALE: { label: "STALE", tone: "text-amber-400" },
};

export default function Accounts() {
  const qc = useQueryClient();
  const platformsQuery = useQuery({ queryKey: ["platforms"], queryFn: api.platforms.list });
  const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: api.accounts.list });

  const seedMutation = useMutation({
    mutationFn: api.platforms.seed,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["platforms"] }),
  });

  const [form, setForm] = useState({ platformKey: "", externalAccountId: "", label: "" });
  const createMutation = useMutation({
    mutationFn: api.accounts.create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["platforms"] });
      setForm({ platformKey: "", externalAccountId: "", label: "" });
    },
  });

  const startMutation = useMutation({
    mutationFn: api.watchdogs.start,
    onSuccess: () => invalidateAll(qc),
  });
  const stopMutation = useMutation({ mutationFn: api.watchdogs.stop, onSuccess: () => invalidateAll(qc) });
  const restartMutation = useMutation({ mutationFn: api.watchdogs.restart, onSuccess: () => invalidateAll(qc) });
  const syncMutation = useMutation({ mutationFn: api.accounts.sync, onSuccess: () => invalidateAll(qc) });
  const removeMutation = useMutation({ mutationFn: api.accounts.remove, onSuccess: () => invalidateAll(qc) });

  const platforms = platformsQuery.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Accounts & Watchdogs</h1>
          <p className="text-sm text-slate-400">One watchdog per platform account — start/stop/restart independently.</p>
        </div>
      </div>

      <Card title="Platforms">
        {platforms.length === 0 ? (
          <button
            onClick={() => seedMutation.mutate()}
            disabled={seedMutation.isPending}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-base-950 hover:bg-accent/90 disabled:opacity-50"
          >
            {seedMutation.isPending ? "Seeding…" : "Seed built-in mock platforms (Depop, Facebook, eBay)"}
          </button>
        ) : (
          <div className="flex flex-wrap gap-2">
            {platforms.map((p) => (
              <span key={p.id} className="rounded-full border border-base-700 px-3 py-1 text-xs text-slate-300">
                {p.name} · {p._count.accounts} account{p._count.accounts === 1 ? "" : "s"}
              </span>
            ))}
          </div>
        )}
      </Card>

      <Card title="Add account">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.platformKey || !form.externalAccountId || !form.label) return;
            createMutation.mutate(form);
          }}
        >
          <Field label="Platform">
            <select
              value={form.platformKey}
              onChange={(e) => setForm((f) => ({ ...f, platformKey: e.target.value }))}
              className="w-40 rounded-md border border-base-700 bg-base-800 px-2 py-1.5 text-sm"
            >
              <option value="">Select…</option>
              {platforms.map((p) => (
                <option key={p.id} value={p.key}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Account label">
            <input
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              placeholder="e.g. Reselling #1"
              className="w-48 rounded-md border border-base-700 bg-base-800 px-2 py-1.5 text-sm"
            />
          </Field>
          <Field label="External account id">
            <input
              value={form.externalAccountId}
              onChange={(e) => setForm((f) => ({ ...f, externalAccountId: e.target.value }))}
              placeholder="internal identifier"
              className="w-48 rounded-md border border-base-700 bg-base-800 px-2 py-1.5 text-sm"
            />
          </Field>
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-base-950 hover:bg-accent/90 disabled:opacity-50"
          >
            Add
          </button>
        </form>
        {createMutation.isError && (
          <p className="mt-2 text-xs text-rose-400">
            {createMutation.error instanceof Error ? createMutation.error.message : "Failed to create account"}
          </p>
        )}
      </Card>

      <Card title="Accounts">
        {accountsQuery.isLoading && <div className="text-slate-400">Loading…</div>}
        {accountsQuery.data && accountsQuery.data.length === 0 && (
          <div className="text-sm text-slate-500">No accounts yet — add one above.</div>
        )}
        <div className="flex flex-col gap-3">
          {accountsQuery.data?.map((acc) => {
            const wd = acc.watchdog;
            const watchdogInfo = wd ? WATCHDOG_LABEL[wd.state] : WATCHDOG_LABEL.STOPPED;
            const isRunning = wd?.state === "RUNNING" || wd?.state === "STALE";
            return (
              <div
                key={acc.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-base-700 bg-base-800/50 px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[acc.status]}`} />
                  <div>
                    <div className="text-sm font-medium text-white">
                      {acc.platform.name} / {acc.label}
                    </div>
                    <div className="text-xs text-slate-500">
                      {acc.status} · watchdog <span className={watchdogInfo.tone}>{watchdogInfo.label}</span>
                      {wd?.lastSuccessAt && <> · last sync {new Date(wd.lastSuccessAt).toLocaleTimeString()}</>}
                      {wd?.lastError && <span className="text-rose-400"> · {wd.lastError}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  {!isRunning ? (
                    <ActionButton onClick={() => startMutation.mutate(acc.id)}>Start</ActionButton>
                  ) : (
                    <ActionButton onClick={() => stopMutation.mutate(acc.id)}>Stop</ActionButton>
                  )}
                  <ActionButton onClick={() => restartMutation.mutate(acc.id)}>Restart</ActionButton>
                  <ActionButton onClick={() => syncMutation.mutate(acc.id)}>Sync now</ActionButton>
                  <ActionButton danger onClick={() => removeMutation.mutate(acc.id)}>
                    Remove
                  </ActionButton>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["accounts"] });
  qc.invalidateQueries({ queryKey: ["platforms"] });
  qc.invalidateQueries({ queryKey: ["dashboard-summary"] });
  qc.invalidateQueries({ queryKey: ["dashboard-by-platform"] });
  qc.invalidateQueries({ queryKey: ["events"] });
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-slate-400">{label}</span>
      {children}
    </label>
  );
}

function ActionButton({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
        danger
          ? "border-rose-800 text-rose-300 hover:bg-rose-950"
          : "border-base-600 text-slate-300 hover:bg-base-700"
      }`}
    >
      {children}
    </button>
  );
}
