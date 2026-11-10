import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { calcCart, formatMoney, formatQty } from '../../../shared/pricing';
import type { CartDiscountInput, Discount, PaymentMethod, Product, SaleDetail } from '../../../shared/types';
import { CashierSwitchModal, loadCashier, saveCashier, type Cashier } from '../components/CashierSwitch';
import { isPro } from '../components/ProLock';
import { ReceiptPreview } from '../components/ReceiptPreview';
import { Alert, Button, Field, Modal, MoneyField, Segmented, useToast } from '../components/ui';
import { useApp } from '../lib/app';
import { call, printHtml, useLoad } from '../lib/pos';

interface CartLine {
  product: Product;
  quantity: number;
}

export function SellPage() {
  const { store, pos, info, refresh } = useApp();
  const toast = useToast();
  const currency = store?.currency ?? 'PHP';
  const money = (v: number) => formatMoney(v, currency);

  const products = useLoad(() => call('products:list', {}));
  const categories = useLoad(() => call('categories:list'));
  const discounts = useLoad(() => call('discounts:list'));
  const pro = isPro(info?.plan);
  const staff = useLoad(() => (pro ? call('staff:list') : Promise.resolve([])), [pro]);
  const needsCashier = pro && (staff.data?.length ?? 0) > 0;
  const [cashier, setCashier] = useState<Cashier | null>(loadCashier);
  const [switching, setSwitching] = useState<false | 'switch' | 'then-pay'>(false);
  /** Charge: ask who is selling first when staff are set up. */
  const startCharge = () => (needsCashier && !cashier ? setSwitching('then-pay') : setPaying(true));

  const [cart, setCart] = useState<CartLine[]>([]);
  const [discount, setDiscount] = useState<(CartDiscountInput & { label: string }) | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('');
  const [paying, setPaying] = useState(false);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [done, setDone] = useState<{ sale: SaleDetail; html: string } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const totals = useMemo(
    () =>
      calcCart(
        cart.map((l) => ({
          unitPrice: l.product.sellingPrice,
          quantity: l.quantity,
          taxRateBps: l.product.taxRateBps,
          taxInclusive: l.product.taxInclusive,
        })),
        discount,
      ),
    [cart, discount],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (products.data ?? []).filter(
      (p) =>
        (!category || p.categoryId === category) &&
        (!q || p.name.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q) || p.barcode?.includes(q)),
    );
  }, [products.data, search, category]);

  const focusSearch = () => setTimeout(() => searchRef.current?.focus(), 0);

  // F2: search, F9: charge
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'F9' && cart.length && !paying && !done && !switching) {
        e.preventDefault();
        startCharge();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart.length, paying, done, switching, needsCashier, cashier]);

  function add(p: Product, qty = 1) {
    setCart((c) => {
      const i = c.findIndex((l) => l.product.id === p.id);
      if (i === -1) return [...c, { product: p, quantity: qty }];
      const next = [...c];
      next[i] = { ...next[i], quantity: Math.round((next[i].quantity + qty) * 1000) / 1000 };
      return next;
    });
    if (p.trackStock && p.stock <= 0) toast(`${p.name} shows no stock left`, 'warn');
  }

  function setQty(id: string, quantity: number) {
    setCart((c) =>
      quantity <= 0 ? c.filter((l) => l.product.id !== id) : c.map((l) => (l.product.id === id ? { ...l, quantity } : l)),
    );
  }

  /** Enter in the search box: barcode scanners type the code + Enter. */
  async function onSearchKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const code = search.trim();
    if (!code) return;
    try {
      const exact = await call('products:findByCode', code);
      if (exact) {
        add(exact);
        setSearch('');
        return;
      }
      if (visible.length === 1) {
        add(visible[0]);
        setSearch('');
        return;
      }
      toast(visible.length ? 'More than one match. Tap the product to add it.' : `No product with code "${code}"`, 'error');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  async function complete(method: PaymentMethod, tendered: number | undefined) {
    const sale = await call('sales:create', {
      items: cart.map((l) => ({ productId: l.product.id, quantity: l.quantity })),
      discount: discount ? { type: discount.type, value: discount.value, discountId: discount.discountId } : null,
      payment: { method, tendered },
      cashierId: needsCashier ? cashier?.id : undefined,
    });
    const html = await call('receipts:html', sale.id);
    setPaying(false);
    setDone({ sale, html });
    if (pos?.autoPrint) {
      printHtml(await call('receipts:html', sale.id, { markPrinted: true }));
    }
    setCart([]);
    setDiscount(null);
    products.reload();
    refresh();
  }

  function newSale() {
    setDone(null);
    setSearch('');
    focusSearch();
  }

  const items = cart.reduce((n, l) => n + l.quantity, 0);

  return (
    <div className="flex h-full flex-col lg:flex-row">
      {/* Catalog */}
      <section className="flex min-h-0 flex-1 flex-col p-4">
        <div className="flex flex-wrap gap-2">
          <input
            ref={searchRef}
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={onSearchKey}
            placeholder="Scan barcode or search products  (F2)"
            aria-label="Scan barcode or search products"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-4 py-3 text-base outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
          />
        </div>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {[{ id: '', name: 'All' }, ...(categories.data ?? [])].map((c) => (
            <button
              key={c.id}
              onClick={() => setCategory(c.id)}
              className={`shrink-0 rounded-full px-3 py-1 text-sm ${category === c.id ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100'}`}
            >
              {c.name}
            </button>
          ))}
        </div>
        {products.error && <div className="mt-3"><Alert>{products.error}</Alert></div>}
        <div className="mt-3 grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 xl:grid-cols-4">
          {visible.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                add(p);
                focusSearch();
              }}
              className="flex flex-col items-start rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-emerald-400 hover:shadow-sm active:bg-emerald-50"
            >
              <span className="line-clamp-2 text-sm font-medium">{p.name}</span>
              <span className="mt-auto pt-2 font-semibold text-emerald-700">{money(p.sellingPrice)}</span>
              {p.trackStock && (
                <span className={`text-xs ${p.stock <= 0 ? 'text-red-600' : p.isLowStock ? 'text-amber-600' : 'text-slate-400'}`}>
                  {formatQty(p.stock)} in stock
                </span>
              )}
            </button>
          ))}
          {products.data && visible.length === 0 && (
            <p className="col-span-full py-10 text-center text-sm text-slate-400">
              {products.data.length === 0 ? 'No products yet. Add some on the Products page.' : 'No products match.'}
            </p>
          )}
        </div>
      </section>

      {/* Cart */}
      <aside className="flex max-h-[55vh] w-full shrink-0 flex-col border-t border-slate-200 bg-white lg:max-h-none lg:w-[380px] lg:border-t-0 lg:border-l">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="font-semibold">Current sale {items > 0 && <span className="text-sm font-normal text-slate-400">· {formatQty(items)} items</span>}</h2>
          {needsCashier && (
            <button className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-200" onClick={() => setSwitching('switch')}>
              {cashier ? `👤 ${cashier.name} · Switch` : '👤 Choose cashier'}
            </button>
          )}
          {cart.length > 0 && (
            <button className="text-sm text-slate-400 hover:text-red-600" onClick={() => { setCart([]); setDiscount(null); }}>
              Clear
            </button>
          )}
        </div>
        <ul className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto">
          {cart.length === 0 && <li className="px-4 py-10 text-center text-sm text-slate-400">Scan or tap a product to start</li>}
          {cart.map((l, i) => (
            <li key={l.product.id} className="px-4 py-2.5">
              <div className="flex justify-between gap-2 text-sm">
                <span className="font-medium">{l.product.name}</span>
                <span className="font-medium">{money(totals.lines[i]?.gross ?? 0)}</span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                <button className="h-7 w-7 rounded border border-slate-300 hover:bg-slate-100" aria-label={`Less ${l.product.name}`} onClick={() => setQty(l.product.id, Math.round((l.quantity - 1) * 1000) / 1000)}>−</button>
                <input
                  aria-label={`Quantity of ${l.product.name}`}
                  className="h-7 w-14 rounded border border-slate-300 text-center text-sm"
                  inputMode="decimal"
                  value={formatQty(l.quantity)}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (!Number.isNaN(v)) setQty(l.product.id, Math.round(v * 1000) / 1000);
                  }}
                />
                <button className="h-7 w-7 rounded border border-slate-300 hover:bg-slate-100" aria-label={`More ${l.product.name}`} onClick={() => setQty(l.product.id, Math.round((l.quantity + 1) * 1000) / 1000)}>+</button>
                <span>× {money(l.product.sellingPrice)}</span>
                <button className="ml-auto text-slate-400 hover:text-red-600" onClick={() => setQty(l.product.id, 0)}>Remove</button>
              </div>
            </li>
          ))}
        </ul>
        <div className="space-y-1 border-t border-slate-100 px-4 py-3 text-sm">
          <Row label="Subtotal" value={money(totals.subtotal)} />
          <div className="flex items-center justify-between">
            <button className="text-emerald-700 hover:underline disabled:text-slate-300" disabled={!cart.length} onClick={() => setDiscountOpen(true)}>
              {discount ? `Discount (${discount.label})` : '+ Add discount'}
            </button>
            {discount && (
              <span className="flex items-center gap-2">
                -{money(totals.discountTotal)}
                <button className="text-slate-400 hover:text-red-600" aria-label="Remove discount" onClick={() => setDiscount(null)}>✕</button>
              </span>
            )}
          </div>
          {totals.taxTotal > 0 && <Row label="Tax" value={money(totals.taxTotal)} muted />}
          <div className="flex justify-between pt-1 text-xl font-bold">
            <span>Total</span>
            <span>{money(totals.total)}</span>
          </div>
          <Button className="mt-2 w-full py-3 text-base" disabled={!cart.length} onClick={startCharge}>
            Charge {money(totals.total)} <span className="text-xs opacity-70">(F9)</span>
          </Button>
        </div>
      </aside>

      {switching && staff.data && (
        <CashierSwitchModal
          staff={staff.data}
          onClose={() => setSwitching(false)}
          onSwitched={(c) => {
            setCashier(c);
            saveCashier(c);
            toast(`Cashier: ${c.name}`);
            if (switching === 'then-pay') setPaying(true);
            setSwitching(false);
          }}
        />
      )}
      {discountOpen && (
        <DiscountModal
          presets={discounts.data ?? []}
          currency={currency}
          onClose={() => setDiscountOpen(false)}
          onApply={(d) => {
            setDiscount(d);
            setDiscountOpen(false);
          }}
        />
      )}
      {paying && (
        <PaymentModal
          total={totals.total}
          currency={currency}
          onClose={() => {
            setPaying(false);
            focusSearch();
          }}
          onComplete={complete}
        />
      )}
      {done && (
        <Modal
          title={`Sale complete · ${done.sale.receiptNumber}`}
          onClose={newSale}
          footer={
            <>
              <Button variant="secondary" onClick={() => call('receipts:html', done.sale.id, { markPrinted: true }).then(printHtml)}>
                Print receipt
              </Button>
              <Button autoFocus onClick={newSale}>New sale</Button>
            </>
          }
        >
          {done.sale.payment.method === 'cash' && (
            <div className="mb-4 rounded-lg bg-emerald-50 p-4 text-center">
              <p className="text-sm text-emerald-700">Change</p>
              <p className="text-4xl font-bold text-emerald-800">{money(done.sale.payment.change)}</p>
            </div>
          )}
          <ReceiptPreview html={done.html} />
        </Modal>
      )}
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`flex justify-between ${muted ? 'text-slate-500' : ''}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function DiscountModal({
  presets,
  currency,
  onClose,
  onApply,
}: {
  presets: Discount[];
  currency: string;
  onClose: () => void;
  onApply: (d: CartDiscountInput & { label: string }) => void;
}) {
  const [type, setType] = useState<'percent' | 'fixed'>('percent');
  const [percent, setPercent] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const label = (d: Discount) => (d.type === 'percent' ? `${d.value / 100}%` : formatMoney(d.value, currency));

  function applyCustom() {
    if (type === 'percent') {
      const p = parseFloat(percent);
      if (!(p > 0 && p <= 100)) return;
      onApply({ type, value: Math.round(p * 100), label: `${p}%` });
    } else if (amount && amount > 0) {
      onApply({ type, value: amount, label: formatMoney(amount, currency) });
    }
  }

  return (
    <Modal title="Discount" onClose={onClose} footer={<Button onClick={applyCustom}>Apply</Button>}>
      {presets.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {presets.map((d) => (
            <Button key={d.id} variant="secondary" onClick={() => onApply({ type: d.type, value: d.value, discountId: d.id, label: `${d.name} ${label(d)}` })}>
              {d.name} · {label(d)}
            </Button>
          ))}
        </div>
      )}
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          applyCustom();
        }}
      >
        <Segmented value={type} onChange={setType} options={[{ value: 'percent', label: 'Percent' }, { value: 'fixed', label: 'Amount' }]} />
        {type === 'percent' ? (
          <Field label="Percent off" autoFocus inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} placeholder="e.g. 10" />
        ) : (
          <MoneyField label="Amount off" autoFocus value={amount} onChange={setAmount} placeholder="0.00" />
        )}
      </form>
    </Modal>
  );
}

function PaymentModal({
  total,
  currency,
  onClose,
  onComplete,
}: {
  total: number;
  currency: string;
  onClose: () => void;
  onComplete: (method: PaymentMethod, tendered: number | undefined) => Promise<void>;
}) {
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [tendered, setTendered] = useState<number | null>(total);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const money = (v: number) => formatMoney(v, currency);

  // Quick cash buttons: exact, then the next round bills above the total.
  const quick = useMemo(() => {
    const steps = [2000, 5000, 10000, 20000, 50000, 100000];
    const out = new Set<number>([total]);
    for (const s of steps) out.add(Math.ceil(total / s) * s || s);
    return [...out].filter((v) => v >= total).sort((a, b) => a - b).slice(0, 5);
  }, [total]);

  const change = method === 'cash' && tendered !== null ? tendered - total : 0;
  const canPay = method !== 'cash' || (tendered !== null && tendered >= total);

  async function pay() {
    if (!canPay || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onComplete(method, method === 'cash' ? tendered ?? undefined : undefined);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Payment"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Back</Button>
          <Button disabled={!canPay || busy} onClick={pay}>{busy ? 'Saving…' : 'Complete sale'}</Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void pay();
        }}
      >
        <div className="text-center">
          <p className="text-sm text-slate-500">Amount due</p>
          <p className="text-4xl font-bold">{money(total)}</p>
        </div>
        <Segmented
          value={method}
          onChange={setMethod}
          options={[
            { value: 'cash', label: 'Cash' },
            { value: 'card', label: 'Card' },
            { value: 'ewallet', label: 'E-wallet' },
            { value: 'other', label: 'Other' },
          ]}
        />
        {method === 'cash' ? (
          <>
            <MoneyField label="Cash received" autoFocus value={tendered} onChange={setTendered} onFocus={(e) => e.target.select()} />
            <div className="flex flex-wrap gap-2">
              {quick.map((v) => (
                <Button key={v} variant="secondary" onClick={() => setTendered(v)}>
                  {v === total ? 'Exact' : money(v)}
                </Button>
              ))}
            </div>
            <div className={`rounded-lg p-3 text-center ${change >= 0 ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>
              {change >= 0 ? <>Change: <b className="text-xl">{money(change)}</b></> : <>Short by {money(-change)}</>}
            </div>
          </>
        ) : (
          <p className="text-sm text-slate-500">Record a {method === 'ewallet' ? 'GCash/Maya' : method} payment of {money(total)} taken outside the POS.</p>
        )}
        {error && <Alert>{error}</Alert>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
