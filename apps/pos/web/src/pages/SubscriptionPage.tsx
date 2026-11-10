import { useState } from 'react';
import { formatMoney } from '../../../shared/pricing';
import { Alert, Button, Card, PageTitle, useToast } from '../components/ui';
import { useApp } from '../lib/app';
import { call, useLoad } from '../lib/pos';

export const WEBSITE_URL = (import.meta.env.VITE_WEBSITE_URL as string | undefined) ?? 'http://localhost:5173';

const PRO_FEATURES = [
  ['Staff & cashier PINs', 'Every sale records who made it'],
  ['Advanced reports', 'Sales by cashier, hour, weekday, payment and category'],
  ['Inventory analytics', 'Stock value, what runs out soon, slow movers'],
  ['Business insights', 'Plain-language tips from your own sales'],
  ['Multiple branches', 'Each branch with its own receipt numbers'],
  ['Unlimited sales history', 'Free shows the last 90 days'],
];

export function SubscriptionPage() {
  const { refresh } = useApp();
  const toast = useToast();
  const status = useLoad(() => call('license:status'));
  const [busy, setBusy] = useState<'sub' | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const s = status.data;
  const pro = s?.plan === 'PROFESSIONAL';
  const price = s?.priceMonthly ? formatMoney(s.priceMonthly, s.currency) : null;
  const until = s?.professionalUntil ? new Date(s.professionalUntil).toLocaleDateString(undefined, { dateStyle: 'medium' }) : null;

  async function run(kind: 'sub' | 'cancel') {
    if (kind === 'cancel' && !confirm('Cancel Professional? Pro features lock right away. Your data is kept.')) return;
    setBusy(kind);
    setError(null);
    try {
      const r = await call(kind === 'sub' ? 'account:subscribe' : 'account:cancel');
      status.reload();
      refresh();
      toast(kind === 'sub' ? `You're on Professional${r.professionalUntil ? ` until ${new Date(r.professionalUntil).toLocaleDateString()}` : ''}` : 'Professional canceled');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="max-w-3xl">
      <PageTitle title="Subscription" />
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}

      {s && !s.signedIn && (
        <Card className="mb-6 p-6 text-center">
          <h2 className="text-lg font-semibold">Sign in to subscribe</h2>
          <p className="mt-1 text-sm text-slate-500">Sign in on the website and you'll come straight back here, already connected.</p>
          <a
            href={`${WEBSITE_URL}/login?pos=1`}
            className="mt-4 inline-block rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            Sign in
          </a>
        </Card>
      )}

      {s?.signedIn && (
        <Card className="mb-6 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm text-slate-500">Your plan</p>
              <p className="mt-1 text-2xl font-bold">{pro ? 'Professional' : 'Free'}</p>
              {pro && until && <p className="text-sm text-slate-500">Renews / ends {until}</p>}
              <p className="mt-2 text-xs text-slate-400">Signed in as {s.account?.email}</p>
            </div>
            {pro ? (
              <div className="flex flex-col items-end gap-2">
                <Button disabled={!!busy} onClick={() => run('sub')}>{busy === 'sub' ? 'Adding…' : 'Add another month'}</Button>
                <Button variant="ghost" className="text-red-600" disabled={!!busy} onClick={() => run('cancel')}>
                  {busy === 'cancel' ? 'Canceling…' : 'Cancel subscription'}
                </Button>
              </div>
            ) : (
              <Button className="px-6 py-3 text-base" disabled={!!busy} onClick={() => run('sub')}>
                {busy === 'sub' ? 'Subscribing…' : `Subscribe to Professional${price ? ` · ${price}/month` : ''}`}
              </Button>
            )}
          </div>
        </Card>
      )}

      <Card className="p-6">
        <h2 className="font-semibold">What Professional adds</h2>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {PRO_FEATURES.map(([t, d]) => (
            <li key={t} className="flex gap-2 text-sm">
              <span className={pro ? 'text-emerald-600' : 'text-slate-400'}>✓</span>
              <span><b className="font-medium">{t}</b><span className="block text-slate-500">{d}</span></span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-slate-400">Selling, products, inventory, receipts and basic reports are free and work offline.</p>
      </Card>
    </div>
  );
}
