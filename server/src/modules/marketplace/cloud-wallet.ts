import { getCloudConnectionStatus, postConnectedCloudApi } from './cloud-session.js';
import type { FetchLike } from './cloud-client.js';

/**
 * POS-counter wallet redemption — a vendor looks a customer up by phone,
 * proposes redeeming part of their real LNDRY wallet balance against a
 * counter sale, and the customer confirms by reading a one-time code off
 * their own already-logged-in Lndry_app (see Lndry_backend's
 * wallet-redemption module, migration 112). Thin wrappers only — all the
 * real business logic (rate limiting, audit logging, the atomic
 * claim+debit) lives backend-side; this just talks to it.
 */

function requireLinkedVendor(tenant: string) {
  const status = getCloudConnectionStatus(tenant);
  if (!status.connected) throw new Error('CLOUD_NOT_CONNECTED');
  if (!status.remoteVendorId) throw new Error('CLOUD_VENDOR_NOT_LINKED');
}

export type CloudWalletLookup = { userId: string; name: string; balancePaise: number };
export type CloudWalletRedemptionRequest = { requestId: string; expiresAt: string };
export type CloudWalletRedemptionConfirm = { requestId: string; amountPaise: number; walletTransactionId: string; newBalance: number };

export async function lookupCloudWalletBalance(tenant: string, phone: string, fetchImpl?: FetchLike): Promise<CloudWalletLookup> {
  requireLinkedVendor(tenant);
  const digits = String(phone || '').replace(/\D/g, '');
  return await postConnectedCloudApi(tenant, '/vendor/wallet/lookup', { phone: digits }, fetchImpl) as CloudWalletLookup;
}

export async function createCloudWalletRedemptionRequest(tenant: string, customerUserId: string, amountPaise: number, fetchImpl?: FetchLike): Promise<CloudWalletRedemptionRequest> {
  requireLinkedVendor(tenant);
  return await postConnectedCloudApi(tenant, '/vendor/wallet/redemption-requests', { customerUserId, amountPaise }, fetchImpl) as CloudWalletRedemptionRequest;
}

export async function confirmCloudWalletRedemption(tenant: string, requestId: string, otp: string, fetchImpl?: FetchLike): Promise<CloudWalletRedemptionConfirm> {
  requireLinkedVendor(tenant);
  return await postConnectedCloudApi(tenant, `/vendor/wallet/redemption-requests/${encodeURIComponent(requestId)}/confirm`, { otp }, fetchImpl) as CloudWalletRedemptionConfirm;
}

export async function cancelCloudWalletRedemption(tenant: string, requestId: string, fetchImpl?: FetchLike): Promise<void> {
  requireLinkedVendor(tenant);
  await postConnectedCloudApi(tenant, `/vendor/wallet/redemption-requests/${encodeURIComponent(requestId)}/cancel`, {}, fetchImpl);
}
