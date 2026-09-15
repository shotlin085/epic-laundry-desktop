import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { createHmac } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerApi } from './api.js';
import { registerSeedAutomations } from './automations/seed.js';
import { listRows } from './kernel/entity-service.js';
import { assignLaundryOrder, bookLaundryOrder, createLaundryRider, laundryCatalogue, scanLaundryGarment, seedLaundryDefaults, transitionLaundryOrder } from './modules/laundry/domain.js';
import { laundryBusinessDate } from './modules/laundry/dates.js';
import { seedLaundryDemoExpansion, seedLaundryDemoExperienceCoverage, seedLaundryDemoLifecycleCoverage } from './modules/laundry/demo-data.js';
import { ensureDemoOwner } from './modules/auth/auth.js';
import { createCloudOrderAutoSync } from './modules/marketplace/cloud-order-auto-sync.js';

const TENANT = process.env.EPIC_TENANT || 'T1';
const PORT = Number(process.env.PORT || 3001);
const WORKSPACE_MODE = process.env.EPIC_WORKSPACE_MODE === 'demo' ? 'demo' : 'production';
// Make the entry-point mode explicit to downstream domain services. This is
// what lets production tax paths fail closed while isolated self-tests and
// demo data retain their compatibility behavior.
process.env.EPIC_WORKSPACE_MODE = WORKSPACE_MODE;

const app = Fastify({ logger: true });
const configuredCorsOrigins = String(process.env.EPIC_CORS_ORIGIN || '').split(',').map((origin) => origin.trim()).filter(Boolean);
await app.register(cors, { origin: configuredCorsOrigins.length ? configuredCorsOrigins : false });

// Keep the retired generic ERP pages from being opened by the desktop or old
// bookmarks. These redirects preserve useful entry points while ensuring
// every operational surface lands in the authenticated Laundry Desk UI.
const retiredUiRouteRedirects: Record<string, string> = {
  '/ui/': '/ui/app/',
  '/ui/index.html': '/ui/app/#/laundry/dashboard',
  '/ui/pos.html': '/ui/app/#/laundry/new-order',
  '/ui/invoice.html': '/ui/app/#/laundry/print-centre',
  '/ui/invoices.html': '/ui/app/#/laundry/print-centre',
  '/ui/crm.html': '/ui/app/#/laundry/customers',
  '/ui/engage.html': '/ui/app/#/laundry/customers',
  '/ui/inventory.html': '/ui/app/#/laundry/catalogue',
  '/ui/buying.html': '/ui/app/#/laundry/expenses',
  '/ui/purchases.html': '/ui/app/#/laundry/expenses',
  '/ui/selling.html': '/ui/app/#/laundry/orders',
  '/ui/manufacturing.html': '/ui/app/#/laundry/production-queue',
  '/ui/accounting.html': '/ui/app/#/laundry/finance',
  '/ui/banking.html': '/ui/app/#/laundry/finance',
  '/ui/gst.html': '/ui/app/#/laundry/finance/statutory',
  '/ui/compliance.html': '/ui/app/#/laundry/quality-claims',
  '/ui/returns.html': '/ui/app/#/laundry/returns',
  '/ui/hr.html': '/ui/app/#/laundry/management',
  '/ui/projects.html': '/ui/app/#/laundry/operations',
  '/ui/assets.html': '/ui/app/#/laundry/catalogue',
  '/ui/ai.html': '/ui/app/#/laundry/dashboard',
  '/ui/ops.html': '/ui/app/#/laundry/operations',
  '/ui/multi-entity.html': '/ui/app/#/laundry/settings',
  '/ui/migration.html': '/ui/app/#/laundry/import-catalogue',
  '/ui/ecosystem.html': '/ui/app/#/laundry/sync-status',
  '/ui/portal.html': '/ui/app/#/laundry/customers',
};
app.addHook('onRequest', async (request, reply) => {
  const pathname = request.raw.url?.split('?')[0] || '';
  const destination = retiredUiRouteRedirects[pathname];
  if (destination) return reply.redirect(destination);
});

const DEMO_ASSEMBLY_STATES = ['Sorted', 'Processing', 'QC', 'Assembly', 'Racked'] as const;
function completeDemoAssembly(units: Array<{ tagCode: string; sequence: number }>, batch: string) {
  for (const [unitIndex, unit] of units.entries()) for (const [stateIndex, nextState] of DEMO_ASSEMBLY_STATES.entries()) scanLaundryGarment(TENANT, 'demo-seed', { tagCode: unit.tagCode, nextState, location: nextState === 'Racked' ? `DEMO-RACK-${batch}-${unitIndex}` : `Demo ${nextState} station`, note: `Demo assembly step ${stateIndex + 1}` });
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
await app.register(fastifyStatic, {
  root: path.join(__dirname, '..', 'public'),
  prefix: '/ui/',
});

registerApi(app);
// This is deliberately a direct account REST pull, not the separate local
// device-envelope transport. It runs per connected store, persists health and
// backs off safely after a cloud failure. Set the flag to false only for a
// controlled diagnostic session; ordinary Desktop operation keeps it on.
const cloudOrderAutoSync = process.env.EPIC_MARKETPLACE_CLOUD_AUTO_SYNC === 'false'
  ? undefined
  : createCloudOrderAutoSync({
    tenant: TENANT,
    intervalMs: Number(process.env.EPIC_MARKETPLACE_CLOUD_POLL_INTERVAL_MS || 30_000),
  });
app.addHook('onClose', async () => { cloudOrderAutoSync?.stop(); });
registerSeedAutomations(TENANT);
if (WORKSPACE_MODE === 'demo') {
  ensureDemoOwner(TENANT, 'STORE-DEFAULT');
  seedLaundryDefaults(TENANT);
  seedLaundryDemo();
  seedLaundryDemoExpansion(TENANT);
  seedLaundryDemoLifecycleCoverage(TENANT);
  seedLaundryDemoExperienceCoverage(TENANT);
}

function seedLaundryDemo() {
  if (listRows(TENANT, 'laundry_order').length) return;
  const catalogue = laundryCatalogue(TENANT);
  const garments = new Map(catalogue.garments.map((garment) => [garment.name, garment]));
  const services = new Map(catalogue.services.map((service) => [service.name, service]));
  const rider = createLaundryRider(TENANT, 'demo-seed', { name: 'Amit Das', phone: '9000000109' });
  const today = laundryBusinessDate();
  const day = (offset: number) => {
    const value = new Date(`${today}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() + offset);
    return value.toISOString().slice(0, 10);
  };
  const samples = [
    ['Demo Priya', '9000000101', 'Shirt / T-shirt', 'Steam Iron', 'Home Delivery', 'Cash', 'Booked'],
    ['Demo Rahul', '9000000102', 'Trouser / Pant', 'Dry Cleaning', 'Pickup Order', 'Pay Later', 'Booked'],
    ['Demo Ananya', '9000000103', 'Saree', 'Dry Cleaning', 'Pickup Order', 'UPI', 'Picked Up'],
    ['Demo Kabir', '9000000104', 'Kurti', 'Steam Iron', 'Home Delivery', 'Card', 'In Process'],
    ['Demo Meera', '9000000105', 'Blanket', 'Dry Cleaning', 'Home Delivery', 'Pay Later', 'In Process'],
    ['Demo Suman', '9000000106', 'Bed sheet', 'Dry Cleaning', 'Home Delivery', 'Cash', 'Ready'],
    ['Demo Arjun', '9000000107', 'Mixed clothes', 'Wash & Fold', 'Home Delivery', 'UPI', 'Out for Delivery'],
    ['Demo Nisha', '9000000108', 'Shoe pair', 'Dry Cleaning', 'Home Delivery', 'Card', 'Delivered'],
  ] as const;
  for (const [index, [name, phone, garmentName, serviceName, fulfillmentMode, paymentMode, targetState]] of samples.entries()) {
    const garment = garments.get(garmentName);
    const service = services.get(serviceName);
    if (!garment || !service) continue;
    const result = bookLaundryOrder(TENANT, 'demo-seed', {
      orderDate: day(index - 7),
      customer: { name, phone },
      items: [{ garment: garment.id, service: service.id, qty: index % 3 + 1 }],
      expectedDeliveryDate: day(index + 1),
      fulfillmentMode,
      paymentMode,
    });
    if (targetState === 'Picked Up') {
      assignLaundryOrder(TENANT, 'demo-seed', result.order.id, { stage: 'pickup', riderId: rider.id });
      transitionLaundryOrder(TENANT, 'demo-seed', result.order.id, 'Picked Up', 'Demo intake complete');
    } else if (targetState === 'In Process') {
      transitionLaundryOrder(TENANT, 'demo-seed', result.order.id, 'Picked Up', 'Demo pickup complete');
      transitionLaundryOrder(TENANT, 'demo-seed', result.order.id, 'In Process', 'Demo wash started');
    } else if (targetState === 'Ready') {
      transitionLaundryOrder(TENANT, 'demo-seed', result.order.id, 'Picked Up', 'Demo pickup complete');
      transitionLaundryOrder(TENANT, 'demo-seed', result.order.id, 'In Process', 'Demo wash started');
      completeDemoAssembly(result.garmentUnits, String(index));
      transitionLaundryOrder(TENANT, 'demo-seed', result.order.id, 'Ready', 'Demo quality check passed');
    } else if (targetState === 'Out for Delivery') {
      transitionLaundryOrder(TENANT, 'demo-seed', result.order.id, 'Picked Up', 'Demo pickup complete');
      transitionLaundryOrder(TENANT, 'demo-seed', result.order.id, 'In Process', 'Demo wash started');
      completeDemoAssembly(result.garmentUnits, String(index));
      transitionLaundryOrder(TENANT, 'demo-seed', result.order.id, 'Ready', 'Demo quality check passed');
      assignLaundryOrder(TENANT, 'demo-seed', result.order.id, { stage: 'delivery', riderId: rider.id });
      transitionLaundryOrder(TENANT, 'demo-seed', result.order.id, 'Out for Delivery', 'Demo rider dispatched');
    } else if (targetState === 'Delivered') {
      transitionLaundryOrder(TENANT, 'demo-seed', result.order.id, 'Picked Up', 'Demo pickup complete');
      transitionLaundryOrder(TENANT, 'demo-seed', result.order.id, 'In Process', 'Demo wash started');
      completeDemoAssembly(result.garmentUnits, String(index));
      transitionLaundryOrder(TENANT, 'demo-seed', result.order.id, 'Ready', 'Demo quality check passed');
      transitionLaundryOrder(TENANT, 'demo-seed', result.order.id, 'Delivered', 'Demo customer handoff complete');
    }
  }
  console.log('[seed] laundry demo orders, customers and rider created');
}

try {
  await app.listen({ port: PORT, host: process.env.HOST || '127.0.0.1' });
  const address = app.server.address();
  const activePort = typeof address === 'object' && address ? address.port : PORT;
  const startupSecret = process.env.EPIC_STARTUP_SECRET;
  const startupNonce = process.env.EPIC_STARTUP_NONCE;
  if (startupSecret && startupNonce) {
    const proof = createHmac('sha256', startupSecret).update(`${startupNonce}:${activePort}`).digest('hex');
    console.log(`EPIC_READY ${JSON.stringify({ port: activePort, nonce: startupNonce, proof })}`);
  }
  cloudOrderAutoSync?.start();
  console.log(`\n  Epic Laundry ${WORKSPACE_MODE} workspace on http://localhost:${activePort}`);
  console.log(`  Laundry Desk UI: http://localhost:${activePort}/ui/app/`);
  console.log(`  API health:      http://localhost:${activePort}/api/health`);
  console.log('  Session auth:    enabled\n');
} catch (e) {
  console.error(e);
  process.exit(1);
}
