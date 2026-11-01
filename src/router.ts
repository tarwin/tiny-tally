import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router';
import type { DocType } from './lib/api';

declare module 'vue-router' {
  interface RouteMeta {
    docType?: DocType;
    /** Reports that show either side: sales or expenses. */
    kind?: 'income' | 'expense';
  }
}

/** Invoices, quotes, credit notes and bills share their list, editor and view screens. */
function documentRoutes(docType: DocType, base: string): RouteRecordRaw[] {
  const meta = { docType };
  return [
    { path: base, name: `${docType}-list`, component: () => import('./views/Invoices.vue'), meta },
    { path: `${base}/new`, name: `${docType}-new`, component: () => import('./views/InvoiceEditor.vue'), meta },
    { path: `${base}/:id(\\d+)`, name: `${docType}-view`, component: () => import('./views/InvoiceView.vue'), meta },
    { path: `${base}/:id(\\d+)/edit`, name: `${docType}-edit`, component: () => import('./views/InvoiceEditor.vue'), meta },
  ];
}

// Hash history: built pages load from file://, which has no server to
// rewrite deep links.
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'dashboard', component: () => import('./views/Dashboard.vue') },
    { path: '/transactions', name: 'transactions', component: () => import('./views/Transactions.vue') },
    { path: '/accounts', name: 'accounts', component: () => import('./views/Accounts.vue') },
    { path: '/accounts/:id(\\d+)', name: 'register', component: () => import('./views/Register.vue') },
    { path: '/contacts', name: 'contacts', component: () => import('./views/Contacts.vue') },
    ...documentRoutes('invoice', '/invoices'),
    ...documentRoutes('quote', '/quotes'),
    ...documentRoutes('credit', '/credit-notes'),
    ...documentRoutes('bill', '/bills'),
    { path: '/bills/remittance/:entryId(\\d+)', name: 'remittance', component: () => import('./views/Remittance.vue') },
    { path: '/invoices/templates', name: 'templates', component: () => import('./views/Templates.vue') },
    { path: '/accounts/:id(\\d+)/reconcile', name: 'reconcile', component: () => import('./views/Reconcile.vue') },
    { path: '/contacts/:id(\\d+)/statement', name: 'statement', component: () => import('./views/Statement.vue') },
    { path: '/recurring', name: 'recurring', component: () => import('./views/Recurring.vue') },
    { path: '/items', name: 'items', component: () => import('./views/Items.vue') },
    { path: '/rules', name: 'rules', component: () => import('./views/Rules.vue') },
    { path: '/reports/sales-by-customer', name: 'sales-by-customer', component: () => import('./views/ByContact.vue'), meta: { kind: 'income' } },
    { path: '/reports/expenses-by-supplier', name: 'expenses-by-supplier', component: () => import('./views/ByContact.vue'), meta: { kind: 'expense' } },
    { path: '/reports/payables', name: 'payables', component: () => import('./views/Receivables.vue'), meta: { docType: 'bill' } },
    { path: '/reports/balance-sheet', name: 'balance-sheet', component: () => import('./views/BalanceSheet.vue') },
    { path: '/reports/journal', name: 'journal', component: () => import('./views/Journal.vue') },
    { path: '/journals', name: 'journals', component: () => import('./views/JournalEntries.vue') },
    { path: '/activity', name: 'activity', component: () => import('./views/Activity.vue') },
    { path: '/import', name: 'import', component: () => import('./views/Import.vue') },
    { path: '/reports', name: 'reports', component: () => import('./views/Reports.vue') },
    { path: '/reports/profit-and-loss', name: 'pnl', component: () => import('./views/ProfitLoss.vue') },
    { path: '/reports/tax-return', name: 'tax-return', component: () => import('./views/TaxReturn.vue') },
    { path: '/reports/bas', redirect: '/reports/tax-return' },
    { path: '/reports/sales-tax', name: 'sales-tax', component: () => import('./views/SalesTax.vue') },
    { path: '/reports/schedule-c', name: 'schedule-c', component: () => import('./views/ScheduleC.vue') },
    { path: '/reports/receivables', name: 'receivables', component: () => import('./views/Receivables.vue') },
    { path: '/categories', name: 'categories', component: () => import('./views/Categories.vue') },
    { path: '/settings', name: 'settings', component: () => import('./views/Settings.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});
