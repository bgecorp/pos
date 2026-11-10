/**
 * Types shared by the desktop main process and renderer.
 * Money is always an integer in minor units (centavos). Rates are basis points (1200 = 12%).
 */

export interface Category {
  id: string;
  name: string;
  color: string | null;
  productCount: number;
}

export interface Tax {
  id: string;
  name: string;
  rateBps: number;
  isInclusive: boolean;
  isDefault: boolean;
}

export interface Product {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  categoryId: string | null;
  categoryName: string | null;
  taxId: string | null;
  taxRateBps: number;
  taxInclusive: boolean;
  purchasePrice: number;
  sellingPrice: number;
  trackStock: boolean;
  lowStockThreshold: number | null;
  isActive: boolean;
  stock: number;
  isLowStock: boolean;
}

export interface ProductInput {
  id?: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  categoryId?: string | null;
  taxId?: string | null;
  purchasePrice: number;
  sellingPrice: number;
  trackStock: boolean;
  lowStockThreshold?: number | null;
  isActive?: boolean;
  /** Only used when creating a product */
  initialStock?: number;
}

export interface ProductQuery {
  search?: string;
  categoryId?: string;
  lowStockOnly?: boolean;
  includeInactive?: boolean;
  limit?: number;
}

export type StockReason = 'sale' | 'void' | 'refund' | 'adjustment' | 'receive' | 'count' | 'transfer_in' | 'transfer_out';

export interface StockAdjustment {
  productId: string;
  /** add: receive/increase, remove: write-off/decrease, set: physical count */
  mode: 'add' | 'remove' | 'set';
  quantity: number;
  note?: string;
}

export interface StockMovement {
  id: string;
  productId: string;
  productName: string;
  delta: number;
  after: number;
  reason: StockReason;
  note: string | null;
  referenceId: string | null;
  createdAt: string;
}

export type DiscountType = 'percent' | 'fixed';

export interface Discount {
  id: string;
  name: string;
  type: DiscountType;
  /** bps for percent, minor units for fixed */
  value: number;
}

export interface CartDiscountInput {
  type: DiscountType;
  value: number;
  /** Set when a saved discount preset was used */
  discountId?: string | null;
}

export type PaymentMethod = 'cash' | 'card' | 'ewallet' | 'other';

export interface SaleInput {
  items: { productId: string; quantity: number }[];
  discount?: CartDiscountInput | null;
  payment: { method: PaymentMethod; tendered?: number };
  note?: string;
  /** Staff member who made the sale (Professional: staff management) */
  cashierId?: string | null;
}

export interface SaleSummary {
  id: string;
  receiptNumber: string;
  status: 'completed' | 'voided' | 'refunded';
  total: number;
  itemCount: number;
  paymentMethod: PaymentMethod;
  cashierName: string | null;
  createdAt: string;
}

export interface SaleItem {
  id: string;
  productId: string | null;
  name: string;
  sku: string | null;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  taxAmount: number;
  lineTotal: number;
}

export interface SaleDetail extends SaleSummary {
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  note: string | null;
  items: SaleItem[];
  payment: { method: PaymentMethod; amount: number; tendered: number | null; change: number };
}

export interface SalesQuery {
  from?: string; // YYYY-MM-DD (local)
  to?: string; // YYYY-MM-DD (local, inclusive)
  search?: string;
  limit?: number;
  offset?: number;
}

export interface SalesPage {
  sales: SaleSummary[];
  total: number;
  /** Set when the Free plan's history window cut the requested range */
  limitedFrom: string | null;
}

export interface DateRange {
  from: string; // YYYY-MM-DD (local)
  to: string; // YYYY-MM-DD (local, inclusive)
}

export interface SalesSummaryReport {
  salesCount: number;
  voidedCount: number;
  grossSales: number;
  discounts: number;
  netSales: number;
  taxes: number;
  totalCollected: number;
  cost: number;
  grossProfit: number;
  averageSale: number;
  limitedFrom: string | null;
}

export interface DailySalesRow {
  date: string;
  salesCount: number;
  netSales: number;
  totalCollected: number;
}

export interface ProductSalesRow {
  productId: string | null;
  name: string;
  quantity: number;
  revenue: number;
  profit: number;
}

export interface StoreSettings {
  storeName: string;
  address: string | null;
  phone: string | null;
  receiptHeader: string | null;
  receiptFooter: string | null;
  currency: string;
  branchName: string;
  branchCode: string;
}

export interface PosSettings {
  receiptWidth: 58 | 80;
  autoPrint: boolean;
  lowStockDefault: number;
}

export interface AppInfo {
  version: string;
  plan: 'FREE' | 'PROFESSIONAL';
  dbPath: string;
  schemaVersion: number;
  installId: string;
  lowStockCount: number;
}

/** Snapshot stored with each sale so reprints show exactly what was sold. */
export interface ReceiptContent {
  storeName: string;
  address: string | null;
  phone: string | null;
  header: string | null;
  footer: string | null;
  branchName: string;
  currency: string;
  receiptNumber: string;
  cashier?: string | null;
  createdAt: string;
  items: { name: string; quantity: number; unitPrice: number; lineTotal: number }[];
  subtotal: number;
  discountTotal: number;
  taxes: { name: string; amount: number; inclusive: boolean }[];
  total: number;
  payment: { method: PaymentMethod; tendered: number | null; change: number };
}

/** Envelope every IPC call resolves to (errors are values, not rejections). */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface LicenseStatus {
  /** Connected to a website account (or a legacy license key) */
  activated: boolean;
  /** Signed in to a website account on this POS */
  signedIn: boolean;
  account: { email: string; fullName: string } | null;
  /** End of Professional from the last check (null = none / no end date) */
  professionalUntil: string | null;
  priceMonthly: number | null;
  currency: string;
  /** Masked, e.g. POS-••••-••••-7KQ2 */
  licenseKey: string | null;
  /** Plan in effect right now (FREE unless a verified, unexpired PROFESSIONAL token is cached) */
  plan: 'FREE' | 'PROFESSIONAL';
  storeName: string | null;
  /** When the cached token stops being valid without a refresh */
  expiresAt: string | null;
  lastVerifiedAt: string | null;
  /** Last background refresh problem, e.g. no internet */
  lastError: string | null;
}

// ---------------------------------------------------------------------------
// Professional features
// ---------------------------------------------------------------------------

export type StaffRole = 'owner' | 'manager' | 'cashier';

export interface StaffMember {
  id: string;
  name: string;
  role: StaffRole;
  isActive: boolean;
}

export interface StaffInput {
  id?: string;
  name: string;
  role: StaffRole;
  /** 4-6 digits. Required when creating; omit to keep the current PIN. */
  pin?: string;
  isActive?: boolean;
}

export interface CashierRow {
  cashierId: string | null;
  name: string;
  salesCount: number;
  total: number;
  averageSale: number;
}

export interface AdvancedReport {
  byCashier: CashierRow[];
  /** 0-23, local time */
  byHour: { hour: number; salesCount: number; total: number }[];
  /** 0 = Sunday */
  byWeekday: { weekday: number; salesCount: number; total: number }[];
  byPayment: { method: PaymentMethod; salesCount: number; total: number }[];
  byCategory: { category: string; quantity: number; revenue: number; profit: number }[];
}

export interface InventoryItemAnalytics {
  productId: string;
  name: string;
  stock: number;
  soldLast30: number;
  /** null when nothing sold in 30 days */
  daysLeft: number | null;
  lastSoldAt: string | null;
  stockValueCost: number;
}

export interface InventoryAnalytics {
  stockValueCost: number;
  stockValueRetail: number;
  trackedProducts: number;
  runningOut: InventoryItemAnalytics[];
  slowMovers: InventoryItemAnalytics[];
  items: InventoryItemAnalytics[];
}

export interface Insight {
  id: string;
  kind: 'good' | 'warn' | 'info';
  title: string;
  detail: string;
}

export interface BranchOption {
  remoteId: string;
  name: string;
  code: string;
  isCurrent: boolean;
}
