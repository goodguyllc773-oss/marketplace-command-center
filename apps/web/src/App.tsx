import { NavLink, Route, Routes } from "react-router-dom";
import Dashboard from "./pages/Dashboard.js";
import Inbox from "./pages/Inbox.js";
import Inventory from "./pages/Inventory.js";
import Listings from "./pages/Listings.js";
import Accounts from "./pages/Accounts.js";
import Activity from "./pages/Activity.js";

const NAV = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/inbox", label: "Inbox" },
  { to: "/inventory", label: "Inventory" },
  { to: "/listings", label: "Listings" },
  { to: "/accounts", label: "Accounts & Watchdogs" },
  { to: "/activity", label: "Activity" },
];

export default function App() {
  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-base-700 bg-base-900 p-4">
        <div className="mb-6 px-2">
          <div className="text-sm font-semibold tracking-wide text-accent">MARKETPLACE</div>
          <div className="text-xs text-slate-400">Command Center</div>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `rounded-md px-3 py-2 text-sm transition-colors ${
                  isActive ? "bg-base-700 text-white" : "text-slate-400 hover:bg-base-800 hover:text-slate-200"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="flex-1 overflow-y-auto p-6">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/inbox" element={<Inbox />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/listings" element={<Listings />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/activity" element={<Activity />} />
        </Routes>
      </main>
    </div>
  );
}
