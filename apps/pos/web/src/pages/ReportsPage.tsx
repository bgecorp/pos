import { useState } from 'react';
import { formatMoney, formatQty } from '../../../shared/pricing';
import { ProOnly } from '../components/ProLock';
import { Alert, Card, Empty, PageTitle, Segmented } from '../components/ui';
import { useApp } from '../lib/app';
import { call, presetRange, RANGE_LABELS, useLoad, type RangePreset } from '../lib/pos';

type Tab = 'summary' | 'advanced' | 'inventory' | 'insights';

export function ReportsPage() {
  const [tab, setTab] = useState<Tab>('summary');
  const [preset, setPreset] = useState<RangePreset>('7d');
  return (
    <>
      <PageTitle
        title="Reports"
        actions={
          <>
            <Segmented
              value={tab}
              onChange={setTab}
              options={[
                { value: 'summary', label: 'Summary' },
                { value: 'advanced', label: 'Advanced' },
                { value: 'inventory', label: 'Inventory' },
                { value: 'insights', label: 'Insights' },
              ]}
            />
            {(tab === 'summary' || tab === 'advanced') && (
              <select className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" aria-label="Date range" value={preset} onChange={(e) => setPreset(e.target.value as RangePreset)}>
                {Object.entries(RANGE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            )}
          </>
        }
      />
      {tab === 'summary' && <SummaryTab preset={preset} />}
      {tab === 'advanced' && (
        <ProOnly title="Advanced reports" description="Sales by cashier, by hour of the day, by weekday, by payment method and by category.">
          <AdvancedTab preset={preset} />
        </ProOnly>
      )}
      {tab === 'inventory' && (
        <ProOnly title="Inventory analytics" description="What your stock is worth, what will run out soon at your current selling pace, and what is not selling.">
          <InventoryTab />
        </ProOnly>
      )}
      {tab === 'insights' && (
        <ProOnly title="Business insights" description="Plain-language tips from your own sales: trends, best sellers, stock risks and thin margins.">
          <InsightsTab />
        </ProOnly>
      )}
    </>
  );
}

function SummaryTab({ preset }: { preset: RangePreset }) {
  const { store } = useApp();
  const money = (v: number) => formatMoney(v, store?.currency);
  const data = useLoad(() => {
    const r = presetRange(preset);
    return Promise.all([call('reports:summary', r), call('reports:daily', r), call('reports:products', r)]);
  }, [preset]);
  const [summary, daily, products] = data.data ?? [null, null, null];
  const maxDay = Math.max(1, ...(daily ?? []).map((d) => d.netSales));

  return (
    <>
      {data.error && <Alert>{data.error}</Alert>}
      {summary?.limitedFrom && (
        <div className="mb-3">
          <Alert kind="info">Free plan reports cover the last 90 days (from {summary.limitedFrom}).</Alert>
        </div>
      )}
      {summary && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Net sales" value={money(summary.netSales)} sub={`${summary.salesCount} sale${summary.salesCount === 1 ? '' : 's'}`} />
          <Stat label="Gross profit" value={money(summary.grossProfit)} sub={`Cost ${money(summary.cost)}`} />
          <Stat label="Average sale" value={money(summary.averageSale)} />
          <Stat label="Collected" value={money(summary.totalCollected)} sub={summary.voidedCount ? `${summary.voidedCount} voided` : undefined} />
        </div>
      )}
      {summary && (
        <p className="mt-2 text-xs text-slate-400">
          Gross {money(summary.grossSales)} · Discounts {money(summary.discounts)} · Tax {money(summary.taxes)}. Profit excludes tax.
        </p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="border-b border-slate-100 px-4 py-3 font-semibold">Daily sales</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {daily?.map((d) => (
              <li key={d.date} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-3 px-4 py-2">
                <span className="text-slate-500">{new Date(d.date + 'T00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                <span className="h-2.5 rounded-full bg-emerald-500" style={{ width: `${Math.max(2, (d.netSales / maxDay) * 100)}%` }} />
                <span className="text-right font-medium">{money(d.netSales)}</span>
              </li>
            ))}
          </ul>
          {daily?.length === 0 && <Empty>No sales in this period</Empty>}
        </Card>
        <Card className="overflow-x-auto">
          <h2 className="border-b border-slate-100 px-4 py-3 font-semibold">Product sales</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-2">Product</th>
                <th className="px-4 py-2 text-right">Qty</th>
                <th className="px-4 py-2 text-right">Sales</th>
                <th className="px-4 py-2 text-right">Profit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {products?.map((p) => (
                <tr key={p.productId ?? p.name}>
                  <td className="px-4 py-2">{p.name}</td>
                  <td className="px-4 py-2 text-right">{formatQty(p.quantity)}</td>
                  <td className="px-4 py-2 text-right font-medium">{money(p.revenue)}</td>
                  <td className="px-4 py-2 text-right text-slate-500">{money(p.profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {products?.length === 0 && <Empty>No products sold in this period</Empty>}
        </Card>
      </div>
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-bold">{value}</p>
      {sub && <p className="text-xs text-slate-400">{sub}</p>}
    </Card>
  );
}

const METHOD_LABEL = { cash: 'Cash', card: 'Card', ewallet: 'E-wallet', other: 'Other' } as const;
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const hourLabel = (h: number) => `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`;

function Bars({ rows }: { rows: { label: string; value: number; display: string; sub?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <Empty>No sales in this period</Empty>;
  return (
    <ul className="divide-y divide-slate-100 text-sm">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[7rem_1fr_auto] items-center gap-3 px-4 py-2">
          <span className="truncate text-slate-600" title={r.label}>{r.label}</span>
          <span className="h-2.5 rounded-full bg-indigo-500" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
          <span className="text-right">
            <span className="font-medium">{r.display}</span>
            {r.sub && <span className="block text-xs text-slate-400">{r.sub}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function AdvancedTab({ preset }: { preset: RangePreset }) {
  const { store } = useApp();
  const money = (v: number) => formatMoney(v, store?.currency);
  const r = useLoad(() => call('reports:advanced', presetRange(preset)), [preset]);
  if (r.error) return <Alert>{r.error}</Alert>;
  if (!r.data) return <p className="text-slate-500">Loading…</p>;
  const d = r.data;
  const n = (c: number) => `${c} sale${c === 1 ? '' : 's'}`;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <h2 className="border-b border-slate-100 px-4 py-3 font-semibold">Sales by cashier</h2>
        <Bars rows={d.byCashier.map((c) => ({ label: c.name, value: c.total, display: money(c.total), sub: `${n(c.salesCount)} · avg ${money(c.averageSale)}` }))} />
      </Card>
      <Card>
        <h2 className="border-b border-slate-100 px-4 py-3 font-semibold">Payment methods</h2>
        <Bars rows={d.byPayment.map((p) => ({ label: METHOD_LABEL[p.method], value: p.total, display: money(p.total), sub: n(p.salesCount) }))} />
      </Card>
      <Card>
        <h2 className="border-b border-slate-100 px-4 py-3 font-semibold">Busiest hours</h2>
        <Bars rows={d.byHour.map((h) => ({ label: `${hourLabel(h.hour)}–${hourLabel((h.hour + 1) % 24)}`, value: h.total, display: money(h.total), sub: n(h.salesCount) }))} />
      </Card>
      <Card>
        <h2 className="border-b border-slate-100 px-4 py-3 font-semibold">By weekday</h2>
        <Bars rows={d.byWeekday.map((w) => ({ label: WEEKDAY[w.weekday], value: w.total, display: money(w.total), sub: n(w.salesCount) }))} />
      </Card>
      <Card className="overflow-x-auto lg:col-span-2">
        <h2 className="border-b border-slate-100 px-4 py-3 font-semibold">By category</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500 uppercase">
            <tr>
              <th className="px-4 py-2">Category</th>
              <th className="px-4 py-2 text-right">Qty</th>
              <th className="px-4 py-2 text-right">Sales</th>
              <th className="px-4 py-2 text-right">Profit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {d.byCategory.map((c) => (
              <tr key={c.category}>
                <td className="px-4 py-2">{c.category}</td>
                <td className="px-4 py-2 text-right">{formatQty(c.quantity)}</td>
                <td className="px-4 py-2 text-right font-medium">{money(c.revenue)}</td>
                <td className="px-4 py-2 text-right text-slate-500">{money(c.profit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {d.byCategory.length === 0 && <Empty>No sales in this period</Empty>}
      </Card>
    </div>
  );
}

function InventoryTab() {
  const { store } = useApp();
  const money = (v: number) => formatMoney(v, store?.currency);
  const r = useLoad(() => call('reports:inventory'));
  if (r.error) return <Alert>{r.error}</Alert>;
  if (!r.data) return <p className="text-slate-500">Loading…</p>;
  const d = r.data;
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'never');
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Stock value (cost)" value={money(d.stockValueCost)} sub={`${d.trackedProducts} tracked products`} />
        <Stat label="Stock value (retail)" value={money(d.stockValueRetail)} sub={`Potential margin ${money(d.stockValueRetail - d.stockValueCost)}`} />
        <Stat label="Running out (7 days or less)" value={String(d.runningOut.length)} />
        <Stat label="No sales in 30 days" value={String(d.slowMovers.length)} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="border-b border-slate-100 px-4 py-3 font-semibold">Running out soon</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {d.runningOut.map((i) => (
              <li key={i.productId} className="flex justify-between gap-3 px-4 py-2">
                <span>
                  {i.name}
                  <span className="block text-xs text-slate-400">{formatQty(i.stock)} left · {formatQty(i.soldLast30)} sold in 30 days</span>
                </span>
                <span className={`font-semibold ${i.daysLeft === 0 ? 'text-red-600' : 'text-amber-600'}`}>
                  {i.daysLeft === 0 ? 'Out now' : `~${i.daysLeft} day${i.daysLeft === 1 ? '' : 's'}`}
                </span>
              </li>
            ))}
          </ul>
          {d.runningOut.length === 0 && <Empty>Nothing will run out this week at the current pace</Empty>}
        </Card>
        <Card>
          <h2 className="border-b border-slate-100 px-4 py-3 font-semibold">Slow movers (no sales in 30 days)</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {d.slowMovers.map((i) => (
              <li key={i.productId} className="flex justify-between gap-3 px-4 py-2">
                <span>
                  {i.name}
                  <span className="block text-xs text-slate-400">{formatQty(i.stock)} in stock · last sold {when(i.lastSoldAt)}</span>
                </span>
                <span className="text-slate-600">{money(i.stockValueCost)}</span>
              </li>
            ))}
          </ul>
          {d.slowMovers.length === 0 && <Empty>Everything in stock sold in the last 30 days</Empty>}
        </Card>
      </div>
    </div>
  );
}

function InsightsTab() {
  const r = useLoad(() => call('insights:list'));
  if (r.error) return <Alert>{r.error}</Alert>;
  if (!r.data) return <p className="text-slate-500">Loading…</p>;
  const style = { good: 'border-l-emerald-500', warn: 'border-l-amber-500', info: 'border-l-sky-500' } as const;
  const icon = { good: '📈', warn: '⚠️', info: '💡' } as const;
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">Worked out on this computer from the last 30 days of sales. Nothing is sent online.</p>
      {r.data.map((i) => (
        <Card key={i.id} className={`border-l-4 p-4 ${style[i.kind]}`}>
          <p className="font-semibold">
            <span aria-hidden className="mr-2">{icon[i.kind]}</span>
            {i.title}
          </p>
          <p className="mt-1 text-sm text-slate-600">{i.detail}</p>
        </Card>
      ))}
    </div>
  );
}
