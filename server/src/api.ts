import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  listDefs, getDef, createRow, getRow, listRows, submitRow, cancelRow,
} from './kernel/entity-service.js';
import { store } from './kernel/store.js';
import { drainOutbox } from './kernel/event-bus.js';
import { audit } from './kernel/audit.js';
import { ShotlinXchatAdapter } from './integrations/whatsapp/shotlinxchat.js';
import { buildEinvoicePayload } from './modules/gst/einvoice.js';
import { buildGstr1, buildCdnr, gstFromCanonicalSnapshot } from './modules/gst/gstr1.js';
import {
  generateIrnForInvoice, cancelIrnForInvoice, generateEwbForInvoice,
  getImsSupplies, recordImsAction,
} from './modules/gst/irn-service.js';
import { getTrialBalance, getPnL, getBalanceSheet, getLedger } from './modules/accounting/reports.js';
import { computePayroll } from './modules/hr/payroll.js';
import {
  recordAttendance, getLeaveBalances, applyLeave, approveLeave,
  createExpenseClaim, createEmployeeLoan, getLoanSchedule,
  createJobOpening, applyToJob, scheduleInterview, getRecruitmentPipeline,
} from './modules/hr/hr-depth.js';
import { getInsights } from './modules/ai/insights.js';
import { ask } from './modules/ai/assistant.js';
import { runImport, PRESETS } from './modules/migration/import.js';
import { stockValuation, serialStock, batchStock, getStockBalance } from './modules/inventory/valuation.js';
import { quoteRate, runRecurring, reorderSuggestions, getAlerts, createReorderPO } from './modules/ops.js';
import {
  explodeBom, bomCost, planMaterials, createPlannedWorkOrders, createPlannedPurchaseOrder, defaultBom,
} from './modules/manufacturing/mrp.js';
import { billProject } from './modules/projects/billing.js';
import { runDepreciation } from './modules/assets/depreciation.js';
import { getComplianceSummary, verifyAuditTrail } from './modules/compliance/returns.js';
import { getRate, convert } from './modules/multi-entity/fx.js';
import { roleCan } from './modules/rbac/roles.js';
import { paymentLink } from './modules/integrations/payments.js';
import { bootstrapOwner, can, changePassword, contextForToken, createOperationalStore, createOperationalUser, listOperationalStores, readSessionToken, resetOperationalUserPassword, setOperationalUserEnabled, signIn, signOut, switchOperationalStore, updateOperationalUser, type AuthContext } from './modules/auth/auth.js';
import { authenticateWithCloud, requestLoginOtp, isFreshInstall, CloudLoginError } from './modules/auth/cloud-auth.js';
import { runBot, fetchBankStatement } from './modules/integrations/rpa.js';
import {
  scoreLead, scoreAllLeads, logActivity, activitiesFor, findDuplicateLeads, mergeLeads,
  convertLead, winOpportunity, loseOpportunity, getPipeline, getForecast,
  getSourceAnalytics, getLostReasonPareto, getOwnerPerformance, assignOwner,
} from './modules/crm/crm.js';
import {
  sendMessage, sendTemplated, runCampaign, campaignStats, notify,
  listNotifications, markNotificationRead, markAllRead, syncAlertsToNotifications,
} from './modules/crm/engagement.js';
import { dashboardSummary } from './modules/analytics/dashboard.js';
import {
  applyLaundryGarmentBackfill, assignLaundryOrder, bookLaundryOrder, cancelLaundryExpense, cancelLaundryOrder, createLaundryExpense, createLaundryRider, editLaundryExpense, editLaundryOrder, getLaundryOrder, importLaundryCatalogue, importLaundryCustomers, importLaundryPrices, laundryCatalogue, laundryDashboard, listLaundryFulfillment, recordLaundryFulfillment, listLaundryGarmentUnits, getLaundryGarmentUnit, previewLaundryGarmentBackfill, scanLaundryGarment, scanLaundryContainer, getLaundryContainerDetail, reprintLaundryTag, replaceLaundryTag, createLaundryPrintJob, listLaundryPrintJobs, LaundryDomainError, TagRetiredError,
  laundryDispatch, laundryReportDetail, laundryReports, laundryStatistics, listLaundryExpenses, listLaundryImportJobs, listLaundryOrderPage, listLaundryOrders, listLaundryRiderSettlements, listLaundryRiders, quoteLaundryOrder, saveLaundryCategory, saveLaundryChargeRule, saveLaundryDiscountRule,
  saveLaundryGarment, saveLaundryPrice, saveLaundryRiderSettlement, saveLaundryService, saveLaundryTaxRule, searchLaundryCustomers, seedLaundryDefaults, transitionLaundryOrder,
} from './modules/laundry/domain.js';
import { adjustRewards, applyWalletCommand, archiveLaundryCustomerAddress, createLaundryCustomer, customerProfile, customerRetentionInsights, listLaundryCustomerAddresses, listOnlineOnlyCustomers, saveLaundryCustomerAddress, updateLaundryCustomer } from './modules/laundry/customers.js';
import { collectServicePackagePayment, createServicePackage, customerPackages, listServicePackages, packageLiability, purchaseServicePackage, redeemServicePackage } from './modules/laundry/packages.js';
import { collectLaundryPayment, laundryPaymentSummary, reverseLaundryPayment } from './modules/laundry/payments.js';
import { laundryBusinessDate } from './modules/laundry/dates.js';
import { cashCloseDrill, laundryFinancialReconciliation } from './modules/laundry/reconciliation.js';
import { closeCashShift, getCurrentCashShift, listCashShifts, openCashShift } from './modules/laundry/cash.js';
import { applyProductionWorkloadRecommendations, assignProductionTask, listProductionTasks, productionLoad, productionSchedule, productionSupervisorMetrics, productionWorkload, startProductionTask } from './modules/laundry/production.js';
import { listCustomerCorrections, listQualityClaims, openQualityClaim, qualityAnalytics, resolveQualityClaim } from './modules/laundry/quality.js';
import { laundryManagementSnapshot, laundryWorkforceDashboard, markLaundryAttendance } from './modules/laundry/management.js';
import { listLaundryReturns, requestLaundryReturn } from './modules/laundry/returns.js';
import { entityFinanceProfile, financePolicyReadiness, installIndia2026Baseline, listRegulatoryPolicies, saveEntityFinanceProfile } from './modules/finance/regulatory-policy.js';
import { calculatePayrollPreview } from './modules/finance/payroll-engine.js';
import { financeCommandCenter } from './modules/finance/intelligence.js';
import { listFinancePlanningTargets, saveFinancePlanningTarget } from './modules/finance/planning.js';
import { calculateConfiguredIncomeTaxTcs, calculateGstEcoTcs, calculateTds, listIncomeTaxTcsPolicies, listStatutoryTransactions, prepareStatutoryReturn, recordTcsTransaction, recordTdsTransaction, saveIncomeTaxTcsPolicy, statutoryDashboard, updateStatutoryReturn, type IncomeTaxTcsPolicyStatus, type StatutoryReturnState, type StatutoryReturnType, type TdsCategory, type TdsPayeeType, type PanStatus, type TcsCategory } from './modules/finance/statutory.js';
import { cancelLaundryOrderHold, claimLaundryOrderHold, createLaundryOrderHold, listLaundryOrderHolds, orderHoldPresence, releaseLaundryOrderHold, renewLaundryOrderHold, resumeLaundryOrderHold } from './modules/laundry/holds.js';
import { completeRouteStop, createRouteRun, createServiceZone, listRouteRuns, listServiceZoneMaster, listServiceZones, routeCoverageAnalytics, startRouteRun, updateServiceZone } from './modules/laundry/routes.js';
import { createRackProfile, listRackProfiles, rackOccupancy, updateRackProfile } from './modules/laundry/rack.js';
import { hardwareCapabilities, hardwareStatus, listHardwareReceipts, recordHardwareReceipt } from './modules/laundry/hardware.js';
import { buildDiagnostics } from './modules/ops/diagnostics.js';
import { freshDatabaseRestoreRehearsal } from './modules/ops/fresh-recovery.js';
import { decryptBackup, encryptBackup } from './modules/ops/backup-crypto.js';
import { applyFinancialNormalization, previewFinancialNormalization } from './modules/ops/financial-normalization.js';
import { compatibilityRetirementAudit } from './modules/ops/compatibility-audit.js';
import { applyEntityNormalization, previewEntityNormalization, ENTITY_NORMALIZATION_ENTITIES, type EntityNormalizationEntity } from './modules/ops/entity-normalization.js';
import { searchLaundryWorkspace } from './modules/laundry/search.js';
import { createLaundryReportExportJob, getLaundryReportExportJob, readLaundryReportExport } from './modules/laundry/report-exports.js';
import { createSavedReportView, deleteSavedReportView, listSavedReportViews } from './modules/laundry/report-views.js';
import { actOnMarketplaceOrder, createDeviceEnrollment, linkMarketplaceOrderToLocalOrder, marketplaceSyncStatus, materializeMarketplaceOrder, registerMarketplaceDevice, replayHeldMarketplaceOrder } from './modules/marketplace/edge-sync.js';
import { marketplaceAvailability, saveMarketplaceAvailability } from './modules/marketplace/availability.js';
import { listMarketplaceCatalogueMappings, saveMarketplaceCatalogueMapping } from './modules/marketplace/catalogue.js';
import { listMarketplaceCustomerLinks, revokeMarketplaceCustomerLink, saveMarketplaceCustomerLink } from './modules/marketplace/customer-links.js';
import { createMarketplaceReassessment, createMarketplaceOrderRequest, decideMarketplaceReassessment, marketplaceOrderTruth, recordMarketplaceIntake } from './modules/marketplace/order-truth.js';
import { createCanonicalDebitNoteSnapshot, createCanonicalInvoiceSnapshot } from './modules/gst/invoice-snapshot.js';
import { marketplaceSettlement, recordMarketplaceCashCollection, recordMarketplaceSettlement } from './modules/marketplace/settlements.js';
import { marketplaceSettlementStatement, renderCanonicalSettlementStatement, type CanonicalSettlementStatement } from './modules/marketplace/settlement-statement.js';
import { createPayoutAttempt, createSettlementBatch, payoutAttempt, settlementBatch } from './modules/marketplace/settlement-batches.js';
import { recordProviderPaymentEvent, verifyProviderWebhook, type ProviderPaymentEvent } from './modules/marketplace/provider-events.js';
import { queueMarketplaceNotification, recordMarketplaceNotificationDelivery, type NotificationChannel, type NotificationState } from './modules/marketplace/notifications.js';
import { customerFacingOrderStatus, customerStatusMapping, saveCustomerStatusMapping } from './modules/marketplace/customer-status.js';
import { completeMarketplacePickup, marketplacePickupTask, scheduleMarketplacePickup } from './modules/marketplace/pickup.js';
import { connectCloudSession, disconnectCloudSession, fetchConnectedVendorProfile, getCloudConnectionStatus, requestCloudOtp } from './modules/marketplace/cloud-session.js';
import { CloudClientError } from './modules/marketplace/cloud-client.js';
import { pullCloudOrders } from './modules/marketplace/cloud-order-sync.js';
import { acceptCloudOrder, CloudOrderConflictError, rejectCloudOrder } from './modules/marketplace/cloud-order-actions.js';
import { advanceCloudOrderStage, CLOUD_ORDER_STAGES, cloudProgressErrorHint, proposeCloudReconciliation, syncCloudOrderDetail, type CloudOrderStage } from './modules/marketplace/cloud-order-progress.js';
import { fetchCloudCatalogue, updateCloudCatalogueItem, updateCloudCatalogueStock } from './modules/marketplace/cloud-catalogue.js';
import { syncLocalCatalogueFromCloud } from './modules/marketplace/catalogue-sync.js';
import { pushStoreOrderIfLinked, resolveCloudCustomerByPhone, adoptRemoteCustomer } from './modules/marketplace/cloud-store-orders.js';
import { lookupCloudWalletBalance, createCloudWalletRedemptionRequest, confirmCloudWalletRedemption, cancelCloudWalletRedemption } from './modules/marketplace/cloud-wallet.js';
import { fetchCloudVendorCategories, fetchCloudVendorServices, fetchCloudVendorServiceDetails, createCloudServiceDraft, bulkUpsertCloudGarmentRates } from './modules/marketplace/cloud-vendor-services.js';
import { syncLocalCaptainsFromCloud } from './modules/marketplace/cloud-captains.js';
import { claimConnectedPlatformPartnerLead, connectPlatformSession, disconnectPlatformSession, getPlatformSessionStatus, callConnectedPlatformApi, getConnectedPlatformOrder, getConnectedPlatformVendor, listConnectedPlatformAuditLogs, listConnectedPlatformFinanceVendors, listConnectedPlatformOrders, listConnectedPlatformPartnerLeads, listConnectedPlatformVendorFinancials, listConnectedPlatformVendorTransactions, listConnectedPlatformVendors, reviewConnectedPlatformVendor, writeConnectedPlatformApi } from './modules/marketplace/platform-session.js';
import { renderCanonicalTaxInvoice } from './modules/gst/canonical-invoice-print.js';
import { approveTaxPolicyRule, createTaxPolicyRule, listTaxPolicyRules, retireTaxPolicyRule, saveSupplierTaxProfile, supplierTaxProfile, taxReadiness } from './modules/gst/tax-policy.js';
import { auditGarmentAssets } from './modules/laundry/garment-assets.js';
import { ensureCanonicalInvoiceForLegacy } from './modules/gst/legacy-invoice-bridge.js';
import { renderCanonicalReceipt } from './modules/gst/canonical-receipts.js';
import { completeCustomerPrivacyRequest, createCustomerPrivacyRequest, exportCustomerPrivacyData, listCustomerPrivacyRequests } from './modules/laundry/customer-privacy.js';
import { issueCustomerPortalToken, verifyCustomerPortalToken } from './modules/laundry/customer-portal.js';

const TENANT = process.env.EPIC_TENANT || 'T1';
const USER = process.env.EPIC_USER || 'admin@epic.local';
// Legacy ERP routes predate the laundry workspace APIs. Always derive their
// tenant/actor from the authenticated request so a multi-store session cannot
// read or mutate the process-default workspace.
const requestTenant = (req: any) => req?.auth?.tenant || TENANT;
const requestActor = (req: any) => req?.auth?.actor || USER;
declare module 'fastify' { interface FastifyRequest { auth?: AuthContext } }

const laundryIdParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1, maxLength: 120 } },
} as const;
const laundrySearchQuery = {
  type: 'object',
  properties: { q: { type: 'string', maxLength: 80 } },
  additionalProperties: false,
} as const;
const laundryTransitionBody = {
  type: 'object',
  required: ['state'],
  properties: {
    state: { type: 'string', enum: ['Booked', 'Picked Up', 'In Process', 'Ready', 'Out for Delivery', 'Delivered', 'Cancelled'] },
    note: { type: 'string', maxLength: 500 },
    expectedVersion: { type: 'integer', minimum: 0 },
  },
  additionalProperties: false,
} as const;
const laundryScanBody = {
  type: 'object',
  required: ['tagCode'],
  properties: {
    tagCode: { type: 'string', minLength: 1, maxLength: 120 },
    nextState: { type: 'string', enum: ['Intake', 'Sorted', 'Processing', 'QC', 'Rewash', 'Assembly', 'Racked', 'Dispatched', 'Delivered', 'Missing', 'Damaged', 'Cancelled'] },
    location: { type: 'string', maxLength: 80 },
    note: { type: 'string', maxLength: 500 },
    condition: { type: 'string', maxLength: 40 },
  },
  additionalProperties: false,
} as const;
const laundryContainerScanBody = {
  ...laundryScanBody,
  properties: { ...laundryScanBody.properties, nextState: { type: 'string', enum: ['Intake', 'Processing', 'Ready', 'Dispatched', 'Delivered', 'Missing', 'Damaged', 'Cancelled'] } },
} as const;
const laundryLifecycleBody = {
  type: 'object',
  required: ['reason'],
  properties: {
    station: { type: 'string', maxLength: 80 },
    reason: { type: 'string', minLength: 3, maxLength: 240 },
    status: { type: 'string', enum: ['Lost', 'Damaged', 'Replaced'] },
  },
  additionalProperties: false,
} as const;
const laundryPrintJobBody = {
  type: 'object',
  required: ['orderId'],
  properties: {
    orderId: { type: 'string', minLength: 1, maxLength: 120 },
    templateId: { type: 'string', maxLength: 120 },
    templateVersion: { type: 'string', maxLength: 40 },
    printerProfile: { type: 'string', maxLength: 120 },
    tagIds: { type: 'array', maxItems: 500, items: { type: 'string', minLength: 1, maxLength: 120 } },
    containerIds: { type: 'array', maxItems: 500, items: { type: 'string', minLength: 1, maxLength: 120 } },
    documentType: { type: 'string', enum: ['invoice', 'mini-invoice', 'garment-tags', 'bag-tags', 'correction'] },
    requestedCopies: { type: 'integer', minimum: 1, maximum: 1000 },
    status: { type: 'string', enum: ['Queued', 'Rendering', 'Printed', 'Downloaded', 'Failed', 'Cancelled'] },
    failureReason: { type: 'string', maxLength: 500 },
    outputHash: { type: 'string', maxLength: 128 },
    evidence: { type: 'string', maxLength: 500 },
  },
  additionalProperties: false,
} as const;
const marketplaceOrderParams = {
  type: 'object', required: ['externalOrderId'],
  properties: { externalOrderId: { type: 'string', minLength: 1, maxLength: 160 } }, additionalProperties: false,
} as const;
const marketplaceCloudRejectBody = {
  type: 'object', required: ['reason'],
  properties: { reason: { type: 'string', minLength: 1, maxLength: 500 } }, additionalProperties: false,
} as const;
const marketplaceCloudStageBody = {
  type: 'object', required: ['stage'],
  properties: {
    stage: { type: 'string', enum: ['RECEIVED_AT_VENDOR', 'WASHING', 'DRYING', 'IRONING', 'PACKED'] },
    deliverySlotLabel: { type: 'string', maxLength: 100 },
    deliverySlotAt: { type: 'string', minLength: 1, maxLength: 40 },
  }, additionalProperties: false,
} as const;
const marketplaceCloudReconcileBody = {
  type: 'object', required: ['photoUrls'],
  properties: {
    // The marketplace refuses an unevidenced recount, so this is required all
    // the way through rather than being quietly defaulted to an empty list.
    photoUrls: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1, maxLength: 2000 } },
    lines: {
      type: 'array',
      items: {
        type: 'object', required: ['orderLineId'],
        properties: {
          orderLineId: { type: 'string', minLength: 1, maxLength: 80 },
          confirmedQuantity: { type: 'integer', minimum: 0 },
          newGarmentTypeId: { type: 'string', minLength: 1, maxLength: 80 },
        }, additionalProperties: false,
      },
    },
    newLines: {
      type: 'array',
      items: {
        type: 'object', required: ['garmentTypeId', 'quantity'],
        properties: {
          garmentTypeId: { type: 'string', minLength: 1, maxLength: 80 },
          quantity: { type: 'number', exclusiveMinimum: 0 },
        }, additionalProperties: false,
      },
    },
    confirmedWeightKg: { type: 'number', minimum: 0.1 },
    reason: { type: 'string', maxLength: 500 },
  }, additionalProperties: false,
} as const;
const marketplaceCatalogueItemParams = {
  type: 'object', required: ['itemId'],
  properties: { itemId: { type: 'string', minLength: 1, maxLength: 160 } }, additionalProperties: false,
} as const;
const marketplaceCloudCatalogueUpdateBody = {
  type: 'object',
  properties: {
    price: { type: 'number', minimum: 0 },
    salePrice: { type: 'number', minimum: 0 },
    costPrice: { type: 'number', minimum: 0 },
    lowStockThreshold: { type: 'integer', minimum: 0 },
    maxOrderQty: { type: 'integer', minimum: 1 },
    isAvailable: { type: 'boolean' },
  }, additionalProperties: false,
} as const;
const marketplaceCloudCatalogueStockBody = {
  type: 'object', required: ['stockQuantity'],
  properties: { stockQuantity: { type: 'integer', minimum: 0 } }, additionalProperties: false,
} as const;
const platformConnectBody = {
  type: 'object', required: ['email', 'password'],
  properties: { email: { type: 'string', minLength: 1, maxLength: 320 }, password: { type: 'string', minLength: 1, maxLength: 200 } }, additionalProperties: false,
} as const;
const platformVendorParams = {
  type: 'object', required: ['vendorId'],
  properties: { vendorId: { type: 'string', minLength: 1, maxLength: 160 } }, additionalProperties: false,
} as const;
const platformVendorCapacityBody = {
  // Matches the real backend's PUT /vendors/admin/:id/capacity body exactly
  // (confirmed by reading vendors.routes.js's own schema) — a single daily
  // ceiling, not a per-slot map; slot-level edits are a separate, deferred
  // endpoint (/admin/:id/slots/:slotId).
  type: 'object', required: ['max_orders_per_day'],
  properties: { max_orders_per_day: { type: 'integer', minimum: 1 } }, additionalProperties: false,
} as const;
const platformVendorQuery = {
  type: 'object', properties: {
    status: { type: 'string', maxLength: 64 },
    search: { type: 'string', maxLength: 200 },
    city: { type: 'string', maxLength: 120 },
    page: { type: 'integer', minimum: 1, maximum: 100000 },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
  }, additionalProperties: false,
} as const;
const platformPartnerLeadParams = {
  type: 'object', required: ['leadId'], additionalProperties: false,
  properties: { leadId: { type: 'string', minLength: 1, maxLength: 120 } },
} as const;
const platformPartnerLeadQuery = {
  type: 'object', additionalProperties: false,
  properties: { state: { type: 'string', enum: ['RECEIVED', 'CLAIMED', 'ARCHIVED'] }, page: { type: 'integer', minimum: 1 }, limit: { type: 'integer', minimum: 1, maximum: 100 } },
} as const;
const platformVendorReviewBody = {
  type: 'object', required: ['status'], properties: {
    status: { type: 'string', enum: ['APPROVED', 'REJECTED', 'CORRECTION_REQUIRED', 'SUSPENDED'] },
    approvedRadius: { type: 'number', minimum: 0 },
    approvedDailyCapacity: { type: 'integer', minimum: 1 },
    rejectionReason: { type: 'string', maxLength: 2000 },
    correctionSections: { type: 'array', items: { type: 'string', enum: ['business', 'owner_bank', 'location', 'radius', 'documents'] }, maxItems: 5 },
    documentReviews: { type: 'array', items: { type: 'object', required: ['documentId', 'status'], properties: { documentId: { type: 'string', minLength: 1, maxLength: 160 }, status: { type: 'string', enum: ['APPROVED', 'REJECTED'] }, rejectionReason: { type: 'string', maxLength: 2000 } }, additionalProperties: false } },
  }, additionalProperties: false,
} as const;
const platformOrderParams = {
  type: 'object', required: ['orderId'],
  properties: { orderId: { type: 'string', minLength: 1, maxLength: 160 } }, additionalProperties: false,
} as const;
const platformOrderQuery = {
  type: 'object', properties: {
    status: { type: 'string', maxLength: 80 },
    paymentMethod: { type: 'string', maxLength: 80 },
    search: { type: 'string', maxLength: 200 },
    startDate: { type: 'string', maxLength: 40 },
    endDate: { type: 'string', maxLength: 40 },
    page: { type: 'integer', minimum: 1 },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
  }, additionalProperties: false,
} as const;
const platformAuditQuery = {
  type: 'object', properties: {
    actor_user_id: { type: 'string', minLength: 1, maxLength: 160 },
    actor_shop_id: { type: 'string', minLength: 1, maxLength: 160 },
    target_type: { type: 'string', minLength: 1, maxLength: 50 },
    target_id: { type: 'string', minLength: 1, maxLength: 160 },
    action: { type: 'string', minLength: 1, maxLength: 80 },
    from: { type: 'string', maxLength: 40 },
    to: { type: 'string', maxLength: 40 },
    page: { type: 'integer', minimum: 1 },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
  }, additionalProperties: false,
} as const;
const platformFinanceVendorQuery = {
  type: 'object', properties: {
    page: { type: 'integer', minimum: 1, maximum: 100000 },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
    search: { type: 'string', maxLength: 200 },
    has_pending_payout: { type: 'boolean' },
  }, additionalProperties: false,
} as const;
const platformFinanceFinancialQuery = {
  type: 'object', properties: {
    period_type: { type: 'string', enum: ['DAILY', 'WEEKLY', 'MONTHLY'] },
    from: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    to: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    payout_status: { type: 'string', enum: ['PENDING', 'PROCESSING', 'PAID', 'HELD'] },
    page: { type: 'integer', minimum: 1, maximum: 100000 },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
  }, additionalProperties: false,
} as const;
const platformFinanceTransactionQuery = {
  type: 'object', properties: {
    type: { type: 'string', maxLength: 120 },
    direction: { type: 'string', enum: ['CREDIT', 'DEBIT'] },
    from: { type: 'string', format: 'date-time' },
    to: { type: 'string', format: 'date-time' },
    page: { type: 'integer', minimum: 1, maximum: 100000 },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
  }, additionalProperties: false,
} as const;
const settlementBatchParams = { type: 'object', required: ['batchId'], properties: { batchId: { type: 'string', minLength: 1, maxLength: 160 } }, additionalProperties: false } as const;
const payoutAttemptParams = { type: 'object', required: ['attemptId'], properties: { attemptId: { type: 'string', minLength: 1, maxLength: 160 } }, additionalProperties: false } as const;
const marketplaceOrderQuery = {
  type: 'object', properties: {
    state: { type: 'string', enum: ['AwaitingAcceptance', 'Accepted', 'Rejected', 'Expired', 'PickupScheduled', 'IntakeRequired', 'CustomerApprovalRequired', 'Processing', 'Ready', 'DeliveryScheduled', 'Completed', 'Cancelled'] },
    cursor: { type: 'string', minLength: 1, maxLength: 500 }, limit: { type: 'integer', minimum: 1, maximum: 200 },
  }, additionalProperties: false,
} as const;
const marketplaceRejectBody = {
  type: 'object', required: ['reason'], properties: { reason: { type: 'string', minLength: 3, maxLength: 500 } }, additionalProperties: false,
} as const;
const marketplaceLinkBody = {
  type: 'object', required: ['localOrderId'], properties: { localOrderId: { type: 'string', minLength: 1, maxLength: 160 } }, additionalProperties: false,
} as const;
const marketplaceNotificationBody = {
  type: 'object', required: ['eventId', 'eventType', 'recipientRef', 'channel', 'template', 'payload'], properties: {
    eventId: { type: 'string', minLength: 1, maxLength: 200 }, eventType: { type: 'string', minLength: 1, maxLength: 160 }, recipientRef: { type: 'string', minLength: 1, maxLength: 200 }, channel: { type: 'string', enum: ['in-app', 'push', 'whatsapp', 'sms', 'email'] }, template: { type: 'string', minLength: 1, maxLength: 160 }, payload: { type: 'object', additionalProperties: true },
  }, additionalProperties: false,
} as const;
const marketplaceNotificationDeliveryParams = {
  type: 'object', required: ['eventId', 'channel'], properties: { eventId: { type: 'string', minLength: 1, maxLength: 200 }, channel: { type: 'string', enum: ['in-app', 'push', 'whatsapp', 'sms', 'email'] } }, additionalProperties: false,
} as const;
const marketplaceNotificationDeliveryBody = {
  type: 'object', required: ['state'], properties: { state: { type: 'string', enum: ['Queued', 'Sent', 'Delivered', 'Failed'] }, providerMessageId: { type: 'string', maxLength: 200 }, error: { type: 'string', maxLength: 500 } }, additionalProperties: false,
} as const;
const gstTaxPolicyBody = {
  type: 'object', required: ['classificationType', 'classificationCode', 'description', 'supplyType', 'rateBps', 'validFrom', 'sourceNote', 'version'], properties: { classificationType: { type: 'string', enum: ['SAC', 'HSN'] }, classificationCode: { type: 'string', minLength: 2, maxLength: 20 }, description: { type: 'string', minLength: 1, maxLength: 240 }, supplyType: { type: 'string', enum: ['Service', 'Product'] }, rateBps: { type: 'integer', minimum: 0, maximum: 10000 }, validFrom: { type: 'string', minLength: 10, maxLength: 10 }, validTo: { type: 'string', minLength: 10, maxLength: 10 }, sourceNote: { type: 'string', minLength: 3, maxLength: 1000 }, version: { type: 'string', minLength: 1, maxLength: 80 } }, additionalProperties: false,
} as const;
const gstTaxPolicyQuery = { type: 'object', properties: { asOf: { type: 'string', minLength: 10, maxLength: 10 } }, additionalProperties: false } as const;
const gstSupplierProfileBody = {
  type: 'object', required: ['legalName', 'address', 'stateCode', 'pincode', 'registrationStatus'], properties: { legalName: { type: 'string', minLength: 1, maxLength: 240 }, tradeName: { type: 'string', maxLength: 240 }, address: { type: 'string', minLength: 1, maxLength: 1000 }, stateCode: { type: 'string', minLength: 2, maxLength: 2 }, pincode: { type: 'string', minLength: 6, maxLength: 6 }, registrationStatus: { type: 'string', enum: ['Registered', 'Unregistered'] }, gstin: { type: 'string', maxLength: 15 }, invoiceSeries: { type: 'string', maxLength: 80 }, einvoiceState: { type: 'string', enum: ['NotApplicable', 'NotConfigured', 'Sandbox', 'Ready', 'Pending', 'Generated', 'Failed', 'Cancelled', 'TimeRestricted'] } }, additionalProperties: false,
} as const;
const statutoryTdsBody = {
  type: 'object', required: ['sourceReference', 'postingDate', 'category', 'basePaise'], properties: {
    sourceReference: { type: 'string', minLength: 1, maxLength: 200 }, postingDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, category: { type: 'string', enum: ['CONTRACTOR', 'COMMISSION', 'RENT_EQUIPMENT', 'RENT_PROPERTY', 'PROFESSIONAL', 'TECHNICAL', 'GOODS_PURCHASE', 'ECOMMERCE'] }, payeeName: { type: 'string', maxLength: 240 }, payeeType: { type: 'string', enum: ['INDIVIDUAL_HUF', 'OTHER'] }, basePaise: { type: 'integer', minimum: 0 }, aggregatePaise: { type: 'integer', minimum: 0 }, panStatus: { type: 'string', enum: ['VALID', 'MISSING', 'INVALID', 'INOPERATIVE', 'UNKNOWN'] }, buyerTurnoverPaise: { type: 'integer', minimum: 0 }, participantExemptionEligible: { type: 'boolean' }, debitAccount: { type: 'string', maxLength: 160 },
  }, additionalProperties: false,
} as const;
const statutoryTdsCalculateBody = { ...statutoryTdsBody, required: ['postingDate', 'category', 'basePaise'] } as const;
const statutoryTcsBody = {
  type: 'object', required: ['sourceReference', 'postingDate', 'category', 'taxableSupplyPaise'], properties: {
    sourceReference: { type: 'string', minLength: 1, maxLength: 200 }, postingDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, category: { type: 'string', enum: ['GST_ECO_TCS', 'INCOME_TAX_TCS'] }, taxableSupplyPaise: { type: 'integer', minimum: 0 }, returnedSupplyPaise: { type: 'integer', minimum: 0 }, intraState: { type: 'boolean' }, policyKey: { type: 'string', minLength: 1, maxLength: 120 }, debitAccount: { type: 'string', maxLength: 160 },
  }, additionalProperties: false,
} as const;
const statutoryTcsCalculateBody = { ...statutoryTcsBody, required: ['category', 'taxableSupplyPaise'] } as const;
const incomeTaxTcsPolicyBody = {
  type: 'object', required: ['policyKey', 'rateBps', 'effectiveFrom', 'calculationBasis', 'sourceNote', 'version'], properties: {
    policyKey: { type: 'string', minLength: 1, maxLength: 120 }, rateBps: { type: 'integer', minimum: 0, maximum: 10000 }, effectiveFrom: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, effectiveUntil: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, calculationBasis: { type: 'string', minLength: 1, maxLength: 500 }, sourceNote: { type: 'string', minLength: 3, maxLength: 1000 }, status: { type: 'string', enum: ['DRAFT', 'APPROVED', 'RETIRED'] }, version: { type: 'string', minLength: 1, maxLength: 80 },
  }, additionalProperties: false,
} as const;
const statutoryReturnPrepareBody = {
  type: 'object', required: ['returnType', 'periodStart', 'periodEnd'], properties: {
    returnType: { type: 'string', enum: ['TDS_138', 'TDS_140', 'TCS_143', 'GSTR_8'] }, periodStart: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, periodEnd: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
  }, additionalProperties: false,
} as const;
const statutoryReturnStatusBody = {
  type: 'object', required: ['state'], properties: { state: { type: 'string', enum: ['Prepared', 'Validated', 'Exported', 'Submitted', 'Acknowledged', 'Accepted', 'Rejected', 'CorrectionRequired'] }, evidence: { type: 'string', maxLength: 500 }, acknowledgement: { type: 'string', maxLength: 200 } }, additionalProperties: false,
} as const;
const financePlanningTargetBody = {
  type: 'object', required: ['periodStart', 'periodEnd'], properties: {
    periodStart: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, periodEnd: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    revenuePaise: { type: 'integer', minimum: 0 }, expensePaise: { type: 'integer', minimum: 0 }, ebitdaPaise: { type: 'integer', minimum: 0 }, collectionPaise: { type: 'integer', minimum: 0 }, marginBps: { type: 'integer', minimum: 0, maximum: 10000 }, payrollPaise: { type: 'integer', minimum: 0 }, note: { type: 'string', maxLength: 500 },
  }, additionalProperties: false,
} as const;
const marketplaceIntakeBody = {
  type: 'object', required: ['actual'], properties: { actual: { type: 'object', additionalProperties: true }, reason: { type: 'string', maxLength: 500 } }, additionalProperties: false,
} as const;
const marketplaceReassessmentBody = {
  type: 'object', required: ['previousAmountPaise', 'revisedAmountPaise', 'reason'], properties: { previousAmountPaise: { type: 'integer', minimum: 0 }, revisedAmountPaise: { type: 'integer', minimum: 0 }, reason: { type: 'string', minLength: 3, maxLength: 500 }, tolerancePaise: { type: 'integer', minimum: 0 } }, additionalProperties: false,
} as const;
const customerStatusMappingBody = {
  type: 'object', additionalProperties: false, properties: {
    AwaitingAcceptance: { type: 'string', enum: ['AwaitingAcceptance', 'Accepted', 'PickupScheduled', 'Received', 'Cleaning', 'QualityCheck', 'Ready', 'OutForDelivery', 'Delivered', 'ApprovalRequired', 'Cancelled'] },
    Accepted: { type: 'string', enum: ['AwaitingAcceptance', 'Accepted', 'PickupScheduled', 'Received', 'Cleaning', 'QualityCheck', 'Ready', 'OutForDelivery', 'Delivered', 'ApprovalRequired', 'Cancelled'] },
    Rejected: { type: 'string', enum: ['AwaitingAcceptance', 'Accepted', 'PickupScheduled', 'Received', 'Cleaning', 'QualityCheck', 'Ready', 'OutForDelivery', 'Delivered', 'ApprovalRequired', 'Cancelled'] },
    Expired: { type: 'string', enum: ['AwaitingAcceptance', 'Accepted', 'PickupScheduled', 'Received', 'Cleaning', 'QualityCheck', 'Ready', 'OutForDelivery', 'Delivered', 'ApprovalRequired', 'Cancelled'] },
    PickupScheduled: { type: 'string', enum: ['AwaitingAcceptance', 'Accepted', 'PickupScheduled', 'Received', 'Cleaning', 'QualityCheck', 'Ready', 'OutForDelivery', 'Delivered', 'ApprovalRequired', 'Cancelled'] },
    IntakeRequired: { type: 'string', enum: ['AwaitingAcceptance', 'Accepted', 'PickupScheduled', 'Received', 'Cleaning', 'QualityCheck', 'Ready', 'OutForDelivery', 'Delivered', 'ApprovalRequired', 'Cancelled'] },
    CustomerApprovalRequired: { type: 'string', enum: ['AwaitingAcceptance', 'Accepted', 'PickupScheduled', 'Received', 'Cleaning', 'QualityCheck', 'Ready', 'OutForDelivery', 'Delivered', 'ApprovalRequired', 'Cancelled'] },
    Processing: { type: 'string', enum: ['AwaitingAcceptance', 'Accepted', 'PickupScheduled', 'Received', 'Cleaning', 'QualityCheck', 'Ready', 'OutForDelivery', 'Delivered', 'ApprovalRequired', 'Cancelled'] },
    Ready: { type: 'string', enum: ['AwaitingAcceptance', 'Accepted', 'PickupScheduled', 'Received', 'Cleaning', 'QualityCheck', 'Ready', 'OutForDelivery', 'Delivered', 'ApprovalRequired', 'Cancelled'] },
    DeliveryScheduled: { type: 'string', enum: ['AwaitingAcceptance', 'Accepted', 'PickupScheduled', 'Received', 'Cleaning', 'QualityCheck', 'Ready', 'OutForDelivery', 'Delivered', 'ApprovalRequired', 'Cancelled'] },
    Completed: { type: 'string', enum: ['AwaitingAcceptance', 'Accepted', 'PickupScheduled', 'Received', 'Cleaning', 'QualityCheck', 'Ready', 'OutForDelivery', 'Delivered', 'ApprovalRequired', 'Cancelled'] },
    Cancelled: { type: 'string', enum: ['AwaitingAcceptance', 'Accepted', 'PickupScheduled', 'Received', 'Cleaning', 'QualityCheck', 'Ready', 'OutForDelivery', 'Delivered', 'ApprovalRequired', 'Cancelled'] },
  },
} as const;
const marketplacePickupScheduleBody = {
  type: 'object', required: ['scheduledDate'], properties: {
    scheduledDate: { type: 'string', minLength: 10, maxLength: 10 }, window: { type: 'string', maxLength: 80 }, riderId: { type: 'string', maxLength: 160 }, serviceZone: { type: 'string', maxLength: 120 },
  }, additionalProperties: false,
} as const;
const marketplacePickupOutcomeBody = {
  type: 'object', required: ['state'], properties: { state: { type: 'string', enum: ['Collected', 'Failed', 'Cancelled'] }, reason: { type: 'string', maxLength: 500 } }, additionalProperties: false,
} as const;
const customerPrivacyRequestBody = {
  type: 'object', required: ['type'], properties: {
    type: { type: 'string', enum: ['Export', 'Correction', 'Erasure'] },
    details: { type: 'object', additionalProperties: true },
  }, additionalProperties: false,
} as const;
const customerPrivacyQuery = {
  type: 'object', properties: { customerId: { type: 'string', minLength: 1, maxLength: 160 } }, additionalProperties: false,
} as const;
const customerPortalTokenBody = {
  type: 'object', required: ['customerId'], properties: { customerId: { type: 'string', minLength: 1, maxLength: 160 }, ttlSeconds: { type: 'integer', minimum: 300, maximum: 86400 } }, additionalProperties: false,
} as const;
const customerPortalQuery = {
  type: 'object', properties: { token: { type: 'string', minLength: 1, maxLength: 4000 } }, additionalProperties: false,
} as const;
const marketplaceDeviceRegistrationBody = {
  type: 'object', required: ['deviceId', 'vendorId', 'publicKey'], properties: {
    deviceId: { type: 'string', minLength: 1, maxLength: 160 }, vendorId: { type: 'string', minLength: 1, maxLength: 120 }, station: { type: 'string', maxLength: 120 },
    publicKey: { type: 'string', minLength: 1, maxLength: 10000 }, credentialRef: { type: 'string', maxLength: 500 }, softwareVersion: { type: 'string', maxLength: 80 },
    capabilities: { type: 'object', additionalProperties: { type: 'boolean' } }, status: { type: 'string', enum: ['Pending', 'Registered', 'Revoked'] },
  }, additionalProperties: false,
} as const;
const marketplaceDeviceRevokeBody = {
  type: 'object', properties: { reason: { type: 'string', minLength: 3, maxLength: 500 } }, additionalProperties: false,
} as const;
const marketplaceCatalogueMappingBody = {
  type: 'object', required: ['vendorId', 'garmentId', 'serviceId', 'marketplaceCategoryId', 'marketplaceServiceId', 'publicName', 'pricePaise', 'pricingUnit', 'effectiveFrom'], properties: {
    id: { type: 'string', minLength: 1, maxLength: 160 }, vendorId: { type: 'string', minLength: 1, maxLength: 120 }, garmentId: { type: 'string', minLength: 1, maxLength: 160 }, serviceId: { type: 'string', minLength: 1, maxLength: 160 },
    marketplaceCategoryId: { type: 'string', minLength: 1, maxLength: 160 }, marketplaceServiceId: { type: 'string', minLength: 1, maxLength: 160 }, publicName: { type: 'string', minLength: 1, maxLength: 240 }, publicDescription: { type: 'string', maxLength: 1000 },
    pricePaise: { type: 'integer', minimum: 0 }, pricingUnit: { type: 'string', enum: ['Piece', 'Kilogram', 'Pair', 'Square Foot'] }, minQuantityMilli: { type: 'integer', minimum: 1 }, turnaroundMinutes: { type: 'integer', minimum: 0 },
    expressEligible: { type: 'boolean' }, marketplaceVisible: { type: 'boolean' }, version: { type: 'integer', minimum: 1 }, effectiveFrom: { type: 'string', minLength: 10, maxLength: 10 }, effectiveUntil: { type: 'string', minLength: 10, maxLength: 10 }, approvalStatus: { type: 'string', enum: ['Draft', 'PendingReview', 'Approved', 'Rejected', 'Retired'] },
  }, additionalProperties: false,
} as const;
const marketplaceCatalogueQuery = { type: 'object', properties: { vendorId: { type: 'string', maxLength: 120 }, visibleOnly: { type: 'boolean' } }, additionalProperties: false } as const;
const marketplaceCustomerLinkBody = {
  type: 'object', required: ['customerId', 'channel', 'externalCustomerId'], properties: {
    id: { type: 'string', minLength: 1, maxLength: 160 }, customerId: { type: 'string', minLength: 1, maxLength: 160 }, externalCustomerId: { type: 'string', minLength: 1, maxLength: 160 },
    channel: { type: 'string', enum: ['CUSTOMER_APP', 'WEBSITE', 'VENDOR_APP', 'MARKETPLACE', 'ADMIN', 'IMPORT'] },
  }, additionalProperties: false,
} as const;
const marketplaceCustomerLinkQuery = { type: 'object', properties: { customerId: { type: 'string', maxLength: 160 } }, additionalProperties: false } as const;
const marketplacePaymentWebhookParams = {
  type: 'object', required: ['provider'],
  properties: { provider: { type: 'string', pattern: '^[a-z0-9][a-z0-9._-]{0,63}$' } }, additionalProperties: false,
} as const;
const marketplacePaymentWebhookBody = {
  type: 'object', required: ['eventId', 'paymentIntent', 'status', 'amountPaise', 'currency', 'occurredAt', 'payload'],
  properties: {
    eventId: { type: 'string', minLength: 1, maxLength: 200 },
    paymentIntent: { type: 'string', minLength: 1, maxLength: 200 },
    status: { type: 'string', enum: ['Captured', 'Failed', 'Refunded', 'Chargeback'] },
    amountPaise: { type: 'integer', minimum: 0 },
    currency: { type: 'string', enum: ['INR'] },
    occurredAt: { type: 'string', minLength: 1, maxLength: 80 },
    payload: { type: 'object', additionalProperties: true },
  }, additionalProperties: false,
} as const;
const captureWebhookRawBody = async (req: any, _rep: any, payload: AsyncIterable<Buffer | string>) => {
  const captured: Buffer[] = [];
  for await (const chunk of payload) captured.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const body = Buffer.concat(captured);
  req.rawBody = body.toString('utf8');
  const replay = Readable.from([body]);
  (replay as any).receivedEncodedLength = body.length;
  return replay;
};

function sessionCookie(token: string, maxAgeSeconds: number) {
  return `epic_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}

function validateRestorePayload(input: any, tenant: string, storeId: string) {
  const { backupFormat, backupVersion, checksum, tenant: backupTenant, storeId: backupStoreId, createdAt: _createdAt, migrations: _migrations, ...db } = input || {};
  if (backupFormat !== undefined) {
    if (backupFormat !== 'epic-laundry-backup' || backupVersion !== 1 || typeof checksum !== 'string' || !/^[a-f0-9]{64}$/.test(checksum)) throw new Error('invalid backup envelope');
    if (backupTenant !== tenant || backupStoreId !== storeId) throw new Error('backup belongs to another workspace');
    const actual = createHash('sha256').update(JSON.stringify(db), 'utf8').digest('hex');
    if (actual !== checksum) throw new Error('backup checksum mismatch');
  }
  if (!db || !Array.isArray(db.rows) || !Array.isArray(db.gl) || !Array.isArray(db.audit) || !Array.isArray(db.outbox) || !Array.isArray(db.stock) || !Array.isArray(db.ims) || (db.seq !== undefined && (typeof db.seq !== 'object' || Array.isArray(db.seq)))) throw new Error('invalid backup payload');
  return db;
}

export function registerApi(app: FastifyInstance) {
  // ---- health / meta ----
  app.get('/api/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));
  app.get('/api/workspace/status', async () => ({
    mode: process.env.EPIC_WORKSPACE_MODE === 'demo' ? 'demo' : 'production',
  }));
  app.get('/api/entities', async () => listDefs().map((d) => ({
    name: d.name, label: d.label, kind: d.kind, module: d.module,
    fields: d.fields, lifecycle: d.lifecycle,
  })));

  // ---- auth guard for mutating/reading routes ----
  const guard = async (req: any, rep: any) => {
    const internalKey = String(req.headers['x-epic-internal-key'] || '');
    if (internalKey && process.env.EPIC_INTERNAL_API_KEY && internalKey === process.env.EPIC_INTERNAL_API_KEY) {
      req.auth = { identityId: 'desktop-system', actor: 'desktop-system', tenant: TENANT, storeId: 'STORE-DEFAULT', roles: ['owner'], sessionHash: 'desktop-internal' } satisfies AuthContext;
      store.enterStoreScope(req.auth.tenant, req.auth.storeId);
      return;
    }
    const auth = contextForToken(readSessionToken(req.headers));
    if (!auth) return rep.code(401).send({ error: 'authentication required' });
    req.auth = auth;
    store.enterStoreScope(auth.tenant, auth.storeId);
  };
  const allow = (permission: string) => async (req: any, rep: any) => {
    if (!req.auth || !can(req.auth, permission)) return rep.code(403).send({ error: 'permission denied' });
  };
  const allowAny = (...permissions: string[]) => async (req: any, rep: any) => {
    if (!req.auth || !permissions.some((permission) => can(req.auth, permission))) return rep.code(403).send({ error: 'permission denied' });
  };
  const idempotent = <T>(req: any, scope: string, work: () => T) => {
    const key = String(req.headers['idempotency-key'] || '').trim();
    if (!key || key.length > 160) throw new Error('a valid idempotency key is required');
    const auth = req.auth as AuthContext;
    const requestHash = createHash('sha256').update(JSON.stringify(req.body === undefined ? null : req.body)).digest('hex');
    let conflict = false;
    const result = store.transaction(() => {
      const previous = store.idempotencyRecord<T>(auth.tenant, scope, key);
      if (previous) {
        if (previous.requestHash && previous.requestHash !== requestHash) {
          conflict = true;
          return undefined as T;
        }
        return previous.response;
      }
      const result = work();
      store.recordIdempotencyResult(auth.tenant, scope, key, result, requestHash);
      return result;
    });
    if (conflict) {
      audit(auth.tenant, auth.actor, 'ops:idempotency-conflict', { after: { scope, keyHash: createHash('sha256').update(key).digest('hex'), requestHash } });
      throw new Error('idempotency key was already used for a different command payload; use a new key or resolve the conflict');
    }
    return result;
  };
  const inStore = <T>(req: any, work: () => T) => store.withStoreScope(req.auth!.tenant, req.auth!.storeId, work);
  // Fire-and-forget: a completed walk-in sale is pushed to the cloud as a
  // "Laundry Store" order if the customer's phone matches a real account —
  // never blocks or fails the local booking. Separate store-scope wrap since
  // this runs after the request's own inStore(...) call has already returned.
  const pushBookedStoreOrder = (req: any, result: any) => {
    if (!result?.order) return;
    const tenant = req.auth!.tenant, actor = req.auth!.actor, storeId = req.auth!.storeId;
    store.withStoreScope(tenant, storeId, () => {
      void pushStoreOrderIfLinked(tenant, actor, result.order).catch(() => {});
    });
  };
  const laundryFailure = (rep: any, error: unknown) => {
    if (error instanceof TagRetiredError) return rep.code(409).send({ code: error.code, error: error.message, details: error.details });
    if (error instanceof LaundryDomainError) return rep.code(error.code === 'TAG_RETIRED' ? 409 : 400).send({ code: error.code, error: error.message, details: error.details });
    return rep.code(400).send({ error: error instanceof Error ? error.message : String(error || 'laundry operation failed') });
  };
  const cloudErrorStatus = (error: unknown) => {
    // A losing race against another client is a conflict, not a server fault.
    if (error instanceof CloudOrderConflictError) return 409;
    if (error instanceof Error && error.message === 'CLOUD_ORDER_NOT_SYNCED') return 404;
    if (error instanceof Error && error.message === 'CLOUD_ORDER_REJECT_REASON_REQUIRED') return 400;
    if (error instanceof Error && error.message === 'CLOUD_ORDER_STATUS_UNREADABLE') return 502;
    if (error instanceof CloudClientError) {
      // The marketplace refusing an action because of the order's current
      // state is a precondition the operator can act on, not a bad request.
      // Checked first: the generic fallthrough below would otherwise swallow it.
      if (error.remoteCode === 'INVALID_STAGE' || error.remoteCode === 'INVALID_TRANSITION') return 409;
      // 401 is the right status here (wrong OTP, or a dead connector token) —
      // but note the webapp's fetch wrapper (webapp/src/lib/api.ts) must NOT
      // treat THIS 401 the same as the operator's own Desktop session dying,
      // since `code: 'CLOUD_AUTH_FAILED'` is how it tells the two apart.
      if (error.code === 'CLOUD_AUTH_FAILED') return 401;
      if (error.code === 'CLOUD_NOT_CONFIGURED') return 409;
      if (error.code === 'CLOUD_TIMEOUT' || error.code === 'CLOUD_UNREACHABLE') return 502;
      return 400;
    }
    if (error instanceof Error && (error.message === 'CLOUD_NOT_CONFIGURED' || error.message === 'CLOUD_NOT_CONNECTED' || error.message === 'CLOUD_VENDOR_NOT_LINKED' || error.message === 'PLATFORM_NOT_CONNECTED')) return 409;
    if (error instanceof Error && (error.message === 'CLOUD_CONNECT_INPUT_REQUIRED' || error.message === 'PLATFORM_CONNECT_INPUT_REQUIRED' || error.message === 'PLATFORM_2FA_REQUIRED' || error.message.startsWith('PLATFORM_LOGIN_MISSING_FIELD'))) return 400;
    if (error instanceof Error && error.message.startsWith('CLOUD_ORDER_UNKNOWN_STATUS')) return 502;
    if (error instanceof Error && error.message === 'CLOUD_ORDER_LIST_UNEXPECTED_RESPONSE') return 502;
    if (error instanceof Error && error.message === 'CLOUD_ORDER_DETAIL_UNEXPECTED_RESPONSE') return 502;
    if (error instanceof Error && (error.message === 'CLOUD_RECONCILIATION_EVIDENCE_REQUIRED' || error.message === 'CLOUD_RECONCILIATION_EMPTY' || error.message === 'CLOUD_ORDER_STAGE_INVALID')) return 400;
    return 400;
  };
  const cloudErrorBody = (error: unknown) => {
    if (error instanceof CloudOrderConflictError) {
      // The operator needs the remote truth, not just "it failed" — that is
      // what lets them see the order was taken/rejected elsewhere.
      return { code: error.code, error: error.message, remoteStatus: error.remoteStatus, attempted: error.attempted };
    }
    const code = error instanceof CloudClientError ? error.code : (error instanceof Error ? error.message : 'CLOUD_ERROR');
    const message = error instanceof Error ? error.message : String(error || 'Cloud connector operation failed');
    const hint = cloudProgressErrorHint(error);
    // `remoteCode` is the marketplace's own reason; keeping it distinct from
    // our transport-level code is what lets a caller act on the precondition.
    return { code, error: message, ...(error instanceof CloudClientError && error.remoteCode ? { remoteCode: error.remoteCode } : {}), ...(hint ? { hint } : {}) };
  };

  app.get('/api/auth/bootstrap-status', async () => ({ needsBootstrap: store.authIdentityCount() === 0 }));
  app.post('/api/auth/bootstrap', async (req: any, rep: any) => {
    try {
      const body = req.body as any;
      const identity = bootstrapOwner({
        username: body?.username, password: body?.password,
        tenant: body?.tenant, storeId: body?.storeId,
        firstName: body?.firstName, lastName: body?.lastName, email: body?.email, phone: body?.phone,
      });
      // Production starts without fabricated business activity. Catalogue defaults are
      // neutral master data, created only after the owner explicitly completes setup.
      store.withStoreScope(identity.tenant, identity.storeId, () => {
        seedLaundryDefaults(identity.tenant);
        store.saveStoreSettings(identity.tenant, identity.username, {
          businessName: body?.businessName,
          address: body?.address,
          phone: body?.phone,
          email: body?.email,
          upiId: body?.upiId,
          taxMode: body?.taxMode,
          gstin: body?.gstin,
          currency: body?.currency,
          timezone: body?.timezone,
          printerProfile: body?.printerProfile,
        }, identity.storeId);
        const setupProgress = store.saveSetupProgress(identity.tenant, identity.username, { business: true, owner: true, operations: true }, identity.storeId);
        audit(identity.tenant, identity.username, 'settings:setup-progress-updated', { entity: 'store_settings', row_id: identity.storeId, after: { ...setupProgress, source: 'bootstrap' } });
      });
      const signedIn = signIn(identity.username, (req.body as any).password);
      rep.header('Set-Cookie', sessionCookie(signedIn.token, 60 * 60 * 12));
      return { user: { username: signedIn.context.actor, roles: signedIn.context.roles, tenant: signedIn.context.tenant, storeId: signedIn.context.storeId }, expiresAt: signedIn.expiresAt };
    } catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/auth/sign-in', async (req: any, rep: any) => {
    try {
      const signedIn = signIn((req.body as any)?.username, (req.body as any)?.password);
      rep.header('Set-Cookie', sessionCookie(signedIn.token, 60 * 60 * 12));
      return { user: { username: signedIn.context.actor, roles: signedIn.context.roles, tenant: signedIn.context.tenant, storeId: signedIn.context.storeId }, expiresAt: signedIn.expiresAt };
    } catch (error: any) { return rep.code(401).send({ error: error.message }); }
  });
  // Production-workspace login gate — the one way into this app for a real
  // vendor: phone+OTP against the real backend, replacing local username/
  // password. Deliberately UNAUTHENTICATED (no `guard`): there is no local
  // session yet at this point, by definition. The demo workspace keeps its
  // own separate bootstrap/sign-in above, untouched.
  app.post('/api/auth/cloud/otp', async (req: any, rep: any) => {
    try { return await requestLoginOtp(String((req.body as any)?.phone || '')); }
    catch (error: any) { return rep.code(error instanceof CloudLoginError ? 400 : cloudErrorStatus(error)).send(error instanceof CloudLoginError ? { code: error.code, error: error.message } : cloudErrorBody(error)); }
  });
  app.post('/api/auth/cloud/verify', async (req: any, rep: any) => {
    try {
      const freshInstall = isFreshInstall();
      const result = await authenticateWithCloud({ phone: String((req.body as any)?.phone || ''), otp: String((req.body as any)?.otp || '') });
      if (freshInstall || result.isNewIdentity) {
        // Real approved catalogue in, generic starter catalogue never seeded
        // for a cloud-authenticated identity — matches production's actual
        // vendor data from the first moment, not a placeholder set the owner
        // would otherwise have to clear out by hand.
        store.withStoreScope(result.context.tenant, result.context.storeId, () => {
          void syncLocalCatalogueFromCloud(result.context.tenant, result.context.actor).catch(() => {
            // Best-effort: a slow/unreachable first sync must never block login
            // itself. The Marketplace catalogue page's own manual "Sync" button
            // covers a retry.
          });
        });
      }
      rep.header('Set-Cookie', sessionCookie(result.token, 60 * 60 * 12));
      return { user: { username: result.context.actor, roles: result.context.roles, tenant: result.context.tenant, storeId: result.context.storeId }, expiresAt: result.expiresAt };
    } catch (error: any) {
      if (error instanceof CloudLoginError) return rep.code(403).send({ code: error.code, error: error.message });
      return rep.code(cloudErrorStatus(error)).send(cloudErrorBody(error));
    }
  });
  app.post('/api/auth/sign-out', { preHandler: guard }, async (req: any, rep: any) => {
    signOut(readSessionToken(req.headers));
    rep.header('Set-Cookie', sessionCookie('', 0));
    return { ok: true };
  });
  app.post('/api/auth/change-password', { preHandler: guard }, async (req: any, rep: any) => {
    try {
      changePassword(req.auth!, String((req.body as any)?.currentPassword || ''), String((req.body as any)?.newPassword || ''));
      return { ok: true };
    } catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/auth/switch-store', { preHandler: guard }, async (req: any, rep: any) => {
    try {
      const switched = switchOperationalStore(req.auth!, String((req.body as any)?.storeId || ''));
      const token = readSessionToken(req.headers);
      if (token) rep.header('Set-Cookie', sessionCookie(token, 60 * 60 * 12));
      return { user: { username: req.auth!.actor, roles: switched.roles, tenant: req.auth!.tenant, storeId: switched.store.id, riderId: req.auth!.riderId || null }, store: switched.store };
    } catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/settings/stores', { preHandler: [guard, allow('staff.manage')] }, async (req: any) => listOperationalStores(req.auth!));
  app.post('/api/settings/stores', { preHandler: [guard, allow('staff.manage')] }, async (req: any, rep: any) => {
    try {
      return inStore(req, () => {
        const created = createOperationalStore(req.auth!, { name: (req.body as any)?.name, code: (req.body as any)?.code });
        audit(req.auth!.tenant, req.auth!.actor, 'settings:store-created', { entity: 'store', row_id: created.id, after: created });
        return rep.code(201).send(created);
      });
    } catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/settings/staff', { preHandler: [guard, allow('staff.manage')] }, async (req: any) =>
    store.listIdentities(req.auth!.tenant, req.auth!.storeId).map(({ passwordHash: _passwordHash, ...user }) => user),
  );
  app.post('/api/settings/staff', { preHandler: [guard, allow('staff.manage')] }, async (req: any, rep: any) => {
    try {
      return inStore(req, () => {
        const body = req.body as any;
        const identity = createOperationalUser(req.auth!, { username: body?.username, password: body?.password, roles: body?.roles, storeId: body?.storeId || req.auth!.storeId, firstName: body?.firstName, lastName: body?.lastName, email: body?.email, phone: body?.phone, description: body?.description, riderId: body?.riderId });
        audit(req.auth!.tenant, req.auth!.actor, 'settings:staff-created', { entity: 'auth_identity', row_id: identity.id, after: { username: identity.username, roles: identity.roles, enabled: identity.enabled, riderId: identity.riderId || '', firstName: identity.firstName, lastName: identity.lastName, email: identity.email, phone: identity.phone, description: identity.description } });
        const { passwordHash: _passwordHash, ...safeIdentity } = identity;
        return rep.code(201).send(safeIdentity);
      });
    } catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.patch('/api/settings/staff/:id', { preHandler: [guard, allow('staff.manage')] }, async (req: any, rep: any) => {
    try {
      return inStore(req, () => {
        const before = store.identityById(req.params.id);
        const body = req.body as any;
        const identity = updateOperationalUser(req.auth!, req.params.id, { firstName: body?.firstName, lastName: body?.lastName, email: body?.email, phone: body?.phone, description: body?.description, roles: body?.roles, enabled: body?.enabled, riderId: body?.riderId });
        audit(req.auth!.tenant, req.auth!.actor, 'settings:staff-updated', { entity: 'auth_identity', row_id: identity.id, before: before ? { username: before.username, roles: before.roles, enabled: before.enabled, riderId: before.riderId || '', firstName: before.firstName, lastName: before.lastName, email: before.email, phone: before.phone, description: before.description } : undefined, after: { username: identity.username, roles: identity.roles, enabled: identity.enabled, riderId: identity.riderId || '', firstName: identity.firstName, lastName: identity.lastName, email: identity.email, phone: identity.phone, description: identity.description } });
        const { passwordHash: _passwordHash, ...safeIdentity } = identity;
        return safeIdentity;
      });
    } catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/settings/staff/:id/reset-password', { preHandler: [guard, allow('staff.manage')] }, async (req: any, rep: any) => {
    try {
      return inStore(req, () => {
        resetOperationalUserPassword(req.auth!, req.params.id, String((req.body as any)?.password || ''));
        audit(req.auth!.tenant, req.auth!.actor, 'settings:staff-password-reset', { entity: 'auth_identity', row_id: req.params.id });
        return { ok: true };
      });
    } catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/settings/staff/:id/enabled', { preHandler: [guard, allow('staff.manage')] }, async (req: any, rep: any) => {
    try {
      return inStore(req, () => {
        const identity = setOperationalUserEnabled(req.auth!, req.params.id, Boolean((req.body as any)?.enabled));
        audit(req.auth!.tenant, req.auth!.actor, 'settings:staff-enabled', { entity: 'auth_identity', row_id: identity.id, after: { enabled: identity.enabled } });
        return { id: identity.id, enabled: identity.enabled };
      });
    } catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/settings/store', { preHandler: [guard, allow('settings.manage')] }, async (req: any) =>
    inStore(req, () => store.getStoreSettings(req.auth!.tenant, req.auth!.storeId)),
  );
  app.post('/api/settings/store', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try {
      return inStore(req, () => {
        const before = store.getStoreSettings(req.auth!.tenant, req.auth!.storeId);
        const next = store.saveStoreSettings(req.auth!.tenant, req.auth!.actor, req.body as any, req.auth!.storeId);
        audit(req.auth!.tenant, req.auth!.actor, 'settings:store-updated', { entity: 'store_settings', row_id: req.auth!.storeId, before, after: next });
        return next;
      });
    } catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/settings/setup-progress', { preHandler: [guard, allow('settings.manage')] }, async (req: any) =>
    inStore(req, () => store.getStoreSettings(req.auth!.tenant, req.auth!.storeId).setupProgress),
  );
  app.post('/api/settings/setup-progress', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try {
      const body = req.body as Record<string, unknown>;
      const allowed = ['business', 'owner', 'operations', 'catalogue', 'recovery'] as const;
      const progress = inStore(req, () => store.saveSetupProgress(req.auth!.tenant, req.auth!.actor, Object.fromEntries(allowed.filter((key) => typeof body?.[key] === 'boolean').map((key) => [key, body[key]])) as any, req.auth!.storeId));
      audit(req.auth!.tenant, req.auth!.actor, 'settings:setup-progress-updated', { entity: 'store_settings', row_id: req.auth!.storeId, after: progress });
      return progress;
    } catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/auth/session', async (req: any) => {
    const auth = contextForToken(readSessionToken(req.headers));
    return auth ? { user: { username: auth.actor, roles: auth.roles, tenant: auth.tenant, storeId: auth.storeId, riderId: auth.riderId || null } } : { user: null };
  });

  // ---- Laundry desk: dedicated domain API, kept separate from generic ERP screens ----
  app.get('/api/laundry/catalogue', { preHandler: [guard, allow('catalogue.read')] }, async (req: any) => inStore(req, () => laundryCatalogue(req.auth!.tenant)));
  app.get('/api/laundry/search', { schema: { querystring: laundrySearchQuery }, preHandler: [guard, allowAny('orders.read', 'customers.read', 'garments.read', 'settings.manage')] }, async (req: any) => inStore(req, () => searchLaundryWorkspace(req.auth!.tenant, (req.query as any)?.q, {
    customers: can(req.auth!, 'customers.read'), orders: can(req.auth!, 'orders.read'), garments: can(req.auth!, 'garments.read'), settlements: can(req.auth!, 'settings.manage'),
  })));
  app.post('/api/laundry/catalogue/categories', { preHandler: [guard, allow('catalogue.manage')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => saveLaundryCategory(req.auth!.tenant, req.auth!.actor, req.body as any))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.patch('/api/laundry/catalogue/categories/:id', { preHandler: [guard, allow('catalogue.manage')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => saveLaundryCategory(req.auth!.tenant, req.auth!.actor, req.body as any, req.params.id)); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/catalogue/services', { preHandler: [guard, allow('catalogue.manage')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => saveLaundryService(req.auth!.tenant, req.auth!.actor, req.body as any))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.patch('/api/laundry/catalogue/services/:id', { preHandler: [guard, allow('catalogue.manage')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => saveLaundryService(req.auth!.tenant, req.auth!.actor, req.body as any, req.params.id)); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/catalogue/garments', { preHandler: [guard, allow('catalogue.manage')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => saveLaundryGarment(req.auth!.tenant, req.auth!.actor, req.body as any))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.patch('/api/laundry/catalogue/garments/:id', { preHandler: [guard, allow('catalogue.manage')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => saveLaundryGarment(req.auth!.tenant, req.auth!.actor, req.body as any, req.params.id)); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/catalogue/prices', { preHandler: [guard, allow('catalogue.manage')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => saveLaundryPrice(req.auth!.tenant, req.auth!.actor, req.body as any))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.patch('/api/laundry/catalogue/prices/:id', { preHandler: [guard, allow('catalogue.manage')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => saveLaundryPrice(req.auth!.tenant, req.auth!.actor, req.body as any, req.params.id)); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/catalogue/charges', { preHandler: [guard, allow('catalogue.manage')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => saveLaundryChargeRule(req.auth!.tenant, req.auth!.actor, req.body as any))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.patch('/api/laundry/catalogue/charges/:id', { preHandler: [guard, allow('catalogue.manage')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => saveLaundryChargeRule(req.auth!.tenant, req.auth!.actor, req.body as any, req.params.id)); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/catalogue/discounts', { preHandler: [guard, allow('catalogue.manage')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => saveLaundryDiscountRule(req.auth!.tenant, req.auth!.actor, req.body as any))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.patch('/api/laundry/catalogue/discounts/:id', { preHandler: [guard, allow('catalogue.manage')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => saveLaundryDiscountRule(req.auth!.tenant, req.auth!.actor, req.body as any, req.params.id)); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/catalogue/taxes', { preHandler: [guard, allow('catalogue.manage')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => saveLaundryTaxRule(req.auth!.tenant, req.auth!.actor, req.body as any))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.patch('/api/laundry/catalogue/taxes/:id', { preHandler: [guard, allow('catalogue.manage')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => saveLaundryTaxRule(req.auth!.tenant, req.auth!.actor, req.body as any, req.params.id)); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/catalogue/import', { preHandler: [guard, allow('catalogue.manage')] }, async (req: any, rep: any) => {
    try {
      const result = inStore(req, () => idempotent(req, 'laundry.catalogue-import', () => importLaundryCatalogue(req.auth!.tenant, req.auth!.actor, req.body as any)));
      inStore(req, () => store.saveSetupProgress(req.auth!.tenant, req.auth!.actor, { catalogue: true }, req.auth!.storeId));
      return rep.code(201).send(result);
    } catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/laundry/garment-backfill', { preHandler: [guard, allow('catalogue.manage')] }, async (req: any) => inStore(req, () => previewLaundryGarmentBackfill(req.auth!.tenant)));
  app.get('/api/laundry/garment-assets/audit', { preHandler: [guard, allow('catalogue.manage')] }, async (req: any) => inStore(req, () => auditGarmentAssets(req.auth!.tenant)));
  app.post('/api/laundry/garment-backfill', { preHandler: [guard, allow('catalogue.manage')] }, async (req: any, rep: any) => {
    try { return rep.code(200).send(inStore(req, () => idempotent(req, 'laundry.garment-backfill', () => applyLaundryGarmentBackfill(req.auth!.tenant, req.auth!.actor)))); }
    catch (error: any) { return rep.code(400).send({ error: error.message || 'garment backfill failed' }); }
  });
  app.get('/api/laundry/customers', { preHandler: [guard, allow('customers.read')] }, async (req: any) =>
    inStore(req, () => searchLaundryCustomers(req.auth!.tenant, String((req.query as any)?.search || ''))),
  );
  // A local-only search (above) can never find a real LNDRY App customer
  // who has never bought here before — the app and the POS are separate
  // databases. This asks the real backend directly whether a phone number
  // belongs to a real account, for the booking screen to offer as a
  // one-click "adopt" suggestion when nothing local matches. Best-effort:
  // not connected / a transient network issue is a normal "no match", not
  // a 500 — a vendor typing a phone shouldn't see an error for this.
  app.get('/api/laundry/customers/remote-lookup', { preHandler: [guard, allow('customers.read')] }, async (req: any) => {
    const phone = String((req.query as any)?.phone || '').replace(/\D/g, '');
    if (phone.length < 8) return { match: null };
    try {
      const resolved = await resolveCloudCustomerByPhone(req.auth!.tenant, phone);
      return { match: resolved?.userId ? { userId: resolved.userId, name: resolved.name, phone } : null };
    } catch {
      return { match: null };
    }
  });
  app.post('/api/laundry/customers/adopt-remote', { preHandler: [guard, allow('customers.create')] }, async (req: any, rep: any) => {
    const { userId, name, phone } = (req.body as any) || {};
    if (!userId || !phone) return rep.code(400).send({ error: 'userId and phone are required' });
    try { return rep.code(201).send(inStore(req, () => adoptRemoteCustomer(req.auth!.tenant, req.auth!.actor, { userId, name, phone }))); }
    catch (error: any) { return rep.code(400).send({ error: error.message || 'could not link this real customer' }); }
  });

  // ── Wallet redemption at the counter ────────────────────────────────────
  // A vendor looks a customer up by phone, proposes redeeming part of their
  // real LNDRY wallet balance against a counter sale, and the customer
  // confirms with a one-time code read off their own already-logged-in
  // app. All real business logic (rate limiting, audit logging, the
  // atomic claim+debit) lives on Lndry_backend — these are thin proxies.
  app.post('/api/marketplace/cloud/wallet/lookup', { preHandler: [guard, allow('orders.create')] }, async (req: any, rep: any) => {
    const phone = String((req.body as any)?.phone || '');
    try { return await lookupCloudWalletBalance(req.auth!.tenant, phone); }
    catch (error: any) { return rep.code(cloudErrorStatus(error)).send(cloudErrorBody(error)); }
  });
  app.post('/api/marketplace/cloud/wallet/redemption-requests', { preHandler: [guard, allow('orders.create')] }, async (req: any, rep: any) => {
    const { customerUserId, amountPaise } = (req.body as any) || {};
    if (!customerUserId || !Number.isFinite(amountPaise) || amountPaise <= 0) return rep.code(400).send({ error: 'customerUserId and a positive amountPaise are required' });
    try { return await createCloudWalletRedemptionRequest(req.auth!.tenant, customerUserId, amountPaise); }
    catch (error: any) { return rep.code(cloudErrorStatus(error)).send(cloudErrorBody(error)); }
  });
  app.post('/api/marketplace/cloud/wallet/redemption-requests/:id/confirm', { preHandler: [guard, allow('orders.create')] }, async (req: any, rep: any) => {
    const otp = String((req.body as any)?.otp || '');
    if (!otp) return rep.code(400).send({ error: 'otp is required' });
    try { return await confirmCloudWalletRedemption(req.auth!.tenant, String((req.params as any).id), otp); }
    catch (error: any) { return rep.code(cloudErrorStatus(error)).send(cloudErrorBody(error)); }
  });
  app.post('/api/marketplace/cloud/wallet/redemption-requests/:id/cancel', { preHandler: [guard, allow('orders.create')] }, async (req: any, rep: any) => {
    try { await cancelCloudWalletRedemption(req.auth!.tenant, String((req.params as any).id)); return { cancelled: true }; }
    catch (error: any) { return rep.code(cloudErrorStatus(error)).send(cloudErrorBody(error)); }
  });
  app.get('/api/laundry/customer-insights', { preHandler: [guard, allow('customers.read')] }, async (req: any) =>
    inStore(req, () => customerRetentionInsights(req.auth!.tenant)),
  );
  app.get('/api/laundry/customers/online-only', { preHandler: [guard, allow('customers.read')] }, async (req: any) =>
    inStore(req, () => listOnlineOnlyCustomers(req.auth!.tenant)),
  );
  app.post('/api/laundry/customers', { preHandler: [guard, allow('customers.create')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, 'laundry.customer-create', () => createLaundryCustomer(req.auth!.tenant, req.auth!.actor, req.body as any)))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/laundry/customers/:id', { preHandler: [guard, allow('customers.read')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => customerProfile(req.auth!.tenant, req.params.id)); }
    catch (error: any) { return rep.code(404).send({ error: error.message }); }
  });
  app.get('/api/marketplace/customer-links', { schema: { querystring: marketplaceCustomerLinkQuery }, preHandler: [guard, allow('customers.read')] }, async (req: any) => inStore(req, () => listMarketplaceCustomerLinks(req.auth!.tenant, String((req.query as any)?.customerId || '').trim() || undefined)));
  app.post('/api/marketplace/customer-links', { schema: { body: marketplaceCustomerLinkBody }, preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, `marketplace.customer-link:${req.body.channel}:${req.body.externalCustomerId}`, () => saveMarketplaceCustomerLink(req.auth!.tenant, req.auth!.actor, req.body)))); }
    catch (error: any) { const code = error.message === 'MARKETPLACE_CUSTOMER_ALREADY_LINKED' ? 409 : 400; return rep.code(code).send({ code: error.message, error: error.message }); }
  });
  app.post('/api/marketplace/customer-links/:id/revoke', { schema: { params: laundryIdParams, body: { type: 'object', additionalProperties: false } }, preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => idempotent(req, `marketplace.customer-link-revoke:${req.params.id}`, () => revokeMarketplaceCustomerLink(req.auth!.tenant, req.auth!.actor, req.params.id))); }
    catch (error: any) { return rep.code(400).send({ code: error.message, error: error.message }); }
  });
  app.patch('/api/laundry/customers/:id', { preHandler: [guard, allow('customers.edit')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => updateLaundryCustomer(req.auth!.tenant, req.auth!.actor, req.params.id, req.body as any)); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/laundry/customers/:id/privacy-export', { preHandler: [guard, allow('customers.read')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => exportCustomerPrivacyData(req.auth!.tenant, req.auth!.actor, req.params.id)); } catch (error: any) { return rep.code(404).send({ code: error.message, error: error.message }); }
  });
  app.get('/api/laundry/privacy-requests', { schema: { querystring: customerPrivacyQuery }, preHandler: [guard, allow('settings.manage')] }, async (req: any) => inStore(req, () => listCustomerPrivacyRequests(req.auth!.tenant, String((req.query as any)?.customerId || ''))));
  app.post('/api/laundry/customers/:id/privacy-requests', { schema: { params: laundryIdParams, body: customerPrivacyRequestBody }, preHandler: [guard, allow('customers.edit')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, `privacy-request:${req.params.id}:${req.body?.type}`, () => createCustomerPrivacyRequest(req.auth!.tenant, req.auth!.actor, { customerId: req.params.id, type: req.body?.type, details: req.body?.details })))); } catch (error: any) { return rep.code(400).send({ code: error.message, error: error.message }); }
  });
  app.post('/api/laundry/privacy-requests/:id/complete', { schema: { params: laundryIdParams, body: { type: 'object', properties: { legalHold: { type: 'boolean' }, outcome: { type: 'string', maxLength: 500 } }, additionalProperties: false } }, preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => idempotent(req, `privacy-request-complete:${req.params.id}`, () => completeCustomerPrivacyRequest(req.auth!.tenant, req.auth!.actor, req.params.id, req.body || {}))); } catch (error: any) { return rep.code(400).send({ code: error.message, error: error.message }); }
  });
  app.get('/api/laundry/customers/:id/addresses', { preHandler: [guard, allow('customers.read')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => listLaundryCustomerAddresses(req.auth!.tenant, req.params.id)); } catch (error: any) { return rep.code(404).send({ error: error.message }); }
  });
  app.post('/api/laundry/customers/:id/addresses', { preHandler: [guard, allow('customers.edit')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => idempotent(req, `customer-address:${req.params.id}`, () => saveLaundryCustomerAddress(req.auth!.tenant, req.auth!.actor, req.params.id, req.body || {}))); } catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.patch('/api/laundry/customers/:id/addresses/:addressId', { preHandler: [guard, allow('customers.edit')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => idempotent(req, `customer-address:${req.params.id}`, () => saveLaundryCustomerAddress(req.auth!.tenant, req.auth!.actor, req.params.id, req.body || {}, req.params.addressId))); } catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/customers/:id/addresses/:addressId/archive', { preHandler: [guard, allow('customers.edit')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => idempotent(req, `customer-address-archive:${req.params.id}`, () => archiveLaundryCustomerAddress(req.auth!.tenant, req.auth!.actor, req.params.id, req.params.addressId))); } catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/customers/:id/wallet', { preHandler: [guard, allow('wallet.manage')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, `laundry.customer-wallet:${req.params.id}`, () => applyWalletCommand(req.auth!.tenant, req.auth!.actor, req.params.id, req.body as any)))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/customers/:id/rewards', { preHandler: [guard, allow('rewards.manage')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, `laundry.customer-rewards:${req.params.id}`, () => adjustRewards(req.auth!.tenant, req.auth!.actor, req.params.id, req.body as any)))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/laundry/packages', { preHandler: [guard, allow('packages.read')] }, async (req: any) => inStore(req, () => listServicePackages(req.auth!.tenant, String((req.query as any)?.includeInactive || '') === 'true')));
  app.get('/api/laundry/package-liability', { preHandler: [guard, allowAny('packages.read', 'reports.read')] }, async (req: any) => inStore(req, () => packageLiability(req.auth!.tenant, { customerId: String((req.query as any)?.customerId || '').trim() || undefined })));
  app.post('/api/laundry/packages', { preHandler: [guard, allow('packages.manage')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, 'laundry.package-create', () => createServicePackage(req.auth!.tenant, req.auth!.actor, req.body as any)))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/laundry/customers/:id/packages', { preHandler: [guard, allow('packages.read')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => customerPackages(req.auth!.tenant, req.params.id)); }
    catch (error: any) { return rep.code(404).send({ error: error.message }); }
  });
  app.post('/api/laundry/customers/:id/packages', { preHandler: [guard, allow('packages.sell')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, `laundry.package-purchase:${req.params.id}`, () => purchaseServicePackage(req.auth!.tenant, req.auth!.actor, { ...(req.body as any), customer: req.params.id })))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/customer-packages/:id/redemptions', { preHandler: [guard, allow('packages.redeem')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, `laundry.package-redemption:${req.params.id}`, () => redeemServicePackage(req.auth!.tenant, req.auth!.actor, { ...(req.body as any), customerPackage: req.params.id })))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/customer-packages/:id/payments', { preHandler: [guard, allow('packages.sell')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, `laundry.package-payment:${req.params.id}`, () => collectServicePackagePayment(req.auth!.tenant, req.auth!.actor, req.params.id, req.body as any)))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/laundry/dashboard', { preHandler: [guard, allow('orders.read')] }, async (req: any) =>
    inStore(req, () => laundryDashboard(req.auth!.tenant, String((req.query as any)?.asOf || laundryBusinessDate()))),
  );
  // Marketplace control-plane data is intentionally limited to the authenticated store scope.
  // The desktop never exposes its loopback Fastify service as a public marketplace endpoint.
  app.get('/api/marketplace/sync/status', { preHandler: [guard, allow('orders.read')] }, async (req: any) =>
    inStore(req, () => marketplaceSyncStatus(req.auth!.tenant)),
  );
  app.post('/api/marketplace/device/enrollment', { preHandler: [guard, allow('settings.manage')] }, async (req: any) =>
    inStore(req, () => ({ ...createDeviceEnrollment(), storage: 'one-time-response-only', activation: 'EXTERNAL_MARKETPLACE_ACTIVATION_REQUIRED' })),
  );
  app.put('/api/marketplace/device', { schema: { body: marketplaceDeviceRegistrationBody }, preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try {
      return inStore(req, () => {
        const status = String(req.body.status || 'Pending');
        if (status === 'Registered') throw new Error('DEVICE_ACTIVATION_REQUIRED');
        return registerMarketplaceDevice(req.auth!.tenant, req.auth!.actor, req.body);
      });
    } catch (error: any) { return rep.code(error.message === 'DEVICE_ACTIVATION_REQUIRED' ? 409 : 400).send({ code: error.message, error: error.message }); }
  });
  app.post('/api/marketplace/device/revoke', { schema: { body: marketplaceDeviceRevokeBody }, preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try {
      return inStore(req, () => {
        const current = store.getMarketplaceDevice(req.auth!.tenant);
        if (!current) throw new Error('MARKETPLACE_DEVICE_NOT_FOUND');
        const result = registerMarketplaceDevice(req.auth!.tenant, req.auth!.actor, { ...current, status: 'Revoked' });
        audit(req.auth!.tenant, req.auth!.actor, 'marketplace:device-revoked', { entity: 'marketplace_device', row_id: result.id, after: { reason: String(req.body?.reason || '').trim().slice(0, 500) || undefined } });
        return result;
      });
    } catch (error: any) { return rep.code(error.message === 'MARKETPLACE_DEVICE_NOT_FOUND' ? 404 : 400).send({ code: error.message, error: error.message }); }
  });
  // Cloud connector — connects this store to a real LNDRY Cloud Backend
  // vendor account (phone+OTP, the same flow Vendor App uses). Separate from
  // the marketplace device/outbox-inbox concepts above, which have no
  // matching protocol on the real backend today — see cloud-client.ts.
  app.post('/api/marketplace/cloud/otp', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { return await requestCloudOtp(String((req.body as any)?.phone || '')); }
    catch (error: any) { return rep.code(cloudErrorStatus(error)).send(cloudErrorBody(error)); }
  });
  app.post('/api/marketplace/cloud/connect', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try {
      const result = await connectCloudSession(req.auth!.tenant, req.auth!.actor, req.body as any);
      audit(req.auth!.tenant, req.auth!.actor, 'marketplace:cloud-connected', { entity: 'marketplace_cloud_session', row_id: req.auth!.tenant, after: { remoteVendorName: result.remoteVendorName } });
      return result;
    } catch (error: any) { return rep.code(cloudErrorStatus(error)).send(cloudErrorBody(error)); }
  });
  app.get('/api/marketplace/cloud/status', { preHandler: [guard, allow('orders.read')] }, async (req: any) =>
    getCloudConnectionStatus(req.auth!.tenant),
  );
  app.get('/api/marketplace/cloud/sync-health', { preHandler: [guard, allow('orders.read')] }, async (req: any) =>
    inStore(req, () => store.getMarketplaceCloudSyncHealth(req.auth!.tenant)),
  );
  app.post('/api/marketplace/cloud/disconnect', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try {
      const result = await disconnectCloudSession(req.auth!.tenant);
      audit(req.auth!.tenant, req.auth!.actor, 'marketplace:cloud-disconnected', { entity: 'marketplace_cloud_session', row_id: req.auth!.tenant });
      return result;
    } catch (error: any) { return rep.code(cloudErrorStatus(error)).send(cloudErrorBody(error)); }
  });
  app.get('/api/marketplace/cloud/vendor-profile', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { return await fetchConnectedVendorProfile(req.auth!.tenant); }
    catch (error: any) { return rep.code(cloudErrorStatus(error)).send(cloudErrorBody(error)); }
  });
  app.post('/api/marketplace/cloud/sync-orders', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { return await pullCloudOrders(req.auth!.tenant, req.auth!.actor); }
    catch (error: any) { return rep.code(cloudErrorStatus(error)).send(cloudErrorBody(error)); }
  });
  // Accept/reject go to the cloud first (it owns the marketplace decision) and
  // only then update local state — see cloud-order-actions.ts.
  app.post('/api/marketplace/cloud/orders/:externalOrderId/accept', { schema: { params: marketplaceOrderParams }, preHandler: [guard, allow('orders.edit')] }, async (req: any, rep: any) => {
    try { return await acceptCloudOrder(req.auth!.tenant, req.auth!.actor, req.params.externalOrderId); }
    catch (error: any) { return rep.code(cloudErrorStatus(error)).send(cloudErrorBody(error)); }
  });
  app.post('/api/marketplace/cloud/orders/:externalOrderId/reject', { schema: { params: marketplaceOrderParams, body: marketplaceCloudRejectBody }, preHandler: [guard, allow('orders.edit')] }, async (req: any, rep: any) => {
    try { return await rejectCloudOrder(req.auth!.tenant, req.auth!.actor, req.params.externalOrderId, String((req.body as any)?.reason || '')); }
    catch (error: any) { return rep.code(cloudErrorStatus(error)).send(cloudErrorBody(error)); }
  });
  app.post('/api/marketplace/cloud/orders/:externalOrderId/detail-sync', { schema: { params: marketplaceOrderParams }, preHandler: [guard, allow('orders.read')] }, async (req: any, rep: any) => {
    try { return await syncCloudOrderDetail(req.auth!.tenant, req.auth!.actor, req.params.externalOrderId); }
    catch (error: any) { return rep.code(cloudErrorStatus(error)).send(cloudErrorBody(error)); }
  });
  app.post('/api/marketplace/cloud/orders/:externalOrderId/stage', { schema: { params: marketplaceOrderParams, body: marketplaceCloudStageBody }, preHandler: [guard, allow('orders.edit')] }, async (req: any, rep: any) => {
    try { return await advanceCloudOrderStage(req.auth!.tenant, req.auth!.actor, req.params.externalOrderId, (req.body as any).stage as CloudOrderStage, { deliverySlotLabel: (req.body as any).deliverySlotLabel, deliverySlotAt: (req.body as any).deliverySlotAt }); }
    catch (error: any) { return rep.code(cloudErrorStatus(error)).send(cloudErrorBody(error)); }
  });
  app.post('/api/marketplace/cloud/orders/:externalOrderId/reconcile', { schema: { params: marketplaceOrderParams, body: marketplaceCloudReconcileBody }, preHandler: [guard, allow('orders.edit')] }, async (req: any, rep: any) => {
    try { return await proposeCloudReconciliation(req.auth!.tenant, req.auth!.actor, req.params.externalOrderId, req.body as any); }
    catch (error: any) { return rep.code(cloudErrorStatus(error)).send(cloudErrorBody(error)); }
  });
  // Real marketplace catalogue (vendor_services on the real backend) — see
  // cloud-catalogue.ts's header for why this is narrower than the full
  // shop-garment_rates surface (no create/delete/bulk-update here).
  app.get('/api/marketplace/cloud/catalogue', { preHandler: [guard, allow('catalogue.read')] }, async (req: any, rep: any) => {
    try { return await fetchCloudCatalogue(req.auth!.tenant); }
    catch (error: any) { return rep.code(cloudErrorStatus(error)).send(cloudErrorBody(error)); }
  });
  app.patch('/api/marketplace/cloud/catalogue/:itemId', { schema: { params: marketplaceCatalogueItemParams, body: marketplaceCloudCatalogueUpdateBody }, preHandler: [guard, allow('catalogue.manage')] }, async (req: any, rep: any) => {
    try { return await updateCloudCatalogueItem(req.auth!.tenant, req.params.itemId, req.body as any); }
    catch (error: any) { return rep.code(cloudErrorStatus(error)).send(cloudErrorBody(error)); }
  });
  app.patch('/api/marketplace/cloud/catalogue/:itemId/stock', { schema: { params: marketplaceCatalogueItemParams, body: marketplaceCloudCatalogueStockBody }, preHandler: [guard, allow('catalogue.manage')] }, async (req: any, rep: any) => {
    try { return await updateCloudCatalogueStock(req.auth!.tenant, req.params.itemId, (req.body as any).stockQuantity); }
    catch (error: any) { return rep.code(cloudErrorStatus(error)).send(cloudErrorBody(error)); }
  });
  // Real approved catalogue sync (service_categories/vendor_services — the
  // modern model, distinct from the legacy shop-garment_rates surface
  // above) — pulls this vendor's actual admin-approved services/garments/
  // prices/category-photos into the local POS's own master data.
  app.post('/api/marketplace/cloud/catalogue-sync', { preHandler: [guard, allow('catalogue.manage')] }, async (req: any, rep: any) => {
    try { return await syncLocalCatalogueFromCloud(req.auth!.tenant, req.auth!.actor); }
    catch (error: any) { return rep.code(cloudErrorStatus(error)).send(cloudErrorBody(error)); }
  });
  // Request-a-new-service — the same PENDING -> admin approve/reject
  // lifecycle a vendor application itself goes through on the real backend
  // (service_categories/vendor_services, the modern model — see
  // cloud-vendor-services.ts's header for how this differs from the legacy
  // shop-garment_rates surface above).
  app.get('/api/marketplace/cloud/service-categories', { preHandler: [guard, allow('catalogue.read')] }, async (req: any, rep: any) => {
    try { return await fetchCloudVendorCategories(req.auth!.tenant); }
    catch (error: any) { return rep.code(cloudErrorStatus(error)).send(cloudErrorBody(error)); }
  });
  app.get('/api/marketplace/cloud/my-services', { preHandler: [guard, allow('catalogue.read')] }, async (req: any, rep: any) => {
    try { return await fetchCloudVendorServices(req.auth!.tenant); }
    catch (error: any) { return rep.code(cloudErrorStatus(error)).send(cloudErrorBody(error)); }
  });
  app.get('/api/marketplace/cloud/services/:serviceId', { preHandler: [guard, allow('catalogue.read')] }, async (req: any, rep: any) => {
    try { return await fetchCloudVendorServiceDetails(req.auth!.tenant, req.params.serviceId); }
    catch (error: any) { return rep.code(cloudErrorStatus(error)).send(cloudErrorBody(error)); }
  });
  app.post('/api/marketplace/cloud/services', { preHandler: [guard, allow('catalogue.manage')] }, async (req: any, rep: any) => {
    try { return await createCloudServiceDraft(req.auth!.tenant, req.body as any); }
    catch (error: any) { return rep.code(cloudErrorStatus(error)).send(cloudErrorBody(error)); }
  });
  app.post('/api/marketplace/cloud/services/:serviceId/garment-rates/bulk', { preHandler: [guard, allow('catalogue.manage')] }, async (req: any, rep: any) => {
    try { await bulkUpsertCloudGarmentRates(req.auth!.tenant, req.params.serviceId, (req.body as any).rates); return { success: true }; }
    catch (error: any) { return rep.code(cloudErrorStatus(error)).send(cloudErrorBody(error)); }
  });
  // Real captain (rider) roster sync — identity only (name/phone), never
  // settlement/payout: no real backend data source exists for per-rider
  // handover/cash-collected figures (see cloud-captains.ts's header).
  app.post('/api/marketplace/cloud/captains-sync', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { return await syncLocalCaptainsFromCloud(req.auth!.tenant, req.auth!.actor); }
    catch (error: any) { return rep.code(cloudErrorStatus(error)).send(cloudErrorBody(error)); }
  });
  // Platform Control — a real platform-admin identity (email+password
  // against /admin/auth/login), separate from both the local operator
  // login and the vendor phone+OTP connector above. Gated the same way as
  // the cloud connector's own connect/disconnect (settings.manage) since
  // linking any external identity is equally sensitive; the REAL security
  // boundary is the backend's own ADMIN-only authorization on every
  // /vendors/admin/* route this proxies to (confirmed live: a real
  // VENDOR_OWNER token gets 403 from all of them).
  app.post('/api/platform/connect', { schema: { body: platformConnectBody }, preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try {
      const result = await connectPlatformSession(req.auth!.tenant, req.auth!.actor, req.body as any);
      audit(req.auth!.tenant, req.auth!.actor, 'platform:connected', { entity: 'platform_admin_session', row_id: req.auth!.tenant, after: { email: result.email, isSuperAdmin: result.isSuperAdmin } });
      return result;
    } catch (error: any) { return rep.code(cloudErrorStatus(error)).send(cloudErrorBody(error)); }
  });
  app.get('/api/platform/status', { preHandler: [guard, allow('settings.manage')] }, async (req: any) =>
    getPlatformSessionStatus(req.auth!.tenant),
  );
  app.post('/api/platform/disconnect', { preHandler: [guard, allow('settings.manage')] }, async (req: any) => {
    const result = disconnectPlatformSession(req.auth!.tenant);
    audit(req.auth!.tenant, req.auth!.actor, 'platform:disconnected', { entity: 'platform_admin_session', row_id: req.auth!.tenant });
    return result;
  });
  app.get('/api/platform/vendors', { schema: { querystring: platformVendorQuery }, preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { return await listConnectedPlatformVendors(req.auth!.tenant, req.query || {}); }
    catch (error: any) { return rep.code(cloudErrorStatus(error)).send(cloudErrorBody(error)); }
  });
  app.get('/api/platform/vendors/:vendorId', { schema: { params: platformVendorParams }, preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { return await getConnectedPlatformVendor(req.auth!.tenant, req.params.vendorId); }
    catch (error: any) { return rep.code(cloudErrorStatus(error)).send(cloudErrorBody(error)); }
  });
  app.post('/api/platform/vendors/:vendorId/review', { schema: { params: platformVendorParams, body: platformVendorReviewBody }, preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try {
      const result = await reviewConnectedPlatformVendor(req.auth!.tenant, req.params.vendorId, req.body as any);
      audit(req.auth!.tenant, req.auth!.actor, 'platform:vendor-reviewed', { entity: 'platform_vendor', row_id: req.params.vendorId, after: { status: req.body.status } });
      return result;
    } catch (error: any) { return rep.code(cloudErrorStatus(error)).send(cloudErrorBody(error)); }
  });
  app.get('/api/platform/vendors/:vendorId/capacity', { schema: { params: platformVendorParams }, preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { return await callConnectedPlatformApi(req.auth!.tenant, `/vendors/admin/${encodeURIComponent(req.params.vendorId)}/capacity`); }
    catch (error: any) { return rep.code(cloudErrorStatus(error)).send(cloudErrorBody(error)); }
  });
  app.put('/api/platform/vendors/:vendorId/capacity', { schema: { params: platformVendorParams, body: platformVendorCapacityBody }, preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { return await writeConnectedPlatformApi(req.auth!.tenant, 'PUT', `/vendors/admin/${encodeURIComponent(req.params.vendorId)}/capacity`, req.body as any); }
    catch (error: any) { return rep.code(cloudErrorStatus(error)).send(cloudErrorBody(error)); }
  });
  // A website partner enquiry is deliberately a separate, cloud-owned staging
  // record. This exposes visibility and ownership assignment only; it cannot
  // turn an unaudited lead into a vendor through Desktop.
  app.get('/api/platform/partner-leads', { schema: { querystring: platformPartnerLeadQuery }, preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { return await listConnectedPlatformPartnerLeads(req.auth!.tenant, req.query || {}); }
    catch (error: any) { return rep.code(cloudErrorStatus(error)).send(cloudErrorBody(error)); }
  });
  app.post('/api/platform/partner-leads/:leadId/claim', { schema: { params: platformPartnerLeadParams }, preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try {
      const result = await claimConnectedPlatformPartnerLead(req.auth!.tenant, req.params.leadId);
      audit(req.auth!.tenant, req.auth!.actor, 'platform:partner-lead-claimed', { entity: 'platform_partner_lead', row_id: req.params.leadId });
      return result;
    } catch (error: any) { return rep.code(cloudErrorStatus(error)).send(cloudErrorBody(error)); }
  });
  // Order oversight stays deliberately read-only. The cloud's canonical
  // vendor/rider lifecycle is the authority for pickup, delivery, OTP and
  // payment transitions; this Desktop screen must not route around it via
  // older broad admin-write endpoints.
  app.get('/api/platform/orders', { schema: { querystring: platformOrderQuery }, preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { return await listConnectedPlatformOrders(req.auth!.tenant, req.query || {}); }
    catch (error: any) { return rep.code(cloudErrorStatus(error)).send(cloudErrorBody(error)); }
  });
  app.get('/api/platform/orders/:orderId', { schema: { params: platformOrderParams }, preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { return await getConnectedPlatformOrder(req.auth!.tenant, req.params.orderId); }
    catch (error: any) { return rep.code(cloudErrorStatus(error)).send(cloudErrorBody(error)); }
  });
  // Platform evidence is cloud-owned and append-only. This is deliberately
  // a read-only observation surface; local Desktop audit remains separate.
  app.get('/api/platform/audit-logs', { schema: { querystring: platformAuditQuery }, preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { return await listConnectedPlatformAuditLogs(req.auth!.tenant, req.query || {}); }
    catch (error: any) { return rep.code(cloudErrorStatus(error)).send(cloudErrorBody(error)); }
  });
  // Finance oversight is read-only and cloud-authoritative. In particular,
  // no bank field, payout release, or manual-paid shortcut is bridged into
  // Desktop: a provider-evidenced payout workflow is still required.
  app.get('/api/platform/finance/vendors', { schema: { querystring: platformFinanceVendorQuery }, preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { return await listConnectedPlatformFinanceVendors(req.auth!.tenant, req.query || {}); }
    catch (error: any) { return rep.code(cloudErrorStatus(error)).send(cloudErrorBody(error)); }
  });
  app.get('/api/platform/finance/vendors/:vendorId/financials', { schema: { params: platformVendorParams, querystring: platformFinanceFinancialQuery }, preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { return await listConnectedPlatformVendorFinancials(req.auth!.tenant, req.params.vendorId, req.query || {}); }
    catch (error: any) { return rep.code(cloudErrorStatus(error)).send(cloudErrorBody(error)); }
  });
  app.get('/api/platform/finance/vendors/:vendorId/transactions', { schema: { params: platformVendorParams, querystring: platformFinanceTransactionQuery }, preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { return await listConnectedPlatformVendorTransactions(req.auth!.tenant, req.params.vendorId, req.query || {}); }
    catch (error: any) { return rep.code(cloudErrorStatus(error)).send(cloudErrorBody(error)); }
  });
  app.get('/api/marketplace/catalogue/mappings', { schema: { querystring: marketplaceCatalogueQuery }, preHandler: [guard, allow('catalogue.read')] }, async (req: any) =>
    inStore(req, () => listMarketplaceCatalogueMappings(req.auth!.tenant, { vendorId: req.query?.vendorId, visibleOnly: req.query?.visibleOnly === true })),
  );
  app.post('/api/marketplace/catalogue/mappings', { schema: { body: marketplaceCatalogueMappingBody }, preHandler: [guard, allow('catalogue.manage')] }, async (req: any, rep: any) => {
    try {
      return rep.code(201).send(inStore(req, () => idempotent(req, `marketplace.catalogue-mapping:${req.body.id || `${req.body.vendorId}:${req.body.garmentId}:${req.body.serviceId}:${req.body.effectiveFrom}`}`, () => saveMarketplaceCatalogueMapping(req.auth!.tenant, req.auth!.actor, req.body))));
    } catch (error: any) { return rep.code(error.message === 'MARKETPLACE_CATALOGUE_ID_COLLISION' ? 409 : 400).send({ code: error.message, error: error.message }); }
  });
  app.get('/api/marketplace/availability', { preHandler: [guard, allow('orders.read')] }, async (req: any) => inStore(req, () => marketplaceAvailability(req.auth!.tenant)));
  app.put('/api/marketplace/availability', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => idempotent(req, 'marketplace.availability-update', () => saveMarketplaceAvailability(req.auth!.tenant, req.auth!.actor, req.body || {}))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/marketplace/orders', { schema: { querystring: marketplaceOrderQuery }, preHandler: [guard, allow('orders.read')] }, async (req: any) =>
    inStore(req, () => store.listMarketplaceOrderProjectionPage(req.auth!.tenant, req.query as any)),
  );
  app.get('/api/marketplace/orders/:externalOrderId/truth', { schema: { params: marketplaceOrderParams }, preHandler: [guard, allow('orders.read')] }, async (req: any) =>
    inStore(req, () => marketplaceOrderTruth(req.auth!.tenant, req.params.externalOrderId)),
  );
  app.get('/api/marketplace/orders/:externalOrderId/customer-status', { schema: { params: marketplaceOrderParams }, preHandler: [guard, allow('orders.read')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => customerFacingOrderStatus(req.auth!.tenant, req.params.externalOrderId)); }
    catch (error) { return rep.code(error instanceof Error && error.message === 'marketplace order not found' ? 404 : 422).send({ error: error instanceof Error ? error.message : 'customer status unavailable' }); }
  });
  app.get('/api/marketplace/customer-status-mapping', { preHandler: [guard, allow('orders.read')] }, async (req: any) => inStore(req, () => customerStatusMapping(req.auth!.tenant)));
  app.put('/api/marketplace/customer-status-mapping', { schema: { body: customerStatusMappingBody }, preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => saveCustomerStatusMapping(req.auth!.tenant, req.auth!.actor, req.body || {})); }
    catch (error) { return rep.code(422).send({ error: error instanceof Error ? error.message : 'customer status mapping invalid' }); }
  });
  app.get('/api/marketplace/orders/:externalOrderId/pickup', { schema: { params: marketplaceOrderParams }, preHandler: [guard, allow('orders.read')] }, async (req: any) => inStore(req, () => marketplacePickupTask(req.auth!.tenant, req.params.externalOrderId)));
  app.post('/api/marketplace/orders/:externalOrderId/pickup/schedule', { schema: { params: marketplaceOrderParams, body: marketplacePickupScheduleBody }, preHandler: [guard, allow('orders.edit')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, `marketplace.pickup-schedule:${req.params.externalOrderId}`, () => scheduleMarketplacePickup(req.auth!.tenant, req.auth!.actor, { ...req.body, externalOrderId: req.params.externalOrderId })))); }
    catch (error) { return rep.code(error instanceof Error && error.message === 'marketplace order not found' ? 404 : 422).send({ code: error instanceof Error ? error.message : 'PICKUP_SCHEDULE_FAILED', error: error instanceof Error ? error.message : 'pickup scheduling failed' }); }
  });
  app.post('/api/marketplace/orders/:externalOrderId/pickup/outcome', { schema: { params: marketplaceOrderParams, body: marketplacePickupOutcomeBody }, preHandler: [guard, allow('orders.edit')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => idempotent(req, `marketplace.pickup-outcome:${req.params.externalOrderId}:${req.body.state}`, () => completeMarketplacePickup(req.auth!.tenant, req.auth!.actor, { ...req.body, externalOrderId: req.params.externalOrderId }))); }
    catch (error) { return rep.code(422).send({ code: error instanceof Error ? error.message : 'PICKUP_OUTCOME_FAILED', error: error instanceof Error ? error.message : 'pickup outcome failed' }); }
  });
  app.post('/api/marketplace/settlements', { schema: { body: { type: 'object', required: ['externalOrderId', 'policyVersion', 'customerCollectedPaise', 'vendorServiceGrossPaise', 'commissionBps'], properties: { externalOrderId: { type: 'string', minLength: 1, maxLength: 160 }, policyVersion: { type: 'string', minLength: 1, maxLength: 80 }, customerCollectedPaise: { type: 'integer', minimum: 0 }, refundPaise: { type: 'integer', minimum: 0 }, refundAllocations: { type: 'array', maxItems: 100, items: { type: 'object', required: ['allocationId', 'amountPaise', 'responsibility', 'reason'], properties: { allocationId: { type: 'string', minLength: 1, maxLength: 160 }, amountPaise: { type: 'integer', minimum: 0 }, responsibility: { type: 'string', enum: ['Vendor', 'Platform', 'Shared', 'PendingPolicy'] }, reason: { type: 'string', minLength: 3, maxLength: 500 } }, additionalProperties: false } }, vendorServiceGrossPaise: { type: 'integer', minimum: 0 }, vendorFundedDiscountPaise: { type: 'integer', minimum: 0 }, platformFundedPromotionPaise: { type: 'integer', minimum: 0 }, commissionBps: { type: 'integer', minimum: 0, maximum: 10000 }, paymentFeePaise: { type: 'integer', minimum: 0 }, withholdingPaise: { type: 'integer', minimum: 0 }, adjustmentsPaise: { type: 'integer' } }, additionalProperties: false } }, preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, `marketplace.settlement:${req.body.externalOrderId}:${req.body.policyVersion}`, () => recordMarketplaceSettlement(req.auth!.tenant, req.auth!.actor, req.body)))); }
    catch (error: any) { return rep.code(400).send({ code: error.message, error: error.message }); }
  });
  app.get('/api/marketplace/settlements/:externalOrderId', { schema: { params: marketplaceOrderParams }, preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => inStore(req, () => marketplaceSettlement(req.auth!.tenant, req.params.externalOrderId) || rep.code(404).send({ error: 'marketplace settlement not found' })));
  app.get('/api/marketplace/settlements/:externalOrderId/statement/print', { schema: { params: marketplaceOrderParams }, preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => inStore(req, () => { const statement = marketplaceSettlementStatement(req.auth!.tenant, req.params.externalOrderId); if (!statement || statement.entity !== 'canonical_settlement_statement' || statement.status !== 'Submitted') return rep.code(404).send({ error: 'marketplace settlement statement not found' }); rep.type('text/html; charset=utf-8'); return rep.send(renderCanonicalSettlementStatement(statement.data as CanonicalSettlementStatement)); }));
  app.post('/api/marketplace/settlement-batches', { schema: { body: { type: 'object', required: ['batchId', 'policyVersion', 'settlementIds'], properties: { batchId: { type: 'string', minLength: 1, maxLength: 160 }, policyVersion: { type: 'string', minLength: 1, maxLength: 80 }, settlementIds: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'string', minLength: 1, maxLength: 160 } }, issuedAt: { type: 'string', maxLength: 40 } }, additionalProperties: false } }, preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, `marketplace.settlement-batch:${req.body.batchId}`, () => createSettlementBatch(req.auth!.tenant, req.auth!.actor, req.body)))); }
    catch (error: any) { return rep.code(400).send({ code: error.message, error: error.message }); }
  });
  app.get('/api/marketplace/settlement-batches/:batchId', { schema: { params: settlementBatchParams }, preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => inStore(req, () => settlementBatch(req.auth!.tenant, req.params.batchId) || rep.code(404).send({ error: 'settlement batch not found' })));
  app.post('/api/marketplace/settlement-batches/:batchId/payout-attempts', { schema: { params: settlementBatchParams, body: { type: 'object', required: ['attemptId', 'provider', 'amountPaise', 'idempotencyKey'], properties: { attemptId: { type: 'string', minLength: 1, maxLength: 160 }, provider: { type: 'string', minLength: 1, maxLength: 80 }, amountPaise: { type: 'integer', minimum: 1 }, idempotencyKey: { type: 'string', minLength: 1, maxLength: 160 } }, additionalProperties: false } }, preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, `marketplace.payout-attempt:${req.body.attemptId}`, () => createPayoutAttempt(req.auth!.tenant, req.auth!.actor, { ...req.body, batchId: req.params.batchId })))); }
    catch (error: any) { return rep.code(400).send({ code: error.message, error: error.message }); }
  });
  app.get('/api/marketplace/payout-attempts/:attemptId', { schema: { params: payoutAttemptParams }, preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => inStore(req, () => payoutAttempt(req.auth!.tenant, req.params.attemptId) || rep.code(404).send({ error: 'payout attempt not found' })));
  app.post('/api/marketplace/cash-collections', { schema: { body: { type: 'object', required: ['collectionId', 'externalOrderId', 'amountPaise', 'method', 'collectedBy', 'evidence'], properties: { collectionId: { type: 'string', minLength: 1, maxLength: 160 }, externalOrderId: { type: 'string', minLength: 1, maxLength: 160 }, amountPaise: { type: 'integer', minimum: 0 }, method: { type: 'string', enum: ['CashOnPickup', 'CashOnDelivery'] }, collectedBy: { type: 'string', minLength: 1, maxLength: 160 }, evidence: { type: 'string', minLength: 1, maxLength: 500 } }, additionalProperties: false } }, preHandler: [guard, allow('orders.edit')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, `marketplace.cash-collection:${req.body.collectionId}`, () => recordMarketplaceCashCollection(req.auth!.tenant, req.auth!.actor, req.body)))); }
    catch (error: any) { return rep.code(400).send({ code: error.message, error: error.message }); }
  });
  // Provider callbacks are machine-to-machine and intentionally bypass the human
  // session guard. They remain disabled until the operator explicitly configures
  // the secret and the single local tenant/store that owns this edge adapter.
  // Capture exact bytes before Fastify parses the validated JSON. This keeps the
  // signature boundary compatible with providers that sign raw request bodies.
  app.post('/api/marketplace/payments/webhook/:provider', { bodyLimit: 256 * 1024, preParsing: captureWebhookRawBody, schema: { params: marketplacePaymentWebhookParams, body: marketplacePaymentWebhookBody } }, async (req: any, rep: any) => {
    const secret = String(process.env.EPIC_MARKETPLACE_PROVIDER_SECRET || '');
    const tenant = String(process.env.EPIC_MARKETPLACE_WEBHOOK_TENANT || '');
    const storeId = String(process.env.EPIC_MARKETPLACE_WEBHOOK_STORE_ID || '');
    if (!secret || !tenant || !storeId) return rep.code(503).send({ code: 'PAYMENT_PROVIDER_UNVERIFIED', error: 'provider webhook is not configured for a tenant and store' });
    try {
      const body = req.body as Omit<ProviderPaymentEvent, 'provider'>;
      const rawBody = String(req.rawBody || '');
      if (!rawBody) throw new Error('PAYMENT_WEBHOOK_RAW_BODY_MISSING');
      verifyProviderWebhook({ secret, signature: String(req.headers['x-provider-signature'] || ''), timestamp: String(req.headers['x-provider-timestamp'] || ''), rawBody });
      const event: ProviderPaymentEvent = { ...body, provider: String(req.params.provider), rawBody, signatureVerifiedAt: new Date().toISOString() };
      const row = store.withStoreScope(tenant, storeId, () => recordProviderPaymentEvent(tenant, `provider-webhook:${event.provider}`, event));
      return rep.code(202).send({ accepted: true, eventId: event.eventId, rowId: row.id, idempotent: true });
    } catch (error: any) {
      const code = String(error?.message || 'PAYMENT_PROVIDER_EVENT_INVALID');
      const status = code.startsWith('PAYMENT_WEBHOOK_') ? 401 : 400;
      return rep.code(status).send({ code, error: code });
    }
  });
  app.post('/api/marketplace/notifications', { schema: { body: marketplaceNotificationBody }, preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, `marketplace.notification:${req.body.eventId}:${req.body.channel}`, () => queueMarketplaceNotification(req.auth!.tenant, req.auth!.actor, req.body)))); }
    catch (error: any) { return rep.code(400).send({ code: error.message, error: error.message }); }
  });
  app.post('/api/marketplace/notifications/:eventId/:channel/delivery', { schema: { params: marketplaceNotificationDeliveryParams, body: marketplaceNotificationDeliveryBody }, preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => recordMarketplaceNotificationDelivery(req.auth!.tenant, req.auth!.actor, req.params.eventId, req.params.channel as NotificationChannel, req.body as { state: NotificationState; providerMessageId?: string; error?: string })); }
    catch (error: any) { return rep.code(error.message === 'NOTIFICATION_EVIDENCE_REQUIRED' || error.message === 'NOTIFICATION_FAILURE_REASON_REQUIRED' ? 400 : 404).send({ code: error.message, error: error.message }); }
  });
  app.post('/api/marketplace/orders/:externalOrderId/intake', { schema: { params: marketplaceOrderParams, body: marketplaceIntakeBody }, preHandler: [guard, allow('orders.edit')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => idempotent(req, `marketplace.intake:${req.params.externalOrderId}`, () => recordMarketplaceIntake(req.auth!.tenant, req.auth!.actor, { externalOrderId: req.params.externalOrderId, actual: req.body.actual, reason: req.body.reason }))); }
    catch (error: any) { return rep.code(400).send({ code: error.message, error: error.message }); }
  });
  app.post('/api/marketplace/orders/:externalOrderId/reassessment', { schema: { params: marketplaceOrderParams, body: marketplaceReassessmentBody }, preHandler: [guard, allow('orders.edit')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => idempotent(req, `marketplace.reassessment:${req.params.externalOrderId}`, () => createMarketplaceReassessment(req.auth!.tenant, req.auth!.actor, { ...req.body, externalOrderId: req.params.externalOrderId }))); }
    catch (error: any) { return rep.code(400).send({ code: error.message, error: error.message }); }
  });
  app.post('/api/marketplace/reassessments/:id/approve', { schema: { params: laundryIdParams, body: { type: 'object', additionalProperties: false } }, preHandler: [guard, allow('orders.edit')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => idempotent(req, `marketplace.reassessment-approve:${req.params.id}`, () => decideMarketplaceReassessment(req.auth!.tenant, req.auth!.actor, req.params.id, 'approve'))); }
    catch (error: any) { return rep.code(400).send({ code: error.message, error: error.message }); }
  });
  app.post('/api/marketplace/reassessments/:id/reject', { schema: { params: laundryIdParams, body: { type: 'object', additionalProperties: false } }, preHandler: [guard, allow('orders.edit')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => idempotent(req, `marketplace.reassessment-reject:${req.params.id}`, () => decideMarketplaceReassessment(req.auth!.tenant, req.auth!.actor, req.params.id, 'reject'))); }
    catch (error: any) { return rep.code(400).send({ code: error.message, error: error.message }); }
  });
  app.post('/api/marketplace/orders/:externalOrderId/accept', { schema: { params: marketplaceOrderParams, body: { type: 'object', additionalProperties: false } }, preHandler: [guard, allow('orders.edit')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => idempotent(req, `marketplace.order-accept:${req.params.externalOrderId}`, () => actOnMarketplaceOrder(req.auth!.tenant, req.auth!.actor, req.params.externalOrderId, { action: 'accept' }))); }
    catch (error: any) { return rep.code(400).send({ code: error.message, error: error.message }); }
  });
  app.post('/api/marketplace/orders/:externalOrderId/reject', { schema: { params: marketplaceOrderParams, body: marketplaceRejectBody }, preHandler: [guard, allow('orders.edit')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => idempotent(req, `marketplace.order-reject:${req.params.externalOrderId}`, () => actOnMarketplaceOrder(req.auth!.tenant, req.auth!.actor, req.params.externalOrderId, { action: 'reject', reason: req.body.reason }))); }
    catch (error: any) { return rep.code(400).send({ code: error.message, error: error.message }); }
  });
  app.post('/api/marketplace/orders/:externalOrderId/link', { schema: { params: marketplaceOrderParams, body: marketplaceLinkBody }, preHandler: [guard, allow('orders.edit')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => idempotent(req, `marketplace.order-link:${req.params.externalOrderId}`, () => linkMarketplaceOrderToLocalOrder(req.auth!.tenant, req.auth!.actor, req.params.externalOrderId, req.body.localOrderId))); }
    catch (error: any) { return rep.code(error.message === 'EXTERNAL_ORDER_ALREADY_LINKED' ? 409 : 400).send({ code: error.message, error: error.message }); }
  });
  app.post('/api/marketplace/orders/:externalOrderId/materialize', { schema: { params: marketplaceOrderParams, body: { type: 'object', additionalProperties: false } }, preHandler: [guard, allow('orders.edit')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, `marketplace.order-materialize:${req.params.externalOrderId}`, () => materializeMarketplaceOrder(req.auth!.tenant, req.auth!.actor, req.params.externalOrderId)))); }
    catch (error: any) { return rep.code(400).send({ code: error.message, error: error.message }); }
  });
  app.post('/api/marketplace/inbox/:id/replay', { schema: { params: laundryIdParams, body: { type: 'object', additionalProperties: false } }, preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => idempotent(req, `marketplace.inbox-replay:${req.params.id}`, () => replayHeldMarketplaceOrder(req.auth!.tenant, req.auth!.actor, req.params.id))); }
    catch (error: any) { return rep.code(400).send({ code: error.message, error: error.message }); }
  });
  app.post('/api/laundry/quote', { preHandler: [guard, allow('orders.create')] }, async (req: any, rep: any) => {
    try {
      const body = req.body as any;
      return inStore(req, () => quoteLaundryOrder(req.auth!.tenant, body, body?.customerId || ''));
    } catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/orders', { preHandler: [guard, allow('orders.create')] }, async (req: any, rep: any) => {
    try {
      const result = inStore(req, () => idempotent(req, 'laundry.booking', () => bookLaundryOrder(req.auth!.tenant, req.auth!.actor, req.body as any)));
      pushBookedStoreOrder(req, result);
      return rep.code(201).send(result);
    }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/laundry/order-holds', { preHandler: [guard, allow('orders.hold')] }, async (req: any) => inStore(req, () => listLaundryOrderHolds(req.auth!.tenant, req.auth!.actor, String(req.query?.includeClosed || '') === 'true')));
  app.get('/api/laundry/order-holds/presence', { preHandler: [guard, allow('orders.hold')] }, async (req: any) => inStore(req, () => orderHoldPresence(req.auth!.tenant, req.auth!.actor)));
  app.post('/api/laundry/order-holds', { preHandler: [guard, allow('orders.hold')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, 'laundry.order-hold', () => createLaundryOrderHold(req.auth!.tenant, req.auth!.actor, req.body)))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/order-holds/:id/resume', { preHandler: [guard, allow('orders.hold')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => idempotent(req, `laundry.order-hold-resume:${req.params.id}`, () => resumeLaundryOrderHold(req.auth!.tenant, req.auth!.actor, req.params.id, req.auth!.roles?.includes('owner') === true))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/order-holds/:id/claim', { preHandler: [guard, allow('orders.hold')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => idempotent(req, `laundry.order-hold-claim:${req.params.id}`, () => claimLaundryOrderHold(req.auth!.tenant, req.auth!.actor, req.params.id))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/order-holds/:id/heartbeat', { preHandler: [guard, allow('orders.hold')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => idempotent(req, `laundry.order-hold-heartbeat:${req.params.id}`, () => renewLaundryOrderHold(req.auth!.tenant, req.auth!.actor, req.params.id))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/order-holds/:id/release', { preHandler: [guard, allow('orders.hold')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => idempotent(req, `laundry.order-hold-release:${req.params.id}`, () => releaseLaundryOrderHold(req.auth!.tenant, req.auth!.actor, req.params.id, req.auth!.roles?.includes('owner') === true))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/order-holds/:id/cancel', { preHandler: [guard, allow('orders.hold')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => idempotent(req, `laundry.order-hold-cancel:${req.params.id}`, () => cancelLaundryOrderHold(req.auth!.tenant, req.auth!.actor, req.params.id, req.auth!.roles?.includes('owner') === true))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/laundry/orders', { preHandler: [guard, allow('orders.read')] }, async (req: any) => inStore(req, () => (req.query?.page !== undefined || req.query?.pageSize !== undefined || req.query?.cursor !== undefined ? listLaundryOrderPage(req.auth!.tenant, req.query as any) : listLaundryOrders(req.auth!.tenant, req.query as any))));
  app.get('/api/laundry/orders/:id', { schema: { params: laundryIdParams }, preHandler: [guard, allow('orders.read')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => getLaundryOrder(req.auth!.tenant, req.params.id)); }
    catch (error: any) { return rep.code(404).send({ error: error.message }); }
  });
  app.get('/api/laundry/orders/:id/payments', { preHandler: [guard, allow('orders.read')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => laundryPaymentSummary(req.auth!.tenant, req.params.id)); }
    catch (error: any) { return rep.code(404).send({ error: error.message }); }
  });
  app.post('/api/laundry/orders/:id/payments', { preHandler: [guard, allow('payments.collect')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, `laundry.payment:${req.params.id}`, () => collectLaundryPayment(req.auth!.tenant, req.auth!.actor, req.params.id, req.body as any)))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/payments/:id/reverse', { preHandler: [guard, allow('payments.refund')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => idempotent(req, `laundry.payment-reversal:${req.params.id}`, () => reverseLaundryPayment(req.auth!.tenant, req.auth!.actor, req.params.id, String((req.body as any)?.reason || '')))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/orders/:id/transition', { schema: { params: laundryIdParams, body: laundryTransitionBody }, preHandler: [guard, allow('orders.transition')] }, async (req: any, rep: any) => {
    try {
      const body = req.body as any;
      return inStore(req, () => transitionLaundryOrder(req.auth!.tenant, req.auth!.actor, req.params.id, body?.state, body?.note, body?.expectedVersion));
    } catch (error: any) { return laundryFailure(rep, error); }
  });
  app.post('/api/laundry/orders/:id/cancel', { preHandler: [guard, allow('orders.edit')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => cancelLaundryOrder(req.auth!.tenant, req.auth!.actor, req.params.id, String((req.body as any)?.reason || ''), (req.body as any)?.expectedVersion)); }
    catch (error: any) { return rep.code(400).send({ error: error.message || 'order cancellation failed' }); }
  });
  app.patch('/api/laundry/orders/:id', { preHandler: [guard, allow('orders.edit')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => editLaundryOrder(req.auth!.tenant, req.auth!.actor, req.params.id, req.body as any)); }
    catch (error: any) { return rep.code(400).send({ error: error.message || 'order edit failed' }); }
  });
  app.post('/api/laundry/orders/:id/assign', { preHandler: [guard, allow('orders.edit')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => assignLaundryOrder(req.auth!.tenant, req.auth!.actor, req.params.id, req.body as any)); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/laundry/orders/:id/fulfillment', { preHandler: [guard, allow('orders.read')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => listLaundryFulfillment(req.auth!.tenant, req.params.id)); }
    catch (error: any) { return rep.code(404).send({ error: error.message }); }
  });
  app.get('/api/laundry/garment-units', { preHandler: [guard, allow('garments.read')] }, async (req: any) => inStore(req, () => listLaundryGarmentUnits(req.auth!.tenant, req.query as any)));
  app.get('/api/laundry/rack-occupancy', { preHandler: [guard, allow('garments.read')] }, async (req: any) => inStore(req, () => rackOccupancy(req.auth!.tenant, req.query as any)));
  app.get('/api/laundry/rack-profiles', { preHandler: [guard, allow('settings.manage')] }, async (req: any) => inStore(req, () => listRackProfiles(req.auth!.tenant, true)));
  app.post('/api/laundry/rack-profiles', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => { try { return rep.code(201).send(inStore(req, () => idempotent(req, 'laundry.rack-profile-create', () => createRackProfile(req.auth!.tenant, req.auth!.actor, req.body || {})))); } catch (error: any) { return rep.code(400).send({ error: error.message }); } });
  app.patch('/api/laundry/rack-profiles/:id', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => inStore(req, () => { try { return updateRackProfile(req.auth!.tenant, req.auth!.actor, req.params.id, req.body || {}); } catch (error: any) { rep.code(400); return { error: error.message }; } }));
  app.get('/api/laundry/garment-units/:id', { schema: { params: laundryIdParams }, preHandler: [guard, allow('garments.read')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => getLaundryGarmentUnit(req.auth!.tenant, req.params.id)); }
    catch (error: any) { return rep.code(404).send({ error: error.message }); }
  });
  app.post('/api/laundry/garment-units/scan', { schema: { body: laundryScanBody }, preHandler: [guard, allow('garments.scan')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, 'laundry.garment-scan', () => scanLaundryGarment(req.auth!.tenant, req.auth!.actor, req.body as any)))); }
    catch (error: any) { return laundryFailure(rep, error); }
  });
  app.get('/api/laundry/containers/:id', { schema: { params: laundryIdParams }, preHandler: [guard, allow('garments.read')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => getLaundryContainerDetail(req.auth!.tenant, req.params.id)); }
    catch (error: any) { return rep.code(404).send({ error: error.message }); }
  });
  app.post('/api/laundry/containers/scan', { schema: { body: laundryContainerScanBody }, preHandler: [guard, allow('garments.scan')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, 'laundry.container-scan', () => scanLaundryContainer(req.auth!.tenant, req.auth!.actor, req.body as any)))); }
    catch (error: any) { return laundryFailure(rep, error); }
  });
  app.post('/api/laundry/garment-units/:id/reprint', { schema: { params: laundryIdParams, body: laundryLifecycleBody }, preHandler: [guard, allow('tags.reprint')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, `laundry.tag-reprint:${req.params.id}`, () => reprintLaundryTag(req.auth!.tenant, req.auth!.actor, req.params.id, req.body as any)))); }
    catch (error: any) { return laundryFailure(rep, error); }
  });
  app.post('/api/laundry/garment-units/:id/replace-tag', { schema: { params: laundryIdParams, body: laundryLifecycleBody }, preHandler: [guard, allow('tags.replace')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, `laundry.tag-replace:${req.params.id}`, () => replaceLaundryTag(req.auth!.tenant, req.auth!.actor, req.params.id, req.body as any)))); }
    catch (error: any) { return laundryFailure(rep, error); }
  });
  app.get('/api/laundry/print-jobs', { schema: { querystring: { type: 'object', properties: { orderId: { type: 'string', maxLength: 120 } }, additionalProperties: false } }, preHandler: [guard, allow('orders.read')] }, async (req: any) => inStore(req, () => listLaundryPrintJobs(req.auth!.tenant, String(req.query?.orderId || '') || undefined)));
  app.post('/api/laundry/print-jobs', { schema: { body: laundryPrintJobBody }, preHandler: [guard, allow('orders.read')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, `laundry.print-job:${String(req.body?.orderId || '')}`, () => createLaundryPrintJob(req.auth!.tenant, req.auth!.actor, req.body || {})))); }
    catch (error: any) { return laundryFailure(rep, error); }
  });
  app.get('/api/laundry/production-queue', { preHandler: [guard, allow('production.read')] }, async (req: any) => inStore(req, () => listProductionTasks(req.auth!.tenant, req.query as any)));
  app.get('/api/laundry/production-load', { preHandler: [guard, allow('production.read')] }, async (req: any) => inStore(req, () => productionLoad(req.auth!.tenant)));
  app.get('/api/laundry/production-workload', { preHandler: [guard, allow('production.read')] }, async (req: any) => inStore(req, () => productionWorkload(req.auth!.tenant)));
  app.get('/api/laundry/production-supervisor-metrics', { preHandler: [guard, allow('production.read')] }, async (req: any) => inStore(req, () => productionSupervisorMetrics(req.auth!.tenant, req.query as any)));
  app.get('/api/laundry/production-schedule', { preHandler: [guard, allow('production.read')] }, async (req: any) => inStore(req, () => productionSchedule(req.auth!.tenant, req.query as any)));
  app.post('/api/laundry/production-workload/assign', { preHandler: [guard, allow('production.assign')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => idempotent(req, 'laundry.production-workload-assign', () => applyProductionWorkloadRecommendations(req.auth!.tenant, req.auth!.actor, (req.body as any)?.taskIds))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/production-tasks/:id/assign', { preHandler: [guard, allow('production.assign')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => idempotent(req, `laundry.production-assign:${req.params.id}`, () => assignProductionTask(req.auth!.tenant, req.auth!.actor, req.params.id, String((req.body as any)?.assignedTo || '')))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/production-tasks/:id/start', { preHandler: [guard, allow('production.start')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => idempotent(req, `laundry.production-start:${req.params.id}`, () => startProductionTask(req.auth!.tenant, req.auth!.actor, req.params.id))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/laundry/quality-claims', { preHandler: [guard, allow('quality.read')] }, async (req: any) => inStore(req, () => listQualityClaims(req.auth!.tenant, req.query as any)));
  app.get('/api/laundry/quality-analytics', { preHandler: [guard, allow('quality.read')] }, async (req: any) => inStore(req, () => qualityAnalytics(req.auth!.tenant)));
  app.get('/api/laundry/returns', { preHandler: [guard, allow('quality.read')] }, async (req: any) => inStore(req, () => listLaundryReturns(req.auth!.tenant)));
  app.post('/api/laundry/returns', { preHandler: [guard, allow('quality.open')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, 'laundry.return-request', () => requestLaundryReturn(req.auth!.tenant, req.auth!.actor, req.body || {})))); }
    catch (error: any) { return rep.code(400).send({ code: error.message, error: error.message }); }
  });
  app.get('/api/laundry/management-snapshot', { preHandler: [guard, allow('settings.manage')] }, async (req: any) => inStore(req, () => laundryManagementSnapshot(req.auth!.tenant)));
  app.get('/api/finance/regulatory-policies', { preHandler: [guard, allow('settings.manage')] }, async (req: any) => inStore(req, () => listRegulatoryPolicies(req.auth!.tenant, String(req.query?.asOf || '').trim() || undefined)));
  app.post('/api/finance/regulatory-policies/install-india-2026', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, 'finance.india-2026-baseline', () => installIndia2026Baseline(req.auth!.tenant, req.auth!.actor)))); }
    catch (error: any) { return rep.code(400).send({ code: error.message, error: error.message }); }
  });
  app.get('/api/finance/readiness', { preHandler: [guard, allow('settings.manage')] }, async (req: any) => inStore(req, () => financePolicyReadiness(req.auth!.tenant)));
  app.get('/api/finance/entity-profile', { preHandler: [guard, allow('settings.manage')] }, async (req: any) => inStore(req, () => entityFinanceProfile(req.auth!.tenant) || { code: 'ENTITY_CONFIGURATION_REQUIRED' }));
  app.put('/api/finance/entity-profile', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => idempotent(req, 'finance.entity-profile', () => saveEntityFinanceProfile(req.auth!.tenant, req.auth!.actor, req.body || {}))); }
    catch (error: any) { return rep.code(400).send({ code: error.message, error: error.message }); }
  });
  app.post('/api/finance/payroll-preview', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { const body = req.body || {}; return inStore(req, () => calculatePayrollPreview(body.components || [], body.policy || {})); }
    catch (error: any) { return rep.code(400).send({ code: error.message, error: error.message }); }
  });
  app.get('/api/finance/command-center', { preHandler: [guard, allow('settings.manage')] }, async (req: any) => inStore(req, () => financeCommandCenter(req.auth!.tenant, req.query || {})));
  app.get('/api/finance/planning-targets', { preHandler: [guard, allow('settings.manage')] }, async (req: any) => inStore(req, () => listFinancePlanningTargets(req.auth!.tenant)));
  app.put('/api/finance/planning-targets', { schema: { body: financePlanningTargetBody }, preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => idempotent(req, `finance.planning-target:${req.body.periodStart}:${req.body.periodEnd}`, () => saveFinancePlanningTarget(req.auth!.tenant, req.auth!.actor, req.body))); }
    catch (error: any) { return rep.code(400).send({ code: error.message, error: error.message }); }
  });
  app.get('/api/finance/statutory-dashboard', { preHandler: [guard, allow('settings.manage')] }, async (req: any) => inStore(req, () => statutoryDashboard(req.auth!.tenant, req.query || {})));
  app.get('/api/finance/statutory-transactions', { preHandler: [guard, allow('settings.manage')] }, async (req: any) => inStore(req, () => listStatutoryTransactions(req.auth!.tenant, req.query || {})));
  app.post('/api/finance/tds/calculate', { schema: { body: statutoryTdsCalculateBody }, preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => calculateTds(req.body)); } catch (error: any) { return rep.code(400).send({ code: error.message, error: error.message }); }
  });
  app.post('/api/finance/tds/transactions', { schema: { body: statutoryTdsBody }, preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, `finance.tds:${req.body.sourceReference}`, () => recordTdsTransaction(req.auth!.tenant, req.auth!.actor, { ...req.body, category: req.body.category as TdsCategory, payeeType: req.body.payeeType as TdsPayeeType, panStatus: req.body.panStatus as PanStatus })))); } catch (error: any) { return rep.code(400).send({ code: error.message, error: error.message }); }
  });
  app.post('/api/finance/tcs/calculate', { schema: { body: statutoryTcsCalculateBody }, preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => req.body.category === 'GST_ECO_TCS' ? calculateGstEcoTcs(req.body) : calculateConfiguredIncomeTaxTcs(req.auth!.tenant, req.body)); } catch (error: any) { return rep.code(400).send({ code: error.message, error: error.message }); }
  });
  app.get('/api/finance/tcs/policies', { preHandler: [guard, allow('settings.manage')] }, async (req: any) => inStore(req, () => listIncomeTaxTcsPolicies(req.auth!.tenant)));
  app.put('/api/finance/tcs/policies', { schema: { body: incomeTaxTcsPolicyBody }, preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => idempotent(req, `finance.tcs-policy:${req.body.policyKey}:${req.body.version}`, () => saveIncomeTaxTcsPolicy(req.auth!.tenant, req.auth!.actor, { ...req.body, status: req.body.status as IncomeTaxTcsPolicyStatus || 'DRAFT' }))); } catch (error: any) { return rep.code(400).send({ code: error.message, error: error.message }); }
  });
  app.post('/api/finance/tcs/transactions', { schema: { body: statutoryTcsBody }, preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, `finance.tcs:${req.body.sourceReference}`, () => recordTcsTransaction(req.auth!.tenant, req.auth!.actor, { ...req.body, category: req.body.category as TcsCategory })))); } catch (error: any) { return rep.code(400).send({ code: error.message, error: error.message }); }
  });
  app.get('/api/finance/statutory-returns', { preHandler: [guard, allow('settings.manage')] }, async (req: any) => inStore(req, () => statutoryDashboard(req.auth!.tenant).returns));
  app.post('/api/finance/statutory-returns/prepare', { schema: { body: statutoryReturnPrepareBody }, preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, `finance.return:${req.body.returnType}:${req.body.periodStart}:${req.body.periodEnd}`, () => prepareStatutoryReturn(req.auth!.tenant, req.auth!.actor, { ...req.body, returnType: req.body.returnType as StatutoryReturnType })))); } catch (error: any) { return rep.code(400).send({ code: error.message, error: error.message }); }
  });
  app.post('/api/finance/statutory-returns/:id/status', { schema: { params: laundryIdParams, body: statutoryReturnStatusBody }, preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => idempotent(req, `finance.return-status:${req.params.id}:${req.body.state}`, () => updateStatutoryReturn(req.auth!.tenant, req.auth!.actor, req.params.id, { ...req.body, state: req.body.state as StatutoryReturnState }))); } catch (error: any) { return rep.code(400).send({ code: error.message, error: error.message }); }
  });
  app.get('/api/laundry/workforce', { preHandler: [guard, allow('settings.manage')] }, async (req: any) => inStore(req, () => laundryWorkforceDashboard(req.auth!.tenant, String(req.query?.date || '').trim() || undefined)));
  app.post('/api/laundry/workforce/attendance', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, 'laundry.workforce-attendance', () => markLaundryAttendance(req.auth!.tenant, req.auth!.actor, req.body || {})))); }
    catch (error: any) { return rep.code(400).send({ code: error.message, error: error.message }); }
  });
  app.get('/api/laundry/customer-corrections', { preHandler: [guard, allow('quality.read')] }, async (req: any) => inStore(req, () => listCustomerCorrections(req.auth!.tenant, req.query as any)));
  app.post('/api/laundry/quality-claims', { preHandler: [guard, allow('quality.open')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => openQualityClaim(req.auth!.tenant, req.auth!.actor, req.body as any))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/quality-claims/:id/resolve', { preHandler: [guard, allow('quality.resolve')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => resolveQualityClaim(req.auth!.tenant, req.auth!.actor, req.params.id, String((req.body as any)?.decision || ''), String((req.body as any)?.note || ''))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/laundry/routes', { preHandler: [guard, allowAny('routes.read', 'routes.read.assigned')] }, async (req: any) => inStore(req, () => listRouteRuns(req.auth!.tenant, { ...(req.query as any), ...(req.auth!.roles.includes('rider') ? { riderId: req.auth!.riderId || '__unlinked-rider__' } : {}) })));
  app.get('/api/laundry/service-zones', { preHandler: [guard, allowAny('routes.read', 'routes.read.assigned')] }, async (req: any) => inStore(req, () => listServiceZones(req.auth!.tenant, req.auth!.roles.includes('rider') ? req.auth!.riderId : undefined)));
  app.get('/api/laundry/service-zone-master', { preHandler: [guard, allow('settings.manage')] }, async (req: any) => inStore(req, () => listServiceZoneMaster(req.auth!.tenant, true)));
  app.post('/api/laundry/service-zone-master', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => { try { return rep.code(201).send(inStore(req, () => idempotent(req, 'laundry.service-zone-create', () => createServiceZone(req.auth!.tenant, req.auth!.actor, req.body || {})))); } catch (error: any) { return rep.code(400).send({ error: error.message }); } });
  app.patch('/api/laundry/service-zone-master/:id', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => inStore(req, () => { try { return updateServiceZone(req.auth!.tenant, req.auth!.actor, req.params.id, req.body || {}); } catch (error: any) { rep.code(400); return { error: error.message }; } }));
  app.get('/api/laundry/route-analytics', { preHandler: [guard, allowAny('routes.read', 'routes.read.assigned')] }, async (req: any) => inStore(req, () => routeCoverageAnalytics(req.auth!.tenant, req.auth!.roles.includes('rider') ? (req.auth!.riderId || '__unlinked-rider__') : undefined)));
  app.post('/api/laundry/routes', { preHandler: [guard, allow('routes.manage')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, 'laundry.route-create', () => createRouteRun(req.auth!.tenant, req.auth!.actor, req.body as any)))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/routes/:id/start', { preHandler: [guard, allowAny('routes.manage', 'routes.manage.assigned')] }, async (req: any, rep: any) => {
    if (req.auth!.roles.includes('rider') && !req.auth!.riderId) return rep.code(403).send({ error: 'rider account is not linked to an active rider record' });
    try { return inStore(req, () => idempotent(req, `laundry.route-start:${req.params.id}`, () => startRouteRun(req.auth!.tenant, req.auth!.actor, req.params.id, req.auth!.roles.includes('rider') ? req.auth!.riderId : undefined))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/routes/:runId/stops/:stopId/complete', { preHandler: [guard, allowAny('routes.manage', 'routes.manage.assigned')] }, async (req: any, rep: any) => {
    if (req.auth!.roles.includes('rider') && !req.auth!.riderId) return rep.code(403).send({ error: 'rider account is not linked to an active rider record' });
    try { return inStore(req, () => idempotent(req, `laundry.route-stop:${req.params.stopId}`, () => completeRouteStop(req.auth!.tenant, req.auth!.actor, req.params.runId, req.params.stopId, req.body as any, req.auth!.roles.includes('rider') ? req.auth!.riderId : undefined))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/ops/hardware-capabilities', { preHandler: [guard, allow('hardware.read')] }, async () => hardwareCapabilities());
  app.get('/api/ops/hardware-status', { preHandler: [guard, allow('hardware.read')] }, async (req: any) => inStore(req, () => hardwareStatus(req.auth!.tenant)));
  app.get('/api/ops/diagnostics', { preHandler: [guard, allow('settings.manage')] }, async (req: any) => inStore(req, () => buildDiagnostics(req.auth!.tenant, req.auth!.storeId)));
  app.get('/api/ops/financial-normalization', { preHandler: [guard, allow('settings.manage')] }, async (req: any) => inStore(req, () => previewFinancialNormalization(req.auth!.tenant)));
  app.get('/api/ops/compatibility-audit', { preHandler: [guard, allow('settings.manage')] }, async (req: any) => inStore(req, () => compatibilityRetirementAudit(req.auth!.tenant, req.auth!.storeId)));
  app.get('/api/ops/entity-normalization', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    const entity = String((req.query as any)?.entity || '');
    if (!ENTITY_NORMALIZATION_ENTITIES.includes(entity as EntityNormalizationEntity)) return rep.code(400).send({ error: 'entity must be party or laundry_order' });
    try { return inStore(req, () => previewEntityNormalization(req.auth!.tenant, entity as EntityNormalizationEntity)); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/ops/entity-normalization', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    const entity = String((req.body as any)?.entity || '');
    if (!ENTITY_NORMALIZATION_ENTITIES.includes(entity as EntityNormalizationEntity)) return rep.code(400).send({ error: 'entity must be party or laundry_order' });
    try { return inStore(req, () => idempotent(req, `ops.entity-normalization:${entity}`, () => applyEntityNormalization(req.auth!.tenant, req.auth!.actor, entity as EntityNormalizationEntity, Number((req.body as any)?.batchSize || 250)))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/ops/financial-normalization', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => idempotent(req, 'ops.financial-normalization', () => applyFinancialNormalization(req.auth!.tenant, req.auth!.actor))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/ops/hardware-receipts', { preHandler: [guard, allow('hardware.read')] }, async (req: any) => inStore(req, () => listHardwareReceipts(req.auth!.tenant)));
  app.post('/api/ops/hardware-receipts', { preHandler: [guard, allow('hardware.receipt')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, 'ops.hardware-receipt', () => recordHardwareReceipt(req.auth!.tenant, req.auth!.actor, req.body as any)))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/laundry/print-settings', { preHandler: [guard, allow('orders.read')] }, async (req: any) => inStore(req, () => {
    const settings = store.getStoreSettings(req.auth!.tenant, req.auth!.storeId);
    return {
      businessName: settings.businessName,
      address: settings.address,
      phone: settings.phone,
      email: settings.email,
      upiId: settings.upiId,
      qrOnPrint: settings.qrOnPrint,
      logoDataUrl: settings.logoDataUrl,
      taxMode: settings.taxMode,
      gstin: settings.gstin,
      currency: settings.currency,
      timezone: settings.timezone,
      printerProfile: settings.printerProfile,
      afterBooking: settings.afterBooking,
      printerProfiles: settings.printerProfiles,
      tagTemplate: settings.tagTemplate,
    };
  }));
  app.post('/api/laundry/orders/:id/fulfillment', { preHandler: [guard, allow('orders.edit')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => recordLaundryFulfillment(req.auth!.tenant, req.auth!.actor, req.params.id, req.body as any))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/laundry/riders', { preHandler: [guard, allow('orders.read')] }, async (req: any) => inStore(req, () => listLaundryRiders(req.auth!.tenant)));
  app.post('/api/laundry/riders', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => createLaundryRider(req.auth!.tenant, req.auth!.actor, req.body as any))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/laundry/dispatch', { preHandler: [guard, allow('orders.read')] }, async (req: any) => inStore(req, () => laundryDispatch(req.auth!.tenant)));
  app.get('/api/laundry/rider-settlements', { preHandler: [guard, allow('orders.read')] }, async (req: any) => inStore(req, () => listLaundryRiderSettlements(req.auth!.tenant, req.query as any)));
  app.post('/api/laundry/rider-settlements', { preHandler: [guard, allow('orders.edit')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, 'laundry.rider-settlement', () => saveLaundryRiderSettlement(req.auth!.tenant, req.auth!.actor, req.body as any)))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.patch('/api/laundry/rider-settlements/:id', { preHandler: [guard, allow('orders.edit')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => saveLaundryRiderSettlement(req.auth!.tenant, req.auth!.actor, req.body as any, req.params.id)); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/laundry/expenses', { preHandler: [guard, allow('expenses.create')] }, async (req: any) => inStore(req, () => listLaundryExpenses(req.auth!.tenant, req.query as any)));
  app.post('/api/laundry/expenses', { preHandler: [guard, allow('expenses.create')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => createLaundryExpense(req.auth!.tenant, req.auth!.actor, req.body as any))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/expenses/:id/cancel', { preHandler: [guard, allow('expenses.create')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => cancelLaundryExpense(req.auth!.tenant, req.auth!.actor, req.params.id, String((req.body as any)?.reason || ''))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.patch('/api/laundry/expenses/:id', { preHandler: [guard, allow('expenses.create')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => editLaundryExpense(req.auth!.tenant, req.auth!.actor, req.params.id, req.body as any, String((req.body as any)?.reason || ''))); }
    catch (error: any) { return rep.code(400).send({ error: error.message || 'expense edit failed' }); }
  });
  app.get('/api/laundry/reports', { preHandler: [guard, allow('reports.read')] }, async (req: any) => {
    const query = req.query as any;
    return inStore(req, () => laundryReports(req.auth!.tenant, query?.from, query?.to));
  });
  app.get('/api/laundry/reports/:kind/export', { preHandler: [guard, allow('reports.read')] }, async (req: any, rep: any) => {
    try {
      const cap = 5000;
      const result = inStore(req, () => laundryReportDetail(req.auth!.tenant, req.params.kind, req.query?.from, req.query?.to, req.query?.search, 1, cap, cap));
      return { ...result, exportAll: true, exportCap: cap, exportTruncated: result.totalRows > cap };
    }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/report-exports', { preHandler: [guard, allow('reports.read')] }, async (req: any, rep: any) => {
    try { return rep.code(202).send(inStore(req, () => idempotent(req, 'laundry.report-export-queue', () => createLaundryReportExportJob(req.auth!.tenant, req.auth!.actor, { ...(req.body || {}), kind: req.body?.kind || req.body?.reportKind })))); }
    catch (error: any) { return rep.code(400).send({ error: error.message || 'report export could not be queued' }); }
  });
  app.get('/api/laundry/report-exports/:id', { preHandler: [guard, allow('reports.read')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => getLaundryReportExportJob(req.auth!.tenant, req.params.id)); }
    catch (error: any) { return rep.code(404).send({ error: error.message }); }
  });
  app.get('/api/laundry/report-exports/:id/download', { preHandler: [guard, allow('reports.read')] }, async (req: any, rep: any) => {
    try { const result = inStore(req, () => readLaundryReportExport(req.auth!.tenant, req.params.id)); rep.header('Content-Type', 'text/csv; charset=utf-8'); rep.header('Content-Disposition', `attachment; filename="${result.job.fileName}"`); return rep.send(result.csv); }
    catch (error: any) { return rep.code(409).send({ error: error.message }); }
  });
  app.get('/api/laundry/report-views', { preHandler: [guard, allow('reports.read')] }, async (req: any) => inStore(req, () => listSavedReportViews(req.auth!.tenant, req.auth!.actor)));
  app.post('/api/laundry/report-views', { preHandler: [guard, allow('reports.read')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, 'laundry.report-view-create', () => createSavedReportView(req.auth!.tenant, req.auth!.actor, { ...(req.body || {}), kind: req.body?.kind || req.body?.reportKind }, req.auth!.roles.includes('owner'))))); }
    catch (error: any) { return rep.code(400).send({ error: error.message || 'saved report view could not be created' }); }
  });
  app.delete('/api/laundry/report-views/:id', { preHandler: [guard, allow('reports.read')] }, async (req: any, rep: any) => inStore(req, () => { try { return deleteSavedReportView(req.auth!.tenant, req.auth!.actor, req.params.id); } catch (error: any) { rep.code(400); return { error: error.message }; } }));
  app.get('/api/laundry/reconciliation', { preHandler: [guard, allow('reports.read')] }, async (req: any) => inStore(req, () => laundryFinancialReconciliation(req.auth!.tenant)));
  app.get('/api/laundry/cash-close-drill', { preHandler: [guard, allow('reports.read')] }, async (req: any) => inStore(req, () => cashCloseDrill(req.auth!.tenant, String(req.query?.businessDate || ''))));
  app.get('/api/laundry/financial-entries', { preHandler: [guard, allow('reports.read')] }, async (req: any) => inStore(req, () => store.listFinancialEntries(req.auth!.tenant, req.query as any)));
  app.get('/api/laundry/cash-shift', { preHandler: [guard, allow('cash.read')] }, async (req: any) => inStore(req, () => getCurrentCashShift(req.auth!.tenant, String((req.query as any)?.register || '').trim() || undefined)));
  app.get('/api/laundry/cash-shifts', { preHandler: [guard, allow('cash.read')] }, async (req: any) => inStore(req, () => listCashShifts(req.auth!.tenant)));
  app.post('/api/laundry/cash-shift/open', { preHandler: [guard, allow('cash.open')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, 'laundry.cash-shift-open', () => openCashShift(req.auth!.tenant, req.auth!.actor, req.body as any)))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/cash-shift/close', { preHandler: [guard, allow('cash.close')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, 'laundry.cash-shift-close', () => closeCashShift(req.auth!.tenant, req.auth!.actor, { ...(req.body || {}), supervisorApproved: req.auth!.roles.includes('owner'), supervisorActor: req.auth!.roles.includes('owner') ? req.auth!.actor : undefined })))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/laundry/reports/:kind', { preHandler: [guard, allow('reports.read')] }, async (req: any, rep: any) => {
    try {
      const page = Math.max(1, Math.floor(Number(req.query?.page) || 1));
      const pageSize = Math.max(1, Math.min(500, Math.floor(Number(req.query?.pageSize) || 100)));
      return inStore(req, () => laundryReportDetail(req.auth!.tenant, req.params.kind, req.query?.from, req.query?.to, req.query?.search, page, pageSize));
    }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/laundry/statistics', { preHandler: [guard, allow('orders.read')] }, async (req: any) => inStore(req, () => {
    const requestedPeriod = String(req.query?.period || 'today');
    const period = requestedPeriod === 'week' ? 'week' : requestedPeriod === 'lifetime' ? 'lifetime' : 'today';
    return laundryStatistics(req.auth!.tenant, period);
  }));
  app.post('/api/laundry/import/customers', { preHandler: [guard, allow('catalogue.manage')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, 'laundry.customer-import', () => importLaundryCustomers(req.auth!.tenant, req.auth!.actor, req.body?.rows)))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.post('/api/laundry/import/prices', { preHandler: [guard, allow('catalogue.manage')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, 'laundry.price-import', () => importLaundryPrices(req.auth!.tenant, req.auth!.actor, req.body?.rows)))); }
    catch (error: any) { return rep.code(400).send({ error: error.message }); }
  });
  app.get('/api/laundry/import/jobs', { preHandler: [guard, allow('catalogue.manage')] }, async (req: any) =>
    inStore(req, () => listLaundryImportJobs(req.auth!.tenant, String((req.query as any)?.type || ''))),
  );

  // ---- generic entity CRUD (the Schema Registry in action) ----
  app.get('/api/:entity', { preHandler: [guard, allow('settings.manage')] }, async (req: any) => {
    const { entity } = req.params;
    if (!getDef(entity)) return req.status ? null : { error: 'unknown entity' };
    return listRows(req.auth!.tenant, entity).map((r) => ({ id: r.id, status: r.status, ...r.data }));
  });

  app.get('/api/:entity/:id', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    const { entity, id } = req.params;
    try { return getRow(req.auth!.tenant, entity, id); }
    catch (e: any) { return rep.code(404).send({ error: e.message }); }
  });

  app.post('/api/:entity', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try {
      const { entity } = req.params;
      const data = (req.body as any)?.data || req.body;
      const row = createRow(req.auth!.tenant, req.auth!.actor, entity, data);
      return rep.code(201).send(row);
    } catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });

  app.post('/api/:entity/:id/submit', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { return submitRow(req.auth!.tenant, req.auth!.actor, req.params.entity, req.params.id); }
    catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });

  app.post('/api/:entity/:id/cancel', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { return cancelRow(req.auth!.tenant, req.auth!.actor, req.params.entity, req.params.id); }
    catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });

  // ---- ledger / audit / event outbox (relay) ----
  app.get('/api/ledger/gl', { preHandler: [guard, allow('reports.read')] }, async (req: any) => store.glOf(req.auth!.tenant));
  app.get('/api/ledger/audit', { preHandler: [guard, allow('reports.read')] }, async (req: any) => store.auditOf(req.auth!.tenant).slice(-200).reverse());
  app.get('/api/events/outbox', { preHandler: [guard, allow('settings.manage')] }, async (req: any) => drainOutbox(req.auth!.tenant));

  // ---- WhatsApp (shotlinXchat / WhatsAPI) ----
  const wa = new ShotlinXchatAdapter();

  app.post('/api/wa/inbound', async (req: any, rep: any) => {
    // WhatsAPI pushes recent messages here (or we poll /api/v1/messages).
    const m = req.body as any;
    const from = m?.from || m?.to || m?.phone;
    const text = m?.body || m?.message || m?.text || '';
    if (!from) return rep.code(400).send({ error: 'no sender' });
    // CRM capture: attach to existing party or create a lead (consent-gated).
    let party = store.rowsOf(TENANT, 'party').find((p) => p.data.phone === from);
    if (!party) {
      party = createRow(TENANT, 'wa-bot', 'party', {
        name: 'WA:' + from, phone: from, is_customer: true,
      });
      audit(TENANT, 'wa-bot', 'crm:lead-created', { row_id: party.id, after: { from } });
    }
    // Never place phone numbers or message bodies in logs/audit payloads.
    // Support can correlate a webhook without exposing customer content.
    const senderHash = createHash('sha256').update(String(from), 'utf8').digest('hex');
    const textHash = createHash('sha256').update(String(text), 'utf8').digest('hex');
    audit(TENANT, 'wa-bot', 'wa:inbound', { entity: 'party', row_id: party.id, after: { senderHash, textHash, textLength: String(text).length } });
    console.log(`[wa] inbound received senderHash=${senderHash} textLength=${String(text).length}`);
    return { ok: true, party: party.id };
  });

  app.get('/api/wa/qr', async () => wa.getQr());
  app.post('/api/wa/webhook', { preHandler: guard }, async (req: any, rep: any) => {
    const url = (req.body as any)?.url || `${process.env.EPIC_PUBLIC_BASE || 'http://localhost:3001'}/api/wa/inbound`;
    const r = await wa.setWebhook(url);
    return rep.code(r.ok ? 200 : 502).send(r);
  });
  app.post('/api/wa/send', { preHandler: guard }, async (req: any, rep: any) => {
    const { to, message } = req.body as any;
    if (!to || !message) return rep.code(400).send({ error: 'to+message required' });
    const r = await wa.sendText(to, message);
    return rep.code(r.ok ? 200 : 502).send(r);
  });

  // ---- GST compliance engine (the moat) ----
  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  function companyForTenant(tenant: string) {
    const profile = supplierTaxProfile(tenant);
    if (!profile) throw new Error('TAX_PROFILE_INCOMPLETE');
    return { gstin: profile.gstin || '', name: profile.legalName, addr: profile.address, state: profile.stateCode };
  }
  app.post('/api/gst/canonical-invoices', { schema: { body: { type: 'object', required: ['sourceOrderId', 'supplier', 'customer', 'tax'], properties: { sourceOrderId: { type: 'string', minLength: 1, maxLength: 160 }, issuedAt: { type: 'string', maxLength: 40 }, supplier: { type: 'object', additionalProperties: true }, customer: { type: 'object', additionalProperties: true }, tax: { type: 'object', additionalProperties: true }, paidPaise: { type: 'integer', minimum: 0 } }, additionalProperties: false } }, preHandler: [guard, allow('orders.edit')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, `gst.canonical-invoice:${req.body.sourceOrderId}`, () => createCanonicalInvoiceSnapshot(req.auth!.tenant, req.auth!.actor, req.body)))); }
    catch (error: any) { return rep.code(400).send({ code: error.message, error: error.message }); }
  });
  app.post('/api/gst/canonical-debit-notes', { schema: { body: { type: 'object', required: ['sourceOrderId', 'supplier', 'customer', 'tax', 'referenceInvoiceNumber', 'reason', 'applicabilityApproved'], properties: { sourceOrderId: { type: 'string', minLength: 1, maxLength: 160 }, issuedAt: { type: 'string', maxLength: 40 }, supplier: { type: 'object', additionalProperties: true }, customer: { type: 'object', additionalProperties: true }, tax: { type: 'object', additionalProperties: true }, referenceInvoiceNumber: { type: 'string', minLength: 1, maxLength: 80 }, reason: { type: 'string', minLength: 1, maxLength: 500 }, applicabilityApproved: { type: 'boolean' } }, additionalProperties: false } }, preHandler: [guard, allow('orders.edit')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, `gst.canonical-debit-note:${req.body.sourceOrderId}`, () => createCanonicalDebitNoteSnapshot(req.auth!.tenant, req.auth!.actor, req.body)))); }
    catch (error: any) { return rep.code(400).send({ code: error.message, error: error.message }); }
  });
  app.get('/api/gst/canonical-invoices/:sourceOrderId', { schema: { params: { type: 'object', required: ['sourceOrderId'], properties: { sourceOrderId: { type: 'string', minLength: 1, maxLength: 160 } }, additionalProperties: false } }, preHandler: [guard, allow('orders.read')] }, async (req: any, rep: any) => {
    const row = inStore(req, () => store.rowsOf(req.auth!.tenant, 'canonical_invoice_snapshot').find((candidate) => candidate.data.sourceOrderId === req.params.sourceOrderId));
    return row || rep.code(404).send({ error: 'canonical invoice not found' });
  });
  app.get('/api/gst/canonical-invoices/:sourceOrderId/print', { schema: { params: { type: 'object', required: ['sourceOrderId'], properties: { sourceOrderId: { type: 'string', minLength: 1, maxLength: 160 } }, additionalProperties: false } }, preHandler: [guard, allow('orders.read')] }, async (req: any, rep: any) => {
    const row = inStore(req, () => store.rowsOf(req.auth!.tenant, 'canonical_invoice_snapshot').find((candidate) => candidate.data.sourceOrderId === req.params.sourceOrderId));
    if (!row) return rep.code(404).send({ error: 'canonical invoice not found' });
    rep.header('Content-Type', 'text/html; charset=utf-8');
    return renderCanonicalTaxInvoice(row.data as any);
  });
  app.get('/api/gst/tax-profile', { preHandler: [guard, allow('settings.manage')] }, async (req: any) => inStore(req, () => supplierTaxProfile(req.auth!.tenant) || { ready: false, code: 'TAX_PROFILE_INCOMPLETE', profile: null }));
  app.get('/api/gst/tax-readiness', { preHandler: [guard, allow('settings.manage')] }, async (req: any) => inStore(req, () => taxReadiness(req.auth!.tenant)));
  app.put('/api/gst/tax-profile', { schema: { body: gstSupplierProfileBody }, preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try {
      return inStore(req, () => idempotent(req, 'gst.tax-profile', () => {
        const profile = saveSupplierTaxProfile(req.auth!.tenant, req.auth!.actor, req.body);
        // Keep the owner-facing supplier registration and the counter's tax
        // mode in one truth. A registered profile has already passed GSTIN
        // validation; an unregistered profile must not leave GST charging on.
        const settings = store.saveStoreSettings(req.auth!.tenant, req.auth!.actor, {
          taxMode: profile.data.registrationStatus === 'Registered' ? 'gst' : 'none',
          gstin: profile.data.gstin || '',
        });
        audit(req.auth!.tenant, req.auth!.actor, 'gst:counter-tax-mode-synchronised', {
          entity: profile.entity,
          row_id: profile.id,
          after: { taxMode: settings.taxMode, gstinPresent: Boolean(settings.gstin) },
        });
        return { ...profile.data, counterTaxMode: settings.taxMode };
      }));
    }
    catch (error: any) { return rep.code(400).send({ code: error.message, error: error.message }); }
  });
  app.get('/api/gst/tax-rules', { schema: { querystring: gstTaxPolicyQuery }, preHandler: [guard, allow('settings.manage')] }, async (req: any) => inStore(req, () => listTaxPolicyRules(req.auth!.tenant, req.query?.asOf)));
  app.post('/api/gst/tax-rules', { schema: { body: gstTaxPolicyBody }, preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { return rep.code(201).send(inStore(req, () => idempotent(req, 'gst.tax-policy-rule', () => createTaxPolicyRule(req.auth!.tenant, req.auth!.actor, req.body)))); }
    catch (error: any) { return rep.code(400).send({ code: error.message, error: error.message }); }
  });
  app.post('/api/gst/tax-rules/:id/approve', { schema: { params: laundryIdParams, body: { type: 'object', additionalProperties: false } }, preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => idempotent(req, `gst.tax-policy-approve:${req.params.id}`, () => approveTaxPolicyRule(req.auth!.tenant, req.auth!.actor, req.params.id))); }
    catch (error: any) { return rep.code(400).send({ code: error.message, error: error.message }); }
  });
  app.post('/api/gst/tax-rules/:id/retire', { schema: { params: laundryIdParams, body: { type: 'object', additionalProperties: false } }, preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => idempotent(req, `gst.tax-policy-retire:${req.params.id}`, () => retireTaxPolicyRule(req.auth!.tenant, req.auth!.actor, req.params.id))); }
    catch (error: any) { return rep.code(400).send({ code: error.message, error: error.message }); }
  });
  app.get('/api/gst/einvoice/:id', { preHandler: guard }, async (req: any, rep: any) => {
    const tenant = requestTenant(req);
    const row = store.getRow(tenant, req.params.id);
    if (!row || !['sales_invoice', 'pos_invoice'].includes(row.entity)) return rep.code(404).send({ error: 'not found' });
    const linked = row.data.canonical_snapshot_id ? store.getRow(tenant, String(row.data.canonical_snapshot_id)) : undefined;
    const gst = linked?.entity === 'canonical_invoice_snapshot' ? gstFromCanonicalSnapshot(linked.data) : row.data.__gst;
    if (!gst) return rep.code(400).send({ error: 'invoice not submitted' });
    try {
      const configured = supplierTaxProfile(tenant);
      if (!configured) return rep.code(409).send({ code: 'TAX_PROFILE_INCOMPLETE', error: 'configure the supplier tax profile before creating e-invoice data' });
      if (configured.registrationStatus !== 'Registered') return rep.code(409).send({ code: 'EINVOICE_NOT_APPLICABLE', error: 'e-invoice data is not applicable to an unregistered supplier' });
      const p = store.getRow(tenant, row.data.customer);
      return buildEinvoicePayload({ name: linked?.entity === 'canonical_invoice_snapshot' ? linked.data.invoiceNumber : row.data.name, posting_date: row.data.posting_date, data: row.data }, companyForTenant(tenant), {
      name: p?.data?.name || (row.entity === 'pos_invoice' ? 'Walk-in Customer' : ''), gstin: p?.data?.gstin, addr: p?.data?.addr,
      state: p?.data?.state, pos: row.data.place_of_supply,
      }, gst);
    } catch (error: any) { return rep.code(409).send({ code: error.message, error: error.message }); }
  });
  app.get('/api/gst/print/:id', { preHandler: guard }, async (req: any, rep: any) => {
    const tenant = requestTenant(req);
    const row = store.getRow(tenant, req.params.id);
    if (!row || !['sales_invoice', 'pos_invoice', 'credit_note'].includes(row.entity) || row.status !== 'Submitted') return rep.code(404).send({ error: 'submitted invoice or credit note not found' });
    if (row.entity === 'credit_note') {
      const linked = row.data.canonical_snapshot_id ? store.getRow(tenant, String(row.data.canonical_snapshot_id)) : undefined;
      if (linked?.entity !== 'canonical_invoice_snapshot') return rep.code(409).send({ code: 'TAX_PROFILE_INCOMPLETE', error: 'canonical credit-note evidence is not available' });
      rep.header('Content-Type', 'text/html; charset=utf-8');
      return renderCanonicalTaxInvoice(linked.data as any);
    }
    try {
      const canonical = store.transaction(() => ensureCanonicalInvoiceForLegacy(tenant, requestActor(req), row.id));
      rep.header('Content-Type', 'text/html; charset=utf-8');
      return renderCanonicalTaxInvoice(canonical.data as any);
    } catch (error: any) { return rep.code(error.message === 'TAX_PROFILE_INCOMPLETE' ? 409 : 422).send({ code: error.message, error: error.message }); }
  });
  app.get('/api/gst/receipt/:paymentId/print', { preHandler: guard }, async (req: any, rep: any) => {
    const tenant = requestTenant(req); const paymentId = String(req.params.paymentId || '').trim(); const type = String((req.query as any)?.type || 'PaymentReceipt');
    if (!['PaymentReceipt', 'RefundReceipt'].includes(type)) return rep.code(400).send({ code: 'RECEIPT_TYPE_INVALID', error: 'unsupported receipt type' });
    const row = store.rowsOf(tenant, 'canonical_receipt_snapshot').find((candidate) => candidate.data.sourcePaymentId === paymentId && candidate.data.documentType === type);
    if (!row) return rep.code(404).send({ error: 'canonical receipt not found' });
    rep.header('Content-Type', 'text/html; charset=utf-8'); return renderCanonicalReceipt(row.data as any);
  });
  app.get('/api/gst/gstr1', { preHandler: guard }, async (req: any) => {
    const tenant = requestTenant(req);
    const canonicalFor = (row: any) => {
      const linked = row.data.canonical_snapshot_id ? store.getRow(tenant, String(row.data.canonical_snapshot_id)) : undefined;
      if (linked?.entity !== 'canonical_invoice_snapshot') return { data: row.data, gst: row.data.__gst, canonical: false };
      return { data: { ...row.data, name: linked.data.invoiceNumber, posting_date: linked.data.issuedAt.slice(0, 10) }, gst: gstFromCanonicalSnapshot(linked.data), canonical: true };
    };
    const invs = [...store.rowsOf(tenant, 'sales_invoice'), ...store.rowsOf(tenant, 'pos_invoice')]
      .filter((r) => r.status === 'Submitted')
      .map(canonicalFor);
    const cns = store.rowsOf(tenant, 'credit_note')
      .filter((r) => r.status === 'Submitted')
      .map(canonicalFor);
    const originalInvoiceNumber = (data: any) => {
      const original = store.getRow(tenant, data.reference_invoice);
      const linked = original?.data?.canonical_snapshot_id ? store.getRow(tenant, String(original.data.canonical_snapshot_id)) : undefined;
      return linked?.entity === 'canonical_invoice_snapshot' ? linked.data.invoiceNumber : original?.data?.name || '';
    };
    return {
      ...buildGstr1(invs, (data) => Boolean(data.customer && store.getRow(tenant, data.customer)?.data?.gstin)),
      ...buildCdnr(cns, originalInvoiceNumber),
      evidence: { canonicalInvoices: invs.filter((row) => row.canonical).length, canonicalCreditNotes: cns.filter((row) => row.canonical).length, legacyFallbackInvoices: invs.filter((row) => !row.canonical).length, legacyFallbackCreditNotes: cns.filter((row) => !row.canonical).length },
    };
  });
  app.get('/api/gst/cockpit', { preHandler: guard }, async (req: any) => {
    const cockpitTenant = requestTenant(req);
    const invs = [...store.rowsOf(cockpitTenant, 'sales_invoice'), ...store.rowsOf(cockpitTenant, 'pos_invoice')].filter((r) => r.status === 'Submitted');
    let cgst = 0, sgst = 0, igst = 0, taxable = 0;
    for (const r of invs) { const linked = r.data.canonical_snapshot_id ? store.getRow(cockpitTenant, String(r.data.canonical_snapshot_id)) : undefined; const g = linked?.entity === 'canonical_invoice_snapshot' ? gstFromCanonicalSnapshot(linked.data) : r.data.__gst; if (!g) continue; cgst += g.totalCgst; sgst += g.totalSgst; igst += g.totalIgst; taxable += g.totalTaxable; }
    const configuredProfile = supplierTaxProfile(cockpitTenant);
    const readiness = taxReadiness(cockpitTenant);
    const threshold = Number(process.env.GST_EINVOICE_THRESHOLD || 5000000);
    return {
      supplierState: configuredProfile?.stateCode || null,
      periodInvoices: invs.length,
      outputTax: { cgst: round2(cgst), sgst: round2(sgst), igst: round2(igst), total: round2(cgst + sgst + igst) },
      taxable: round2(taxable),
      einvoiceApplicable: configuredProfile?.registrationStatus === 'Registered' && configuredProfile.einvoiceState !== 'NotApplicable',
      einvoiceState: configuredProfile?.einvoiceState || 'NotConfigured',
      taxReadiness: { ready: readiness.ready, code: readiness.code },
      thresholdNote: `E-invoicing mandated when aggregate turnover > ₹${threshold.toLocaleString('en-IN')}`,
      nextGstr1Due: '10th of next month',
      nextGstr3bDue: '20th of next month',
    };
  });

  // ---- E-invoice (IRN) via GSP ----
  app.post('/api/gst/irn/:id', { preHandler: guard }, async (req: any, rep: any) => {
    try { return await generateIrnForInvoice(requestTenant(req), req.params.id); }
    catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });
  app.post('/api/gst/irn/:id/cancel', { preHandler: guard }, async (req: any, rep: any) => {
    const reason = (req.body as any)?.reason || 'Data entry mistake';
    try { return await cancelIrnForInvoice(requestTenant(req), req.params.id, reason); }
    catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });
  app.get('/api/gst/irn/:id', { preHandler: guard }, async (req: any, rep: any) => {
    const row = store.getRow(requestTenant(req), req.params.id);
    return { einvoice: row?.data?.__einvoice || null, status: row?.data?.einvoice_status || 'NOT_GENERATED' };
  });

  // ---- E-way bill via GSP ----
  app.post('/api/gst/eway/:id', { preHandler: guard }, async (req: any, rep: any) => {
    try { return await generateEwbForInvoice(requestTenant(req), req.params.id, (req.body as any)?.transporter); }
    catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });
  app.get('/api/gst/eway/:id', { preHandler: guard }, async (req: any, rep: any) => {
    const row = store.getRow(requestTenant(req), req.params.id);
    return { eway: row?.data?.__eway || null };
  });

  // ---- IMS (inward supply 2A/2B matching) ----
  app.get('/api/gst/ims', { preHandler: guard }, async (req: any) => {
    const period = (req.query as any)?.period as string | undefined;
    return getImsSupplies(requestTenant(req), period);
  });
  app.post('/api/gst/ims/action', { preHandler: guard }, async (req: any, rep: any) => {
    const { irn, action, reason } = req.body as any;
    if (!irn || !['ACC', 'REJ', 'PEN'].includes(action)) return rep.code(400).send({ error: 'irn + valid action required' });
    return recordImsAction(requestTenant(req), irn, action, reason, requestActor(req));
  });

  // ---- CRM: convert a lead into party + opportunity (optionally a quotation) ----
  app.post('/api/lead/:id/convert', { preHandler: guard }, async (req: any, rep: any) => {
    try {
      const b = (req.body as any) || {};
      const out = convertLead(requestTenant(req), requestActor(req), req.params.id, { gstin: b.gstin, createQuotation: !!b.createQuotation });
      return {
        party: out.party,
        opportunity: { id: out.opportunity.id },
        quotation: out.quotation ? { id: out.quotation.id } : undefined,
        lead: { id: req.params.id },
      };
    } catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });

  // ---- CRM: lead scoring ----
  app.post('/api/crm/lead/:id/score', { preHandler: guard }, async (req: any, rep: any) => {
    try { return scoreLead(requestTenant(req), req.params.id); }
    catch (e: any) { return rep.code(404).send({ error: e.message }); }
  });
  app.post('/api/crm/score-all', { preHandler: guard }, async (req: any) => scoreAllLeads(requestTenant(req)));

  // ---- CRM: activities (timeline) ----
  app.post('/api/crm/activity', { preHandler: guard }, async (req: any, rep: any) => {
    try {
      const b = (req.body as any)?.data || req.body;
      const row = logActivity(requestTenant(req), requestActor(req), b);
      return rep.code(201).send(row);
    } catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });
  app.get('/api/crm/timeline/:id', { preHandler: guard }, async (req: any) =>
    activitiesFor(requestTenant(req), (req.query as any)?.ref_entity, req.params.id).map((a) => ({ id: a.id, ...a.data, created_at: a.created_at })));

  // ---- CRM: duplicate detection + merge ----
  app.get('/api/crm/duplicates', { preHandler: guard }, async (req: any) => findDuplicateLeads(requestTenant(req)));
  app.post('/api/crm/merge', { preHandler: guard }, async (req: any, rep: any) => {
    try {
      const b = (req.body as any) || {};
      if (!b.primary || !Array.isArray(b.duplicates)) return rep.code(400).send({ error: 'primary + duplicates[] required' });
      return mergeLeads(requestTenant(req), requestActor(req), b.primary, b.duplicates);
    } catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });

  // ---- CRM: opportunity win/lose + assignment ----
  app.post('/api/crm/opportunity/:id/win', { preHandler: guard }, async (req: any, rep: any) => {
    try { return winOpportunity(requestTenant(req), requestActor(req), req.params.id); }
    catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });
  app.post('/api/crm/opportunity/:id/lose', { preHandler: guard }, async (req: any, rep: any) => {
    try { return loseOpportunity(requestTenant(req), requestActor(req), req.params.id, (req.body as any)?.lost_reason || ''); }
    catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });
  app.post('/api/crm/lead/:id/assign', { preHandler: guard }, async (req: any) => ({ owner: assignOwner(requestTenant(req), req.params.id) }));

  // ---- CRM: pipeline board, forecast, analytics (for the dashboard) ----
  app.get('/api/crm/pipeline', { preHandler: guard }, async (req: any) => getPipeline(requestTenant(req), req.query as any));
  app.get('/api/crm/forecast', { preHandler: guard }, async (req: any) => getForecast(requestTenant(req), req.query as any));
  app.get('/api/crm/analytics/source', { preHandler: guard }, async (req: any) => getSourceAnalytics(requestTenant(req)));
  app.get('/api/crm/analytics/lost-reasons', { preHandler: guard }, async (req: any) => getLostReasonPareto(requestTenant(req)));
  app.get('/api/crm/analytics/owners', { preHandler: guard }, async (req: any) => getOwnerPerformance(requestTenant(req)));

  // ---- Dashboard analytics: KPIs + time-series for the home command center ----
  app.get('/api/dashboard/summary', { preHandler: guard }, async (req: any) =>
    dashboardSummary(requestTenant(req), (req.query as any)?.asOf));

  // ---- P19 Engagement: multi-channel gateway, templates, campaigns, notifications ----
  // Templates use the generic CRUD (`/api/message_template`). These are the action routes.

  // Send a free-form message on any channel (WhatsApp/Email/SMS). Offline-simulated unless creds set.
  app.post('/api/engage/send', { preHandler: guard }, async (req: any, rep: any) => {
    const { channel, to, message, subject } = (req.body as any) || {};
    if (!channel || !to || !message) return rep.code(400).send({ error: 'channel + to + message required' });
    try { return await inStore(req, () => sendMessage(req.auth!.tenant, req.auth!.actor, channel, to, message, { subject })); }
    catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });

  // Send using a saved template to a party/lead (renders {{merge}} fields from the record).
  app.post('/api/engage/send-templated', { preHandler: guard }, async (req: any, rep: any) => {
    const { template, ref, extra } = (req.body as any) || {};
    if (!template || !ref) return rep.code(400).send({ error: 'template + ref required' });
    try { return await inStore(req, () => sendTemplated(req.auth!.tenant, req.auth!.actor, template, ref, extra)); }
    catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });

  // Run a campaign: blast a template to an audience, tracking each recipient as a touch.
  app.post('/api/engage/campaign/:id/run', { preHandler: guard }, async (req: any, rep: any) => {
    const b = (req.body as any) || {};
    const templateId = b.templateId || b.template;
    if (!templateId) return rep.code(400).send({ error: 'template required' });
    try { return await inStore(req, () => runCampaign(req.auth!.tenant, req.auth!.actor, req.params.id, { templateId, audience: b.audience, consentOnly: b.consentOnly })); }
    catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });

  // Per-campaign stats (touches sent/delivered/failed/skipped + reach %).
  app.get('/api/engage/campaign/:id/stats', { preHandler: guard }, async (req: any) => inStore(req, () => campaignStats(req.auth!.tenant, req.params.id)));

  // Notification center (internal inbox).
  app.get('/api/notifications', { preHandler: guard }, async (req: any) =>
    inStore(req, () => listNotifications(req.auth!.tenant, { unreadOnly: (req.query as any)?.unread === '1', user: req.auth!.actor })
      .map((n) => ({ id: n.id, ...n.data, created_at: n.created_at }))));
  app.post('/api/notifications/:id/read', { preHandler: guard }, async (req: any, rep: any) => {
    try { return inStore(req, () => markNotificationRead(req.auth!.tenant, req.params.id, (req.body as any)?.read !== false)); }
    catch (e: any) { return rep.code(404).send({ error: e.message }); }
  });
  app.post('/api/notifications/read-all', { preHandler: guard }, async (req: any) =>
    inStore(req, () => ({ marked: markAllRead(req.auth!.tenant, req.auth!.actor) })));
  // Pull the ops alerts (overdue receivables, low stock, GST due dates) into the notification inbox.
  app.post('/api/notifications/sync-alerts', { preHandler: guard }, async (req: any) => inStore(req, () => {
    const a = getAlerts(req.auth!.tenant) as any;
    const norm: { type: string; message: string; severity?: string; ref?: string }[] = [];
    for (const o of a.overdue || [])
      norm.push({ type: 'Receivable', message: `Overdue ₹${o.due} from ${o.customer || o.name} (${o.age}d)`, severity: 'warning', ref: o.id });
    for (const r of a.reorder || [])
      norm.push({ type: 'Stock', message: `Low stock: ${r.name} (on-hand ${r.on_hand}, reorder ${r.reorder_level})`, severity: 'warning', ref: r.item });
    for (const g of a.gst || [])
      norm.push({ type: 'Compliance', message: g.message || `${g.name || 'GST'} due ${g.due || ''}`.trim(), severity: 'critical', ref: g.name });
    for (const s of a.subscriptions_due || [])
      norm.push({ type: 'Billing', message: `Subscription renewal due: ${s.name} on ${s.next}`, severity: 'info', ref: s.id });
    for (const b of a.budgets || [])
      norm.push({ type: 'Budget', message: `Budget breach: ${b.name} at ${b.pct}% (₹${b.actual} / ₹${b.budget})`, severity: 'warning', ref: b.id });
    return { created: syncAlertsToNotifications(req.auth!.tenant, norm) };
  }));

  // ---- Inventory: stock balances + low-stock alert ----
  app.get('/api/inventory/stock', { preHandler: guard }, async (req: any) => {
    const wh = (req.query as any)?.warehouse as string | undefined;
    const tenant = requestTenant(req);
    const items = store.rowsOf(tenant, 'item');
    const whs = store.rowsOf(tenant, 'warehouse');
    const balances: Record<string, Record<string, number>> = {};
    for (const s of store.stockOf(tenant)) {
      if (wh && s.warehouse !== wh) continue;
      balances[s.item] ||= {};
      balances[s.item][s.warehouse] = (balances[s.item][s.warehouse] || 0) + s.qty;
    }
    return {
      warehouses: whs.map((w) => ({ id: w.id, name: w.data.name })),
      items: items.map((it) => ({
        id: it.id, name: it.data.name, item_code: it.data.item_code,
        by_warehouse: balances[it.id] || {},
        total: Object.values(balances[it.id] || {}).reduce((a, b) => a + b, 0),
        reorder: Number(it.data.reorder_level || 0),
        low: (Number(it.data.reorder_level || 0) > 0)
          && (Object.values(balances[it.id] || {}).reduce((a, b) => a + b, 0) <= Number(it.data.reorder_level || 0)),
      })),
    };
  });

  // ---- Inventory depth (Phase-16): valuation, serials, batches ----
  app.get('/api/inventory/valuation', { preHandler: guard }, async (req: any) => {
    const method = ((req.query as any).method === 'fifo' ? 'fifo' : 'moving-average') as 'moving-average' | 'fifo';
    return { method, ...stockValuation(requestTenant(req), method) };
  });
  app.get('/api/inventory/serials', { preHandler: guard }, async (req: any) => serialStock(requestTenant(req)));
  app.get('/api/inventory/batches', { preHandler: guard }, async (req: any) => batchStock(requestTenant(req)));
  app.get('/api/inventory/balances', { preHandler: guard }, async (req: any) => getStockBalance(requestTenant(req)));

  // ---- Manufacturing depth (Phase-17): BOM cost, explosion, MRP planning ----
  app.get('/api/manufacturing/bom-cost', { preHandler: guard }, async (req: any) => {
    const item = (req.query as any).item; if (!item) return { error: 'item required' };
    return bomCost(requestTenant(req), item, Number((req.query as any).qty || 1));
  });
  app.get('/api/manufacturing/explode', { preHandler: guard }, async (req: any) => {
    const item = (req.query as any).item; if (!item) return { error: 'item required' };
    return explodeBom(requestTenant(req), item, Number((req.query as any).qty || 1));
  });
  app.get('/api/manufacturing/mrp', { preHandler: guard }, async (req: any) => planMaterials(requestTenant(req)));
  app.post('/api/manufacturing/mrp/work-orders', { preHandler: guard }, async (req: any, rep: any) => {
    const b = req.body || {};
    if (!b.items?.length) return rep.code(400).send({ error: 'items required' });
    const created = createPlannedWorkOrders(requestTenant(req), b.module || 'manufacturing', b.items);
    return { created: created.map((r: any) => ({ id: r.id, name: r.data.name })) };
  });
  app.post('/api/manufacturing/mrp/purchase-order', { preHandler: guard }, async (req: any, rep: any) => {
    const b = req.body || {};
    if (!b.supplier || !b.items?.length) return rep.code(400).send({ error: 'supplier and items required' });
    const po = createPlannedPurchaseOrder(requestTenant(req), b.module || 'buying', b.supplier, b.items, {
      isSubcontracted: b.isSubcontracted, suppliedItems: b.suppliedItems,
    });
    return { id: po.id, name: po.data.name };
  });

  // ---- Accounting: Trial Balance / P&L / Balance Sheet / Ledger ----
  app.get('/api/accounting/trial-balance', { preHandler: guard }, async (req: any) => getTrialBalance(requestTenant(req), (req.query as any).cost_center));
  app.get('/api/accounting/pnl', { preHandler: guard }, async (req: any) => getPnL(requestTenant(req), (req.query as any).cost_center));
  app.get('/api/accounting/balancesheet', { preHandler: guard }, async (req: any) => getBalanceSheet(requestTenant(req), (req.query as any).cost_center));
  app.get('/api/accounting/ledger/:account', { preHandler: guard }, async (req: any) => {
    const name = decodeURIComponent(String(req.params.account));
    return { account: name, entries: getLedger(requestTenant(req), name) };
  });

  // ---- Banking: bank statement import + reconcile + outstanding ----
  app.post('/api/bank/import', { preHandler: guard }, async (req: any, rep: any) => {
    const b = req.body as any;
    const lines = (b.lines || []).map((l: any) => ({
      date: l.date,
      narration: l.narration || l.particulars || '',
      withdrawal: Math.round((Number(l.withdrawal || l.debit || 0)) * 100) / 100,
      deposit: Math.round((Number(l.deposit || l.credit || 0)) * 100) / 100,
      balance: Math.round((Number(l.balance || 0)) * 100) / 100,
      reconciled: false,
    }));
    try {
      const stmt = createRow(requestTenant(req), requestActor(req), 'bank_statement', {
        bank_name: b.bank_name, account_no: b.account_no, period: b.period, lines,
      });
      return rep.code(201).send(stmt);
    } catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });

  app.post('/api/bank/:id/reconcile', { preHandler: guard }, async (req: any, rep: any) => {
    const stmt = store.getRow(requestTenant(req), req.params.id);
    if (!stmt || stmt.entity !== 'bank_statement') return rep.code(404).send({ error: 'statement not found' });
    const { index, party } = req.body as any;
    const lines = (stmt.data.lines || []) as any[];
    const line = lines[Number(index)];
    if (!line) return rep.code(400).send({ error: 'line not found' });
    if (line.reconciled) return rep.code(400).send({ error: 'line already reconciled' });
    const deposit = Number(line.deposit) || 0;
    const withdrawal = Number(line.withdrawal) || 0;
    if (deposit <= 0 && withdrawal <= 0) return rep.code(400).send({ error: 'line has no amount' });
    const isDeposit = deposit > 0;
    const amount = isDeposit ? deposit : withdrawal;
    try {
      const payment = createRow(requestTenant(req), requestActor(req), 'payment_entry', {
        payment_type: isDeposit ? 'Receive' : 'Pay',
        party: party || undefined,
        posting_date: line.date || new Date().toISOString().slice(0, 10),
        mode: 'Bank',
        bank_account: stmt.data.account_no || stmt.data.bank_name,
        amount,
        remarks: line.narration || '',
      });
      submitRow(requestTenant(req), requestActor(req), 'payment_entry', payment.id);
      line.reconciled = true;
      store.updateRow(stmt);
      return { payment: payment.id, type: isDeposit ? 'Receive' : 'Pay', amount, index: Number(index) };
    } catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });

  app.get('/api/banking/outstanding', { preHandler: guard }, async (req: any) => {
    const paidFor = (invId: string) =>
      store.rowsOf(requestTenant(req), 'payment_entry').filter((p) => p.status === 'Submitted').reduce(
        (acc, p) => acc + ((p.data.against_sales === invId || p.data.against_purchase === invId) ? ((store.financialDocumentAmountPaise(requestTenant(req), 'payment', p.entity, p.id) ?? Math.round((Number(p.data.amount) || 0) * 100)) / 100) : 0),
        0,
      );
    const map = (r: any) => {
      const gt = (store.financialDocumentAmountPaise(requestTenant(req), 'invoice', r.entity, r.id) ?? Math.round((Number(r.data.grand_total) || 0) * 100)) / 100;
      const paid = paidFor(r.id);
      return {
        id: r.id, name: r.data.name, type: r.entity,
        party: r.data.customer || r.data.supplier,
        grand_total: gt, paid, balance: Math.max(0, Math.round((gt - paid) * 100) / 100),
      };
    };
    const sales = store.rowsOf(requestTenant(req), 'sales_invoice').filter((r) => r.status === 'Submitted').map(map).filter((x) => x.balance > 0);
    const purchases = store.rowsOf(requestTenant(req), 'purchase_invoice').filter((r) => r.status === 'Submitted').map(map).filter((x) => x.balance > 0);
    return { receivables: sales, payables: purchases };
  });

  // ---- Sync: store-and-forward bulk push (offline POS / field app replays queued docs) ----
  app.post('/api/sync/push', { preHandler: guard }, async (req: any, rep: any) => {
    const docs = (req.body as any)?.docs;
    if (!Array.isArray(docs)) return rep.code(400).send({ error: 'docs[] required' });
    if (docs.length > 500) return rep.code(413).send({ error: 'a maximum of 500 offline commands can be replayed at once' });
    const auth = req.auth as AuthContext;
    const supported = new Set(['laundry_order', 'laundry_expense', 'party', 'laundry_order_transition', 'laundry_order_cancel', 'laundry_order_edit']);
    const results: any[] = [];
    let okN = 0;
    for (let i = 0; i < docs.length; i++) {
      const d = docs[i] as any;
      try {
        const testDelayMs = Math.max(0, Math.min(5_000, Number(process.env.EPIC_TEST_SYNC_DELAY_MS || 0)));
        if (testDelayMs) await new Promise((resolve) => setTimeout(resolve, testDelayMs));
        const entity = String(d?.entity || '').trim();
        if (!supported.has(entity)) throw new Error(`offline sync does not support '${entity || 'unknown'}'; use its authoritative command endpoint`);
        const key = String(d?.idempotencyKey || d?.clientId || '').trim();
        if (!key || key.length > 160) throw new Error('each offline command requires a unique idempotencyKey or clientId');
        const result: any = inStore(req, () => idempotent({ headers: { 'idempotency-key': key }, auth, body: d.data || {} }, `sync:${entity}`, () => {
          if (entity === 'laundry_order') return bookLaundryOrder(auth.tenant, auth.actor, d.data || {});
          if (entity === 'laundry_order_transition') {
            const command = d.data || {};
            if (!command.orderId || !command.state) throw new Error('offline order transition requires orderId and state');
            return transitionLaundryOrder(auth.tenant, auth.actor, String(command.orderId), command.state, command.note, command.expectedVersion);
          }
          if (entity === 'laundry_order_cancel') {
            const command = d.data || {};
            if (!command.orderId || !command.reason) throw new Error('offline order cancellation requires orderId and reason');
            return cancelLaundryOrder(auth.tenant, auth.actor, String(command.orderId), String(command.reason), command.expectedVersion);
          }
          if (entity === 'laundry_order_edit') {
            const command = d.data || {};
            if (!command.orderId) throw new Error('offline order edit requires orderId');
            const { orderId, ...edit } = command;
            return editLaundryOrder(auth.tenant, auth.actor, String(orderId), edit);
          }
          if (entity === 'laundry_expense') return createLaundryExpense(auth.tenant, auth.actor, d.data || {});
          const customer = d.data || {};
          if (!customer.is_customer && customer.is_customer !== undefined) throw new Error('offline party sync only accepts customer records');
          return createLaundryCustomer(auth.tenant, auth.actor, customer);
        }));
        if (entity === 'laundry_order') pushBookedStoreOrder(req, result);
        const id = result?.order?.id || result?.id || result?.expense?.id;
        audit(auth.tenant, auth.actor, 'ops:offline-replay-applied', { after: { entity, id: id || null, keyHash: createHash('sha256').update(key).digest('hex') } });
        results.push({ index: i, ok: true, id, entity });
        okN++;
      } catch (e: any) { results.push({ index: i, ok: false, error: e.message }); }
    }
    return { accepted: docs.length, applied: okN, results };
  });
  app.get('/api/sync/replay-audit', { preHandler: [guard, allow('reports.read')] }, async (req: any) => inStore(req, () => store.auditOf(req.auth!.tenant).filter((entry) => entry.action === 'ops:offline-replay-applied' || entry.action === 'ops:idempotency-conflict').slice(-200).reverse()));

  // ---- HR & Payroll ----
  app.get('/api/payroll/preview', { preHandler: guard }, async (req: any, rep: any) => {
    const emp = store.getRow(requestTenant(req), (req.query as any).employee);
    if (!emp) return rep.code(404).send({ error: 'employee not found' });
    const ss = emp.data.salary_structure ? store.getRow(requestTenant(req), emp.data.salary_structure)?.data : null;
    if (!ss) return rep.code(400).send({ error: 'employee has no salary structure' });
    return computePayroll(ss, Number((req.query as any).paid_days) || 30, 30);
  });
  app.post('/api/payroll/run', { preHandler: guard }, async (req: any, rep: any) => {
    const { period, paid_days, payment_mode } = req.body as any;
    if (!period) return rep.code(400).send({ error: 'period required' });
    const emps = store.rowsOf(requestTenant(req), 'employee').filter((e) => e.data.is_active && e.data.salary_structure);
    const results: any[] = [];
    for (const e of emps) {
      try {
        const r = createRow(requestTenant(req), requestActor(req), 'salary_slip', { employee: e.id, period, paid_days: Number(paid_days) || 30, payment_mode: payment_mode || 'Bank' });
        const s = submitRow(requestTenant(req), requestActor(req), 'salary_slip', r.id);
        results.push({ ok: true, id: r.id, name: s.id, employee: e.data.name });
      } catch (err: any) { results.push({ ok: false, employee: e.data.name, error: err.message }); }
    }
    return { period, generated: results.length, results };
  });

  // ---- P18 HR Depth: Attendance, Leave, Expense Claims, Loans, Recruitment ----
  // Attendance
  app.post('/api/hr/attendance', { preHandler: guard }, async (req: any, rep: any) => {
    const b = req.body || {}; if (!b.data?.employee || !b.data?.date || !b.data?.status) return rep.code(400).send({ error: 'employee, date, status required' });
    return recordAttendance(requestTenant(req), requestActor(req), b.data);
  });
  app.get('/api/hr/attendance', { preHandler: guard }, async (req: any) => {
    const { employee, from, to } = req.query as any;
    let rows = store.rowsOf(requestTenant(req), 'attendance');
    if (employee) rows = rows.filter(r => r.data.employee === employee);
    if (from) rows = rows.filter(r => r.data.date >= from);
    if (to) rows = rows.filter(r => r.data.date <= to);
    return rows;
  });

  // Leave balances & applications
  app.get('/api/hr/leave-balance', { preHandler: guard }, async (req: any, rep: any) => {
    const { employee, fiscal_year } = req.query as any;
    if (!employee || !fiscal_year) return rep.code(400).send({ error: 'employee and fiscal_year required' });
    return getLeaveBalances(requestTenant(req), employee, fiscal_year);
  });
  app.post('/api/hr/leave-apply', { preHandler: guard }, async (req: any, rep: any) => {
    const b = req.body || {}; if (!b.data?.employee || !b.data?.leave_type || !b.data?.from_date || !b.data?.to_date) return rep.code(400).send({ error: 'employee, leave_type, from_date, to_date required' });
    return applyLeave(requestTenant(req), requestActor(req), b.data);
  });
  app.post('/api/hr/leave-approve/:id', { preHandler: guard }, async (req: any, rep: any) => {
    const approver = (req.body as any)?.approver; if (!approver) return rep.code(400).send({ error: 'approver required' });
    return approveLeave(requestTenant(req), req.params.id, approver);
  });

  // Expense Claims
  app.post('/api/hr/expense-claim', { preHandler: guard }, async (req: any, rep: any) => {
    const b = req.body || {}; if (!b.data?.employee || !b.data?.posting_date || !b.data?.items?.length) return rep.code(400).send({ error: 'employee, posting_date, items[] required' });
    return createExpenseClaim(requestTenant(req), requestActor(req), b.data);
  });
  app.get('/api/hr/expense-claims', { preHandler: guard }, async (req: any) => {
    const { employee, status } = req.query as any;
    let rows = store.rowsOf(requestTenant(req), 'expense_claim');
    if (employee) rows = rows.filter(r => r.data.employee === employee);
    if (status) rows = rows.filter(r => r.data.status === status);
    return rows;
  });

  // Employee Loans
  app.post('/api/hr/loan', { preHandler: guard }, async (req: any, rep: any) => {
    const b = req.body || {}; if (!b.data?.employee || !b.data?.loan_type || !b.data?.principal_amount || !b.data?.start_date) return rep.code(400).send({ error: 'employee, loan_type, principal_amount, start_date required' });
    return createEmployeeLoan(requestTenant(req), requestActor(req), b.data);
  });
  app.get('/api/hr/loan/:id/schedule', { preHandler: guard }, async (req: any) => getLoanSchedule(requestTenant(req), req.params.id));
  app.get('/api/hr/loans', { preHandler: guard }, async (req: any) => {
    const { employee, status } = req.query as any;
    let rows = store.rowsOf(requestTenant(req), 'employee_loan');
    if (employee) rows = rows.filter(r => r.data.employee === employee);
    if (status) rows = rows.filter(r => r.data.status === status);
    return rows;
  });

  // Recruitment
  app.post('/api/hr/job-opening', { preHandler: guard }, async (req: any, rep: any) => {
    const b = req.body || {}; if (!b.data?.title) return rep.code(400).send({ error: 'title required' });
    return createJobOpening(requestTenant(req), requestActor(req), b.data);
  });
  app.get('/api/hr/job-openings', { preHandler: guard }, async (req: any) => {
    const { status } = req.query as any;
    let rows = store.rowsOf(requestTenant(req), 'job_opening');
    if (status) rows = rows.filter(r => r.data.status === status);
    return rows;
  });
  app.post('/api/hr/job-apply', { preHandler: guard }, async (req: any, rep: any) => {
    const b = req.body || {}; if (!b.data?.job_opening || !b.data?.applicant_name) return rep.code(400).send({ error: 'job_opening, applicant_name required' });
    return applyToJob(requestTenant(req), requestActor(req), b.data);
  });
  app.post('/api/hr/interview', { preHandler: guard }, async (req: any, rep: any) => {
    const b = req.body || {}; if (!b.data?.job_applicant || !b.data?.round || !b.data?.interviewer || !b.data?.scheduled_on) return rep.code(400).send({ error: 'job_applicant, round, interviewer, scheduled_on required' });
    return scheduleInterview(requestTenant(req), requestActor(req), b.data);
  });
  app.get('/api/hr/recruitment-pipeline', { preHandler: guard }, async (req: any) => getRecruitmentPipeline(requestTenant(req)));

  // ---- Migration: Tally / Zoho / generic CSV import ----
  app.get('/api/migration/presets', { preHandler: guard }, async () => PRESETS);
  app.post('/api/migration/import', { preHandler: guard }, async (req: any, rep: any) => {
    const { entity, rows, fieldMap, open_bal_account } = req.body as any;
    if (!entity || !Array.isArray(rows)) return rep.code(400).send({ error: 'entity + rows[] required' });
    if (!getDef(entity)) return rep.code(400).send({ error: 'unknown entity: ' + entity });
    try {
      const results = runImport(requestTenant(req), requestActor(req), entity, rows, fieldMap, open_bal_account);
      const ok = results.filter((r) => r.ok).length;
      return { accepted: rows.length, imported: ok, results };
    } catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });

  // ---- Projects & Services: bill unbilled timesheets into a draft sales invoice ----
  app.post('/api/projects/bill', { preHandler: guard }, async (req: any, rep: any) => {
    const { project } = req.body as any;
    if (!project) return rep.code(400).send({ error: 'project required' });
    try { return billProject(requestTenant(req), requestActor(req), project); } catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });

  // ---- Fixed Assets: run depreciation for a period (YYYY-MM) ----
  app.post('/api/assets/depreciate', { preHandler: guard }, async (req: any, rep: any) => {
    const { period } = req.body as any;
    if (!period) return rep.code(400).send({ error: 'period required (YYYY-MM)' });
    try { return runDepreciation(requestTenant(req), requestActor(req), period); } catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });

  // ---- Compliance: statutory summary + audit-trail verification ----
  app.get('/api/compliance/summary', { preHandler: guard }, async (req: any) => getComplianceSummary(requestTenant(req)));
  app.get('/api/compliance/audit', { preHandler: guard }, async (req: any) => verifyAuditTrail(requestTenant(req)));

  // ---- Multi-currency: FX rate lookup + convert to base (INR) ----
  app.get('/api/fx/rate', { preHandler: guard }, async (req: any) => {
    const code = (req.query as any).code || 'INR';
    return { code, rate: getRate(requestTenant(req), code) };
  });
  app.get('/api/fx/convert', { preHandler: guard }, async (req: any) => {
    const code = (req.query as any).code || 'INR';
    const amount = Number((req.query as any).amount) || 0;
    const rate = getRate(requestTenant(req), code);
    return { code, amount, rate, base: convert(amount, rate) };
  });

  // ---- Platform & Ecosystem: RBAC, payments, RPA, marketplace ----
  app.get('/api/auth/whoami', { preHandler: guard }, async (req: any) => ({
    role: req.headers['x-role'] || 'admin', tenant: requestTenant(req),
  }));
  app.get('/api/rbac/check', { preHandler: guard }, async (req: any) => {
    const { entity, action, role } = req.query as any;
    const def = getDef(entity);
    if (!def) return { ok: false, error: 'unknown entity' };
    return { entity, action, role: role || 'admin', allowed: roleCan(role || 'admin', action, def) };
  });
  app.post('/api/payments/link', { preHandler: guard }, async (req: any, rep: any) => {
    const b = req.body as any;
    if (!b?.amount) return rep.code(400).send({ error: 'amount required' });
    try { return paymentLink(b); } catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });
  app.post('/api/rpa/run', { preHandler: guard }, async (req: any, rep: any) => {
    const { bot, input } = req.body as any;
    if (!bot) return rep.code(400).send({ error: 'bot required' });
    try { return runBot(requestTenant(req), requestActor(req), bot, input || {}); } catch (e: any) { return rep.code(400).send({ error: e.message }); }
  });
  app.get('/api/bank/statement', { preHandler: guard }, async (req: any) => fetchBankStatement({ provider: (req.query as any).provider }));
  app.get('/api/marketplace/apps', { preHandler: guard }, async (req: any) => store.rowsOf(requestTenant(req), 'app_def').map((a) => a.data));

  // ---- Phase-14 Ops pack: pricing, recurring invoices, reorder, alerts, backup ----
  app.post('/api/ops/quote', { preHandler: guard }, async (req: any) => quoteRate(requestTenant(req), req.body || {}));
  app.post('/api/ops/recurring/run', { preHandler: guard }, async (req: any) => {
    const ids = runRecurring(requestTenant(req), (req.body as any)?.asOf);
    return { created: ids.length, invoices: ids };
  });
  app.get('/api/ops/reorder', { preHandler: guard }, async (req: any) => reorderSuggestions(requestTenant(req)));
  app.get('/api/ops/alerts', { preHandler: guard }, async (req: any) => getAlerts(requestTenant(req), (req.query as any)?.asOf));
  app.post('/api/ops/po/from-reorder', { preHandler: guard }, async (req: any, rep: any) => {
    const id = createReorderPO(requestTenant(req), (req.body as any)?.supplier);
    if (!id) return rep.code(400).send({ error: 'nothing below reorder level' });
    return { purchase_order: id };
  });
  app.get('/api/ops/backup', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    const db = store.snapshotFor(req.auth!.tenant, req.auth!.storeId);
    const checksum = createHash('sha256').update(JSON.stringify(db), 'utf8').digest('hex');
    rep.type('application/json').header('Content-Disposition', 'attachment; filename="epic-bos-backup.json"');
    return { ...db, backupFormat: 'epic-laundry-backup', backupVersion: 1, createdAt: new Date().toISOString(), tenant: req.auth!.tenant, storeId: req.auth!.storeId, migrations: store.migrationStatus(), checksum };
  });
  app.post('/api/ops/backup/encrypted', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try {
      const db = store.snapshotFor(req.auth!.tenant, req.auth!.storeId);
      return rep.type('application/json').send(encryptBackup(db, (req.body as any)?.passphrase, req.auth!.tenant, req.auth!.storeId));
    } catch (error: any) { return rep.code(400).send({ error: error.message || 'encrypted backup failed' }); }
  });
  app.get('/api/ops/migrations', { preHandler: [guard, allow('settings.manage')] }, async () => ({ status: 'ok', migrations: store.migrationStatus() }));
  app.post('/api/ops/restore/verify', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try {
      const db = validateRestorePayload(req.body, req.auth!.tenant, req.auth!.storeId);
      return { ok: true, backupFormat: 'epic-laundry-backup', rows: db.rows.length, financialEntries: Array.isArray(db.financialEntries) ? db.financialEntries.length : 0, financialDocuments: Array.isArray(db.financialDocuments) ? db.financialDocuments.length : 0, customerLedgerEntries: Array.isArray(db.customerLedgerEntries) ? db.customerLedgerEntries.length : 0, cashShiftCloses: Array.isArray(db.cashShiftCloses) ? db.cashShiftCloses.length : 0, normalizedCustomers: Array.isArray(db.normalizedCustomers) ? db.normalizedCustomers.length : 0, normalizedOrders: Array.isArray(db.normalizedOrders) ? db.normalizedOrders.length : 0, storeId: req.auth!.storeId };
    } catch (error: any) { return rep.code(400).send({ error: error.message || 'backup verification failed' }); }
  });
  app.post('/api/ops/restore/rehearse', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { const db = validateRestorePayload(req.body, req.auth!.tenant, req.auth!.storeId); const result = freshDatabaseRestoreRehearsal(req.auth!.tenant, req.auth!.storeId, db); audit(req.auth!.tenant, req.auth!.actor, 'ops:fresh-database-recovery-rehearsal', { after: { storeId: req.auth!.storeId, ...result } }); return result; }
    catch (error: any) { return rep.code(400).send({ error: error.message || 'fresh-database recovery rehearsal failed' }); }
  });
  app.post('/api/ops/restore', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try {
      const db = validateRestorePayload(req.body, req.auth!.tenant, req.auth!.storeId);
      const result = store.replaceScoped(req.auth!.tenant, req.auth!.storeId, db);
      audit(req.auth!.tenant, req.auth!.actor, 'ops:restore', { after: { storeId: req.auth!.storeId, rows: result.rows } });
      return { ok: true, rows: result.rows, storeId: req.auth!.storeId };
    } catch (error: any) { return rep.code(400).send({ error: error.message || 'backup restore failed' }); }
  });
  app.post('/api/ops/restore/encrypted/verify', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try {
      const envelope = (req.body as any)?.backup;
      if (!envelope || envelope.tenant !== req.auth!.tenant || envelope.storeId !== req.auth!.storeId) throw new Error('encrypted backup belongs to another workspace');
      const db = validateRestorePayload(decryptBackup(envelope, (req.body as any)?.passphrase), req.auth!.tenant, req.auth!.storeId);
      return { ok: true, backupFormat: 'epic-laundry-encrypted-backup', rows: db.rows.length, financialEntries: Array.isArray(db.financialEntries) ? db.financialEntries.length : 0, financialDocuments: Array.isArray(db.financialDocuments) ? db.financialDocuments.length : 0, customerLedgerEntries: Array.isArray(db.customerLedgerEntries) ? db.customerLedgerEntries.length : 0, cashShiftCloses: Array.isArray(db.cashShiftCloses) ? db.cashShiftCloses.length : 0, normalizedCustomers: Array.isArray(db.normalizedCustomers) ? db.normalizedCustomers.length : 0, normalizedOrders: Array.isArray(db.normalizedOrders) ? db.normalizedOrders.length : 0, storeId: req.auth!.storeId };
    } catch (error: any) { return rep.code(400).send({ error: error.message || 'encrypted backup verification failed' }); }
  });
  app.post('/api/ops/restore/encrypted/rehearse', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try { const envelope = (req.body as any)?.backup; if (!envelope || envelope.tenant !== req.auth!.tenant || envelope.storeId !== req.auth!.storeId) throw new Error('encrypted backup belongs to another workspace'); const db = validateRestorePayload(decryptBackup(envelope, (req.body as any)?.passphrase), req.auth!.tenant, req.auth!.storeId); const result = freshDatabaseRestoreRehearsal(req.auth!.tenant, req.auth!.storeId, db); audit(req.auth!.tenant, req.auth!.actor, 'ops:encrypted-fresh-database-recovery-rehearsal', { after: { storeId: req.auth!.storeId, ...result } }); return result; }
    catch (error: any) { return rep.code(400).send({ error: error.message || 'encrypted fresh-database recovery rehearsal failed' }); }
  });
  app.post('/api/ops/restore/encrypted', { preHandler: [guard, allow('settings.manage')] }, async (req: any, rep: any) => {
    try {
      const envelope = (req.body as any)?.backup;
      if (!envelope || envelope.tenant !== req.auth!.tenant || envelope.storeId !== req.auth!.storeId) return rep.code(400).send({ error: 'encrypted backup belongs to another workspace' });
      const db = validateRestorePayload(decryptBackup(envelope, (req.body as any)?.passphrase), req.auth!.tenant, req.auth!.storeId);
      const result = store.replaceScoped(req.auth!.tenant, req.auth!.storeId, db);
      audit(req.auth!.tenant, req.auth!.actor, 'ops:encrypted-restore', { after: { storeId: req.auth!.storeId, rows: result.rows } });
      return result;
    } catch (error: any) { return rep.code(400).send({ error: error.message || 'encrypted backup restore failed' }); }
  });

  // ---- Distribution: scoped read-only customer portal (self-serve invoices + pay link) ----
  // A customer ID is not an access credential. Tokens are short-lived, signed, and bound to one store/customer.
  app.post('/api/portal/access-token', { schema: { body: customerPortalTokenBody }, preHandler: [guard, allow('customers.read')] }, async (req: any, rep: any) => {
    try { return inStore(req, () => issueCustomerPortalToken(req.auth!.tenant, req.body.customerId, req.body.ttlSeconds)); }
    catch (error: any) { return rep.code(error.message === 'PORTAL_NOT_CONFIGURED' ? 503 : 400).send({ code: error.message, error: error.message }); }
  });
  app.get('/api/portal/:customer', { schema: { querystring: customerPortalQuery } }, async (req: any, rep: any) => {
    const cid = String(req.params.customer || '');
    try {
      const claims = verifyCustomerPortalToken(req.query?.token, cid);
      return store.withStoreScope(claims.tenant, claims.storeId, () => {
        const party = store.getRow(claims.tenant, cid);
        if (!party || party.entity !== 'party' || party.data.is_customer !== true) throw new Error('customer not found');
        const paidFor = (invId: string) =>
          store.rowsOf(claims.tenant, 'payment_entry').filter((p) => p.status === 'Submitted' && p.data.against_sales === invId)
            .reduce((a, p) => a + ((store.financialDocumentAmountPaise(claims.tenant, 'payment', p.entity, p.id) ?? Math.round((Number(p.data.amount) || 0) * 100)) / 100), 0);
        const invs = store.rowsOf(claims.tenant, 'sales_invoice')
          .filter((r) => r.status === 'Submitted' && r.data.customer === cid)
          .map((r) => {
            const gt = (store.financialDocumentAmountPaise(claims.tenant, 'invoice', r.entity, r.id) ?? Math.round((Number(r.data.grand_total) || 0) * 100)) / 100;
            const paid = Math.round(paidFor(r.id) * 100) / 100;
            return { name: r.data.name, date: r.data.posting_date, grand_total: gt, paid, balance: Math.max(0, Math.round((gt - paid) * 100) / 100) };
          })
          .filter((x) => x.balance > 0);
        return { customer: { name: party.data.name, gstin: party.data.gstin }, invoices: invs, total_outstanding: Math.round(invs.reduce((a, x) => a + x.balance, 0) * 100) / 100 };
      });
    } catch (error: any) { return rep.code(error.message === 'customer not found' ? 404 : 401).send({ code: error.message, error: error.message }); }
  });

  // ---- Epic AI & Analytics ----
  app.get('/api/ai/insights', { preHandler: guard }, async (req: any) => getInsights(requestTenant(req)));
  app.post('/api/ai/ask', { preHandler: guard }, async (req: any, rep: any) => {
    const q = (req.body as any)?.question;
    if (!q) return rep.code(400).send({ error: 'question required' });
    try { return await ask(requestTenant(req), q); } catch (e: any) { return rep.code(500).send({ error: e.message }); }
  });

  console.log('[api] routes registered');
}
