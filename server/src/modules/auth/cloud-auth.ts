import { requestCloudOtp, verifyCloudOtpForLogin, getMyRolesForLogin, persistCloudSession } from '../marketplace/cloud-session.js';
import type { FetchLike } from '../marketplace/cloud-client.js';
import { resolveOrCreateCloudIdentity, issueSession } from './auth.js';
import { store } from '../../kernel/store.js';

/**
 * The production-workspace login gate: real vendor phone+OTP against the
 * real backend, as the *one* way into this desktop app — replacing the
 * local username/password bootstrap/sign-in for production (the demo
 * workspace keeps its own deterministic password account, untouched).
 *
 * Deliberately a thin orchestrator, not a rewrite of the existing
 * marketplace connector: `getMyRolesForLogin` (a read-only role check)
 * decides whether this phone may enter at all — accounts with no
 * VENDOR_OWNER/VENDOR_STAFF role are refused here, before anything is
 * persisted — and only on success does `persistCloudSession` do the real,
 * persisting connect, reusing the OTP-verify tokens already obtained above
 * rather than verifying the same one-time code a second time (the real
 * backend rejects a repeat verify of an already-used code). This is a UX
 * guardrail, not the real security boundary — the real boundary is the
 * backend's own per-route authorization, unaffected by anything checked
 * here.
 */

export class CloudLoginError extends Error {
  code: 'RIDER_ONLY_ACCOUNT' | 'AMBIGUOUS_VENDOR_ACCOUNT' | 'CLOUD_LOGIN_INPUT_REQUIRED';
  constructor(code: CloudLoginError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

export { requestCloudOtp as requestLoginOtp };

export async function authenticateWithCloud(input: { phone: string; otp: string }, fetchImpl?: FetchLike) {
  const phone = String(input.phone || '').trim();
  const otp = String(input.otp || '').trim();
  if (!phone || !otp) throw new CloudLoginError('CLOUD_LOGIN_INPUT_REQUIRED', 'A phone number and one-time code are required.');

  const tokens = await verifyCloudOtpForLogin(phone, otp, fetchImpl);
  const roles = await getMyRolesForLogin(tokens.accessToken, fetchImpl);

  const isOwner = roles.includes('VENDOR_OWNER');
  const isStaff = roles.includes('VENDOR_STAFF');
  if (!isOwner && !isStaff) {
    if (roles.includes('RIDER') || roles.includes('VENDOR_RIDER')) {
      throw new CloudLoginError('RIDER_ONLY_ACCOUNT', 'This phone is registered as a Captain (delivery) account. Captains cannot access the store desktop app.');
    }
    // A plain CUSTOMER account with no shop-staff role at all.
    throw new CloudLoginError('AMBIGUOUS_VENDOR_ACCOUNT', 'This phone is not recognized as a vendor account for any shop. Contact support if you believe this is wrong.');
  }
  const shopRole: 'VENDOR_OWNER' | 'VENDOR_STAFF' = isOwner ? 'VENDOR_OWNER' : 'VENDOR_STAFF';

  // Persists the connection from the tokens already obtained above — does
  // NOT re-verify the OTP. A second verify-otp call with the same code
  // reliably fails on the real backend (see verifyCloudOtpForLogin's header
  // comment); this used to call connectCloudSession here, which re-verified
  // and broke every real login.
  await persistCloudSession('T1', `cloud:${phone.replace(/\D/g, '')}`, tokens, phone, fetchImpl);

  const { identity, isNewIdentity } = resolveOrCreateCloudIdentity({ phone, shopRole });
  const session = issueSession(identity);
  return { ...session, isNewIdentity };
}

/** True only for the very first cloud login ever on this install — the
 * moment the caller should skip the generic starter catalogue and instead
 * run the real catalogue sync, matching how `/api/auth/bootstrap` seeds
 * defaults only at that same one-time moment. */
export function isFreshInstall() {
  return store.authIdentityCount() === 0;
}
