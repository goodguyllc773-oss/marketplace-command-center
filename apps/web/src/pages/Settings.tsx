import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api.js";
import { Card } from "../components/Card.js";
import { EVENT_TYPE_ICON, describeEvent } from "../eventDescriptions.js";
import {
  loadPrefs,
  savePrefs,
  notificationSupported,
  notificationPermission,
  requestNotificationPermission,
  type DesktopPrefs,
} from "../desktopNotifications.js";

export default function Settings() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Settings</h1>
        <p className="text-sm text-slate-400">Notification routing and delivery log.</p>
      </div>
      <DiscordSettings />
      <DesktopSettings />
      <NotificationLog />
    </div>
  );
}

function DiscordSettings() {
  const qc = useQueryClient();
  const settingsQuery = useQuery({ queryKey: ["notification-settings"], queryFn: api.notifications.settings });
  const updateMutation = useMutation({
    mutationFn: ({ eventType, discordEnabled }: { eventType: string; discordEnabled: boolean }) =>
      api.notifications.updateSetting(eventType, discordEnabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notification-settings"] }),
  });
  const data = settingsQuery.data;
  const enabled = new Map(data?.settings.map((s) => [s.eventType, s.discordEnabled]));

  return (
    <Card title="Discord notifications">
      {settingsQuery.isLoading && <div className="text-sm text-slate-400">Loading…</div>}
      {data && (
        <div className="flex flex-col gap-4">
          <section>
            <h3 className="text-sm font-medium text-white">Default channel</h3>
            <p className="mb-2 text-xs text-slate-500">
              Every alert goes here unless its category below has its own channel.
            </p>
            <WebhookControls
              hint={data.webhookHint}
              status={
                data.discordConfigured ? (
                  <span className="text-emerald-400">
                    ● Sending to {data.webhookHint}
                    {data.webhookSource === "env" && <span className="text-slate-500"> (from apps/server/.env)</span>}
                  </span>
                ) : (
                  <span className="text-amber-400">● No webhook set — paste your Discord webhook URL</span>
                )
              }
              canRemove={data.webhookSource === "app"}
              removeConfirm="Stop sending to the default channel? Categories without their own channel will stop sending."
            />
          </section>

          {data.categories.map((c) => (
            <section key={c.id} className="rounded-md border border-base-700 p-3">
              <h3 className="text-sm font-medium text-white">{c.label}</h3>
              <WebhookControls
                category={c.id}
                hint={c.webhookHint}
                status={
                  c.hasOwnWebhook ? (
                    <span className="text-emerald-400">● Own channel: {c.webhookHint}</span>
                  ) : c.webhookHint ? (
                    <span className="text-slate-400">● Uses the default channel</span>
                  ) : (
                    <span className="text-amber-400">● No channel — set one here or a default above</span>
                  )
                }
                canRemove={c.hasOwnWebhook}
                removeLabel="use default"
                removeConfirm={`Send ${c.label} alerts to the default channel instead?`}
                placeholder="Optional: a webhook for just this category"
              />
              <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {c.eventTypes.map((eventType) => (
                  <label key={eventType} className="flex items-center gap-2 rounded-md border border-base-700 px-2.5 py-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={enabled.get(eventType) ?? false}
                      onChange={(e) => updateMutation.mutate({ eventType, discordEnabled: e.target.checked })}
                    />
                    <span className="text-slate-300">{EVENT_TYPE_ICON[eventType] ?? "⚪"}</span>
                    <span className="text-slate-400">{eventType.replaceAll("_", " ").toLowerCase()}</span>
                  </label>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </Card>
  );
}

function WebhookControls({
  category,
  hint,
  status,
  canRemove,
  removeLabel = "remove",
  removeConfirm,
  placeholder,
}: {
  category?: string;
  hint: string | null;
  status: React.ReactNode;
  canRemove: boolean;
  removeLabel?: string;
  removeConfirm: string;
  placeholder?: string;
}) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["notification-settings"] });
  const [input, setInput] = useState("");
  const testMutation = useMutation({ mutationFn: () => api.notifications.testDiscord(category) });
  const saveMutation = useMutation({
    mutationFn: (url: string) => api.notifications.saveWebhook(url, category),
    onSuccess: () => {
      setInput("");
      testMutation.reset();
      refresh();
    },
  });
  const removeMutation = useMutation({ mutationFn: () => api.notifications.removeWebhook(category), onSuccess: refresh });

  return (
    <div className="flex flex-col gap-2">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim()) saveMutation.mutate(input.trim());
        }}
      >
        <input
          type="password"
          autoComplete="off"
          aria-label={category ? `Webhook URL for ${category}` : "Default webhook URL"}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={placeholder ?? (hint ? "Paste a new URL to replace the current one" : "https://discord.com/api/webhooks/…")}
          className="min-w-0 flex-1 rounded-md border border-base-700 bg-base-800 px-2 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={!input.trim() || saveMutation.isPending}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-base-950 hover:bg-accent/90 disabled:opacity-50"
        >
          {saveMutation.isPending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => testMutation.mutate()}
          disabled={!hint || testMutation.isPending}
          className="rounded-md border border-base-600 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-base-700 disabled:opacity-50"
        >
          Test
        </button>
      </form>
      <div className="text-xs">
        {status}
        {canRemove && (
          <button
            type="button"
            onClick={() => {
              if (confirm(removeConfirm)) removeMutation.mutate();
            }}
            className="ml-3 text-slate-500 underline hover:text-slate-300"
          >
            {removeLabel}
          </button>
        )}
        {testMutation.isSuccess && <span className="ml-3 text-emerald-400">Test sent — check Discord.</span>}
        {testMutation.isError && (
          <span className="ml-3 text-rose-400">{testMutation.error instanceof Error ? testMutation.error.message : "Failed to send"}</span>
        )}
        {saveMutation.isError && (
          <span className="ml-3 text-rose-400">{saveMutation.error instanceof Error ? saveMutation.error.message : "Couldn't save"}</span>
        )}
      </div>
    </div>
  );
}

function DesktopSettings() {
  const [prefs, setPrefs] = useState<DesktopPrefs>(() => loadPrefs());
  const [permission, setPermission] = useState(notificationPermission());

  useEffect(() => savePrefs(prefs), [prefs]);

  if (!notificationSupported()) {
    return (
      <Card title="Desktop notifications">
        <p className="text-sm text-slate-500">This browser doesn't support desktop notifications.</p>
      </Card>
    );
  }

  return (
    <Card title="Desktop notifications">
      <p className="mb-3 text-xs text-slate-500">
        Fires a real browser notification while this app is open in a tab — there's no background service to notify
        from when it's closed (that would need the optional desktop app wrapper, not built yet).
      </p>
      <div className="mb-3 flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={prefs.enabled}
            disabled={permission !== "granted"}
            onChange={(e) => setPrefs((p) => ({ ...p, enabled: e.target.checked }))}
          />
          Enabled
        </label>
        {permission !== "granted" && (
          <button
            onClick={async () => setPermission(await requestNotificationPermission())}
            className="rounded-md border border-base-600 px-2.5 py-1 text-xs text-slate-300 hover:bg-base-700"
          >
            {permission === "denied" ? "Permission denied — check browser settings" : "Grant browser permission"}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {Object.keys(prefs.types).map((eventType) => (
          <label key={eventType} className="flex items-center gap-2 rounded-md border border-base-700 px-2.5 py-1.5 text-xs">
            <input
              type="checkbox"
              checked={prefs.types[eventType]}
              onChange={(e) => setPrefs((p) => ({ ...p, types: { ...p.types, [eventType]: e.target.checked } }))}
            />
            <span className="text-slate-300">{EVENT_TYPE_ICON[eventType] ?? "⚪"}</span>
            <span className="text-slate-400">{eventType.replaceAll("_", " ").toLowerCase()}</span>
          </label>
        ))}
      </div>
    </Card>
  );
}

function NotificationLog() {
  const logQuery = useQuery({ queryKey: ["notification-log"], queryFn: () => api.notifications.log(30) });

  return (
    <Card title="Recent Discord deliveries">
      {logQuery.isLoading && <div className="text-sm text-slate-400">Loading…</div>}
      {logQuery.data && logQuery.data.length === 0 && (
        <div className="text-sm text-slate-500">Nothing sent yet.</div>
      )}
      <ul className="flex flex-col divide-y divide-base-800">
        {logQuery.data?.map((n) => (
          <li key={n.id} className="flex items-start gap-3 py-2">
            <span className={n.status === "SENT" ? "text-emerald-400" : "text-rose-400"}>
              {n.status === "SENT" ? "●" : "✕"}
            </span>
            <div className="flex-1">
              <div className="text-sm text-slate-200">{describeEvent(n.event.type, n.event.payload)}</div>
              <div className="text-xs text-slate-500">
                {n.event.platformAccount.platform.name} / {n.event.platformAccount.label} ·{" "}
                {new Date(n.createdAt).toLocaleString()}
                {n.error && <span className="text-rose-400"> · {n.error}</span>}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
