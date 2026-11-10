import { useEffect, useState, type FormEvent } from 'react';
import { formatMoney } from '../../../shared/pricing';
import type { Discount, PosSettings, StoreSettings, Tax } from '../../../shared/types';
import { Alert, Button, Card, Field, Modal, MoneyField, Segmented, SelectField, useToast } from '../components/ui';
import { useApp } from '../lib/app';
import { call, useLoad } from '../lib/pos';
import { WEBSITE_URL } from './SubscriptionPage';

export function SettingsPage() {
  const { info } = useApp();
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold tracking-tight">Settings</h1>
      <LicenseCard />
      <StoreForm />
      <PosPrefsForm />
      <div className="grid gap-6 lg:grid-cols-2">
        <TaxesCard />
        <DiscountsCard />
      </div>
      <Card className="p-5 text-sm">
        <h2 className="mb-3 font-semibold">About this POS</h2>
        <dl className="grid grid-cols-[9rem_1fr] gap-y-1">
          <dt className="text-slate-500">Version</dt><dd>{info?.version}</dd>
          <dt className="text-slate-500">Plan</dt><dd>{info?.plan === 'PROFESSIONAL' ? 'Professional' : 'Free'}</dd>
          <dt className="text-slate-500">Database</dt><dd className="break-all font-mono text-xs">{info?.dbPath}</dd>
          <dt className="text-slate-500">Install ID</dt><dd className="font-mono text-xs">{info?.installId}</dd>
        </dl>
        <p className="mt-3 text-xs text-slate-400">All sales and products are stored only in the database file above. Back it up by copying that file while the POS is closed.</p>
      </Card>
    </div>
  );
}

function StoreForm() {
  const { store, refresh } = useApp();
  const toast = useToast();
  const [f, setF] = useState<StoreSettings | null>(store);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setF(store), [store]);
  if (!f) return null;
  const set = (k: keyof StoreSettings) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      await call('settings:saveStore', f!);
      setError(null);
      toast('Store details saved');
      refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Card className="p-5">
      <h2 className="mb-1 font-semibold">Store & receipt</h2>
      <p className="mb-4 text-sm text-slate-500">Shown at the top and bottom of every receipt.</p>
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        {error && <div className="sm:col-span-2"><Alert>{error}</Alert></div>}
        <Field label="Store name" required value={f.storeName} onChange={set('storeName')} />
        <Field label="Branch name" required value={f.branchName} onChange={set('branchName')} />
        <Field label="Address" value={f.address ?? ''} onChange={set('address')} />
        <Field label="Phone" value={f.phone ?? ''} onChange={set('phone')} />
        <Field label="Receipt header" value={f.receiptHeader ?? ''} onChange={set('receiptHeader')} placeholder="e.g. TIN 123-456-789" />
        <Field label="Receipt footer" value={f.receiptFooter ?? ''} onChange={set('receiptFooter')} placeholder="e.g. Thank you, come again!" />
        <Field label="Currency" maxLength={3} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} />
        <div className="flex items-end"><Button type="submit">Save store details</Button></div>
      </form>
    </Card>
  );
}

function PosPrefsForm() {
  const { pos, refresh } = useApp();
  const toast = useToast();
  const [f, setF] = useState<PosSettings | null>(pos);
  useEffect(() => setF(pos), [pos]);
  if (!f) return null;

  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      await call('settings:savePos', f!);
      toast('Preferences saved');
      refresh();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  return (
    <Card className="p-5">
      <h2 className="mb-4 font-semibold">Checkout & printing</h2>
      <form onSubmit={save} className="grid items-end gap-4 sm:grid-cols-3">
        <div>
          <span className="text-xs font-medium text-slate-600">Receipt paper</span>
          <div className="mt-1">
            <Segmented
              value={String(f.receiptWidth) as '58' | '80'}
              onChange={(v) => setF({ ...f, receiptWidth: v === '58' ? 58 : 80 })}
              options={[{ value: '58', label: '58 mm' }, { value: '80', label: '80 mm' }]}
            />
          </div>
        </div>
        <Field
          label="Default low-stock alert for new products"
          inputMode="numeric"
          value={String(f.lowStockDefault)}
          onChange={(e) => setF({ ...f, lowStockDefault: Number(e.target.value.replace(/\D/g, '')) || 0 })}
        />
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={f.autoPrint} onChange={(e) => setF({ ...f, autoPrint: e.target.checked })} />
          Print receipt automatically after each sale
        </label>
        <div className="sm:col-span-3"><Button type="submit">Save preferences</Button></div>
      </form>
    </Card>
  );
}

function TaxesCard() {
  const taxes = useLoad(() => call('taxes:list'));
  const [editing, setEditing] = useState<Partial<Tax> | null>(null);
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">Taxes</h2>
        <Button variant="secondary" onClick={() => setEditing({ isInclusive: true })}>+ Add tax</Button>
      </div>
      <ul className="divide-y divide-slate-100 text-sm">
        {taxes.data?.map((t) => (
          <li key={t.id} className="flex items-center justify-between py-2">
            <span>
              {t.name} · {t.rateBps / 100}% {t.isInclusive ? 'included' : 'added'}
              {t.isDefault && <span className="ml-2 rounded bg-slate-100 px-1.5 text-xs text-slate-600">default</span>}
            </span>
            <Button variant="ghost" onClick={() => setEditing(t)}>Edit</Button>
          </li>
        ))}
        {taxes.data?.length === 0 && <li className="py-3 text-slate-400">No taxes. Prices are sold as-is.</li>}
      </ul>
      {editing && <TaxModal tax={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); taxes.reload(); }} />}
    </Card>
  );
}

function TaxModal({ tax, onClose, onSaved }: { tax: Partial<Tax>; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(tax.name ?? 'VAT');
  const [rate, setRate] = useState(tax.rateBps !== undefined ? String(tax.rateBps / 100) : '12');
  const [inclusive, setInclusive] = useState(tax.isInclusive ?? true);
  const [isDefault, setIsDefault] = useState(tax.isDefault ?? false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      await call('taxes:save', { id: tax.id, name, rateBps: Math.round(parseFloat(rate) * 100), isInclusive: inclusive, isDefault });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  async function remove() {
    if (!tax.id || !confirm(`Remove ${tax.name}? Products using it will have no tax. Past sales are unchanged.`)) return;
    await call('taxes:delete', tax.id);
    onSaved();
  }

  return (
    <Modal
      title={tax.id ? 'Edit tax' : 'Add tax'}
      onClose={onClose}
      footer={<>{tax.id && <Button variant="danger" className="mr-auto" onClick={remove}>Remove</Button>}<Button type="submit" form="tax-form">Save</Button></>}
    >
      <form id="tax-form" onSubmit={save} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Name" required value={name} onChange={(e) => setName(e.target.value)} />
        <Field label="Rate (%)" required inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
        <SelectField label="Applied" value={inclusive ? 'inc' : 'exc'} onChange={(e) => setInclusive(e.target.value === 'inc')}>
          <option value="inc">Included in the price (e.g. VAT-inclusive)</option>
          <option value="exc">Added on top of the price</option>
        </SelectField>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} /> Use for new products by default
        </label>
      </form>
    </Modal>
  );
}

function DiscountsCard() {
  const { store } = useApp();
  const discounts = useLoad(() => call('discounts:list'));
  const [editing, setEditing] = useState<Partial<Discount> | null>(null);
  const label = (d: Discount) => (d.type === 'percent' ? `${d.value / 100}%` : formatMoney(d.value, store?.currency));
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">Discount presets</h2>
        <Button variant="secondary" onClick={() => setEditing({ type: 'percent' })}>+ Add discount</Button>
      </div>
      <ul className="divide-y divide-slate-100 text-sm">
        {discounts.data?.map((d) => (
          <li key={d.id} className="flex items-center justify-between py-2">
            <span>{d.name} · {label(d)}</span>
            <Button variant="ghost" onClick={() => setEditing(d)}>Edit</Button>
          </li>
        ))}
        {discounts.data?.length === 0 && <li className="py-3 text-slate-400">No presets. Cashiers can still enter a custom discount, e.g. Senior / PWD 20%.</li>}
      </ul>
      {editing && <DiscountModal discount={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); discounts.reload(); }} />}
    </Card>
  );
}

function DiscountModal({ discount, onClose, onSaved }: { discount: Partial<Discount>; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(discount.name ?? '');
  const [type, setType] = useState<'percent' | 'fixed'>(discount.type ?? 'percent');
  const [percent, setPercent] = useState(discount.type === 'percent' && discount.value ? String(discount.value / 100) : '');
  const [amount, setAmount] = useState<number | null>(discount.type === 'fixed' ? (discount.value ?? null) : null);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    const value = type === 'percent' ? Math.round(parseFloat(percent) * 100) : (amount ?? 0);
    try {
      await call('discounts:save', { id: discount.id, name, type, value });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  async function remove() {
    if (!discount.id) return;
    await call('discounts:delete', discount.id);
    onSaved();
  }

  return (
    <Modal
      title={discount.id ? 'Edit discount' : 'Add discount'}
      onClose={onClose}
      footer={<>{discount.id && <Button variant="danger" className="mr-auto" onClick={remove}>Remove</Button>}<Button type="submit" form="disc-form">Save</Button></>}
    >
      <form id="disc-form" onSubmit={save} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Senior citizen" />
        <Segmented value={type} onChange={setType} options={[{ value: 'percent', label: 'Percent' }, { value: 'fixed', label: 'Amount' }]} />
        {type === 'percent' ? (
          <Field label="Percent off" required inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} />
        ) : (
          <MoneyField label="Amount off" required value={amount} onChange={setAmount} />
        )}
      </form>
    </Modal>
  );
}

function LicenseCard() {
  const { refresh } = useApp();
  const toast = useToast();
  const status = useLoad(() => call('license:status'));
  const [busy, setBusy] = useState(false);
  const s = status.data;
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');

  async function check() {
    setBusy(true);
    try {
      await call('license:refresh');
      status.reload();
      refresh();
      toast('Account checked');
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    if (!confirm('Sign this POS out of your account? It will run on the Free plan. Your sales and products stay on this computer.')) return;
    await call('license:deactivate');
    status.reload();
    refresh();
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Account</h2>
          <p className="mt-1 text-sm text-slate-500">Selling always works, with or without an account or internet.</p>
        </div>
        {s && (
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${s.plan === 'PROFESSIONAL' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600'}`}>
            {s.plan === 'PROFESSIONAL' ? 'Professional' : 'Free'}
          </span>
        )}
      </div>

      {s?.signedIn ? (
        <div className="mt-4 space-y-3 text-sm">
          <dl className="grid grid-cols-[9rem_1fr] gap-y-1">
            <dt className="text-slate-500">Signed in as</dt><dd>{s.account?.fullName} · {s.account?.email}</dd>
            <dt className="text-slate-500">Store</dt><dd>{s.storeName ?? '—'}</dd>
            <dt className="text-slate-500">Valid offline until</dt><dd>{when(s.expiresAt)}</dd>
            <dt className="text-slate-500">Last checked</dt><dd>{when(s.lastVerifiedAt)}</dd>
          </dl>
          {s.lastError && <Alert kind="warn">Last check failed: {s.lastError}</Alert>}
          <BranchPicker onChanged={refresh} />
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={busy} onClick={check}>{busy ? 'Checking…' : 'Check now'}</Button>
            <Button variant="ghost" className="text-red-600" onClick={signOut}>Sign out</Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 text-sm">
          {s?.lastError && <div className="mb-3"><Alert kind="warn">{s.lastError}</Alert></div>}
          <a
            href={`${WEBSITE_URL}/login?pos=1`}
            className="inline-block rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-500"
          >
            Sign in to your account
          </a>
          <p className="mt-2 text-xs text-slate-400">You'll sign in on the website and come straight back here.</p>
        </div>
      )}
    </Card>
  );
}


/** Which of the store's branches (from the website) this computer is. Shown when there's a choice. */
function BranchPicker({ onChanged }: { onChanged: () => void }) {
  const toast = useToast();
  const options = useLoad(() => call('branch:options'));
  if (!options.data || options.data.length < 2) return null;
  const current = options.data.find((b) => b.isCurrent);
  return (
    <div className="max-w-sm">
      <SelectField
        label="This computer is branch"
        value={current?.remoteId ?? ''}
        onChange={async (e) => {
          try {
            await call('branch:select', e.target.value);
            options.reload();
            onChanged();
            toast('Branch changed. New receipts use its code.');
          } catch (err) {
            toast((err as Error).message, 'error');
          }
        }}
      >
        {!current && <option value="">Choose a branch</option>}
        {options.data.map((b) => (
          <option key={b.remoteId} value={b.remoteId}>{b.name} ({b.code})</option>
        ))}
      </SelectField>
      <p className="mt-1 text-xs text-slate-400">Each branch runs its own POS with its own data. Past receipts keep their numbers.</p>
    </div>
  );
}
