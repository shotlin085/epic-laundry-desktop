import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { store } from '../../kernel/store.js';

export const VISUAL_ASSETS: Record<string, string> = {
  foldedShirt: '/ui/app/garments/optimized/lndry-folded-shirt-v3.webp', foldedTrouser: '/ui/app/garments/optimized/lndry-folded-trouser-v1.webp', foldedSaree: '/ui/app/garments/optimized/lndry-folded-saree-v1.webp', foldedKurti: '/ui/app/garments/optimized/lndry-folded-kurti-v1.webp', foldedBlanket: '/ui/app/garments/optimized/lndry-folded-blanket-v1.webp', foldedBedsheet: '/ui/app/garments/optimized/lndry-folded-bedsheet-v1.webp', mixedClothes: '/ui/app/garments/optimized/lndry-mixed-clothes-v1.webp', shoePair: '/ui/app/garments/optimized/lndry-shoe-pair-v1.webp', foldedBlazer: '/ui/app/garments/optimized/lndry-folded-blazer-v1.webp', foldedDress: '/ui/app/garments/optimized/lndry-folded-dress-v1.webp', foldedJeans: '/ui/app/garments/optimized/lndry-folded-jeans-v1.webp', foldedHoodie: '/ui/app/garments/optimized/lndry-folded-hoodie-v1.webp', foldedKurta: '/ui/app/garments/optimized/lndry-folded-kurta-v1.webp', sherwani: '/ui/app/garments/optimized/lndry-sherwani-v1.webp', blouse: '/ui/app/garments/optimized/lndry-blouse-v1.webp', salwarSuit: '/ui/app/garments/optimized/lndry-salwar-suit-v1.webp', lehenga: '/ui/app/garments/optimized/lndry-lehenga-v1.webp', tieScarf: '/ui/app/garments/optimized/lndry-tie-scarf-v1.webp', pillowCover: '/ui/app/garments/optimized/lndry-pillow-cover-v1.webp', quiltDuvet: '/ui/app/garments/optimized/lndry-quilt-duvet-v1.webp', handbag: '/ui/app/garments/optimized/lndry-handbag-v1.webp', towel: '/ui/app/garments/optimized/lndry-towel-v1.webp', curtain: '/ui/app/garments/optimized/lndry-curtain-v1.webp', carpetRug: '/ui/app/garments/optimized/lndry-carpet-rug-v1.webp', softToy: '/ui/app/garments/optimized/lndry-soft-toy-v1.webp', socksPair: '/ui/app/garments/optimized/lndry-socks-pair-v1.webp',
};
const INTENTIONAL_SHARED_NAMES = new Set(['Polo shirt', 'Formal shirt', 'Jacket / Coat', 'Kurta pyjama', 'Table cloth', 'Uniform set']);
const DERIVATIVE_BUDGET_BYTES = 256 * 1024;
const publicRoot = resolve(process.env.EPIC_PUBLIC_ROOT || join(dirname(fileURLToPath(import.meta.url)), '../../../public/app'));
const localAsset = (asset: string) => { if (!asset.startsWith('/ui/app/')) return undefined; const target = resolve(publicRoot, asset.slice('/ui/app/'.length)); const rootPrefix = publicRoot.endsWith(sep) ? publicRoot : `${publicRoot}${sep}`; return target === publicRoot || target.startsWith(rootPrefix) ? target : undefined; };

export type GarmentAssetAuditItem = { id: string; name: string; category: string; visualKey: string; photo: string; classification: 'exact_visual' | 'intentional_shared_visual' | 'custom_image' | 'missing' | 'invalid_visual_key' | 'invalid_path' | 'broken_asset'; resolvedAsset?: string; bytes?: number; budgetWarning?: string; issue?: string };
export function auditGarmentAssets(tenant: string) {
  const categories = new Map(store.rowsOf(tenant, 'laundry_category').map((row) => [row.id, String(row.data.name || row.id)]));
  const items: GarmentAssetAuditItem[] = store.rowsOf(tenant, 'laundry_garment').filter((row) => row.data.active !== false).map((row) => {
    const visualKey = String(row.data.visual_key || '').trim(); const photo = String(row.data.photo || '').trim(); const categoryId = String(row.data.category || ''); const base = { id: row.id, name: String(row.data.name || row.id), category: categories.get(categoryId) || categoryId, visualKey, photo };
    if (!visualKey || !VISUAL_ASSETS[visualKey]) return { ...base, classification: visualKey ? 'invalid_visual_key' as const : 'missing' as const, issue: visualKey ? 'visual key is not in the approved taxonomy' : 'active garment has no explicit visual key' };
    if (!photo) { const fallback = localAsset(VISUAL_ASSETS[visualKey]); const bytes = fallback && existsSync(fallback) ? statSync(fallback).size : undefined; return fallback && bytes !== undefined ? { ...base, classification: 'intentional_shared_visual' as const, resolvedAsset: VISUAL_ASSETS[visualKey], bytes, budgetWarning: bytes > DERIVATIVE_BUDGET_BYTES ? `asset exceeds ${DERIVATIVE_BUDGET_BYTES} byte derivative budget` : undefined } : { ...base, classification: 'broken_asset' as const, resolvedAsset: VISUAL_ASSETS[visualKey], issue: 'approved visual asset is missing from the packaged application' }; }
    if (/^data:image\/(?:png|jpeg|webp);base64,/i.test(photo)) return { ...base, classification: 'custom_image' as const, resolvedAsset: 'inline-data-image', bytes: Buffer.byteLength(photo, 'utf8') };
    const target = localAsset(photo); if (!target) return { ...base, classification: 'invalid_path' as const, issue: 'photo is not an approved local application asset' };
    if (!existsSync(target)) return { ...base, classification: 'broken_asset' as const, issue: 'photo path does not exist in the packaged application' };
    const bytes = statSync(target).size; return { ...base, classification: INTENTIONAL_SHARED_NAMES.has(base.name) || photo !== VISUAL_ASSETS[visualKey] ? 'intentional_shared_visual' as const : 'exact_visual' as const, resolvedAsset: photo, bytes, budgetWarning: bytes > DERIVATIVE_BUDGET_BYTES ? `asset exceeds ${DERIVATIVE_BUDGET_BYTES} byte derivative budget` : undefined };
  });
  const counts = items.reduce<Record<string, number>>((result, item) => { result[item.classification] = (result[item.classification] || 0) + 1; return result; }, {});
  const failures = items.filter((item) => ['missing', 'invalid_visual_key', 'invalid_path', 'broken_asset'].includes(item.classification));
  const budgetWarnings = items.filter((item) => item.budgetWarning).length;
  return { tenant, generatedAt: new Date().toISOString(), root: '/ui/app', counts, total: items.length, failures: failures.length, budgetWarnings, ok: failures.length === 0, items };
}
