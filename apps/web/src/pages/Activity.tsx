import { useQuery } from "@tanstack/react-query";
import { api } from "../api.js";
import { Card } from "../components/Card.js";
import { EVENT_TYPE_ICON, describeEvent } from "../eventDescriptions.js";

export default function Activity() {
  const eventsQuery = useQuery({ queryKey: ["events"], queryFn: () => api.events.list(100) });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Activity</h1>
        <p className="text-sm text-slate-400">Chronological feed of everything the watchdogs have seen.</p>
      </div>

      <Card>
        {eventsQuery.isLoading && <div className="text-slate-400">Loading…</div>}
        {eventsQuery.data && eventsQuery.data.length === 0 && (
          <div className="text-sm text-slate-500">No events yet — start a watchdog on the Accounts page.</div>
        )}
        <ul className="flex flex-col divide-y divide-base-800">
          {eventsQuery.data?.map((evt) => (
            <li key={evt.id} className="flex items-start gap-3 py-2.5">
              <span className="mt-0.5">{EVENT_TYPE_ICON[evt.type] ?? "⚪"}</span>
              <div className="flex-1">
                <div className="text-sm text-slate-200">{describeEvent(evt.type, evt.payload)}</div>
                <div className="text-xs text-slate-500">
                  {evt.platformAccount.platform.name} / {evt.platformAccount.label} ·{" "}
                  {new Date(evt.timestamp).toLocaleString()}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
