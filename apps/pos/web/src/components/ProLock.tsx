import type { ReactNode } from 'react';
import { useApp } from '../lib/app';
import { Card } from './ui';

/** Renders children on Professional; otherwise explains the feature and how to unlock it. */
export function ProOnly({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  const { info } = useApp();
  if (!info) return null;
  if (info.plan === 'PROFESSIONAL') return <>{children}</>;
  return (
    <Card className="p-8 text-center">
      <span className="rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-semibold text-indigo-700">Professional</span>
      <h2 className="mt-3 text-lg font-semibold">{title}</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{description}</p>
      <a href="#subscription" className="mt-4 inline-block rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500">See Subscription</a>
    </Card>
  );
}

export const isPro = (plan?: string) => plan === 'PROFESSIONAL';
