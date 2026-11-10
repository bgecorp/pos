import type { HealthResponse } from '@pos/shared-types';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';

/** Phase 1 check: website -> API -> PostgreSQL. */
export function StatusPage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<HealthResponse>('/health')
      .then(setHealth)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div className="max-w-md space-y-4">
      <h1 className="text-2xl font-bold">System status</h1>
      {error && (
        <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">API unreachable: {error}</p>
      )}
      {!error && !health && <p className="text-slate-500">Checking…</p>}
      {health && (
        <dl className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <dt className="text-slate-500">API</dt>
          <dd className="font-medium text-green-700">up ({health.version})</dd>
          <dt className="text-slate-500">PostgreSQL</dt>
          <dd className={health.database === 'up' ? 'font-medium text-green-700' : 'font-medium text-red-700'}>
            {health.database}
          </dd>
          <dt className="text-slate-500">Checked</dt>
          <dd>{new Date(health.time).toLocaleTimeString()}</dd>
        </dl>
      )}
    </div>
  );
}
