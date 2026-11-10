import { useState } from 'react';
import type { StaffMember } from '../../../shared/types';
import { call } from '../lib/pos';
import { Alert, Button, Modal } from './ui';

export interface Cashier {
  id: string;
  name: string;
}

const KEY = 'pos.cashier';

/** The signed-in cashier lives in sessionStorage: cleared when the browser tab closes. */
export function loadCashier(): Cashier | null {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as Cashier | null;
  } catch {
    return null;
  }
}

export function saveCashier(c: Cashier | null) {
  try {
    if (c) sessionStorage.setItem(KEY, JSON.stringify(c));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: cashier just isn't remembered */
  }
}

/** Tap your name, enter your PIN. */
export function CashierSwitchModal({ staff, onClose, onSwitched }: { staff: StaffMember[]; onClose: () => void; onSwitched: (c: Cashier) => void }) {
  const [who, setWho] = useState<StaffMember | null>(staff.length === 1 ? staff[0] : null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(p = pin) {
    if (!who || p.length < 4) return;
    setBusy(true);
    try {
      const s = await call('staff:login', who.id, p);
      onSwitched({ id: s.id, name: s.name });
    } catch (err) {
      setError((err as Error).message);
      setPin('');
    } finally {
      setBusy(false);
    }
  }

  const press = (d: string) => {
    setError(null);
    setPin((p) => (p.length < 6 ? p + d : p));
  };

  return (
    <Modal title={who ? `PIN for ${who.name}` : 'Who is selling?'} onClose={onClose}>
      {!who ? (
        <div className="grid grid-cols-2 gap-2">
          {staff.map((s) => (
            <Button key={s.id} variant="secondary" className="py-4" onClick={() => setWho(s)}>{s.name}</Button>
          ))}
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="space-y-3"
        >
          <input
            autoFocus
            aria-label="PIN"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            value={pin}
            onChange={(e) => {
              setError(null);
              setPin(e.target.value.replace(/\D/g, ''));
            }}
            className="w-full rounded-lg border border-slate-300 py-3 text-center text-2xl tracking-[0.5em]"
          />
          <div className="grid grid-cols-3 gap-2">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <Button key={d} variant="secondary" className="py-3 text-lg" onClick={() => press(d)}>{d}</Button>
            ))}
            <Button variant="ghost" onClick={() => setPin((p) => p.slice(0, -1))}>⌫</Button>
            <Button variant="secondary" className="py-3 text-lg" onClick={() => press('0')}>0</Button>
            <Button type="submit" disabled={busy || pin.length < 4}>OK</Button>
          </div>
          {error && <Alert>{error}</Alert>}
          {staff.length > 1 && (
            <button type="button" className="text-sm text-slate-500 hover:underline" onClick={() => { setWho(null); setPin(''); }}>
              ← Not {who.name}?
            </button>
          )}
        </form>
      )}
    </Modal>
  );
}
