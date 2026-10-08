import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type PlatformAccount } from "../api.js";
import { Card } from "../components/Card.js";

const STATUS_DOT: Record<PlatformAccount["status"], string> = {
  CONNECTED: "bg-emerald-400",
  DISCONNECTED: "bg-slate-500",
  AUTH_REQUIRED: "bg-rose-400",
};

export default function Accounts() {
  const qc = useQueryClient();
  const platformsQuery = useQuery({ queryKey: ["platforms"], queryFn: api.platforms.list });
  const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: api.accounts.list });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["accounts"] });
    qc.invalidateQueries({ queryKey: ["platforms"] });
  };

  const seedMutation = useMutation({
    mutationFn: api.platforms.seed,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["platforms"] }),
  });

  const [form, setForm] = useState({ platformKey: "", externalAccountId: "", label: "" });
  const createMutation = useMutation({
    mutationFn: api.accounts.create,
    onSuccess: () => {
      invalidate();
      setForm({ platformKey: "", externalAccountId: "", label: "" });
    },
  });

  const removeMutation = useMutation({ mutationFn: api.accounts.remove, onSuccess: invalidate });

  const platforms = platformsQuery.data ?? [];
  const selectedPlatform = platforms.find((p) => p.key === form.platformKey);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Accounts</h1>
          <p className="text-sm text-slate-400">
            One entry per platform + account combination. Start/stop each account's watchdog on the{" "}
            <Link to="/watchdogs" className="text-accent hover:underline">
              Watchdogs
            </Link>{" "}
            page.
          </p>
        </div>
      </div>

      <Card title="Platforms">
        {platforms.length === 0 ? (
          <button
            onClick={() => seedMutation.mutate()}
            disabled={seedMutation.isPending}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-base-950 hover:bg-accent/90 disabled:opacity-50"
          >
            {seedMutation.isPending ? "Seeding…" : "Add supported platforms"}
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
          <Field label={selectedPlatform?.key === "depop-live" ? "Depop username" : "External account id"}>
            <input
              value={form.externalAccountId}
              onChange={(e) => setForm((f) => ({ ...f, externalAccountId: e.target.value }))}
              placeholder={selectedPlatform?.key === "depop-live" ? "e.g. vintage" : "internal identifier"}
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
        {selectedPlatform?.key === "depop-live" && (
          <p className="mt-2 text-xs text-slate-500">
            Enter your Depop username (from depop.com/<em>username</em>). Watches your shop's public listings — new,
            sold, and removed — with no login. Depop blocks automated sign-in, so Depop messages and offers can't be
            watched here. Checks gently (every 5 min by default) so Depop doesn't block it.
          </p>
        )}
        {selectedPlatform?.key === "facebook-live" && (
          <p className="mt-2 text-xs text-slate-500">
            Needs your own Facebook login — after adding the account, click "Log in" below to open a real browser
            window and sign in yourself, then <strong>close that window</strong> when you're done (the app checks the
            saved session afterward — while the window's still open it can't peek at the same profile). This app
            never sees or stores your password, only the resulting session. Currently a verified connection check
            only — actual listings/messages come once that login is in place and the real pages can be inspected.
            Any label works for "External account id" (e.g. "primary").
          </p>
        )}
        {createMutation.isError && (
          <p className="mt-2 text-xs text-rose-400">
            {createMutation.error instanceof Error ? createMutation.error.message : "Failed to create account"}
          </p>
        )}
      </Card>

      <Card title="Accounts">
        <UnknownDepopShops onAdded={invalidate} />
        {accountsQuery.isLoading && <div className="text-slate-400">Loading…</div>}
        {accountsQuery.data && accountsQuery.data.length === 0 && (
          <div className="text-sm text-slate-500">No accounts yet — add one above.</div>
        )}
        <div className="flex flex-col gap-3">
          {accountsQuery.data?.map((acc) => (
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
                  <div className="text-xs text-slate-500">{acc.status}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <LoginControl accountId={acc.id} />
                <button
                  onClick={() => {
                    if (
                      confirm(
                        `Remove ${acc.platform.name} / ${acc.label}? This stops its watchdog and deletes its saved login and email connection.`,
                      )
                    ) {
                      removeMutation.mutate(acc.id);
                    }
                  }}
                  className="rounded-md border border-rose-800 px-2.5 py-1 text-xs font-medium text-rose-300 hover:bg-rose-950"
                >
                  Remove
                </button>
              </div>
              {acc.platform.key === "depop-live" && <DepopExtensionControl accountId={acc.id} />}
              {acc.platform.key === "depop-live" && <EmailControl accountId={acc.id} />}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/** Each Depop shop reads its own mailbox for messages/offers/sales emails. */
function EmailControl({ accountId }: { accountId: string }) {
  const qc = useQueryClient();
  const statusQuery = useQuery({ queryKey: ["account-email", accountId], queryFn: () => api.email.get(accountId) });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ user: "", password: "", host: "imap.gmail.com", matchTo: "" });
  const refresh = () => qc.invalidateQueries({ queryKey: ["account-email", accountId] });
  const connectMutation = useMutation({
    mutationFn: () => api.email.connect(accountId, form),
    onSuccess: () => {
      setForm((f) => ({ ...f, password: "" }));
      setOpen(false);
      refresh();
    },
  });
  const disconnectMutation = useMutation({ mutationFn: () => api.email.disconnect(accountId), onSuccess: refresh });
  const status = statusQuery.data;

  return (
    <div className="w-full border-t border-base-700 pt-2 text-xs">
      {status?.connected ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-emerald-400">
            ● Email: {status.user}
            {status.matchTo && <span className="text-slate-400"> (only mail to {status.matchTo})</span>}
          </span>
          <span className="text-slate-500">
            alerts for emails after {status.connectedAt ? new Date(status.connectedAt).toLocaleString() : "—"}
          </span>
          <button
            onClick={() => {
              if (confirm("Disconnect this email? This shop's Depop messages and offers will stop being watched.")) {
                disconnectMutation.mutate();
              }
            }}
            className="text-slate-500 underline hover:text-slate-300"
          >
            disconnect
          </button>
        </div>
      ) : !open ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-slate-500">
            Email not connected — Depop messages, offers, and purchases come from Depop's notification emails.
          </span>
          <button onClick={() => setOpen(true)} className="text-accent hover:underline">
            Connect email
          </button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            connectMutation.mutate();
          }}
        >
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Email address">
              <input
                type="email"
                autoComplete="username"
                value={form.user}
                onChange={(e) => setForm((f) => ({ ...f, user: e.target.value }))}
                className="w-56 rounded-md border border-base-700 bg-base-800 px-2 py-1.5 text-sm"
              />
            </Field>
            <Field label="App Password">
              <input
                type="password"
                autoComplete="off"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                className="w-44 rounded-md border border-base-700 bg-base-800 px-2 py-1.5 text-sm"
              />
            </Field>
            <Field label="IMAP server">
              <input
                value={form.host}
                onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
                className="w-36 rounded-md border border-base-700 bg-base-800 px-2 py-1.5 text-sm"
              />
            </Field>
            <Field label="Depop sign-up email (optional)">
              <input
                type="email"
                value={form.matchTo}
                onChange={(e) => setForm((f) => ({ ...f, matchTo: e.target.value }))}
                placeholder="only if shops share an inbox"
                className="w-56 rounded-md border border-base-700 bg-base-800 px-2 py-1.5 text-sm"
              />
            </Field>
            <button
              type="submit"
              disabled={!form.user || !form.password || connectMutation.isPending}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-base-950 hover:bg-accent/90 disabled:opacity-50"
            >
              {connectMutation.isPending ? "Checking…" : "Connect"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="px-1 py-1.5 text-slate-500 hover:text-slate-300">
              Cancel
            </button>
          </div>
          <p className="text-slate-500">
            Read-only, and only emails from depop.com. Gmail needs an App Password (
            <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" className="text-accent hover:underline">
              myaccount.google.com/apppasswords
            </a>
            , 2-Step Verification on). If two Depop shops get email at the same inbox (e.g. Gmail +aliases), fill in each
            shop's Depop sign-up email so they don't mix.
          </p>
        </form>
      )}
      {connectMutation.isError && (
        <p className="mt-1 text-rose-400">
          {connectMutation.error instanceof Error ? connectMutation.error.message : "Couldn't connect"}
        </p>
      )}
    </div>
  );
}

/** Seen within this long = the Depop messages tab is still open (the
 * extension checks in every minute; background tabs can be throttled). */
const EXTENSION_LIVE_MS = 3 * 60_000;

/** Depop accounts the Depop Reader extension saw signed in (in any Chrome
 * profile) that MCC has no shop for yet — one click adds the shop and
 * starts watching it. */
function UnknownDepopShops({ onAdded }: { onAdded: () => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["unknown-depop-shops"], queryFn: api.accounts.unknownDepopShops, refetchInterval: 30_000 });
  const add = useMutation({
    mutationFn: async (username: string) => {
      const account = await api.accounts.create({ platformKey: "depop-live", externalAccountId: username, label: username });
      await api.watchdogs.updateConfig(account.id, { intervalMs: 120_000, staleAfterMs: 480_000 });
      await api.watchdogs.start(account.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["unknown-depop-shops"] });
      onAdded();
    },
  });
  if (!data?.length) return null;
  return (
    <div className="mb-3 flex flex-col gap-2">
      {data.map((s) => (
        <div key={s.username} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-700/60 bg-amber-950/30 px-4 py-2 text-sm">
          <span className="text-amber-200">
            The Depop Reader extension sees <strong>@{s.username}</strong> signed in, but MCC isn't watching that shop yet.
          </span>
          <button
            onClick={() => add.mutate(s.username)}
            disabled={add.isPending}
            className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-base-950 hover:bg-accent/90 disabled:opacity-50"
          >
            Add @{s.username}
          </button>
        </div>
      ))}
      {add.isError && <p className="text-xs text-rose-400">{add.error instanceof Error ? add.error.message : "Couldn't add it"}</p>}
    </div>
  );
}

/** Status of the "MCC Depop Reader" Chrome extension for this shop. */
function DepopExtensionControl({ accountId }: { accountId: string }) {
  const { data: s } = useQuery({
    queryKey: ["extension-status", accountId],
    queryFn: () => api.accounts.extensionStatus(accountId),
    refetchInterval: 30_000,
  });
  const live = !!s && Date.now() - new Date(s.lastSeenAt).getTime() < EXTENSION_LIVE_MS;

  return (
    <div className="w-full border-t border-base-700 pt-2 text-xs">
      {live ? (
        <span className="text-emerald-400">
          ● Chrome extension: Depop messages tab open
          <span className="text-slate-500">
            {s.signedInAs ? ` · signed in as @${s.signedInAs}` : ""}
            {s.conversations !== undefined && ` · ${s.conversations} conversations`} · last check-in{" "}
            {new Date(s.lastSeenAt).toLocaleTimeString()}
            {s.autoRefresh
              ? ` · auto-refresh every ${s.refreshMinutes ?? 3} min${s.lastRefreshAt ? `, last ${new Date(s.lastRefreshAt).toLocaleTimeString()}` : ""}`
              : " · auto-refresh off"}
          </span>
          {s.refreshProblem && <span className="block text-amber-400">{s.refreshProblem}</span>}
          {!s.signedInAs && (
            <span className="block text-amber-400">
              Couldn't tell which Depop account is signed in — using the shop picked in the extension's settings.
            </span>
          )}
        </span>
      ) : (
        <span className="text-slate-500">
          Chrome extension: {s ? `not seen since ${new Date(s.lastSeenAt).toLocaleString()}` : "not set up"} — open
          depop.com/messages in your Chrome (with the MCC Depop Reader extension) and leave it open.
        </span>
      )}
    </div>
  );
}

function LoginControl({ accountId }: { accountId: string }) {
  const qc = useQueryClient();
  const statusQuery = useQuery({
    queryKey: ["login-status", accountId],
    queryFn: () => api.accounts.loginStatus(accountId),
    refetchInterval: 10_000,
  });
  const invalidateStatus = () => qc.invalidateQueries({ queryKey: ["login-status", accountId] });
  const openMutation = useMutation({
    mutationFn: () => api.accounts.openLoginWindow(accountId),
    // A window can take the user a while to log into — re-check a few
    // seconds later rather than immediately (the profile is still busy).
    onSuccess: () => setTimeout(invalidateStatus, 3000),
  });

  const status = statusQuery.data;
  if (!status?.requiresLogin) return null;

  return (
    <div className="flex items-center gap-2 text-xs">
      {status.authenticated ? (
        <span className="text-emerald-400">Logged in</span>
      ) : status.everAttempted ? (
        <span className="text-amber-400" title={status.message}>
          Not logged in{status.message ? ` — ${status.message}` : ""}
        </span>
      ) : (
        <span className="text-slate-500">Not logged in</span>
      )}
      <button onClick={() => statusQuery.refetch()} className="text-slate-500 hover:text-slate-300" title="Check now">
        ↻
      </button>
      <button
        onClick={() => openMutation.mutate()}
        disabled={openMutation.isPending}
        className="rounded-md border border-base-600 px-2.5 py-1 font-medium text-slate-300 hover:bg-base-700 disabled:opacity-50"
      >
        {status.everAttempted ? "Log in again" : "Log in"}
      </button>
      {openMutation.isError && (
        <span className="text-rose-400">{openMutation.error instanceof Error ? openMutation.error.message : "Failed"}</span>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-slate-400">{label}</span>
      {children}
    </label>
  );
}
