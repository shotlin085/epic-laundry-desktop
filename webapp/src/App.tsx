import { lazy, Suspense, type ReactNode } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { LaundryShell } from "@/components/laundry/LaundryShell";
import { AuthGate } from "@/components/auth/AuthGate";
import { canUseUi, type UiPermission } from "@/components/laundry/LaundryShell";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";

// Operational pages are independently loaded. A counter opening the dashboard
// should not pay the startup cost of reports, statutory controls, imports, or
// print-centre code that they may never visit in that session.
const LaundryDashboard = lazy(() => import("@/pages/laundry/LaundryDashboard"));
const LaundryBooking = lazy(() => import("@/pages/laundry/LaundryBooking"));
const LaundryOrders = lazy(() => import("@/pages/laundry/LaundryOrders"));
const LaundryCatalogue = lazy(() => import("@/pages/laundry/LaundryCatalogue"));
const LaundryExpenses = lazy(() => import("@/pages/laundry/LaundryExpenses"));
const LaundryReports = lazy(() => import("@/pages/laundry/LaundryReports"));
const LaundryImport = lazy(() => import("@/pages/laundry/LaundryImport"));
const LaundryCatalogueImport = lazy(() => import("@/pages/laundry/LaundryCatalogueImport"));
const LaundryDispatch = lazy(() => import("@/pages/laundry/LaundryDispatch"));
const LaundrySettings = lazy(() => import("@/pages/laundry/LaundrySettings"));
const LaundryCustomers = lazy(() => import("@/pages/laundry/LaundryCustomers"));
const LaundryPackages = lazy(() => import("@/pages/laundry/LaundryPackages"));
const LaundryPrintCentre = lazy(() => import("@/pages/laundry/LaundryPrintCentre"));
const LaundrySettlements = lazy(() => import("@/pages/laundry/LaundrySettlements"));
const LaundryReportDetail = lazy(() => import("@/pages/laundry/LaundryReportDetail"));
const LaundryStatistics = lazy(() => import("@/pages/laundry/LaundryStatistics"));
const LaundryGarmentTracking = lazy(() => import("@/pages/laundry/LaundryGarmentTracking"));
const LaundryCashClosing = lazy(() => import("@/pages/laundry/LaundryCashClosing"));
const LaundryProductionQueue = lazy(() => import("@/pages/laundry/LaundryProductionQueue"));
const LaundryQualityClaims = lazy(() => import("@/pages/laundry/LaundryQualityClaims"));
const LaundryCorrections = lazy(() => import("@/pages/laundry/LaundryCorrections"));
const LaundryRoutes = lazy(() => import("@/pages/laundry/LaundryRoutes"));
const LaundryOnlineOrders = lazy(() => import("@/pages/laundry/LaundryOnlineOrders"));
const LaundryMarketplaceCatalogue = lazy(() => import("@/pages/laundry/LaundryMarketplaceCatalogue"));
const LaundryPlatformControl = lazy(() => import("@/pages/laundry/LaundryPlatformControl"));
const LaundryPlatformOrders = lazy(() => import("@/pages/laundry/LaundryPlatformOrders"));
const LaundryPlatformAudit = lazy(() => import("@/pages/laundry/LaundryPlatformAudit"));
const LaundryPlatformFinance = lazy(() => import("@/pages/laundry/LaundryPlatformFinance"));
const LaundrySyncStatus = lazy(() => import("@/pages/laundry/LaundrySyncStatus"));
const LaundryOperationsHub = lazy(() => import("@/pages/laundry/LaundryOperationsHub"));
const LaundryFinanceCommandCenter = lazy(() => import("@/pages/laundry/LaundryFinanceCommandCenter"));
const LaundryManagement = lazy(() => import("@/pages/laundry/LaundryManagement"));
const LaundryReturns = lazy(() => import("@/pages/laundry/LaundryReturns"));
const LaundryFinanceSetup = lazy(() => import("@/pages/laundry/LaundryFinanceSetup"));
const LaundryStatutoryFinance = lazy(() => import("@/pages/laundry/LaundryStatutoryFinance"));

export function App() {
  return (
    <AuthGate>
    <Suspense fallback={<RouteLoading />}>
    <Routes>
      <Route path="/" element={<LaundryLanding />} />
      <Route path="/laundry" element={<LaundryShell />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<PermissionGate permission="orders.read"><LaundryDashboard /></PermissionGate>} />
        <Route path="operations" element={<PermissionGate permission="orders.read"><LaundryOperationsHub /></PermissionGate>} />
        <Route path="finance" element={<PermissionGate permission="settings.manage"><LaundryFinanceCommandCenter /></PermissionGate>} />
        <Route path="finance/statutory" element={<PermissionGate permission="settings.manage"><LaundryStatutoryFinance /></PermissionGate>} />
        <Route path="management" element={<PermissionGate permission="settings.manage"><LaundryManagement /></PermissionGate>} />
        <Route path="finance-setup" element={<PermissionGate permission="settings.manage"><LaundryFinanceSetup /></PermissionGate>} />
        <Route path="customers" element={<PermissionGate permission="customers.read"><LaundryCustomers /></PermissionGate>} />
        <Route path="customers/:id" element={<PermissionGate permission="customers.read"><LaundryCustomers /></PermissionGate>} />
        <Route path="packages" element={<PermissionGate permission="packages.read"><LaundryPackages /></PermissionGate>} />
        <Route path="new-order" element={<PermissionGate permission="orders.create"><LaundryBooking /></PermissionGate>} />
        <Route path="orders" element={<PermissionGate permission="orders.read"><LaundryOrders /></PermissionGate>} />
        <Route path="orders/:id" element={<PermissionGate permission="orders.read"><LaundryOrders /></PermissionGate>} />
        <Route path="online-orders" element={<PermissionGate permission="orders.read"><LaundryOnlineOrders /></PermissionGate>} />
        <Route path="marketplace-catalogue" element={<PermissionGate permission="catalogue.read"><LaundryMarketplaceCatalogue /></PermissionGate>} />
        <Route path="platform-control" element={<PermissionGate permission="settings.manage"><LaundryPlatformControl /></PermissionGate>} />
        <Route path="platform-orders" element={<PermissionGate permission="settings.manage"><LaundryPlatformOrders /></PermissionGate>} />
        <Route path="platform-audit" element={<PermissionGate permission="settings.manage"><LaundryPlatformAudit /></PermissionGate>} />
        <Route path="platform-finance" element={<PermissionGate permission="settings.manage"><LaundryPlatformFinance /></PermissionGate>} />
        <Route path="sync-status" element={<PermissionGate permission="settings.manage"><LaundrySyncStatus /></PermissionGate>} />
        <Route path="garment-tracking" element={<PermissionGate permission="garments.read"><LaundryGarmentTracking /></PermissionGate>} />
        <Route path="cash-closing" element={<PermissionGate permission="cash.read"><LaundryCashClosing /></PermissionGate>} />
        <Route path="production-queue" element={<PermissionGate permission="production.read"><LaundryProductionQueue /></PermissionGate>} />
        <Route path="quality-claims" element={<PermissionGate permission="quality.read"><LaundryQualityClaims /></PermissionGate>} />
        <Route path="corrections" element={<PermissionGate permission="quality.read"><LaundryCorrections /></PermissionGate>} />
        <Route path="returns" element={<PermissionGate permission="quality.read"><LaundryReturns /></PermissionGate>} />
        <Route path="routes" element={<PermissionGate permission="routes.read"><LaundryRoutes /></PermissionGate>} />
        <Route path="print-centre" element={<PermissionGate permission="orders.read"><LaundryPrintCentre /></PermissionGate>} />
        <Route path="settlements" element={<PermissionGate permission="orders.read"><LaundrySettlements /></PermissionGate>} />
        <Route path="dispatch" element={<PermissionGate permission="orders.read"><LaundryDispatch /></PermissionGate>} />
        <Route path="expenses" element={<PermissionGate permission="expenses.create"><LaundryExpenses /></PermissionGate>} />
        <Route path="reports" element={<PermissionGate permission="settings.manage"><LaundryReports /></PermissionGate>} />
        <Route path="reports/:kind" element={<PermissionGate permission="settings.manage"><LaundryReportDetail /></PermissionGate>} />
        <Route path="statistics" element={<PermissionGate permission="orders.read"><LaundryStatistics /></PermissionGate>} />
        <Route path="import-prices" element={<PermissionGate permission="settings.manage"><LaundryImport mode="prices" /></PermissionGate>} />
        <Route path="import-customers" element={<PermissionGate permission="settings.manage"><LaundryImport mode="customers" /></PermissionGate>} />
        <Route path="import-catalogue" element={<PermissionGate permission="settings.manage"><LaundryCatalogueImport /></PermissionGate>} />
        <Route path="catalogue" element={<PermissionGate permission="catalogue.read"><LaundryCatalogue /></PermissionGate>} />
        <Route path="settings" element={<PermissionGate permission="settings.manage"><LaundrySettings /></PermissionGate>} />
      </Route>
      <Route path="*" element={<Navigate to="/laundry/dashboard" replace />} />
    </Routes>
    </Suspense>
    </AuthGate>
  );
}

function RouteLoading() {
  return <div className="grid min-h-72 place-items-center text-sm text-muted-foreground">Opening workspace…</div>;
}

function LaundryLanding() {
  const session = useQuery({ queryKey: ['auth-session'], queryFn: () => apiGet<{ user: { roles: string[] } | null }>('/auth/session') })
  if (session.isLoading) return <div className="grid h-screen place-items-center text-sm text-muted-foreground">Opening your laundry workspace…</div>
  const roles = session.data?.user?.roles || []
  const target = roles.includes('owner')
    ? '/laundry/dashboard'
    : roles.includes('counter_staff')
      ? '/laundry/new-order'
      : roles.includes('processing_staff')
        ? '/laundry/production-queue'
        : roles.includes('rider')
          ? '/laundry/routes'
          : '/laundry/dashboard'
  return <Navigate to={target} replace />
}

function PermissionGate({ permission, children }: { permission: UiPermission; children: ReactNode }) {
  const session = useQuery({ queryKey: ['auth-session'], queryFn: () => apiGet<{ user: { roles: string[] } | null }>('/auth/session') })
  if (session.isLoading) return <div className="grid h-72 place-items-center text-sm text-muted-foreground">Checking your workspace access…</div>
  if (!canUseUi(session.data?.user?.roles, permission)) return <section className="mx-auto mt-16 max-w-lg rounded-2xl border border-amber-200 bg-amber-50 p-7 text-center text-amber-950"><h1 className="font-serif text-2xl">This workspace is not assigned to your role.</h1><p className="mt-2 text-sm leading-6">Ask an owner to update your branch access if you need this part of Epic Laundry.</p></section>
  return <>{children}</>
}
