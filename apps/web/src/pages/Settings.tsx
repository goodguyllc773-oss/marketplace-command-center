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
  const testMutation = useMutation({ mutationFn: api.notifications.testDiscord });

  const data = settingsQuery.data;

  return (
    <Card title="Discord notifications">
      {settingsQuery.isLoading && <div className="text-sm text-slate-400">Loading…</div>}
      {data && (
        <>
          <div className="mb-3 flex items-center justify-between">
            <div className="text-xs">
              {data.discordConfigured ? (
                <span className="text-emerald-400">● Webhook configured (DISCORD_WEBHOOK_URL)</span>
              ) : (
                <span className="text-amber-400">
                  ● No webhook configured — set DISCORD_WEBHOOK_URL in apps/server/.env and restart the server
                </span>
              )}
            </div>
            <button
              onClick={() => testMutation.mutate()}
              disabled={!data.discordConfigured || testMutation.isPending}
              className="rounded-md border border-base-600 px-2.5 py-1 text-xs text-slate-300 hover:bg-base-700 disabled:opacity-50"
            >
              Send test message
            </button>
          </div>
          {testMutation.isSuccess && <p className="mb-2 text-xs text-emerald-400">Test message sent — check Discord.</p>}
          {testMutation.isError && (
            <p className="mb-2 text-xs text-rose-400">
              {testMutation.error instanceof Error ? testMutation.error.message : "Failed to send"}
            </p>
          )}

          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {data.settings.map((s) => (
              <label key={s.eventType} className="flex items-center gap-2 rounded-md border border-base-700 px-2.5 py-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={s.discordEnabled}
                  onChange={(e) => updateMutation.mutate({ eventType: s.eventType, discordEnabled: e.target.checked })}
                />
                <span className="text-slate-300">{EVENT_TYPE_ICON[s.eventType] ?? "⚪"}</span>
                <span className="text-slate-400">{s.eventType.replaceAll("_", " ").toLowerCase()}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </Card>
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
