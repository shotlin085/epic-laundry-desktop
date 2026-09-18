import { getCloudConnectionStatus, postConnectedCloudApi } from './cloud-session.js';
import { CloudClientError, type FetchLike } from './cloud-client.js';
import { saveMarketplaceCustomerLink, listMarketplaceCustomerLinks } from './customer-links.js';
import type { presentOrder } from '../laundry/domain.js';

/**
 * Pushes a completed walk-in POS sale to the real LNDRY backend as a
 * "Laundry Store" order, IF the customer's phone matches a real account —
 * so the customer's own app shows it in their order history, clearly
 * labeled as an in-person purchase. Best-effort and silent: a booking must
 * never fail or block on this. Not every local customer resolves to a real
 * account, and that's a normal, expected outcome, not an error.
 */

function requireLinkedVendor(tenant: string) {
  const status = getCloudConnectionStatus(tenant);
  if (!status.connected) throw new Error('CLOUD_NOT_CONNECTED');
  if (!status.remoteVendorId) throw new Error('CLOUD_VENDOR_NOT_LINKED');
}

type PresentedOrder = ReturnType<typeof presentOrder>;

export async function pushStoreOrderIfLinked(tenant: string, actor: string, order: PresentedOrder, fetchImpl?: FetchLike): Promise<void> {
  requireLinkedVendor(tenant);
  const localCustomerId = order.customer.id;
  if (!localCustomerId) return;

  // Skip the resolve-phone round trip if this local customer already
  // resolved to a real account on a previous push.
  const existingLink = listMarketplaceCustomerLinks(tenant, localCustomerId).find((link) => link.channel === 'CUSTOMER_APP' && link.status === 'Active');
  let remoteUserId = existingLink?.externalCustomerId;

  if (!remoteUserId) {
    const phone = String(order.customer.phone || '').replace(/\D/g, '');
    if (!phone) return;
    let resolved: { userId?: string } | null = null;
    try {
      resolved = await postConnectedCloudApi(tenant, '/vendor/customers/resolve-phone', { phone }, fetchImpl) as { userId?: string } | null;
    } catch (error) {
      if (error instanceof CloudClientError && error.httpStatus === 404) return; // no real account for this phone — normal, not an error
      throw error;
    }
    if (!resolved?.userId) return;
    remoteUserId = resolved.userId;
    saveMarketplaceCustomerLink(tenant, actor, { customerId: localCustomerId, channel: 'CUSTOMER_APP', externalCustomerId: remoteUserId });
  }

  const items = order.items.map((item: Record<string, unknown>) => ({
    name: String(item.garmentName || ''),
    serviceName: String(item.serviceName || ''),
    qty: Number(item.qty) || 0,
    unit: String(item.unit || ''),
    ratePaise: Math.round((Number(item.rate) || 0) * 100),
    amountPaise: Math.round((Number(item.amount) || 0) * 100),
  }));

  await postConnectedCloudApi(tenant, '/vendor/store-orders', {
    customerUserId: remoteUserId,
    posOrderId: order.id,
    orderNumber: order.orderNumber,
    items,
    subtotalPaise: Math.round((Number(order.subtotal) || 0) * 100),
    discountPaise: Math.round((Number(order.discounts) || 0) * 100),
    taxPaise: Math.round((Number(order.taxAmount) || 0) * 100),
    totalPaise: Math.round((Number(order.grandTotal) || 0) * 100),
    paymentMethod: order.paymentMode,
  }, fetchImpl);
}
