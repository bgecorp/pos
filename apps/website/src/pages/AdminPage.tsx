import type { AdminCustomer, AdminOverview, AdminPayment, UpgradeCodeDto, UpgradeCodeStatus } from '@pos/shared-types';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, Button, Card, Field, PageHeader, PlanBadge } from '../components/ui';
import { api } from '../lib/api';
import { date, money } from '../lib/format';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'customers', label: 'Customers' },
  { id: 'codes', label: 'Upgrade codes' },
  { id: 'payments', label: 'Payments' },
] as const;
type Tab = (typeof TABS)[number]['id'];

/** Owner-only page: who signed up, who is paying, and the upgrade codes you sell. */
export function AdminPage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'overview') as Tab;

  return (
    <div className="space-y-6">
      <PageHeader title="Admin" subtitle="Your customers and their subscriptions" />
      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setParams({ tab: t.id })}
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${tab === t.id ? 'border-indigo-600 font-medium text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'overview' && <OverviewTab />}
      {tab === 'customers' && <CustomersTab />}
      {tab === 'codes' && <CodesTab />}
      {tab === 'payments' && <PaymentsTab />}
    </div>
  );
}

function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true;
    api<T>(path)
      .then((d) => live && setData(d))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [path, tick]);
  return { data, error, reload: () => setTick((t) => t + 1) };
}

function Table({ head, children, empty }: { head: string[]; children: ReactNode; empty?: string | false }) {
  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500 uppercase">
          <tr>{head.map((h) => <th key={h} className="px-4 py-2.5 whitespace-nowrap">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
      {empty && <p className="px-4 py-8 text-center text-sm text-slate-400">{empty}</p>}
    </Card>
  );
}

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <Card>
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-bold">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
    </Card>
  );
}

function OverviewTab() {
  const { data, error } = useApi<AdminOverview>('/admin/overview');
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <p className="text-slate-500">Loading…</p>;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Stat label="Customers" value={data.customers} sub={`${data.newCustomers30d} new in the last 30 days`} />
      <Stat label="Active Professional" value={data.activeProfessional} />
      <Stat label="Unused upgrade codes" value={data.unusedCodes} />
      <Stat label="Revenue (last 30 days)" value={money(data.revenue30d, data.currency)} />
      <Stat label="Revenue (all time)" value={money(data.revenueTotal, data.currency)} sub="From redeemed upgrade codes" />
    </div>
  );
}

function CustomersTab() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  const { data, error } = useApi<AdminCustomer[]>(`/admin/customers${query ? `?search=${encodeURIComponent(query)}` : ''}`);
  const pro = data?.filter((c) => c.plan === 'PROFESSIONAL').length ?? 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          className="w-full max-w-sm rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          placeholder="Search name or email"
          aria-label="Search customers"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {data && <p className="text-sm text-slate-500">{data.length} customer{data.length === 1 ? '' : 's'} · {pro} on Professional</p>}
      </div>
      {error && <Alert>{error}</Alert>}
      <Table head={['Customer', 'Plan', 'Professional until', 'Stores', 'Total paid', 'Joined']} empty={data?.length === 0 && 'No customers found'}>
        {data?.map((c) => (
          <tr key={c.id}>
            <td className="px-4 py-2.5">
              <span className="font-medium">{c.fullName}</span>
              {c.role === 'ADMIN' && <span className="ml-2 rounded bg-amber-100 px-1.5 text-xs text-amber-800">admin</span>}
              <span className="block text-xs text-slate-500">{c.email}</span>
            </td>
            <td className="px-4 py-2.5"><PlanBadge plan={c.plan} /></td>
            <td className="px-4 py-2.5 whitespace-nowrap">{c.plan === 'PROFESSIONAL' ? (c.professionalUntil ? date(c.professionalUntil) : 'No end date') : '—'}</td>
            <td className="px-4 py-2.5">{c.stores}</td>
            <td className="px-4 py-2.5 whitespace-nowrap">{money(c.totalPaid)}</td>
            <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">{date(c.createdAt)}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function CodesTab() {
  const [status, setStatus] = useState<UpgradeCodeStatus | ''>('');
  const { data, error, reload } = useApi<UpgradeCodeDto[]>(`/admin/codes${status ? `?status=${status}` : ''}`);
  const [form, setForm] = useState({ count: '1', months: '1', note: '' });
  const [created, setCreated] = useState<UpgradeCodeDto[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  async function generate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const codes = await api<UpgradeCodeDto[]>('/admin/codes', {
        method: 'POST',
        json: { count: Number(form.count), months: Number(form.months), note: form.note || undefined },
      });
      setCreated(codes);
      reload();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(c: UpgradeCodeDto) {
    if (!confirm(`Revoke ${c.code}? It can no longer be redeemed.`)) return;
    try {
      await api(`/admin/codes/${c.id}/revoke`, { method: 'POST' });
      reload();
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  function copy(text: string) {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(text);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  const statusStyle: Record<UpgradeCodeStatus, string> = {
    UNUSED: 'bg-green-100 text-green-700',
    REDEEMED: 'bg-indigo-100 text-indigo-700',
    REVOKED: 'bg-slate-100 text-slate-500',
  };

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="font-semibold">Generate upgrade codes</h2>
        <p className="mt-1 text-sm text-slate-500">
          Sell or give a code to a customer after they pay you. They enter it on their Subscription page.
        </p>
        <form onSubmit={generate} className="mt-4 grid gap-3 sm:grid-cols-[6rem_6rem_1fr_auto] sm:items-end">
          <Field label="How many" type="number" min={1} max={50} required value={form.count} onChange={(e) => setForm({ ...form, count: e.target.value })} />
          <Field label="Months each" type="number" min={1} max={24} required value={form.months} onChange={(e) => setForm({ ...form, months: e.target.value })} />
          <Field label="Note (optional)" placeholder="e.g. Paid via GCash, Juan's store" maxLength={100} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <Button type="submit" disabled={busy}>{busy ? 'Generating…' : 'Generate'}</Button>
        </form>
        {msg && <div className="mt-3"><Alert>{msg}</Alert></div>}
        {created && (
          <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-green-800">New code{created.length === 1 ? '' : 's'}: {created[0]?.months} month{created[0]?.months === 1 ? '' : 's'} each</p>
              {created.length > 1 && (
                <button className="text-sm text-green-800 underline" onClick={() => copy(created.map((c) => c.code).join('\n'))}>Copy all</button>
              )}
            </div>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {created.map((c) => (
                <li key={c.id} className="flex items-center justify-between rounded-md bg-white px-3 py-2 font-mono text-sm">
                  {c.code}
                  <button className="font-sans text-xs text-indigo-600 hover:underline" onClick={() => copy(c.code)}>
                    {copied === c.code ? 'Copied' : 'Copy'}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <div className="flex items-center gap-2">
        <span className="text-sm text-slate-500">Show</span>
        <select className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm" aria-label="Filter codes by status" value={status} onChange={(e) => setStatus(e.target.value as UpgradeCodeStatus | '')}>
          <option value="">All codes</option>
          <option value="UNUSED">Unused</option>
          <option value="REDEEMED">Redeemed</option>
          <option value="REVOKED">Revoked</option>
        </select>
      </div>
      {error && <Alert>{error}</Alert>}
      <Table head={['Code', 'Months', 'Status', 'Redeemed by', 'Note', 'Created', '']} empty={data?.length === 0 && 'No codes yet'}>
        {data?.map((c) => (
          <tr key={c.id}>
            <td className="px-4 py-2.5 font-mono whitespace-nowrap">{c.code}</td>
            <td className="px-4 py-2.5">{c.months}</td>
            <td className="px-4 py-2.5"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusStyle[c.status]}`}>{c.status.toLowerCase()}</span></td>
            <td className="px-4 py-2.5">
              {c.redeemedBy ? (
                <>
                  {c.redeemedBy.fullName}
                  <span className="block text-xs text-slate-500">{c.redeemedBy.email} · {c.redeemedAt && date(c.redeemedAt)}</span>
                </>
              ) : '—'}
            </td>
            <td className="px-4 py-2.5 text-slate-500">{c.note ?? ''}</td>
            <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">{date(c.createdAt)}</td>
            <td className="px-4 py-2.5 text-right whitespace-nowrap">
              {c.status === 'UNUSED' && (
                <>
                  <button className="mr-3 text-xs text-indigo-600 hover:underline" onClick={() => copy(c.code)}>{copied === c.code ? 'Copied' : 'Copy'}</button>
                  <button className="text-xs text-red-600 hover:underline" onClick={() => revoke(c)}>Revoke</button>
                </>
              )}
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function PaymentsTab() {
  const { data, error } = useApi<AdminPayment[]>('/admin/payments');
  const total = data?.filter((p) => p.status === 'PAID').reduce((a, p) => a + p.amount, 0) ?? 0;
  return (
    <div className="space-y-3">
      {data && <p className="text-sm text-slate-500">{data.length} payment{data.length === 1 ? '' : 's'} · {money(total)} received</p>}
      {error && <Alert>{error}</Alert>}
      <Table head={['Date', 'Customer', 'Description', 'Reference', 'Amount', 'Status']} empty={data?.length === 0 && 'No payments yet'}>
        {data?.map((p) => (
          <tr key={p.id}>
            <td className="px-4 py-2.5 whitespace-nowrap">{date(p.paidAt ?? p.createdAt)}</td>
            <td className="px-4 py-2.5">
              {p.customer.fullName}
              <span className="block text-xs text-slate-500">{p.customer.email}</span>
            </td>
            <td className="px-4 py-2.5">{p.description}</td>
            <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap">{p.reference ?? '—'}</td>
            <td className="px-4 py-2.5 whitespace-nowrap">{money(p.amount, p.currency)}</td>
            <td className="px-4 py-2.5">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${p.status === 'PAID' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>{p.status.toLowerCase()}</span>
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
