import { audit } from '../../kernel/audit.js';
import { createRow } from '../../kernel/entity-service.js';
import { store } from '../../kernel/store.js';
import type { EntityRow } from '../../kernel/types.js';
import { laundryBusinessDate } from './dates.js';
import { parseMoney, moneyNumber, optionalMoney } from '../../kernel/money.js';
import { randomUUID } from 'node:crypto';

export type CustomerInput = { name: string; phone: string; email?: string; address?: string; openingBalance?: number | string; notes?: string; preferredContact?: 'Phone' | 'WhatsApp' | 'Email' | 'None'; servicePreferences?: string; marketingConsent?: boolean };
export type CustomerAddressInput = { label: string; line1: string; line2?: string; city?: string; state?: string; postalCode?: string; isDefault?: boolean };
export type WalletCommand = { type: 'Credit' | 'Debit' | 'Refund' | 'Adjustment'; amount: number | string; reason: string; referenceType?: string; referenceId?: string };
export type RewardCommand = { points: number; reason: string; referenceType?: string; referenceId?: string };

const round = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
const date = () => laundryBusinessDate();
const normPhone = (value: unknown) => String(value || '').replace(/\D/g, '');
const contactMethods = ['Phone', 'WhatsApp', 'Email', 'None'] as const;
function preferredContact(value: unknown) { const candidate = String(value || 'Phone'); return contactMethods.includes(candidate as typeof contactMethods[number]) ? candidate : 'Phone'; }
function preferenceText(value: unknown) { return String(value || '').trim().slice(0, 500); }

function customerRow(tenant: string, id: string) {
  const row = store.getRow(tenant, id);
  if (!row || row.entity !== 'party' || !row.data.is_customer) throw new Error('customer not found');
  return row;
}

function findCustomer(tenant: string, phone: string, excludeId = '') {
  return store.rowsOf(tenant, 'party').find((row) => row.entity === 'party' && row.data.is_customer && row.id !== excludeId && normPhone(row.data.phone) === phone);
}

function postDocument(row: EntityRow) {
  row.status = 'Posted';
  row.updated_at = new Date().toISOString();
  store.updateRow(row);
  return row;
}

export function appendCustomerLedger(tenant: string, actor: string, input: { customer: string; entryType: 'Opening Balance' | 'Invoice Debit' | 'Payment Credit' | 'Wallet Credit' | 'Wallet Debit' | 'Refund' | 'Adjustment' | 'Settlement'; debit?: number; credit?: number; referenceType?: string; referenceId?: string; reason?: string }) {
  customerRow(tenant, input.customer);
  const debit = optionalMoney(input.debit, 'ledger debit');
  const credit = optionalMoney(input.credit, 'ledger credit');
  if ((debit === 0 && credit === 0) || (debit > 0 && credit > 0)) throw new Error('customer ledger entry needs exactly one debit or credit amount');
  const row = postDocument(createRow(tenant, actor, 'laundry_customer_ledger', {
    customer: input.customer, entry_date: date(), entry_type: input.entryType, debit, credit,
    reference_type: input.referenceType || '', reference_id: input.referenceId || '', reason: String(input.reason || '').trim(),
  }));
  store.appendCustomerLedgerEntry({ id: row.id, tenant, storeId: store.currentStore(tenant), customerId: input.customer, entryType: input.entryType, debitPaise: parseMoney(debit, 'ledger debit', { allowZero: true }), creditPaise: parseMoney(credit, 'ledger credit', { allowZero: true }), entryDate: String(row.data.entry_date), referenceType: String(row.data.reference_type || ''), referenceId: String(row.data.reference_id || ''), reason: String(row.data.reason || ''), actor, createdAt: row.created_at });
  audit(tenant, actor, 'customer:ledger-posted', { entity: 'laundry_customer_ledger', row_id: row.id, after: { customer: input.customer, entryType: input.entryType, debit, credit, referenceId: input.referenceId } });
  return presentLedger(row);
}

export function createLaundryCustomer(tenant: string, actor: string, input: CustomerInput) {
  const name = String(input.name || '').trim().slice(0, 160);
  const phone = normPhone(input.phone);
  if (!name) throw new Error('customer name is required');
  if (phone.length < 6 || phone.length > 15) throw new Error('a valid customer phone is required');
  if (findCustomer(tenant, phone)) throw new Error('a customer with this phone already exists in this branch');
  const openingBalance = moneyNumber(parseMoney(input.openingBalance ?? 0, 'opening balance', { allowNegative: true, allowZero: true }));
  return store.transaction(() => {
    const consent = input.marketingConsent === true;
    const customer = createRow(tenant, actor, 'party', { name, phone, email: String(input.email || '').trim(), address: String(input.address || '').trim(), notes: String(input.notes || '').trim(), preferred_contact: preferredContact(input.preferredContact), service_preferences: preferenceText(input.servicePreferences), marketing_consent: consent, marketing_consent_at: consent ? new Date().toISOString() : null, marketing_consent_by: consent ? actor : null, is_customer: true });
    if (input.marketingConsent !== undefined) {
      createRow(tenant, actor, 'laundry_customer_consent', { customer: customer.id, consent_type: 'marketing', granted: consent, captured_at: new Date().toISOString(), source: 'staff' });
    }
    if (String(input.address || '').trim()) {
      const now = new Date().toISOString();
      store.appendCustomerAddress({ id: `addr_${randomUUID()}`, tenant, storeId: store.currentStore(tenant), customerId: customer.id, label: 'Primary', line1: String(input.address).trim(), line2: '', city: '', state: '', postalCode: '', isDefault: true, active: true, createdAt: now, updatedAt: now, actor });
    }
    let openingEntry: ReturnType<typeof appendCustomerLedger> | undefined;
    if (openingBalance !== 0) openingEntry = appendCustomerLedger(tenant, actor, { customer: customer.id, entryType: 'Opening Balance', debit: openingBalance > 0 ? openingBalance : 0, credit: openingBalance < 0 ? Math.abs(openingBalance) : 0, reason: 'Opening balance' });
    audit(tenant, actor, 'customer:created', { entity: 'party', row_id: customer.id, after: { name, phone, openingBalance } });
    return { ...presentCustomer(customer), openingEntry };
  });
}

export function listLaundryCustomerAddresses(tenant: string, customerId: string) {
  customerRow(tenant, customerId);
  return store.listCustomerAddresses(tenant, customerId);
}

export function saveLaundryCustomerAddress(tenant: string, actor: string, customerId: string, input: CustomerAddressInput, id?: string) {
  customerRow(tenant, customerId);
  const label = String(input.label || '').trim().slice(0, 80);
  const line1 = String(input.line1 || '').trim().slice(0, 240);
  if (!label) throw new Error('address label is required');
  if (!line1) throw new Error('address line1 is required');
  const line2 = String(input.line2 || '').trim().slice(0, 240);
  const city = String(input.city || '').trim().slice(0, 120);
  const state = String(input.state || '').trim().slice(0, 120);
  const postalCode = String(input.postalCode || '').trim().slice(0, 20);
  return store.transaction(() => {
    const existing = id ? store.listCustomerAddresses(tenant, customerId).find((address) => address.id === id) : undefined;
    if (id && !existing) throw new Error('customer address not found');
    const now = new Date().toISOString();
    const existingAddresses = store.listCustomerAddresses(tenant, customerId);
    const hasActiveOther = existingAddresses.some((entry) => entry.active && entry.id !== existing?.id);
    const address = { id: existing?.id || `addr_${randomUUID()}`, tenant, storeId: store.currentStore(tenant), customerId, label, line1, line2, city, state, postalCode, isDefault: Boolean(input.isDefault) || Boolean(existing?.isDefault) || !hasActiveOther, active: true, createdAt: existing?.createdAt || now, updatedAt: now, actor };
    store.appendCustomerAddress(address);
    if (address.isDefault) store.setCustomerAddressDefault(tenant, customerId, address.id);
    audit(tenant, actor, existing ? 'customer:address-updated' : 'customer:address-created', { entity: 'customer_addresses', row_id: address.id, after: { customerId, label, isDefault: address.isDefault } });
    return address;
  });
}

export function archiveLaundryCustomerAddress(tenant: string, actor: string, customerId: string, id: string) {
  customerRow(tenant, customerId);
  return store.transaction(() => {
    const address = store.listCustomerAddresses(tenant, customerId).find((entry) => entry.id === id);
    if (!address || !address.active) throw new Error('customer address not found');
    store.archiveCustomerAddress(tenant, customerId, id);
    if (address.isDefault) {
      const replacement = store.listCustomerAddresses(tenant, customerId).find((entry) => entry.active);
      if (replacement) store.setCustomerAddressDefault(tenant, customerId, replacement.id);
    }
    audit(tenant, actor, 'customer:address-archived', { entity: 'customer_addresses', row_id: id, after: { customerId } });
    return { ...address, active: false, isDefault: false };
  });
}

export function updateLaundryCustomer(tenant: string, actor: string, id: string, input: Partial<CustomerInput>) {
  const customer = customerRow(tenant, id);
  const name = input.name === undefined ? String(customer.data.name || '') : String(input.name || '').trim().slice(0, 160);
  const phone = input.phone === undefined ? normPhone(customer.data.phone) : normPhone(input.phone);
  if (!name) throw new Error('customer name is required');
  if (phone.length < 6 || phone.length > 15) throw new Error('a valid customer phone is required');
  if (findCustomer(tenant, phone, id)) throw new Error('a customer with this phone already exists in this branch');
  const before = presentCustomer(customer);
  const nextConsent = input.marketingConsent === undefined ? Boolean(customer.data.marketing_consent) : Boolean(input.marketingConsent);
  const consentChanged = input.marketingConsent !== undefined && nextConsent !== Boolean(customer.data.marketing_consent);
  customer.data = { ...customer.data, name, phone, email: input.email === undefined ? customer.data.email || '' : String(input.email || '').trim(), address: input.address === undefined ? customer.data.address || '' : String(input.address || '').trim(), notes: input.notes === undefined ? customer.data.notes || '' : String(input.notes || '').trim(), preferred_contact: input.preferredContact === undefined ? preferredContact(customer.data.preferred_contact) : preferredContact(input.preferredContact), service_preferences: input.servicePreferences === undefined ? preferenceText(customer.data.service_preferences) : preferenceText(input.servicePreferences), marketing_consent: nextConsent, marketing_consent_at: consentChanged ? new Date().toISOString() : customer.data.marketing_consent_at || null, marketing_consent_by: consentChanged ? actor : customer.data.marketing_consent_by || null, is_customer: true };
  customer.updated_at = new Date().toISOString();
  store.updateRow(customer);
  if (consentChanged) {
    const capturedAt = new Date().toISOString();
    createRow(tenant, actor, 'laundry_customer_consent', { customer: id, consent_type: 'marketing', granted: nextConsent, captured_at: capturedAt, source: 'staff' });
    audit(tenant, actor, 'customer:consent-changed', { entity: 'laundry_customer_consent', row_id: id, after: { consentType: 'marketing', granted: nextConsent, capturedAt } });
  }
  audit(tenant, actor, 'customer:updated', { entity: 'party', row_id: id, before, after: presentCustomer(customer) });
  return presentCustomer(customer);
}

export function applyWalletCommand(tenant: string, actor: string, customerId: string, input: WalletCommand) {
  customerRow(tenant, customerId);
  const amount = moneyNumber(parseMoney(input.amount, 'wallet amount'));
  const reason = String(input.reason || '').trim().slice(0, 500);
  if (!['Credit', 'Debit', 'Refund', 'Adjustment'].includes(input.type)) throw new Error('unknown wallet action');
  if (amount <= 0) throw new Error('wallet amount must be greater than zero');
  if (!reason) throw new Error('wallet adjustment reason is required');
  return store.transaction(() => {
    const current = walletEntries(tenant, customerId).reduce((sum, entry) => sum + (entry.entryType === 'Debit' ? -entry.amount : entry.amount), 0);
    if (input.type === 'Debit' && round(current) < amount) throw new Error('wallet debit exceeds available balance');
    const entry = postDocument(createRow(tenant, actor, 'laundry_wallet_entry', { customer: customerId, entry_date: date(), entry_type: input.type, amount, reason, reference_type: input.referenceType || '', reference_id: input.referenceId || '' }));
    store.appendWalletEntry({ id: entry.id, tenant, storeId: store.currentStore(tenant), customerId, entryType: input.type, amountPaise: parseMoney(amount, 'wallet amount'), entryDate: String(entry.data.entry_date), referenceType: String(entry.data.reference_type || ''), referenceId: String(entry.data.reference_id || ''), reason, actor, createdAt: entry.created_at });
    store.appendFinancialDocument({ id: `doc:${entry.id}`, tenant, storeId: store.currentStore(tenant), documentType: 'wallet', sourceEntity: 'laundry_wallet_entry', sourceId: entry.id, amountPaise: parseMoney(amount, 'wallet amount'), currency: 'INR', status: entry.status, occurredAt: entry.created_at, actor, metadata: { customerId, type: input.type, reason } });
    const isDebit = input.type === 'Debit';
    appendCustomerLedger(tenant, actor, { customer: customerId, entryType: isDebit ? 'Wallet Debit' : 'Wallet Credit', debit: isDebit ? amount : 0, credit: isDebit ? 0 : amount, referenceType: 'laundry_wallet_entry', referenceId: entry.id, reason });
    audit(tenant, actor, 'customer:wallet-posted', { entity: 'laundry_wallet_entry', row_id: entry.id, after: { customer: customerId, type: input.type, amount, reason } });
    return presentWallet(entry);
  });
}

export function adjustRewards(tenant: string, actor: string, customerId: string, input: RewardCommand) {
  customerRow(tenant, customerId);
  const points = Math.round(Number(input.points) || 0);
  const reason = String(input.reason || '').trim().slice(0, 500);
  if (!points) throw new Error('reward points must not be zero');
  if (!reason) throw new Error('reward adjustment reason is required');
  const current = rewardEntries(tenant, customerId).reduce((sum, entry) => sum + entry.points, 0);
  if (points < 0 && current + points < 0) throw new Error('reward redemption exceeds available points');
  const entry = postDocument(createRow(tenant, actor, 'laundry_reward_entry', { customer: customerId, entry_date: date(), points, reason, reference_type: input.referenceType || '', reference_id: input.referenceId || '' }));
  audit(tenant, actor, 'customer:reward-posted', { entity: 'laundry_reward_entry', row_id: entry.id, after: { customer: customerId, points, reason, policy: 'EPIC_EXTENSION_MANUAL' } });
  return presentReward(entry);
}

export function customerProfile(tenant: string, id: string) {
  const customer = customerRow(tenant, id);
  const orders = store.rowsOf(tenant, 'laundry_order').filter((row) => row.data.customer === id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const ledger = customerLedger(tenant, id);
  const wallet = walletEntries(tenant, id);
  const rewards = rewardEntries(tenant, id);
  const orderAmount = (order: EntityRow) => {
    const invoice = store.getRow(tenant, order.data.invoice);
    const amountPaise = invoice?.entity === 'sales_invoice' ? store.financialDocumentAmountPaise(tenant, 'invoice', invoice.entity, invoice.id) : undefined;
    return amountPaise === undefined ? Number(order.data.grand_total || 0) : moneyNumber(amountPaise);
  };
  const unreconciledOrderIds = orders.filter((order) => order.data.state !== 'Cancelled' && orderAmount(order) > 0 && !ledger.some((entry) => entry.referenceType === 'laundry_order' && entry.referenceId === order.id)).map((order) => order.id);
  const balance = round(ledger.reduce((sum, entry) => sum + entry.debit - entry.credit, 0));
  const walletBalance = round(wallet.reduce((sum, entry) => sum + (entry.entryType === 'Debit' ? -entry.amount : entry.amount), 0));
  const rewardPoints = rewards.reduce((sum, entry) => sum + entry.points, 0);
  const consents = store.rowsOf(tenant, 'laundry_customer_consent').filter((row) => row.data.customer === id).sort((a, b) => String(b.data.captured_at || b.created_at).localeCompare(String(a.data.captured_at || a.created_at))).map((row) => ({ id: row.id, type: String(row.data.consent_type || ''), granted: Boolean(row.data.granted), capturedAt: String(row.data.captured_at || row.created_at), source: String(row.data.source || '') }));
  const revenue = round(orders.filter((order) => order.data.state !== 'Cancelled').reduce((sum, order) => sum + orderAmount(order), 0));
  const currentPackageRow = store.rowsOf(tenant, 'customer_package').filter((row) => row.data.customer === id && row.data.status === 'Active' && String(row.data.expires_on || '') >= date()).sort((a, b) => String(a.data.expires_on).localeCompare(String(b.data.expires_on)))[0];
  const currentPackageDefinition = currentPackageRow ? store.getRow(tenant, String(currentPackageRow.data.service_package)) : undefined;
  const byState = Object.fromEntries(['Booked', 'Picked Up', 'In Process', 'Ready', 'Out for Delivery', 'Delivered', 'Cancelled'].map((state) => [state, orders.filter((order) => order.data.state === state).length]));
  const timeline = [
    ...ledger.map((entry) => ({ at: entry.entryDate, type: 'ledger', label: entry.entryType, amount: round(entry.debit - entry.credit), referenceId: entry.referenceId, reason: entry.reason })),
    ...wallet.map((entry) => ({ at: entry.entryDate, type: 'wallet', label: `Wallet ${entry.entryType}`, amount: entry.entryType === 'Debit' ? -entry.amount : entry.amount, referenceId: entry.referenceId, reason: entry.reason })),
    ...rewards.map((entry) => ({ at: entry.entryDate, type: 'reward', label: 'Reward adjustment', amount: entry.points, referenceId: entry.referenceId, reason: entry.reason })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const marketplaceLinks = store.listMarketplaceCustomerLinks(tenant, id);
  const marketplaceOrders = store.listMarketplaceCustomerOrderProjections(tenant, id, 100);
  return {
    customer: presentCustomer(customer),
    consents,
    metrics: { revenue, orderBalance: balance, walletBalance, rewardPoints, lastVisit: orders[0]?.data.order_date || null, currentPackage: currentPackageDefinition ? String(currentPackageDefinition.data.name || '') : null, orderStatus: byState },
    addresses: store.listCustomerAddresses(tenant, id),
    orders: orders.map((order) => ({ id: order.id, orderNumber: order.data.name || order.id, orderDate: order.data.order_date, state: order.data.state, grandTotal: orderAmount(order), invoice: order.data.invoice || null, paymentStatus: order.data.payment_status || 'Unpaid', fulfillmentMode: order.data.fulfillment_mode || 'Home Delivery', expectedDeliveryDate: order.data.expected_delivery_date || '', serviceZone: order.data.service_zone || '', deliveryAddress: order.data.delivery_address || order.data.address || '', notes: order.data.notes || '', items: Array.isArray(order.data.items) ? order.data.items.map((item: any) => ({ garment: String(item.garment || ''), service: String(item.service || ''), qty: Number(item.qty || 0) })) : [] })),
    marketplace: { links: marketplaceLinks, orders: marketplaceOrders.map((order) => ({ id: order.id, externalOrderId: order.externalOrderId, orderNumber: order.orderNumber, channel: order.channel, state: order.state, paymentState: order.paymentState, updatedAt: order.updatedAt })) },
    ledger, wallet, rewards, timeline,
    reconciliation: { customerLedgerBalance: balance, walletBalance, orderCount: orders.length, unreconciledOrderCount: unreconciledOrderIds.length, note: unreconciledOrderIds.length ? `${unreconciledOrderIds.length} historical order(s) predate the customer ledger and require controlled reconciliation; displayed balance is ledger-only.` : 'Balances are derived from append-only customer and wallet ledger entries.' },
  };
}

/**
 * Deterministic Customer 360 lifecycle projection.
 *
 * This is intentionally read-only and derives every value from the local
 * branch's durable customer/order records. It does not infer churn causes,
 * send communications, or manufacture activity for customers without orders.
 */
export function customerRetentionInsights(tenant: string) {
  const asOf = date();
  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  const issues: Array<{ customerId: string; orderId?: string; code: string; message: string }> = [];
  const customers = store.rowsOf(tenant, 'party').filter((row) => row.data.is_customer);
  const orders = store.rowsOf(tenant, 'laundry_order');
  const ordersByCustomer = new Map<string, EntityRow[]>();
  for (const order of orders) {
    const customerId = String(order.data.customer || '').trim();
    if (!customerId) continue;
    const bucket = ordersByCustomer.get(customerId) || [];
    bucket.push(order);
    ordersByCustomer.set(customerId, bucket);
  }
  const segmentLabels = {
    new: 'New',
    active_repeat: 'Active repeat',
    active_single: 'Active first-time',
    at_risk: 'At risk',
    lapsed: 'Lapsed',
    unknown: 'Date unknown',
    no_orders: 'No orders',
  } as const;
  type Segment = keyof typeof segmentLabels;
  const daysSince = (value: string) => {
    const parsed = Date.parse(`${value}T00:00:00Z`);
    if (!Number.isFinite(parsed) || !Number.isFinite(asOfMs)) return null;
    return Math.max(0, Math.floor((asOfMs - parsed) / 86_400_000));
  };
  const amountForOrder = (customerId: string, order: EntityRow) => {
    if (order.data.state === 'Cancelled') return 0;
    try {
      const invoice = store.getRow(tenant, String(order.data.invoice || ''));
      const normalized = invoice?.entity === 'sales_invoice'
        ? store.financialDocumentAmountPaise(tenant, 'invoice', invoice.entity, invoice.id)
        : undefined;
      if (normalized !== undefined) return moneyNumber(normalized);
      return moneyNumber(parseMoney(order.data.grand_total ?? 0, 'order total', { allowZero: true }));
    } catch (error) {
      issues.push({ customerId, orderId: order.id, code: 'INVALID_ORDER_AMOUNT', message: error instanceof Error ? error.message : 'order amount could not be normalized' });
      return 0;
    }
  };
  const rows = customers.map((customer) => {
    const customerId = customer.id;
    const customerOrders = (ordersByCustomer.get(customerId) || []).filter((order) => order.data.state !== 'Cancelled');
    const datedOrders = customerOrders.map((order) => ({ order, orderDate: String(order.data.order_date || order.created_at.slice(0, 10)) }))
      .sort((a, b) => b.orderDate.localeCompare(a.orderDate));
    const lastOrderDate = datedOrders[0]?.orderDate || null;
    const days = lastOrderDate ? daysSince(lastOrderDate) : null;
    let segment: Segment = 'no_orders';
    if (customerOrders.length > 0) {
      if (days === null) {
        segment = 'unknown';
        issues.push({ customerId, code: 'INVALID_ORDER_DATE', message: 'latest order has no valid business date' });
      } else if (days <= 30 && customerOrders.length === 1) segment = 'new';
      else if (days <= 45 && customerOrders.length >= 2) segment = 'active_repeat';
      else if (days <= 45) segment = 'active_single';
      else if (days <= 90) segment = 'at_risk';
      else segment = 'lapsed';
    }
    const revenue = round(datedOrders.reduce((sum, entry) => sum + amountForOrder(customerId, entry.order), 0));
    const deliveredOrders = customerOrders.filter((order) => order.data.state === 'Delivered').length;
    const openOrders = customerOrders.filter((order) => !['Delivered', 'Cancelled'].includes(String(order.data.state || ''))).length;
    const consented = Boolean(customer.data.marketing_consent);
    const preferred = preferredContact(customer.data.preferred_contact);
    const contactDetail = preferred === 'Email' ? String(customer.data.email || '').trim() : normPhone(customer.data.phone);
    const contactEligible = consented && preferred !== 'None' && Boolean(contactDetail);
    const recommendation = segment === 'at_risk' || segment === 'lapsed'
      ? (contactEligible ? `Review a ${preferred} follow-up (consent recorded)` : 'Review manually; no consented contact channel is available')
      : segment === 'unknown' ? 'Review order dates before making a retention decision'
      : segment === 'no_orders' ? 'Complete first booking or verify profile details' : 'No retention action required';
    return {
      customerId,
      name: String(customer.data.name || ''),
      phone: normPhone(customer.data.phone),
      email: String(customer.data.email || ''),
      segment,
      segmentLabel: segmentLabels[segment],
      orderCount: customerOrders.length,
      deliveredOrders,
      openOrders,
      revenue,
      lastOrderDate,
      daysSinceLastOrder: days,
      marketingConsent: consented,
      preferredContact: preferred,
      contactEligible,
      recommendation,
    };
  }).sort((a, b) => {
    const priority: Record<Segment, number> = { at_risk: 0, lapsed: 1, unknown: 2, new: 3, active_repeat: 4, active_single: 5, no_orders: 6 };
    return priority[a.segment] - priority[b.segment] || (b.daysSinceLastOrder ?? -1) - (a.daysSinceLastOrder ?? -1) || a.name.localeCompare(b.name);
  });
  const bySegment = Object.fromEntries((Object.keys(segmentLabels) as Segment[]).map((segment) => [segment, rows.filter((row) => row.segment === segment).length])) as Record<Segment, number>;
  return {
    asOf,
    policy: {
      newWithinDays: 30,
      activeWithinDays: 45,
      atRiskAfterDays: 45,
      lapsedAfterDays: 90,
      cancelledOrdersExcluded: true,
      note: 'Segments are deterministic activity windows, not a prediction of churn or customer intent.',
    },
    summary: {
      totalCustomers: rows.length,
      customersWithOrders: rows.filter((row) => row.orderCount > 0).length,
      repeatCustomers: rows.filter((row) => row.segment === 'active_repeat' || row.orderCount >= 2).length,
      newCustomers: bySegment.new,
      atRiskCustomers: bySegment.at_risk,
      lapsedCustomers: bySegment.lapsed,
      unknownDateCustomers: bySegment.unknown,
      consentedCustomers: rows.filter((row) => row.marketingConsent).length,
      contactEligibleCustomers: rows.filter((row) => row.contactEligible).length,
      revenue: round(rows.reduce((sum, row) => sum + row.revenue, 0)),
    },
    bySegment,
    customers: rows.slice(0, 500),
    issues: issues.slice(0, 100),
  };
}

export function searchCustomerRecords(tenant: string, search = '') {
  const needle = String(search || '').trim().toLowerCase();
  const invoiceMatches = new Set(store.rowsOf(tenant, 'laundry_order').filter((order) => `${order.data.name || ''} ${order.data.invoice || ''}`.toLowerCase().includes(needle)).map((order) => String(order.data.customer)));
  return store.rowsOf(tenant, 'party').filter((row) => row.entity === 'party' && row.data.is_customer).filter((row) => !needle || `${row.data.name || ''} ${row.data.phone || ''}`.toLowerCase().includes(needle) || invoiceMatches.has(row.id)).slice(0, 30).map((row) => ({ ...presentCustomer(row), matchedBy: invoiceMatches.has(row.id) && !`${row.data.name || ''} ${row.data.phone || ''}`.toLowerCase().includes(needle) ? 'invoice' : 'identity' }));
}

/**
 * Real online (marketplace-app) customers who don't have a local `party`
 * record yet — deliberately read-only and kept separate from
 * `searchCustomerRecords` above, since these customers have no local
 * address/ledger/wallet/reward history until their first order actually
 * goes through local intake (`edge-sync.ts#materializeMarketplaceOrder`).
 * Surfacing them here answers "who's actually ordering online" without
 * pretending they're full local customer records.
 */
export function listOnlineOnlyCustomers(tenant: string) {
  const localPhones = new Set(store.rowsOf(tenant, 'party').filter((row) => row.data.is_customer).map((row) => normPhone(row.data.phone)).filter(Boolean));
  const byPhone = new Map<string, { name: string; phone: string; orderCount: number; lastOrderAt: string }>();
  for (const order of store.listMarketplaceOrderProjections(tenant)) {
    const customer = order.customer as Record<string, unknown> | undefined;
    const phone = normPhone(customer?.phone);
    if (!phone || localPhones.has(phone)) continue;
    const existing = byPhone.get(phone);
    const name = String(customer?.name || existing?.name || 'Online customer');
    if (existing) { existing.orderCount += 1; if (order.createdAt > existing.lastOrderAt) existing.lastOrderAt = order.createdAt; }
    else byPhone.set(phone, { name, phone, orderCount: 1, lastOrderAt: order.createdAt });
  }
  return [...byPhone.values()].sort((a, b) => b.lastOrderAt.localeCompare(a.lastOrderAt));
}

function customerLedger(tenant: string, customer: string) {
  const normalized = store.listCustomerLedgerEntries(tenant, customer);
  const normalizedIds = new Set(normalized.map((entry) => entry.id));
  const legacy = store.rowsOf(tenant, 'laundry_customer_ledger').filter((row) => row.data.customer === customer && !normalizedIds.has(row.id)).map(presentLedger);
  return [...normalized.map((entry) => ({ id: entry.id, entryDate: entry.entryDate, entryType: entry.entryType, debit: entry.debitPaise / 100, credit: entry.creditPaise / 100, referenceType: entry.referenceType, referenceId: entry.referenceId, reason: entry.reason })), ...legacy].sort((a, b) => b.entryDate.localeCompare(a.entryDate) || b.id.localeCompare(a.id));
}
function walletEntries(tenant: string, customer: string) {
  const normalized = store.listWalletEntries(tenant, customer);
  const normalizedIds = new Set(normalized.map((entry) => entry.id));
  const legacy = store.rowsOf(tenant, 'laundry_wallet_entry').filter((row) => row.data.customer === customer && !normalizedIds.has(row.id)).map(presentWallet);
  return [...normalized.map((entry) => ({ id: entry.id, entryDate: entry.entryDate, entryType: entry.entryType, amount: entry.amountPaise / 100, reason: entry.reason, referenceType: entry.referenceType, referenceId: entry.referenceId })), ...legacy].sort((a, b) => b.entryDate.localeCompare(a.entryDate) || b.id.localeCompare(a.id));
}
function rewardEntries(tenant: string, customer: string) { return store.rowsOf(tenant, 'laundry_reward_entry').filter((row) => row.data.customer === customer).map(presentReward).sort((a, b) => b.entryDate.localeCompare(a.entryDate) || b.id.localeCompare(a.id)); }
function presentCustomer(row: EntityRow) { return { id: row.id, name: String(row.data.name || ''), phone: normPhone(row.data.phone), email: String(row.data.email || ''), address: String(row.data.address || ''), notes: String(row.data.notes || ''), preferredContact: preferredContact(row.data.preferred_contact), servicePreferences: preferenceText(row.data.service_preferences), marketingConsent: Boolean(row.data.marketing_consent), createdAt: row.created_at, updatedAt: row.updated_at }; }
function presentLedger(row: EntityRow) { return { id: row.id, entryDate: String(row.data.entry_date), entryType: String(row.data.entry_type), debit: Number(row.data.debit || 0), credit: Number(row.data.credit || 0), referenceType: String(row.data.reference_type || ''), referenceId: String(row.data.reference_id || ''), reason: String(row.data.reason || '') }; }
function presentWallet(row: EntityRow) { return { id: row.id, entryDate: String(row.data.entry_date), entryType: String(row.data.entry_type), amount: Number(row.data.amount || 0), reason: String(row.data.reason || ''), referenceType: String(row.data.reference_type || ''), referenceId: String(row.data.reference_id || '') }; }
function presentReward(row: EntityRow) { return { id: row.id, entryDate: String(row.data.entry_date), points: Number(row.data.points || 0), reason: String(row.data.reason || ''), referenceType: String(row.data.reference_type || ''), referenceId: String(row.data.reference_id || '') }; }
