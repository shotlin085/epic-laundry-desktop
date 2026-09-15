// The public LNDRY backend is a service endpoint, never a credential. Keep
// the release default in this small, testable module so the packaged Desktop
// has a usable canonical endpoint without baking a vendor/admin token into it.
const PRODUCTION_LNDRY_API_URL = 'https://api.lndry.in/api/v1';

function normalizeApiUrl(value) {
  const url = String(value || '').trim();
  return url ? url.replace(/\/+$/, '') : undefined;
}

/**
 * Development deliberately remains opt-in: a developer should not
 * accidentally send local/demo activity to production. Packaged production
 * builds default to the official HTTPS boundary, but still require the
 * operator's own OTP or platform-admin credentials before protected data can
 * be read or changed.
 */
function resolveMarketplaceCloudApiUrl({ isDev, env = process.env } = {}) {
  const explicit = normalizeApiUrl(env.EPIC_MARKETPLACE_CLOUD_API_URL);
  if (explicit) return explicit;
  return isDev ? undefined : PRODUCTION_LNDRY_API_URL;
}

module.exports = { PRODUCTION_LNDRY_API_URL, normalizeApiUrl, resolveMarketplaceCloudApiUrl };
