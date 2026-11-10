import { FEATURES } from '@pos/feature-entitlements';
import type { PlanDto } from '@pos/shared-types';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Card, PageHeader } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { FEATURE_LABELS, money } from '../lib/format';

const ALL_FEATURES = Object.values(FEATURES);

export function PricingPage() {
  const { user } = useAuth();
  const [plans, setPlans] = useState<PlanDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<PlanDto[]>('/plans').then(setPlans).catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div>
      <PageHeader title="Pricing" subtitle="Start free. Upgrade when your business grows." />
      {error && <Alert>{error}</Alert>}
      {!plans && !error && <p className="text-slate-500">Loading plans…</p>}
      <div className="grid gap-6 md:grid-cols-2">
        {plans?.map((p) => {
          const pro = p.code === 'PROFESSIONAL';
          const current = user?.plan === p.code;
          return (
            <Card key={p.code} className={pro ? 'border-indigo-300 ring-1 ring-indigo-200' : ''}>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">{p.name}</h2>
                {current && <span className="text-xs font-semibold text-indigo-600">Your plan</span>}
              </div>
              <p className="mt-2">
                <span className="text-3xl font-bold">{p.priceMonthly === 0 ? 'Free' : money(p.priceMonthly, p.currency)}</span>
                {p.priceMonthly > 0 && <span className="text-sm text-slate-500"> / month</span>}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {p.limits.stores === null ? 'Unlimited stores' : `${p.limits.stores} store`} ·{' '}
                {p.limits.salesHistoryDays === null ? 'unlimited history' : `${p.limits.salesHistoryDays}-day report history`}
              </p>
              <ul className="mt-5 space-y-2 text-sm">
                {ALL_FEATURES.map((f) => {
                  const has = p.features.includes(f);
                  return (
                    <li key={f} className={has ? 'text-slate-800' : 'text-slate-400 line-through'}>
                      <span className={`mr-2 ${has ? 'text-green-600' : ''}`}>{has ? '✓' : '–'}</span>
                      {FEATURE_LABELS[f] ?? f}
                    </li>
                  );
                })}
              </ul>
              <div className="mt-6">
                {!user ? (
                  <Link
                    to="/register"
                    className={`block rounded-md px-4 py-2 text-center text-sm font-medium ${pro ? 'bg-indigo-600 text-white hover:bg-indigo-500' : 'border border-slate-300 hover:bg-slate-50'}`}
                  >
                    {pro ? 'Start free, upgrade anytime' : 'Start free'}
                  </Link>
                ) : pro && !current ? (
                  <Link
                    to="/pos"
                    className="block rounded-md bg-indigo-600 px-4 py-2 text-center text-sm font-medium text-white hover:bg-indigo-500"
                  >
                    Open POS to subscribe
                  </Link>
                ) : null}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
