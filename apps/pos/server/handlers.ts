import type { AppInfo } from '../shared/types';
import { getStatus, type Db } from './db/database';
import * as analytics from './services/analytics';
import * as catalog from './services/catalog';
import { currentPlan } from './services/context';
import { licensePublicKey } from './license-public-key';
import * as inventory from './services/inventory';
import * as license from './services/license';
import * as reports from './services/reports';
import * as sales from './services/sales';
import * as settings from './services/settings';
import * as staff from './services/staff';

/**
 * The complete API the POS screens can call: one named method per operation.
 * The HTTP server exposes each as POST /rpc/<name>; a future Electron shell can
 * register the very same map as IPC channels. Nothing outside this list is reachable.
 */
export function createHandlers(db: Db, meta: { version: string; apiUrl?: string; fetch?: typeof fetch }) {
  const licenseDeps = (): license.LicenseDeps => ({
    apiUrl: meta.apiUrl ?? 'http://localhost:3000/api',
    publicKey: licensePublicKey(),
    appVersion: meta.version,
    fetch: meta.fetch,
  });
  return {
    'license:status': () => license.getLicenseStatus(db, licenseDeps()),
    'license:activate': (licenseKey: string) => license.activateLicense(db, licenseKey, licenseDeps()),
    'license:refresh': () => license.refreshLicense(db, licenseDeps()),
    'license:deactivate': () => license.deactivateLicense(db, licenseDeps()),
    'account:connect': (linkCode: string) => license.connectAccount(db, linkCode, licenseDeps()),
    'account:subscribe': () => license.subscribePro(db, licenseDeps()),
    'account:cancel': () => license.cancelPro(db, licenseDeps()),
    'branch:options': () => license.branchOptions(db),
    'branch:select': (remoteId: string) => license.selectBranch(db, remoteId),

    // Professional (each operation checks the plan on the server)
    'staff:list': (opts?: { includeInactive?: boolean }) => staff.listStaff(db, opts),
    'staff:save': (input: Parameters<typeof staff.saveStaff>[1]) => staff.saveStaff(db, input),
    'staff:login': (staffId: string, pin: string) => staff.staffLogin(db, staffId, pin),
    'reports:advanced': (range: Parameters<typeof analytics.advancedReport>[1]) => analytics.advancedReport(db, range),
    'reports:inventory': () => analytics.inventoryAnalytics(db),
    'insights:list': () => analytics.insights(db),

    'app:info': (): AppInfo => {
      const status = getStatus(db);
      return {
        version: meta.version,
        plan: currentPlan(db),
        dbPath: status.path,
        schemaVersion: status.schemaVersion,
        installId: settings.getSetting(db, 'install_id') ?? '',
        lowStockCount: inventory.lowStockCount(db),
      };
    },

    'categories:list': () => catalog.listCategories(db),
    'categories:save': (input: Parameters<typeof catalog.saveCategory>[1]) => catalog.saveCategory(db, input),
    'categories:delete': (id: string) => catalog.deleteCategory(db, id),

    'products:list': (query?: Parameters<typeof catalog.listProducts>[1]) => catalog.listProducts(db, query),
    'products:get': (id: string) => catalog.getProduct(db, id),
    'products:findByCode': (code: string) => catalog.findProductByCode(db, code),
    'products:save': (input: Parameters<typeof catalog.saveProduct>[1]) => catalog.saveProduct(db, input),
    'products:delete': (id: string) => catalog.deleteProduct(db, id),

    'inventory:adjust': (input: Parameters<typeof inventory.adjustStock>[1]) => inventory.adjustStock(db, input),
    'inventory:movements': (query?: Parameters<typeof inventory.listMovements>[1]) => inventory.listMovements(db, query),

    'taxes:list': () => settings.listTaxes(db),
    'taxes:save': (input: Parameters<typeof settings.saveTax>[1]) => settings.saveTax(db, input),
    'taxes:delete': (id: string) => settings.deleteTax(db, id),

    'discounts:list': () => settings.listDiscounts(db),
    'discounts:save': (input: Parameters<typeof settings.saveDiscount>[1]) => settings.saveDiscount(db, input),
    'discounts:delete': (id: string) => settings.deleteDiscount(db, id),

    'sales:create': (input: Parameters<typeof sales.createSale>[1]) => sales.createSale(db, input),
    'sales:list': (query?: Parameters<typeof sales.listSales>[1]) => sales.listSales(db, query),
    'sales:get': (id: string) => sales.getSale(db, id),
    'sales:void': (id: string, reason?: string) => sales.voidSale(db, id, reason),
    'receipts:html': (saleId: string, opts?: { markPrinted?: boolean }) => sales.getReceiptHtml(db, saleId, opts),

    'reports:summary': (range: Parameters<typeof reports.salesSummary>[1]) => reports.salesSummary(db, range),
    'reports:daily': (range: Parameters<typeof reports.dailySales>[1]) => reports.dailySales(db, range),
    'reports:products': (range: Parameters<typeof reports.productSales>[1]) => reports.productSales(db, range),

    'settings:getStore': () => settings.getStoreSettings(db),
    'settings:saveStore': (input: Parameters<typeof settings.saveStoreSettings>[1]) => settings.saveStoreSettings(db, input),
    'settings:getPos': () => settings.getPosSettings(db),
    'settings:savePos': (input: Parameters<typeof settings.savePosSettings>[1]) => settings.savePosSettings(db, input),
  };
}

export type Handlers = ReturnType<typeof createHandlers>;
export type Channel = keyof Handlers;
