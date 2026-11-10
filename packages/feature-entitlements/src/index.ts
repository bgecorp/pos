import type { PlanCode } from '@pos/shared-types';

/**
 * Central feature entitlement table. Every plan-gated check in the website,
 * API and desktop POS goes through `hasFeature` so plan rules live in one place.
 */
export const FEATURES = {
  // Free
  PRODUCTS: 'products',
  BASIC_INVENTORY: 'basic_inventory',
  BARCODE_SCANNING: 'barcode_scanning',
  RECEIPT_PRINTING: 'receipt_printing',
  CASHIER: 'cashier',
  OFFLINE_MODE: 'offline_mode',
  BASIC_REPORTS: 'basic_reports',
  // Professional
  UNLIMITED_SALES_HISTORY: 'unlimited_sales_history',
  EMPLOYEE_MANAGEMENT: 'employee_management',
  ADVANCED_INVENTORY: 'advanced_inventory',
  MULTI_BRANCH: 'multi_branch',
  ADVANCED_REPORTS: 'advanced_reports',
  SALES_ANALYTICS: 'sales_analytics',
  AI_INSIGHTS: 'ai_insights',
} as const;

export type Feature = (typeof FEATURES)[keyof typeof FEATURES];

const FREE_FEATURES: readonly Feature[] = [
  FEATURES.PRODUCTS,
  FEATURES.BASIC_INVENTORY,
  FEATURES.BARCODE_SCANNING,
  FEATURES.RECEIPT_PRINTING,
  FEATURES.CASHIER,
  FEATURES.OFFLINE_MODE,
  FEATURES.BASIC_REPORTS,
];

const PROFESSIONAL_FEATURES: readonly Feature[] = [
  ...FREE_FEATURES,
  FEATURES.UNLIMITED_SALES_HISTORY,
  FEATURES.EMPLOYEE_MANAGEMENT,
  FEATURES.ADVANCED_INVENTORY,
  FEATURES.MULTI_BRANCH,
  FEATURES.ADVANCED_REPORTS,
  FEATURES.SALES_ANALYTICS,
  FEATURES.AI_INSIGHTS,
];

export const PLAN_FEATURES: Record<PlanCode, readonly Feature[]> = {
  FREE: FREE_FEATURES,
  PROFESSIONAL: PROFESSIONAL_FEATURES,
};

/** Numeric limits per plan. `null` means unlimited. */
export const PLAN_LIMITS: Record<PlanCode, { stores: number | null; salesHistoryDays: number | null }> = {
  FREE: { stores: 1, salesHistoryDays: 90 },
  PROFESSIONAL: { stores: null, salesHistoryDays: null },
};

export function hasFeature(plan: PlanCode | null | undefined, feature: Feature): boolean {
  return PLAN_FEATURES[plan ?? 'FREE'].includes(feature);
}

export function featuresFor(plan: PlanCode | null | undefined): readonly Feature[] {
  return PLAN_FEATURES[plan ?? 'FREE'];
}
