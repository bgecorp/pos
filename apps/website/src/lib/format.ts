export const FEATURE_LABELS: Record<string, string> = {
  products: 'Unlimited products',
  basic_inventory: 'Basic inventory',
  barcode_scanning: 'Barcode scanning',
  receipt_printing: 'Receipt printing',
  cashier: 'Cashier interface',
  offline_mode: 'Works offline',
  basic_reports: 'Basic sales reports',
  unlimited_sales_history: 'Unlimited sales history',
  employee_management: 'Employee management',
  advanced_inventory: 'Advanced inventory',
  multi_branch: 'Multiple branches',
  advanced_reports: 'Advanced reports',
  sales_analytics: 'Sales analytics',
  ai_insights: 'AI business insights',
};

/** Formats minor units (centavos) as currency, e.g. 49900 -> ₱499.00 */
export function money(minor: number, currency = 'PHP'): string {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency }).format(minor / 100);
}

export function date(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
