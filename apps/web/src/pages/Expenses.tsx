import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, EXPENSE_CATEGORIES } from "../api.js";
import { Card, money } from "../components/Card.js";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const emptyForm = { amount: "", date: todayIso(), category: EXPENSE_CATEGORIES[0] as string, description: "" };

export default function Expenses() {
  const qc = useQueryClient();
  const [category, setCategory] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [showAdd, setShowAdd] = useState(false);

  const expensesQuery = useQuery({
    queryKey: ["expenses", { category }],
    queryFn: () => api.expenses.list({ category: category || undefined }),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["expenses"] });
    qc.invalidateQueries({ queryKey: ["dashboard-summary"] });
  };

  const createMutation = useMutation({
    mutationFn: () =>
      api.expenses.create({
        amount: Number(form.amount),
        date: new Date(form.date).toISOString(),
        category: form.category,
        description: form.description || undefined,
      }),
    onSuccess: () => {
      invalidate();
      setForm(emptyForm);
      setShowAdd(false);
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => api.expenses.remove(id),
    onSuccess: invalidate,
  });

  const expenses = expensesQuery.data ?? [];
  const total = expenses.reduce((sum, e) => sum + e.amount, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Expenses</h1>
          <p className="text-sm text-slate-400">Costs not tied to a specific sale — supplies, equipment, advertising, and more.</p>
        </div>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-base-950 hover:bg-accent/90"
        >
          {showAdd ? "Cancel" : "Add expense"}
        </button>
      </div>

      {showAdd && (
        <Card title="New expense">
          <form
            className="grid grid-cols-2 gap-3 md:grid-cols-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (form.amount && Number(form.amount) > 0) createMutation.mutate();
            }}
          >
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              Amount *
              <input
                type="number"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                className="rounded-md border border-base-700 bg-base-800 px-2 py-1.5 text-sm text-slate-100"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              Date *
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                className="rounded-md border border-base-700 bg-base-800 px-2 py-1.5 text-sm text-slate-100"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              Category
              <select
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                className="rounded-md border border-base-700 bg-base-800 px-2 py-1.5 text-sm text-slate-100"
              >
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              Description
              <input
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="rounded-md border border-base-700 bg-base-800 px-2 py-1.5 text-sm text-slate-100"
              />
            </label>
            <div className="col-span-full">
              <button
                type="submit"
                disabled={!form.amount || Number(form.amount) <= 0 || createMutation.isPending}
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-base-950 hover:bg-accent/90 disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        <div className="mb-3 flex items-center gap-2">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-md border border-base-700 bg-base-800 px-2 py-1.5 text-sm"
          >
            <option value="">All categories</option>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {expensesQuery.isLoading && <div className="text-slate-400">Loading…</div>}
        {expenses.length === 0 && !expensesQuery.isLoading && <div className="text-sm text-slate-500">No expenses logged yet.</div>}

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-base-700 text-left text-xs uppercase text-slate-500">
              <th className="py-2">Date</th>
              <th className="py-2">Category</th>
              <th className="py-2">Description</th>
              <th className="py-2 text-right">Amount</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {expenses.map((e) => (
              <tr key={e.id} className="border-b border-base-800">
                <td className="py-2 text-slate-400">{new Date(e.date).toLocaleDateString()}</td>
                <td className="py-2 text-slate-300">{e.category}</td>
                <td className="py-2 text-slate-400">{e.description ?? "—"}</td>
                <td className="py-2 text-right">{money(e.amount)}</td>
                <td className="py-2 text-right">
                  <button
                    onClick={() => removeMutation.mutate(e.id)}
                    className="rounded border border-base-600 px-2 py-0.5 text-xs text-slate-400 hover:bg-base-700"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          {expenses.length > 0 && (
            <tfoot>
              <tr className="border-t border-base-700 text-xs uppercase text-slate-500">
                <td className="py-2" colSpan={3}>
                  Total ({expenses.length})
                </td>
                <td className="py-2 text-right text-slate-300">{money(total)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </Card>
    </div>
  );
}
