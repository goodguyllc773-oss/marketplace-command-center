import { NavLink, Route, Routes } from "react-router-dom";
import Dashboard from "./pages/Dashboard.js";
import Inbox from "./pages/Inbox.js";
import Inventory from "./pages/Inventory.js";
import Listings from "./pages/Listings.js";
import Sales from "./pages/Sales.js";
import Offers from "./pages/Offers.js";
import Expenses from "./pages/Expenses.js";
import Accounts from "./pages/Accounts.js";
import Watchdogs from "./pages/Watchdogs.js";
import Activity from "./pages/Activity.js";
import Settings from "./pages/Settings.js";
import { DesktopNotificationWatcher } from "./DesktopNotificationWatcher.js";

const NAV = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/inbox", label: "Inbox" },
  { to: "/inventory", label: "Inventory" },
  { to: "/listings", label: "Listings" },
  { to: "/offers", label: "Offers" },
  { to: "/sales", label: "Sales" },
  { to: "/expenses", label: "Expenses" },
  { to: "/accounts", label: "Accounts" },
  { to: "/watchdogs", label: "Watchdogs" },
  { to: "/activity", label: "Activity" },
  { to: "/settings", label: "Settings" },
];

export default function App() {
  return (
    <div className="flex min-h-screen">
      <DesktopNotificationWatcher />
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
          <Route path="/offers" element={<Offers />} />
          <Route path="/sales" element={<Sales />} />
          <Route path="/expenses" element={<Expenses />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/watchdogs" element={<Watchdogs />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}
