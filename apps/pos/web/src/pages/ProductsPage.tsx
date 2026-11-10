import { useMemo, useState, type FormEvent } from 'react';
import { formatMoney, formatQty } from '../../../shared/pricing';
import type { Category, Product, ProductInput, Tax } from '../../../shared/types';
import { Alert, Button, Card, Empty, Field, Modal, MoneyField, PageTitle, SelectField, useToast } from '../components/ui';
import { useApp } from '../lib/app';
import { call, useLoad } from '../lib/pos';

export function ProductsPage() {
  const { store, refresh } = useApp();
  const money = (v: number) => formatMoney(v, store?.currency);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const products = useLoad(() => call('products:list', { includeInactive: true }));
  const categories = useLoad(() => call('categories:list'));
  const taxes = useLoad(() => call('taxes:list'));
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [managingCats, setManagingCats] = useState(false);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (products.data ?? []).filter(
      (p) =>
        (!category || p.categoryId === category) &&
        (!q || p.name.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q) || p.barcode?.includes(q)),
    );
  }, [products.data, search, category]);

  const reloadAll = () => {
    products.reload();
    categories.reload();
    refresh();
  };

  return (
    <>
      <PageTitle
        title="Products"
        actions={
          <>
            <Button variant="secondary" onClick={() => setManagingCats(true)}>Categories</Button>
            <Button onClick={() => setEditing('new')}>+ Add product</Button>
          </>
        }
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <input
          className="min-w-48 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          placeholder="Search name, SKU or barcode"
          aria-label="Search products"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          aria-label="Filter by category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">All categories</option>
          {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      {products.error && <Alert>{products.error}</Alert>}
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 text-left text-xs text-slate-500 uppercase">
            <tr>
              <th className="px-4 py-2.5">Product</th>
              <th className="px-4 py-2.5">Category</th>
              <th className="px-4 py-2.5 text-right">Cost</th>
              <th className="px-4 py-2.5 text-right">Price</th>
              <th className="px-4 py-2.5 text-right">Stock</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visible.map((p) => (
              <tr key={p.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setEditing(p)}>
                <td className="px-4 py-2.5">
                  <span className={`font-medium ${p.isActive ? '' : 'text-slate-400 line-through'}`}>{p.name}</span>
                  <span className="block text-xs text-slate-400">{[p.sku, p.barcode].filter(Boolean).join(' · ') || '—'}</span>
                </td>
                <td className="px-4 py-2.5 text-slate-500">{p.categoryName ?? '—'}</td>
                <td className="px-4 py-2.5 text-right text-slate-500">{money(p.purchasePrice)}</td>
                <td className="px-4 py-2.5 text-right font-medium">{money(p.sellingPrice)}</td>
                <td className={`px-4 py-2.5 text-right ${p.isLowStock ? 'font-semibold text-amber-600' : ''}`}>
                  {p.trackStock ? formatQty(p.stock) : <span className="text-slate-400">not tracked</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {products.data && visible.length === 0 && (
          <Empty>{products.data.length ? 'No products match.' : 'No products yet. Click "Add product" to create your first one.'}</Empty>
        )}
      </Card>

      {editing && (
        <ProductForm
          product={editing === 'new' ? null : editing}
          categories={categories.data ?? []}
          taxes={taxes.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reloadAll();
          }}
        />
      )}
      {managingCats && (
        <CategoriesModal
          categories={categories.data ?? []}
          onChanged={reloadAll}
          onClose={() => setManagingCats(false)}
        />
      )}
    </>
  );
}

function ProductForm({
  product,
  categories,
  taxes,
  onClose,
  onSaved,
}: {
  product: Product | null;
  categories: Category[];
  taxes: Tax[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { pos } = useApp();
  const toast = useToast();
  const [f, setF] = useState({
    name: product?.name ?? '',
    sku: product?.sku ?? '',
    barcode: product?.barcode ?? '',
    categoryId: product?.categoryId ?? '',
    taxId: product ? (product.taxId ?? '') : (taxes.find((t) => t.isDefault)?.id ?? ''),
    trackStock: product?.trackStock ?? true,
    isActive: product?.isActive ?? true,
    lowStock: product ? (product.lowStockThreshold?.toString() ?? '') : String(pos?.lowStockDefault ?? ''),
    initialStock: '',
  });
  const [cost, setCost] = useState<number | null>(product?.purchasePrice ?? null);
  const [price, setPrice] = useState<number | null>(product?.sellingPrice ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  async function save(e: FormEvent) {
    e.preventDefault();
    if (price === null) return setError('Enter a selling price');
    setBusy(true);
    setError(null);
    const input: ProductInput = {
      id: product?.id,
      name: f.name,
      sku: f.sku || null,
      barcode: f.barcode || null,
      categoryId: f.categoryId || null,
      taxId: f.taxId || null,
      purchasePrice: cost ?? 0,
      sellingPrice: price,
      trackStock: f.trackStock,
      isActive: f.isActive,
      lowStockThreshold: f.lowStock === '' ? null : Number(f.lowStock),
      initialStock: f.initialStock === '' ? 0 : Number(f.initialStock),
    };
    try {
      await call('products:save', input);
      toast(product ? 'Product updated' : 'Product added');
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!product || !confirm(`Delete "${product.name}"? Past sales keep their records.`)) return;
    try {
      await call('products:delete', product.id);
      toast('Product deleted');
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal
      wide
      title={product ? 'Edit product' : 'Add product'}
      onClose={onClose}
      footer={
        <>
          {product && <Button variant="danger" className="mr-auto" onClick={remove}>Delete</Button>}
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="product-form" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </>
      }
    >
      <form id="product-form" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        {error && <div className="sm:col-span-2"><Alert>{error}</Alert></div>}
        <Field label="Name" required autoFocus className="sm:col-span-2" value={f.name} onChange={(e) => set('name', e.target.value)} />
        <Field label="SKU" value={f.sku} onChange={(e) => set('sku', e.target.value)} placeholder="Optional" />
        <Field
          label="Barcode"
          value={f.barcode}
          onChange={(e) => set('barcode', e.target.value)}
          // Scanners end with Enter: keep it from submitting the form.
          onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
          placeholder="Scan or type"
          hint="Click here and scan the item"
        />
        <SelectField label="Category" value={f.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
          <option value="">No category</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </SelectField>
        <SelectField label="Tax" value={f.taxId} onChange={(e) => set('taxId', e.target.value)}>
          <option value="">No tax</option>
          {taxes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} {t.rateBps / 100}% {t.isInclusive ? '(included in price)' : '(added on top)'}
            </option>
          ))}
        </SelectField>
        <MoneyField label="Purchase price (cost)" value={cost} onChange={setCost} placeholder="0.00" />
        <MoneyField label="Selling price" required value={price} onChange={setPrice} placeholder="0.00" />
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={f.trackStock} onChange={(e) => set('trackStock', e.target.checked)} />
          Track stock for this product
        </label>
        {f.trackStock && (
          <>
            {!product && (
              <Field label="Starting stock" inputMode="decimal" value={f.initialStock} onChange={(e) => set('initialStock', e.target.value)} placeholder="0" />
            )}
            <Field
              label="Low-stock alert at"
              inputMode="decimal"
              value={f.lowStock}
              onChange={(e) => set('lowStock', e.target.value)}
              hint="Leave empty for no alert"
            />
          </>
        )}
        {product && (
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={f.isActive} onChange={(e) => set('isActive', e.target.checked)} />
            Available for sale
          </label>
        )}
      </form>
    </Modal>
  );
}

function CategoriesModal({ categories, onChanged, onClose }: { categories: Category[]; onChanged: () => void; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    try {
      await call('categories:save', { name });
      setName('');
      setError(null);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function rename(c: Category) {
    const next = prompt('Rename category', c.name);
    if (!next || next === c.name) return;
    try {
      await call('categories:save', { id: c.id, name: next });
      onChanged();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  async function remove(c: Category) {
    if (!confirm(`Delete "${c.name}"? Its ${c.productCount} product(s) will have no category.`)) return;
    await call('categories:delete', c.id);
    onChanged();
  }

  return (
    <Modal title="Categories" onClose={onClose}>
      <form onSubmit={add} className="mb-4 flex gap-2">
        <input className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="New category" aria-label="New category name" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" disabled={!name.trim()}>Add</Button>
      </form>
      {error && <div className="mb-3"><Alert>{error}</Alert></div>}
      <ul className="divide-y divide-slate-100">
        {categories.map((c) => (
          <li key={c.id} className="flex items-center gap-2 py-2 text-sm">
            <span className="flex-1">{c.name} <span className="text-slate-400">· {c.productCount}</span></span>
            <Button variant="ghost" onClick={() => rename(c)}>Rename</Button>
            <Button variant="ghost" className="text-red-600" onClick={() => remove(c)}>Delete</Button>
          </li>
        ))}
        {categories.length === 0 && <Empty>No categories yet</Empty>}
      </ul>
    </Modal>
  );
}
