import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type PlatformAccount } from "../api.js";

// The account picked on one page carries over to the others (per browser;
// MCC works without it).
const STORAGE_KEY = "mcc:account";

type AccountLike = Pick<PlatformAccount, "id" | "label" | "externalAccountId"> & { platform: { key: string; name: string } };

export const platformName = (a: { platform: { name: string } }) => a.platform.name.replace(/\s*\(Live\)$/i, "");

/** Depop shops go by @username (plus their label when it says something
 * else, e.g. "@dsgnr_ex · Reselling"); other accounts by their label. */
export function accountName(a: AccountLike): string {
  if (!a.platform.key.startsWith("depop")) return a.label;
  const handle = `@${a.externalAccountId}`;
  return a.label && a.label.toLowerCase() !== a.externalAccountId.toLowerCase() ? `${handle} · ${a.label}` : handle;
}

/** Platform, then account name — the order every page lists accounts in. */
export function sortAccounts<T extends AccountLike>(accounts: T[]): T[] {
  return [...accounts].sort((a, b) => platformName(a).localeCompare(platformName(b)) || accountName(a).localeCompare(accountName(b)));
}

export function useAccountFilter() {
  const accountsQuery = useQuery({ queryKey: ["accounts"], queryFn: api.accounts.list });
  const accounts = sortAccounts(accountsQuery.data ?? []);
  const [stored, setStored] = useState<string | undefined>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) ?? undefined;
    } catch {
      return undefined;
    }
  });
  // A remembered account that has since been removed means "all".
  const accountId = stored && (!accountsQuery.data || accounts.some((a) => a.id === stored)) ? stored : undefined;
  const setAccountId = (id: string | undefined) => {
    setStored(id);
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // not remembered — fine
    }
  };
  return { accounts, accountId, setAccountId };
}

/** Items split into one group per account, in account order (empty groups
 * left out). */
export function groupByAccount<T>(items: T[], accounts: AccountLike[], accountOf: (item: T) => string) {
  const groups = accounts.map((account) => ({ account, items: items.filter((i) => accountOf(i) === account.id) }));
  return groups.filter((g) => g.items.length > 0);
}

/** How many items each account has, for the tab counts. */
export function countByAccount<T>(items: T[], accountOf: (item: T) => string, keep: (item: T) => boolean = () => true) {
  const counts: Record<string, number> = {};
  for (const i of items) if (keep(i)) counts[accountOf(i)] = (counts[accountOf(i)] ?? 0) + 1;
  return counts;
}

interface TabsProps {
  accounts: AccountLike[];
  value: string | undefined;
  onChange: (id: string | undefined) => void;
  /** Shown dim next to each account (e.g. how many conversations). */
  counts?: Record<string, number>;
  /** Shown highlighted when above zero (e.g. unread). */
  badges?: Record<string, number>;
  layout?: "row" | "column";
}

/** "All accounts" plus one tab per account, grouped under its platform. */
export function AccountTabs({ accounts, value, onChange, counts, badges, layout = "row" }: TabsProps) {
  const sum = (r?: Record<string, number>) => (r ? Object.values(r).reduce((a, b) => a + b, 0) : undefined);
  const platforms = [...new Set(accounts.map(platformName))];
  const column = layout === "column";
  return (
    <div className={column ? "flex flex-col gap-1" : "flex flex-wrap items-center gap-x-1 gap-y-2"}>
      <Tab label="All accounts" active={!value} onClick={() => onChange(undefined)} count={sum(counts)} badge={sum(badges)} column={column} />
      {platforms.map((p) => (
        <div key={p} className={column ? "mt-2 flex flex-col gap-1" : "flex items-center gap-1"}>
          <span className={`text-[10px] uppercase tracking-wide text-slate-500 ${column ? "px-2" : "ml-3 mr-1"}`}>{p}</span>
          {accounts
            .filter((a) => platformName(a) === p)
            .map((a) => (
              <Tab
                key={a.id}
                label={accountName(a)}
                active={value === a.id}
                onClick={() => onChange(a.id)}
                count={counts ? (counts[a.id] ?? 0) : undefined}
                badge={badges?.[a.id]}
                column={column}
              />
            ))}
        </div>
      ))}
    </div>
  );
}

function Tab({ label, active, onClick, count, badge, column }: { label: string; active: boolean; onClick: () => void; count?: number; badge?: number; column: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm ${column ? "justify-between" : ""} ${
        active ? "bg-base-700 text-white" : "text-slate-400 hover:bg-base-800 hover:text-slate-200"
      }`}
    >
      <span className="truncate">{label}</span>
      <span className="flex shrink-0 items-center gap-1.5">
        {!!badge && <span className="rounded-full bg-accent/20 px-1.5 text-[10px] font-medium text-accent">{badge}</span>}
        {count !== undefined && <span className="text-xs text-slate-500">{count}</span>}
      </span>
    </button>
  );
}

/** Section title above one account's items when showing all accounts. */
export function AccountHeading({ account, count, className = "" }: { account: AccountLike; count: number; className?: string }) {
  return (
    <div className={`flex items-center justify-between gap-2 text-xs font-medium uppercase tracking-wide text-slate-400 ${className}`}>
      <span>
        <span className="text-slate-500">{platformName(account)} · </span>
        <span className="normal-case text-slate-200">{accountName(account)}</span>
      </span>
      <span className="text-slate-500">{count}</span>
    </div>
  );
}
