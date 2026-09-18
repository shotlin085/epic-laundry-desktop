import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { store, type AuthIdentity } from '../../kernel/store.js';

export type OperationalRole = 'owner' | 'counter_staff' | 'processing_staff' | 'rider';

export type AuthContext = {
  identityId: string;
  actor: string;
  tenant: string;
  storeId: string;
  roles: OperationalRole[];
  sessionHash: string;
  riderId?: string;
};

export type StaffProfileInput = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  description?: string;
  riderId?: string;
};

const SESSION_TTL_MS = Number(process.env.EPIC_SESSION_TTL_MS || 1000 * 60 * 60 * 12);
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

function passwordHash(password: string, salt = randomBytes(16).toString('hex')) {
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function passwordMatches(password: string, encoded: string) {
  const [algorithm, salt, expected] = encoded.split('$');
  if (algorithm !== 'scrypt' || !salt || !expected) return false;
  const actual = scryptSync(password, salt, 64).toString('hex');
  return actual.length === expected.length && timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

function requireNewPassword(password: string) {
  if (typeof password !== 'string' || password.length < 12) throw new Error('password must be at least 12 characters');
}

const validRoles: OperationalRole[] = ['owner', 'counter_staff', 'processing_staff', 'rider'];
function validOperationalRoles(roles: unknown): roles is OperationalRole[] {
  return Array.isArray(roles) && roles.length > 0 && roles.every((role) => typeof role === 'string' && validRoles.includes(role as OperationalRole));
}
function profile(input: StaffProfileInput) {
  const clean = (value: unknown, max: number) => String(value || '').trim().slice(0, max);
  const email = clean(input.email, 254);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('email address is invalid');
  return { firstName: clean(input.firstName, 80), lastName: clean(input.lastName, 80), email, phone: clean(input.phone, 40), description: clean(input.description, 500), riderId: clean(input.riderId, 120) };
}
function validatedRiderId(tenant: string, storeId: string, value: unknown) {
  const riderId = String(value || '').trim().slice(0, 120);
  if (!riderId) return undefined;
  // Rider records are branch-scoped. Validate against the identity's target
  // branch rather than whichever AsyncLocalStorage scope the caller happens
  // to be running in (owners may create staff for another branch).
  const rider = store.withStoreScope(tenant, storeId, () => store.getRow(tenant, riderId));
  if (!rider || rider.entity !== 'laundry_rider' || rider.data.active === false) throw new Error('linked rider must be an active rider in this store');
  return riderId;
}
function ensureOwnerContinuity(identity: AuthIdentity, nextRoles: OperationalRole[], nextEnabled: boolean) {
  if (!identity.enabled || !identity.roles.includes('owner') || (nextEnabled && nextRoles.includes('owner'))) return;
  const remainingOwners = store.listIdentities(identity.tenant, identity.storeId)
    .filter((user) => user.enabled && user.roles.includes('owner') && user.id !== identity.id);
  if (remainingOwners.length === 0) throw new Error('at least one enabled owner is required');
}

export function bootstrapOwner(input: { username: string; password: string; tenant?: string; storeId?: string } & StaffProfileInput) {
  const username = input.username?.trim();
  if (!username || username.length < 3) throw new Error('username must be at least 3 characters');
  requireNewPassword(input.password);
  return store.transaction(() => {
    if (store.authIdentityCount() > 0) throw new Error('an owner already exists; use sign in');
    const identity: AuthIdentity = {
      id: randomUUID(), tenant: input.tenant?.trim() || 'T1', storeId: input.storeId?.trim() || 'STORE-DEFAULT', username,
      passwordHash: passwordHash(input.password), roles: ['owner'], enabled: true, ...profile(input), createdAt: new Date().toISOString(),
    };
    store.createIdentity(identity);
    return identity;
  });
}

/**
 * Create the deterministic account used only by the isolated demo workspace.
 *
 * The production workspace never calls this function. Keeping the credential
 * setup here (rather than in the UI or a universal internal key) means the
 * demo can be opened repeatedly while production remains fail-closed and
 * user-managed.
 */
export function ensureDemoOwner(tenant = 'T1', storeId = 'STORE-DEFAULT') {
  if (process.env.EPIC_WORKSPACE_MODE !== 'demo') throw new Error('demo owner is available only in demo workspace mode');
  const username = 'demo';
  const password = 'DemoLaundry!2026';
  const existing = store.findIdentityByUsername(username);
  if (existing) {
    if (existing.tenant !== tenant || existing.storeId !== storeId) throw new Error('demo owner is bound to another workspace');
    store.transaction(() => {
      store.updateIdentityPassword(existing.id, passwordHash(password));
      store.setIdentityEnabled(existing.id, true);
      store.updateIdentityProfile(existing.id, { ...existing, roles: ['owner'], enabled: true });
      store.addStoreMembership({ identityId: existing.id, tenant, storeId, roles: ['owner'], createdAt: existing.createdAt });
    });
    return { username, password };
  }
  const identity: AuthIdentity = {
    id: randomUUID(), tenant, storeId, username,
    passwordHash: passwordHash(password), roles: ['owner'], enabled: true,
    firstName: 'Demo', lastName: 'Owner', email: 'demo@epic-laundry.local', phone: '', description: 'Isolated demo workspace account', riderId: undefined,
    createdAt: new Date().toISOString(),
  };
  store.transaction(() => store.createIdentity(identity));
  return { username, password };
}

export function issueSession(identity: AuthIdentity) {
  const token = randomBytes(32).toString('base64url');
  const sessionHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  store.createSession({ tokenHash: sessionHash, identityId: identity.id, tenant: identity.tenant, storeId: identity.storeId, expiresAt, createdAt: new Date().toISOString() });
  return { token, context: toContext(identity, sessionHash), expiresAt };
}

export function signIn(username: string, password: string) {
  const identity = store.findIdentityByUsername(username?.trim() || '');
  if (!identity || !identity.enabled || !passwordMatches(password, identity.passwordHash)) throw new Error('invalid username or password');
  return issueSession(identity);
}

/**
 * The production-workspace login gate: resolves (or creates) the local
 * identity for a phone number that has *just* been verified against the
 * real backend (see `cloud-auth.ts`). A genuinely different trust boundary
 * from `bootstrapOwner`/`createOperationalUser` — the caller here is the
 * real backend's own OTP verification, not an existing authenticated local
 * actor, so no `can()` staff-management check applies. There is no password
 * for these accounts going forward; sign-in is cloud-OTP only.
 */
export function resolveOrCreateCloudIdentity(input: { phone: string; shopRole: 'VENDOR_OWNER' | 'VENDOR_STAFF' }): { identity: AuthIdentity; isNewIdentity: boolean } {
  const normalizedPhone = String(input.phone || '').replace(/\D/g, '');
  if (!normalizedPhone) throw new Error('a phone number is required');
  const username = `cloud:${normalizedPhone}`;
  const existing = store.findIdentityByUsername(username);
  if (existing) {
    if (!existing.enabled) throw new Error('this account has been disabled by the store owner');
    return { identity: existing, isNewIdentity: false };
  }
  const identity = store.transaction(() => {
    // The very first identity on a fresh install is always the owner,
    // regardless of shopRole — a solo VENDOR_STAFF account logging into a
    // brand-new desktop install has nobody else to defer ownership to.
    const isFirstEver = store.authIdentityCount() === 0;
    const roles: OperationalRole[] = isFirstEver || input.shopRole === 'VENDOR_OWNER' ? ['owner'] : ['counter_staff'];
    const created: AuthIdentity = {
      id: randomUUID(), tenant: 'T1', storeId: 'STORE-DEFAULT', username,
      passwordHash: passwordHash(randomBytes(32).toString('hex')), roles, enabled: true,
      firstName: '', lastName: '', email: '', phone: normalizedPhone, description: 'Linked to the real LNDRY marketplace account', riderId: undefined,
      createdAt: new Date().toISOString(),
    };
    store.createIdentity(created);
    return created;
  });
  return { identity, isNewIdentity: true };
}

export function contextForToken(token: string | undefined) {
  if (!token) return undefined;
  const sessionHash = hashToken(token);
  const result = store.sessionByTokenHash(sessionHash);
  if (!result || result.session.revokedAt || !result.identity.enabled || Date.parse(result.session.expiresAt) <= Date.now()) return undefined;
  const membership = store.membershipForIdentity(result.identity.id, result.identity.tenant, result.session.storeId);
  if (!membership?.enabled) return undefined;
  return toContext({ ...result.identity, roles: membership.roles }, sessionHash, result.session.storeId);
}

export function signOut(token: string | undefined) { if (token) store.revokeSession(hashToken(token)); }

export function changePassword(context: AuthContext, currentPassword: string, newPassword: string) {
  const identity = store.findIdentityByUsername(context.actor);
  if (!identity || !identity.enabled || !passwordMatches(currentPassword, identity.passwordHash)) throw new Error('current password is incorrect');
  requireNewPassword(newPassword);
  store.transaction(() => {
    store.updateIdentityPassword(identity.id, passwordHash(newPassword));
    store.revokeOtherSessions(identity.id, context.sessionHash);
  });
}

/** Server-only staff-account primitive. The staff-management UI is added in Phase 3. */
export function createOperationalUser(actor: AuthContext, input: { username: string; password: string; roles: OperationalRole[]; storeId?: string } & StaffProfileInput) {
  if (!can(actor, 'staff.manage')) throw new Error('permission denied');
  const username = input.username?.trim();
  if (!username || username.length < 3) throw new Error('username must be at least 3 characters');
  if (store.findIdentityByUsername(username)) throw new Error('username is already in use');
  requireNewPassword(input.password);
  if (!validOperationalRoles(input.roles)) throw new Error('a valid operational role is required');
  const identity: AuthIdentity = {
    id: randomUUID(), tenant: actor.tenant, storeId: input.storeId?.trim() || actor.storeId, username,
    passwordHash: passwordHash(input.password), roles: input.roles, enabled: true, ...profile(input), riderId: validatedRiderId(actor.tenant, input.storeId?.trim() || actor.storeId, input.riderId), createdAt: new Date().toISOString(),
  };
  store.createIdentity(identity);
  return identity;
}

export function setOperationalUserEnabled(actor: AuthContext, identityId: string, enabled: boolean) {
  if (!can(actor, 'staff.manage')) throw new Error('permission denied');
  const identity = store.identityById(identityId);
  if (!identity || identity.tenant !== actor.tenant || identity.storeId !== actor.storeId) throw new Error('staff user not found');
  ensureOwnerContinuity(identity, identity.roles as OperationalRole[], enabled);
  store.setIdentityEnabled(identity.id, enabled);
  return { ...identity, enabled };
}

export function updateOperationalUser(actor: AuthContext, identityId: string, input: StaffProfileInput & { roles?: OperationalRole[]; enabled?: boolean }) {
  if (!can(actor, 'staff.manage')) throw new Error('permission denied');
  const identity = store.identityById(identityId);
  if (!identity || identity.tenant !== actor.tenant || identity.storeId !== actor.storeId) throw new Error('staff user not found');
  const roles = input.roles === undefined ? identity.roles as OperationalRole[] : input.roles;
  if (!validOperationalRoles(roles)) throw new Error('a valid operational role is required');
  const enabled = typeof input.enabled === 'boolean' ? input.enabled : identity.enabled;
  ensureOwnerContinuity(identity, roles, enabled);
  const next = { ...identity, ...profile(input), riderId: input.riderId === undefined ? identity.riderId : validatedRiderId(actor.tenant, actor.storeId, input.riderId), roles, enabled };
  store.updateIdentityProfile(identity.id, next);
  store.addStoreMembership({ identityId: identity.id, tenant: identity.tenant, storeId: identity.storeId, roles, createdAt: identity.createdAt });
  return next;
}

export function resetOperationalUserPassword(actor: AuthContext, identityId: string, password: string) {
  if (!can(actor, 'staff.manage')) throw new Error('permission denied');
  const identity = store.identityById(identityId);
  if (!identity || identity.tenant !== actor.tenant || identity.storeId !== actor.storeId) throw new Error('staff user not found');
  requireNewPassword(password);
  store.transaction(() => {
    store.updateIdentityPassword(identity.id, passwordHash(password));
    // A reset immediately expires any active sessions for that staff account.
    store.revokeOtherSessions(identity.id, '');
  });
}

export function createOperationalStore(actor: AuthContext, input: { name: string; code?: string }) {
  if (!can(actor, 'staff.manage')) throw new Error('permission denied');
  const name = String(input.name || '').trim().slice(0, 120);
  if (name.length < 2) throw new Error('store name must be at least 2 characters');
  const code = String(input.code || name).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);
  if (code.length < 2) throw new Error('store code must contain letters or numbers');
  const record = { id: `STORE-${randomUUID().slice(0, 8).toUpperCase()}`, tenant: actor.tenant, name, code, enabled: true, createdAt: new Date().toISOString() };
  store.transaction(() => {
    store.createStore(record);
    store.addStoreMembership({ identityId: actor.identityId, tenant: actor.tenant, storeId: record.id, roles: actor.roles, createdAt: record.createdAt });
  });
  return record;
}

export function listOperationalStores(actor: AuthContext) { return store.listStoresForIdentity(actor.identityId, actor.tenant); }

export function switchOperationalStore(actor: AuthContext, storeId: string) {
  const membership = store.membershipForIdentity(actor.identityId, actor.tenant, storeId);
  if (!membership?.enabled) throw new Error('you do not have active access to that store');
  if (actor.sessionHash === 'desktop-internal') throw new Error('desktop maintenance session cannot switch stores');
  store.updateActiveSessionStore(actor.sessionHash, storeId);
  const storeRecord = store.storeById(actor.tenant, storeId)!;
  return { store: storeRecord, roles: membership.roles as OperationalRole[] };
}

function toContext(identity: AuthIdentity, sessionHash: string, storeId = identity.storeId): AuthContext {
  return { identityId: identity.id, actor: identity.username, tenant: identity.tenant, storeId, roles: identity.roles.filter((role): role is OperationalRole => validRoles.includes(role as OperationalRole)), sessionHash, riderId: identity.riderId };
}

export function can(context: AuthContext, permission: string) {
  if (context.roles.includes('owner')) return true;
  const permissions: Record<OperationalRole, string[]> = {
    counter_staff: ['orders.read', 'orders.create', 'orders.edit', 'orders.hold', 'payments.collect', 'customers.read', 'customers.create', 'customers.edit', 'expenses.create', 'catalogue.read', 'packages.read', 'packages.sell', 'packages.redeem', 'garments.read', 'garments.scan', 'tags.reprint', 'cash.read', 'cash.open', 'cash.close', 'production.read', 'quality.read', 'quality.open', 'routes.read', 'routes.manage', 'hardware.read', 'hardware.receipt'],
    processing_staff: ['orders.read', 'orders.transition', 'catalogue.read', 'packages.read', 'packages.redeem', 'garments.read', 'garments.scan', 'tags.reprint', 'production.read', 'production.assign', 'production.start', 'quality.read', 'quality.open', 'quality.resolve', 'routes.read', 'routes.manage', 'hardware.read', 'hardware.receipt'],
    rider: ['orders.read.assigned', 'orders.deliver.assigned', 'routes.read.assigned', 'routes.manage.assigned'],
    owner: ['*'],
  };
  return context.roles.some((role) => permissions[role].includes(permission));
}

export const readSessionToken = (headers: Record<string, unknown>) => {
  const cookie = String(headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith('epic_session='));
  return cookie ? decodeURIComponent(cookie.slice('epic_session='.length)) : undefined;
};
