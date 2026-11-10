import { useMemo, useState, type FormEvent } from 'react';
import { formatQty } from '../../../shared/pricing';
import type { Product, StockAdjustment } from '../../../shared/types';
import { Alert, Button, Card, Empty, Field, Modal, PageTitle, Segmented, useToast } from '../components/ui';
import { useApp } from '../lib/app';
import { call, dateTime, useLoad } from '../lib/pos';

const REASON_LABEL: Record<string, string> = {
  sale: 'Sale',
  void: 'Sale voided',
  refund: 'Refund',
  adjustment: 'Removed',
  receive: 'Received',
  count: 'Stock count',
  transfer_in: 'Transfer in',
  transfer_out: 'Transfer out',
};

export function InventoryPage() {
  const { refresh } = useApp();
  const [tab, setTab] = useState<'stock' | 'history'>('stock');
  const [lowOnly, setLowOnly] = useState(false);
  const [search, setSearch] = useState('');
  const products = useLoad(() => call('products:list', {}));
  const movements = useLoad(() => call('inventory:movements', { limit: 200 }), [tab]);
  const [adjusting, setAdjusting] = useState<Product | null>(null);

  const tracked = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (products.data ?? []).filter(
      (p) => p.trackStock && (!lowOnly || p.isLowStock) && (!q || p.name.toLowerCase().includes(q) || p.barcode?.includes(q)),
    );
  }, [products.data, lowOnly, search]);
  const lowCount = (products.data ?? []).filter((p) => p.isLowStock).length;

  return (
    <>
      <PageTitle
        title="Inventory"
        actions={<Segmented value={tab} onChange={setTab} options={[{ value: 'stock', label: 'Stock levels' }, { value: 'history', label: 'History' }]} />}
      />
      {tab === 'stock' && (
        <>
          {lowCount > 0 && (
            <div className="mb-3">
              <Alert kind="warn">
                {lowCount} product{lowCount === 1 ? ' is' : 's are'} low on stock.{' '}
                {!lowOnly && <button className="font-medium underline" onClick={() => setLowOnly(true)}>Show them</button>}
              </Alert>
            </div>
          )}
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <input className="min-w-48 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" placeholder="Search products" aria-label="Search products" value={search} onChange={(e) => setSearch(e.target.value)} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> Low stock only
            </label>
          </div>
          {products.error && <Alert>{products.error}</Alert>}
          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 text-left text-xs text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-2.5">Product</th>
                  <th className="px-4 py-2.5 text-right">In stock</th>
                  <th className="px-4 py-2.5 text-right">Alert at</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tracked.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-2.5 font-medium">{p.name}</td>
                    <td className={`px-4 py-2.5 text-right ${p.stock <= 0 ? 'font-semibold text-red-600' : p.isLowStock ? 'font-semibold text-amber-600' : ''}`}>
                      {formatQty(p.stock)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-500">{p.lowStockThreshold ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right">
                      <Button variant="secondary" onClick={() => setAdjusting(p)}>Adjust</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {products.data && tracked.length === 0 && <Empty>{lowOnly ? 'Nothing is low on stock.' : 'No products with stock tracking.'}</Empty>}
          </Card>
        </>
      )}

      {tab === 'history' && (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 text-left text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-2.5">When</th>
                <th className="px-4 py-2.5">Product</th>
                <th className="px-4 py-2.5">Reason</th>
                <th className="px-4 py-2.5 text-right">Change</th>
                <th className="px-4 py-2.5 text-right">After</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {movements.data?.map((m) => (
                <tr key={m.id}>
                  <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">{dateTime(m.createdAt)}</td>
                  <td className="px-4 py-2.5">{m.productName}</td>
                  <td className="px-4 py-2.5">
                    {REASON_LABEL[m.reason] ?? m.reason}
                    {m.note && <span className="block text-xs text-slate-400">{m.note}</span>}
                  </td>
                  <td className={`px-4 py-2.5 text-right font-medium ${m.delta < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                    {m.delta > 0 ? '+' : ''}{formatQty(m.delta)}
                  </td>
                  <td className="px-4 py-2.5 text-right">{formatQty(m.after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {movements.data?.length === 0 && <Empty>No stock changes yet</Empty>}
        </Card>
      )}

      {adjusting && (
        <AdjustModal
          product={adjusting}
          onClose={() => setAdjusting(null)}
          onDone={() => {
            setAdjusting(null);
            products.reload();
            movements.reload();
            refresh();
          }}
        />
      )}
    </>
  );
}

function AdjustModal({ product, onClose, onDone }: { product: Product; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [mode, setMode] = useState<StockAdjustment['mode']>('add');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const n = Number(qty);
  const preview = qty === '' || Number.isNaN(n) ? null : mode === 'add' ? product.stock + n : mode === 'remove' ? product.stock - n : n;

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await call('inventory:adjust', { productId: product.id, mode, quantity: n, note: note || undefined });
      toast(`${product.name}: stock is now ${formatQty(r.stock)}`);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal
      title={`Adjust stock · ${product.name}`}
      onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="adjust-form" disabled={preview === null}>Save</Button></>}
    >
      <form id="adjust-form" onSubmit={submit} className="space-y-4">
        <p className="text-sm text-slate-500">Currently in stock: <b className="text-slate-900">{formatQty(product.stock)}</b></p>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[{ value: 'add', label: 'Receive' }, { value: 'remove', label: 'Remove' }, { value: 'set', label: 'Count' }]}
        />
        <Field
          label={mode === 'add' ? 'Quantity received' : mode === 'remove' ? 'Quantity removed (damaged, expired, lost…)' : 'Actual quantity counted'}
          autoFocus
          required
          inputMode="decimal"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
        />
        <Field label="Note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional, e.g. supplier delivery" />
        {preview !== null && <p className="text-sm">New stock: <b>{formatQty(Math.round(preview * 1000) / 1000)}</b></p>}
        {error && <Alert>{error}</Alert>}
      </form>
    </Modal>
  );
}
