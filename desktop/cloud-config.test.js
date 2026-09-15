const assert = require('node:assert/strict');
const { PRODUCTION_LNDRY_API_URL, normalizeApiUrl, resolveMarketplaceCloudApiUrl } = require('./cloud-config');

assert.equal(normalizeApiUrl(' https://api.lndry.in/api/v1/ '), PRODUCTION_LNDRY_API_URL, 'normalizes trailing slash without changing path');
assert.equal(normalizeApiUrl(''), undefined, 'blank configuration is absent');
assert.equal(resolveMarketplaceCloudApiUrl({ isDev: true, env: {} }), undefined, 'development never silently talks to production');
assert.equal(resolveMarketplaceCloudApiUrl({ isDev: false, env: {} }), PRODUCTION_LNDRY_API_URL, 'packaged production defaults to the canonical cloud boundary');
assert.equal(resolveMarketplaceCloudApiUrl({ isDev: false, env: { EPIC_MARKETPLACE_CLOUD_API_URL: 'https://api-staging.lndry.in/api/v1/' } }), 'https://api-staging.lndry.in/api/v1', 'an explicit deployment endpoint wins over the release default');

console.log('cloud config tests passed');
