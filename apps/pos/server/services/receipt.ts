import { formatMoney, formatQty } from '../../shared/pricing';
import type { ReceiptContent } from '../../shared/types';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const lines = (s: string | null) => (s ? s.split(/\r?\n/).map(esc).join('<br>') : '');

const METHOD_LABEL = { cash: 'Cash', card: 'Card', ewallet: 'E-wallet', other: 'Other' } as const;

/**
 * Self-contained receipt document for thermal printers (58/80 mm). The browser prints it
 * from a hidden iframe; the same HTML is shown as the on-screen preview.
 */
export function renderReceiptHtml(r: ReceiptContent, widthMm: 58 | 80, opts: { voided?: boolean } = {}): string {
  const m = (v: number) => esc(formatMoney(v, r.currency));
  const date = new Date(r.createdAt).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
  const row = (left: string, right: string, cls = '') => `<div class="row ${cls}"><span>${left}</span><span>${right}</span></div>`;

  return `<!doctype html><html><head><meta charset="utf-8"><title>Receipt ${esc(r.receiptNumber)}</title><style>
@page { size: ${widthMm}mm auto; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; padding: 4mm 3mm; width: ${widthMm}mm; font: ${widthMm === 58 ? 11 : 12}px/1.35 ui-monospace, Consolas, monospace; color: #000; background: #fff; }
.c { text-align: center; } .b { font-weight: 700; } .big { font-size: 1.25em; }
.row { display: flex; justify-content: space-between; gap: 6px; }
.row span:last-child { white-space: nowrap; }
hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
.item { margin-bottom: 3px; } .muted { color: #333; font-size: .92em; }
.void { border: 2px solid #000; text-align: center; font-weight: 700; padding: 2px; margin-bottom: 6px; }
</style></head><body>
${opts.voided ? '<div class="void">VOIDED</div>' : ''}
<div class="c b big">${esc(r.storeName)}</div>
${r.address ? `<div class="c">${lines(r.address)}</div>` : ''}
${r.phone ? `<div class="c">${esc(r.phone)}</div>` : ''}
${r.header ? `<div class="c" style="margin-top:4px">${lines(r.header)}</div>` : ''}
<hr>
${row(`#${esc(r.receiptNumber)}`, esc(r.branchName))}
<div>${esc(date)}</div>
${r.cashier ? `<div>Cashier: ${esc(r.cashier)}</div>` : ''}
<hr>
${r.items
  .map(
    (it) => `<div class="item"><div>${esc(it.name)}</div>${row(
      `<span class="muted">${esc(formatQty(it.quantity))} × ${m(it.unitPrice)}</span>`,
      m(it.lineTotal),
    )}</div>`,
  )
  .join('')}
<hr>
${row('Subtotal', m(r.subtotal))}
${r.discountTotal ? row('Discount', '-' + m(r.discountTotal)) : ''}
${r.taxes.map((t) => row(`${esc(t.name)}${t.inclusive ? ' (incl.)' : ''}`, m(t.amount))).join('')}
${row('TOTAL', m(r.total), 'b big')}
<hr>
${row(METHOD_LABEL[r.payment.method], m(r.payment.tendered ?? r.total))}
${r.payment.method === 'cash' ? row('Change', m(r.payment.change)) : ''}
<hr>
<div class="c">${r.footer ? lines(r.footer) : 'Thank you!'}</div>
</body></html>`;
}
