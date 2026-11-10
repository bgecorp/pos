import { useState } from 'react';
import { formatMoney, formatQty } from '../../../shared/pricing';
import { ReceiptPreview } from '../components/ReceiptPreview';
import { Alert, Button, Card, Empty, Modal, PageTitle, useToast } from '../components/ui';
import { useApp } from '../lib/app';
import { call, dateTime, presetRange, printHtml, RANGE_LABELS, useLoad, type RangePreset } from '../lib/pos';

const METHOD = { cash: 'Cash', card: 'Card', ewallet: 'E-wallet', other: 'Other' } as const;

export function SalesPage() {
  const { store } = useApp();
  const money = (v: number) => formatMoney(v, store?.currency);
  const [preset, setPreset] = useState<RangePreset>('today');
  const [search, setSearch] = useState('');
  const sales = useLoad(() => call('sales:list', { ...presetRange(preset), search: search || undefined, limit: 200 }), [preset, search]);
  const [openId, setOpenId] = useState<string | null>(null);
  const showCashier = sales.data?.sales.some((x) => x.cashierName) ?? false;

  return (
    <>
      <PageTitle
        title="Sales history"
        actions={
          <>
            <input
              className="w-40 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              placeholder="Receipt #"
              aria-label="Search receipt number"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" aria-label="Date range" value={preset} onChange={(e) => setPreset(e.target.value as RangePreset)}>
              {Object.entries(RANGE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </>
        }
      />
      {sales.error && <Alert>{sales.error}</Alert>}
      {sales.data?.limitedFrom && (
        <div className="mb-3">
          <Alert kind="info">The Free plan shows sales from {sales.data.limitedFrom} onward. Older sales are kept and appear with Professional.</Alert>
        </div>
      )}
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 text-left text-xs text-slate-500 uppercase">
            <tr>
              <th className="px-4 py-2.5">Receipt</th>
              <th className="px-4 py-2.5">Time</th>
              <th className="px-4 py-2.5 text-right">Items</th>
              {showCashier && <th className="px-4 py-2.5">Cashier</th>}
              <th className="px-4 py-2.5">Payment</th>
              <th className="px-4 py-2.5 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sales.data?.sales.map((s) => (
              <tr key={s.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpenId(s.id)}>
                <td className="px-4 py-2.5 font-medium">
                  {s.receiptNumber}
                  {s.status === 'voided' && <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">Voided</span>}
                </td>
                <td className="px-4 py-2.5 text-slate-500">{dateTime(s.createdAt)}</td>
                <td className="px-4 py-2.5 text-right">{formatQty(s.itemCount)}</td>
                {showCashier && <td className="px-4 py-2.5">{s.cashierName ?? '—'}</td>}
                <td className="px-4 py-2.5">{METHOD[s.paymentMethod]}</td>
                <td className={`px-4 py-2.5 text-right font-medium ${s.status === 'voided' ? 'text-slate-400 line-through' : ''}`}>{money(s.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {sales.data?.sales.length === 0 && <Empty>No sales in this period</Empty>}
        {sales.data && sales.data.total > sales.data.sales.length && (
          <p className="px-4 py-2 text-xs text-slate-400">Showing the latest {sales.data.sales.length} of {sales.data.total} sales.</p>
        )}
      </Card>
      {openId && <SaleModal saleId={openId} onClose={() => setOpenId(null)} onChanged={sales.reload} />}
    </>
  );
}

function SaleModal({ saleId, onClose, onChanged }: { saleId: string; onClose: () => void; onChanged: () => void }) {
  const { store, refresh } = useApp();
  const toast = useToast();
  const money = (v: number) => formatMoney(v, store?.currency);
  const sale = useLoad(() => call('sales:get', saleId), [saleId]);
  const receipt = useLoad(() => call('receipts:html', saleId), [saleId]);
  const [error, setError] = useState<string | null>(null);

  async function voidSale() {
    const reason = prompt('Void this sale and return its items to stock?\nReason (optional):');
    if (reason === null) return;
    try {
      await call('sales:void', saleId, reason || undefined);
      toast('Sale voided. Stock restored.');
      sale.reload();
      receipt.reload();
      onChanged();
      refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const s = sale.data;
  return (
    <Modal
      wide
      title={s ? `Receipt ${s.receiptNumber}` : 'Sale'}
      onClose={onClose}
      footer={
        s && (
          <>
            {s.status === 'completed' && <Button variant="danger" className="mr-auto" onClick={voidSale}>Void sale</Button>}
            <Button variant="secondary" onClick={() => call('receipts:html', saleId, { markPrinted: true }).then(printHtml)}>Reprint</Button>
            <Button onClick={onClose}>Close</Button>
          </>
        )
      }
    >
      {(error || sale.error) && <div className="mb-3"><Alert>{error ?? sale.error}</Alert></div>}
      {s && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3 text-sm">
            <p className="text-slate-500">
              {new Date(s.createdAt).toLocaleString()} · {METHOD[s.payment.method]}
              {s.cashierName && <> · Cashier: {s.cashierName}</>}
              {s.status === 'voided' && <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">Voided</span>}
            </p>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {s.items.map((it) => (
                <li key={it.id} className="flex justify-between gap-2 px-3 py-2">
                  <span>{it.name} <span className="text-slate-400">× {formatQty(it.quantity)}</span></span>
                  <span>{money(Math.round(it.unitPrice * it.quantity))}</span>
                </li>
              ))}
            </ul>
            <dl className="space-y-1">
              <div className="flex justify-between"><dt>Subtotal</dt><dd>{money(s.subtotal)}</dd></div>
              {s.discountTotal > 0 && <div className="flex justify-between"><dt>Discount</dt><dd>-{money(s.discountTotal)}</dd></div>}
              {s.taxTotal > 0 && <div className="flex justify-between text-slate-500"><dt>Tax</dt><dd>{money(s.taxTotal)}</dd></div>}
              <div className="flex justify-between text-base font-bold"><dt>Total</dt><dd>{money(s.total)}</dd></div>
              {s.payment.method === 'cash' && (
                <>
                  <div className="flex justify-between text-slate-500"><dt>Cash</dt><dd>{money(s.payment.tendered ?? 0)}</dd></div>
                  <div className="flex justify-between text-slate-500"><dt>Change</dt><dd>{money(s.payment.change)}</dd></div>
                </>
              )}
            </dl>
            {s.note && <p className="text-slate-500">{s.note}</p>}
          </div>
          {receipt.data && <ReceiptPreview html={receipt.data} />}
        </div>
      )}
    </Modal>
  );
}
