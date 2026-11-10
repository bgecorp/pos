import { useEffect, useState } from 'react';
import { useApp } from './lib/app';
import { InventoryPage } from './pages/InventoryPage';
import { ProductsPage } from './pages/ProductsPage';
import { ReportsPage } from './pages/ReportsPage';
import { SalesPage } from './pages/SalesPage';
import { SellPage } from './pages/SellPage';
import { SettingsPage } from './pages/SettingsPage';
import { StaffPage } from './pages/StaffPage';
import { SubscriptionPage } from './pages/SubscriptionPage';

const PAGES = [
  { id: 'sell', label: 'Sell', icon: '🛒' },
  { id: 'products', label: 'Products', icon: '📦' },
  { id: 'inventory', label: 'Inventory', icon: '📋' },
  { id: 'sales', label: 'Sales', icon: '🧾' },
  { id: 'reports', label: 'Reports', icon: '📈' },
  { id: 'staff', label: 'Staff', icon: '👥' },
  { id: 'subscription', label: 'Subscription', icon: '⭐' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
] as const;
type PageId = (typeof PAGES)[number]['id'];

const fromHash = (): PageId => {
  const h = window.location.hash.slice(1);
  return (PAGES.find((p) => p.id === h)?.id ?? 'sell') as PageId;
};

export function App() {
  const { info, store } = useApp();
  const [page, setPage] = useState<PageId>(fromHash);

  useEffect(() => {
    const onHash = () => setPage(fromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const go = (id: PageId) => {
    window.location.hash = id;
    setPage(id);
  };

  return (
    <div className="flex h-screen flex-col bg-slate-50 text-slate-900 md:flex-row">
      <nav className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-slate-200 bg-slate-900 px-2 py-2 md:w-48 md:flex-col md:items-stretch md:border-r md:border-b-0 md:px-3 md:py-4">
        <div className="mr-2 hidden px-2 pb-4 md:block">
          <p className="truncate text-sm font-semibold text-white">{store?.storeName ?? 'SaaS POS'}</p>
          <p className="truncate text-xs text-slate-400">{store ? `${store.branchName} branch` : ''}</p>
        </div>
        {PAGES.map((p) => (
          <button
            key={p.id}
            onClick={() => go(p.id)}
            className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm ${page === p.id ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}
          >
            <span aria-hidden>{p.icon}</span>
            {p.label}
            {p.id === 'inventory' && !!info?.lowStockCount && (
              <span className="ml-auto rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-white" title="Products low on stock">
                {info.lowStockCount}
              </span>
            )}
          </button>
        ))}
        <div className="mt-auto hidden px-2 pt-4 text-xs text-slate-500 md:block">
          <span className={`rounded px-1.5 py-0.5 font-semibold ${info?.plan === 'PROFESSIONAL' ? 'bg-indigo-500 text-white' : 'bg-slate-700 text-slate-300'}`}>
            {info?.plan === 'PROFESSIONAL' ? 'Professional' : 'Free'}
          </span>
          <p className="mt-2">Offline · v{info?.version}</p>
        </div>
      </nav>
      <main className="min-h-0 flex-1 overflow-y-auto">
        {page === 'sell' && <SellPage />}
        {page !== 'sell' && (
          <div className="mx-auto max-w-6xl p-4 md:p-6">
            {page === 'products' && <ProductsPage />}
            {page === 'inventory' && <InventoryPage />}
            {page === 'sales' && <SalesPage />}
            {page === 'reports' && <ReportsPage />}
            {page === 'staff' && <StaffPage />}
            {page === 'subscription' && <SubscriptionPage />}
            {page === 'settings' && <SettingsPage />}
          </div>
        )}
      </main>
    </div>
  );
}
