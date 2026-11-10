/**
 * Types shared between the website, the API and the desktop POS.
 * Keep this package dependency-free: types and tiny constants only.
 */

export type PlanCode = 'FREE' | 'PROFESSIONAL';

export type SubscriptionStatus = 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED';

export type LicenseStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED';

export type UserRole = 'USER' | 'ADMIN';

export type UpgradeCodeStatus = 'UNUSED' | 'REDEEMED' | 'REVOKED';

/** Payload inside the signed license token issued by the API and cached by the POS. */
export interface LicenseTokenPayload {
  /** License id (PostgreSQL licenses.id) */
  lid: string;
  /** Store id (PostgreSQL stores.id) */
  sid: string;
  /** Account id (PostgreSQL users.id) */
  uid: string;
  plan: PlanCode;
  /** install_id of the POS this token was issued to */
  iid: string;
  /** Issued-at, seconds since epoch */
  iat: number;
  /** Expiry, seconds since epoch. The POS falls back to FREE after this. */
  exp: number;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  service: string;
  version: string;
  database: 'up' | 'down';
  time: string;
}

/** Status the desktop main process reports to the renderer over IPC. */
export interface LocalDbStatus {
  path: string;
  schemaVersion: number;
  tables: string[];
}

// ---------------------------------------------------------------------------
// Website <-> API contracts
// ---------------------------------------------------------------------------

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  createdAt: string;
  /** Effective plan right now (derived from the active subscription; FREE if none). */
  plan: PlanCode;
  features: string[];
  role: UserRole;
}

export interface AuthResponse {
  accessToken: string;
  user: AuthUser;
}

export interface PlanDto {
  code: PlanCode;
  name: string;
  /** Minor units (centavos) */
  priceMonthly: number;
  currency: string;
  features: string[];
  limits: { stores: number | null; salesHistoryDays: number | null };
}

export interface BranchDto {
  id: string;
  name: string;
  code: string;
  createdAt: string;
}

export interface StoreDto {
  id: string;
  name: string;
  address: string | null;
  currency: string;
  timezone: string;
  createdAt: string;
  updatedAt: string;
  branches: BranchDto[];
}

/** Error body returned by the API (NestJS default shape). */
export interface ApiError {
  statusCode: number;
  message: string | string[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Subscriptions, payments, upgrade codes (Phase 4)
// ---------------------------------------------------------------------------

export interface SubscriptionDto {
  id: string;
  planCode: PlanCode;
  status: SubscriptionStatus;
  currentPeriodStart: string;
  currentPeriodEnd: string | null;
  /** true when this subscription grants its plan right now */
  isCurrent: boolean;
}

export interface PaymentDto {
  id: string;
  provider: string;
  reference: string | null;
  /** Minor units (centavos) */
  amount: number;
  currency: string;
  status: 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';
  paidAt: string | null;
  createdAt: string;
  description: string;
}

export interface SubscriptionOverview {
  plan: PlanCode;
  /** End of the current Professional period, if any */
  professionalUntil: string | null;
  subscriptions: SubscriptionDto[];
  payments: PaymentDto[];
}

export interface RedeemResult {
  months: number;
  professionalUntil: string;
  user: AuthUser;
}

export interface UpgradeCodeDto {
  id: string;
  code: string;
  months: number;
  status: UpgradeCodeStatus;
  note: string | null;
  createdAt: string;
  redeemedAt: string | null;
  redeemedBy: { id: string; email: string; fullName: string } | null;
}

export interface AdminOverview {
  customers: number;
  newCustomers30d: number;
  activeProfessional: number;
  revenueTotal: number;
  revenue30d: number;
  unusedCodes: number;
  currency: string;
}

export interface AdminCustomer {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  createdAt: string;
  plan: PlanCode;
  professionalUntil: string | null;
  stores: number;
  totalPaid: number;
}

export interface AdminPayment extends PaymentDto {
  customer: { id: string; email: string; fullName: string };
}

// ---------------------------------------------------------------------------
// Licensing (Phase 5)
// ---------------------------------------------------------------------------

export interface LicenseActivateRequest {
  licenseKey: string;
  /** Random id the POS generates on first run (no hardware fingerprint) */
  installId: string;
  deviceName?: string;
  appVersion?: string;
}

export interface LicenseActivateResponse {
  /** base64url(JSON payload) + "." + base64url(Ed25519 signature) */
  token: string;
  plan: PlanCode;
  expiresAt: string;
  store: { id: string; name: string };
  /** The store's branches on the website; the POS picks which one it is */
  branches: { id: string; name: string; code: string }[];
}

export interface LicenseActivationDto {
  id: string;
  deviceName: string | null;
  appVersion: string | null;
  activatedAt: string;
  lastSeenAt: string;
}

export interface StoreLicenseDto {
  licenseKey: string;
  status: LicenseStatus;
  createdAt: string;
  activations: LicenseActivationDto[];
}

// ---------------------------------------------------------------------------
// POS account link (no license key: the website signs the POS in)
// ---------------------------------------------------------------------------

export interface PosLinkCode {
  /** Short-lived (5 min) one-time code handed to the POS in the redirect URL */
  code: string;
  expiresAt: string;
}

export interface PosConnectRequest {
  linkCode: string;
  installId: string;
  deviceName?: string;
  appVersion?: string;
}

export interface PosConnectResponse extends LicenseActivateResponse {
  /** Long-lived credential the POS uses for refresh/subscribe. Stored only on the shop PC. */
  deviceToken: string;
  account: { email: string; fullName: string };
  /** End of Professional, if any (null = no end date) */
  professionalUntil: string | null;
  priceMonthly: number;
  currency: string;
}
