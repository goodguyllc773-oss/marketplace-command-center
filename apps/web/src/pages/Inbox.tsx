import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ConversationFilters, type ConversationListItem } from "../api.js";
import { money } from "../components/Card.js";

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function Inbox() {
  const qc = useQueryClient();
  const [platformId, setPlatformId] = useState<string | undefined>(undefined);
  const [accountId, setAccountId] = useState<string | undefined>(undefined);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const q = useDebounced(searchInput, 300);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const summaryQuery = useQuery({ queryKey: ["inbox-summary"], queryFn: api.inbox.summary, refetchInterval: 10_000 });
  const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: api.accounts.list });

  const filters: ConversationFilters = useMemo(
    () => ({ platformId, accountId, unread: unreadOnly ? true : undefined, q: q || undefined }),
    [platformId, accountId, unreadOnly, q],
  );
  const listQuery = useQuery({
    queryKey: ["conversations", filters],
    queryFn: () => api.conversations.list(filters),
    refetchInterval: 10_000,
  });

  const detailQuery = useQuery({
    queryKey: ["conversation", selectedId],
    queryFn: () => api.conversations.get(selectedId!),
    enabled: !!selectedId,
  });

  useEffect(() => {
    setDraft("");
  }, [selectedId]);

  const invalidateInbox = () => {
    qc.invalidateQueries({ queryKey: ["conversations"] });
    qc.invalidateQueries({ queryKey: ["inbox-summary"] });
    if (selectedId) qc.invalidateQueries({ queryKey: ["conversation", selectedId] });
  };

  const replyMutation = useMutation({
    mutationFn: (message: string) => api.conversations.reply(selectedId!, message),
    onSuccess: () => {
      setDraft("");
      invalidateInbox();
    },
  });

  const patchMutation = useMutation({
    mutationFn: (data: { unread?: boolean; archived?: boolean }) => api.conversations.patch(selectedId!, data),
    onSuccess: invalidateInbox,
  });

  const openConversation = (c: ConversationListItem) => {
    setSelectedId(c.id);
    if (c.unread) {
      api.conversations.patch(c.id, { unread: false }).then(invalidateInbox);
    }
  };

  const platforms = summaryQuery.data?.byPlatform ?? [];
  const totalUnread = summaryQuery.data?.totalUnread ?? 0;
  const accounts = accountsQuery.data ?? [];
  const accountsForFilter = platformId ? accounts.filter((a) => a.platformId === platformId) : accounts;

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-white">Inbox</h1>
        <p className="text-sm text-slate-400">Every conversation, across every platform and account, in one place.</p>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[180px_320px_1fr] gap-4">
        {/* Filter rail */}
        <div className="flex flex-col gap-1 overflow-y-auto rounded-lg border border-base-700 bg-base-900 p-2">
          <FilterPill
            label="ALL"
            count={totalUnread}
            active={platformId === undefined}
            onClick={() => setPlatformId(undefined)}
          />
          {platforms.map((p) => (
            <FilterPill
              key={p.platformId}
              label={p.platformName.toUpperCase()}
              count={p.unread}
              active={platformId === p.platformId}
              onClick={() => setPlatformId(p.platformId)}
            />
          ))}
          <div className="mt-2 border-t border-base-800 pt-2">
            <label className="flex items-center gap-2 px-2 text-xs text-slate-400">
              <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
              Unread only
            </label>
          </div>
          <div className="mt-2 px-2">
            <label className="text-xs text-slate-500">Account</label>
            <select
              value={accountId ?? ""}
              onChange={(e) => setAccountId(e.target.value || undefined)}
              className="mt-1 w-full rounded-md border border-base-700 bg-base-800 px-2 py-1 text-xs"
            >
              <option value="">All accounts</option>
              {accountsForFilter.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.platform.name} / {a.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Conversation list */}
        <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-base-700 bg-base-900">
          <div className="border-b border-base-700 p-2">
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search buyer, listing, message…"
              className="w-full rounded-md border border-base-700 bg-base-800 px-2 py-1.5 text-sm"
            />
          </div>
          <div className="flex-1 overflow-y-auto">
            {listQuery.isLoading && <div className="p-4 text-sm text-slate-400">Loading…</div>}
            {listQuery.data && listQuery.data.length === 0 && (
              <div className="p-4 text-sm text-slate-500">No conversations match these filters.</div>
            )}
            {listQuery.data?.map((c) => (
              <button
                key={c.id}
                onClick={() => openConversation(c)}
                className={`flex w-full flex-col gap-0.5 border-b border-base-800 px-3 py-2.5 text-left hover:bg-base-800 ${
                  selectedId === c.id ? "bg-base-800" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 truncate text-sm font-medium text-slate-100">
                    {c.unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
                    {c.buyerName}
                  </span>
                  <span className="shrink-0 text-[10px] text-slate-500">{timeAgo(c.lastMessageAt)}</span>
                </div>
                {c.listing && <div className="truncate text-xs text-slate-500">{c.listing.title}</div>}
                {c.lastMessage && (
                  <div className="truncate text-xs text-slate-400">
                    {c.lastMessage.direction === "OUTBOUND" ? "You: " : ""}
                    {c.lastMessage.body}
                  </div>
                )}
                <div className="text-[10px] uppercase tracking-wide text-slate-600">
                  {c.platformAccount.platform.name} / {c.platformAccount.label}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Detail pane */}
        <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-base-700 bg-base-900">
          {!selectedId && <div className="flex h-full items-center justify-center text-sm text-slate-500">Select a conversation</div>}
          {selectedId && detailQuery.isLoading && <div className="p-4 text-sm text-slate-400">Loading…</div>}
          {selectedId && detailQuery.data && (
            <>
              <div className="flex items-start justify-between gap-3 border-b border-base-700 p-3">
                <div>
                  <div className="text-sm font-semibold text-white">{detailQuery.data.buyerName}</div>
                  <div className="text-xs text-slate-500">
                    {detailQuery.data.platformAccount.platform.name} / {detailQuery.data.platformAccount.label}
                    {detailQuery.data.listing && <> · {detailQuery.data.listing.title}</>}
                    {detailQuery.data.listing?.price !== undefined && <> ({money(detailQuery.data.listing.price)})</>}
                  </div>
                  {detailQuery.data.listing?.url && (
                    <a
                      href={detailQuery.data.listing.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-accent hover:underline"
                    >
                      View listing ↗
                    </a>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => patchMutation.mutate({ unread: !detailQuery.data!.unread })}
                    className="rounded-md border border-base-600 px-2 py-1 text-xs text-slate-300 hover:bg-base-700"
                  >
                    {detailQuery.data.unread ? "Mark read" : "Mark unread"}
                  </button>
                  <button
                    onClick={() => patchMutation.mutate({ archived: !detailQuery.data!.archived })}
                    className="rounded-md border border-base-600 px-2 py-1 text-xs text-slate-300 hover:bg-base-700"
                  >
                    {detailQuery.data.archived ? "Unarchive" : "Archive"}
                  </button>
                </div>
              </div>

              <div className="flex-1 space-y-2 overflow-y-auto p-3">
                {detailQuery.data.messages.map((m) => (
                  <div key={m.id} className={`flex ${m.direction === "OUTBOUND" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                        m.direction === "OUTBOUND" ? "bg-accent/20 text-slate-100" : "bg-base-800 text-slate-200"
                      }`}
                    >
                      <div>{m.body}</div>
                      <div className="mt-1 text-[10px] text-slate-500">{new Date(m.sentAt).toLocaleString()}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-t border-base-700 p-3">
                {detailQuery.data.capabilities.includes("sendMessages") ? (
                  <form
                    className="flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (draft.trim()) replyMutation.mutate(draft.trim());
                    }}
                  >
                    <input
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder="Type a reply…"
                      className="flex-1 rounded-md border border-base-700 bg-base-800 px-3 py-1.5 text-sm"
                    />
                    <button
                      type="submit"
                      disabled={replyMutation.isPending || !draft.trim()}
                      className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-base-950 hover:bg-accent/90 disabled:opacity-50"
                    >
                      Send
                    </button>
                  </form>
                ) : (
                  <div className="text-xs text-slate-500">
                    {detailQuery.data.platformAccount.platform.name} doesn't support sending messages through this
                    account.
                  </div>
                )}
                {replyMutation.isError && (
                  <p className="mt-1 text-xs text-rose-400">
                    {replyMutation.error instanceof Error ? replyMutation.error.message : "Failed to send"}
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function FilterPill({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs ${
        active ? "bg-base-700 text-white" : "text-slate-400 hover:bg-base-800 hover:text-slate-200"
      }`}
    >
      <span className="font-medium">{label}</span>
      {count > 0 && (
        <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] ${active ? "bg-accent text-base-950" : "bg-base-700 text-slate-300"}`}>
          {count}
        </span>
      )}
    </button>
  );
}
