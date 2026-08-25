/** Controleert catalogus en winkelconfiguratie zonder netwerk. */
import { scoreCandidate } from './match.mjs';

/**
 * @returns {{errors: string[], warnings: string[]}}
 */
export function validateCatalog(catalog, shops) {
  const errors = [];
  const warnings = [];

  if (!catalog || !Array.isArray(catalog.products)) {
    return { errors: ['catalog.json mist een products-array'], warnings };
  }
  const categories = new Set((catalog.categories ?? []).map((c) => c.id));
  const shopIds = new Set(Object.keys(shops ?? {}));
  const seen = new Set();

  for (const shopId of shopIds) {
    const shop = shops[shopId];
    if (!shop.name) errors.push(`winkel ${shopId}: 'name' ontbreekt`);
    if (!shop.site) errors.push(`winkel ${shopId}: 'site' ontbreekt`);
    if (!shop.searchUrl?.includes('{q}')) errors.push(`winkel ${shopId}: 'searchUrl' mist {q}`);
    if (shop.productPathPattern) {
      try {
        new RegExp(shop.productPathPattern);
      } catch (err) {
        errors.push(`winkel ${shopId}: ongeldige productPathPattern (${err.message})`);
      }
    }
  }

  for (const product of catalog.products) {
    const label = product.id ?? '(zonder id)';
    if (!product.id) errors.push('product zonder id');
    else if (seen.has(product.id)) errors.push(`dubbel id: ${product.id}`);
    seen.add(product.id);

    if (!product.name) errors.push(`${label}: 'name' ontbreekt`);
    if (!product.category) errors.push(`${label}: 'category' ontbreekt`);
    else if (categories.size && !categories.has(product.category)) {
      errors.push(`${label}: onbekende categorie '${product.category}'`);
    }
    if (!product.query) warnings.push(`${label}: geen 'query', de naam wordt gebruikt om te zoeken`);
    if (!product.match?.must?.length) warnings.push(`${label}: geen match.must, verkeerde treffers zijn dan mogelijk`);

    for (const shopId of product.shops ?? []) {
      if (!shopIds.has(shopId)) errors.push(`${label}: verwijst naar onbekende winkel '${shopId}'`);
    }
    for (const shopId of Object.keys(product.links ?? {})) {
      if (!shopIds.has(shopId)) errors.push(`${label}: link voor onbekende winkel '${shopId}'`);
    }

    // De eigen naam (plus verpakking) moet door de eigen match-regels komen.
    if (product.name) {
      const own = product.match?.packSize ? `${product.name} ${product.match.packSize}` : product.name;
      const verdict = scoreCandidate(own, product);
      if (!verdict.ok) errors.push(`${label}: eigen naam voldoet niet aan de match-regels (${verdict.reason})`);
    }
  }

  return { errors, warnings };
}
