import { useQuery } from "@tanstack/react-query";
import { api, type ActivityEvent } from "../api.js";
import { Card } from "../components/Card.js";
import { AccountHeading, AccountTabs, groupByAccount, useAccountFilter } from "../components/AccountTabs.js";
import { EVENT_TYPE_ICON, describeEvent } from "../eventDescriptions.js";

export default function Activity() {
  const { accounts, accountId, setAccountId } = useAccountFilter();
  // One account: its own latest 100. All accounts: the latest 200, split
  // into a section per account.
  const eventsQuery = useQuery({
    queryKey: ["events", accountId ?? "all"],
    queryFn: () => api.events.list(accountId ? 100 : 200, accountId),
  });
  const events = eventsQuery.data ?? [];
  const groups = accountId ? null : groupByAccount(events, accounts, (e) => e.platformAccount.id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Activity</h1>
        <p className="text-sm text-slate-400">Everything the watchdogs have seen, newest first, sorted by account.</p>
      </div>

      <AccountTabs accounts={accounts} value={accountId} onChange={setAccountId} />

      {eventsQuery.isLoading && (
        <Card>
          <div className="text-slate-400">Loading…</div>
        </Card>
      )}
      {eventsQuery.data && events.length === 0 && (
        <Card>
          <div className="text-sm text-slate-500">
            {accountId ? "Nothing has happened on this account yet." : "No events yet — start a watchdog on the Accounts page."}
          </div>
        </Card>
      )}
      {groups
        ? groups.map((g) => (
            <Card key={g.account.id}>
              <AccountHeading account={g.account} count={g.items.length} className="mb-1" />
              <EventList events={g.items} />
            </Card>
          ))
        : events.length > 0 && (
            <Card>
              <EventList events={events} />
            </Card>
          )}
    </div>
  );
}

function EventList({ events }: { events: ActivityEvent[] }) {
  return (
    <ul className="flex flex-col divide-y divide-base-800">
      {events.map((evt) => (
        <li key={evt.id} className="flex items-start gap-3 py-2.5">
          <span className="mt-0.5">{EVENT_TYPE_ICON[evt.type] ?? "⚪"}</span>
          <div className="flex-1">
            <div className="text-sm text-slate-200">{describeEvent(evt.type, evt.payload)}</div>
            <div className="text-xs text-slate-500">{new Date(evt.timestamp).toLocaleString()}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}
