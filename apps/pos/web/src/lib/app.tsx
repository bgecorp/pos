import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useToast } from '../components/ui';
import type { AppInfo, PosSettings, StoreSettings } from '../../../shared/types';
import { call, useLoad } from './pos';

interface AppState {
  info: AppInfo | null;
  store: StoreSettings | null;
  pos: PosSettings | null;
  /** Refetch info (low-stock count), store and POS settings after changes */
  refresh: () => void;
}

const Ctx = createContext<AppState>({ info: null, store: null, pos: null, refresh: () => {} });
export const useApp = () => useContext(Ctx);

export function AppProvider({ children }: { children: ReactNode }) {
  const { data, error, reload } = useLoad(() =>
    Promise.all([call('app:info'), call('settings:getStore'), call('settings:getPos')]),
  );
  // The server refreshes the license in the background; pick up plan and low-stock
  // changes every minute and whenever the cashier comes back to this window.
  useEffect(() => {
    const t = setInterval(reload, 60_000);
    window.addEventListener('focus', reload);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', reload);
    };
  }, [reload]);

  // Opened from the website after login/register: POS URL is .../#link=<one-time code>.
  // Exchange it for an account connection, then drop the code from the address bar.
  const toast = useToast();
  const [linking, setLinking] = useState(() => window.location.hash.startsWith('#link='));
  useEffect(() => {
    if (!linking) return;
    const code = decodeURIComponent(window.location.hash.slice('#link='.length));
    window.history.replaceState(null, '', `${window.location.pathname}#sell`);
    call('account:connect', code)
      .then((s) => toast(`Signed in as ${s.account?.email ?? 'your account'}`))
      .catch((e: Error) => toast(e.message, 'error'))
      .finally(() => {
        setLinking(false);
        reload();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (linking) {
    return <div className="grid min-h-screen place-items-center bg-slate-50 text-slate-500">Signing you in…</div>;
  }

  if (error) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 p-6 text-center">
        <div>
          <p className="text-lg font-semibold">Can&apos;t connect to the POS server</p>
          <p className="mt-1 text-sm text-slate-500">{error}</p>
          <button className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white" onClick={reload}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  const [info, store, pos] = data ?? [null, null, null];
  return <Ctx.Provider value={{ info, store, pos, refresh: reload }}>{children}</Ctx.Provider>;
}
