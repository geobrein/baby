/** Controleert catalogus en winkelconfiguratie zonder netwerk. */
import { scoreCandidate } from './match.mjs';
import { isValidGtin } from './identity.mjs';

/**
 * @returns {{errors: string[], warnings: string[]}}
 */
export function validateFeeds(feedConfig, shops) {
  const errors = [];
  const warnings = [];
  const feeds = feedConfig?.feeds;
  if (feeds === undefined) return { errors, warnings };
  if (!Array.isArray(feeds)) return { errors: ["feeds.json: 'feeds' moet een lijst zijn"], warnings };

  const seen = new Set();
  for (const feed of feeds) {
    const label = feed.id ?? '(zonder id)';
    if (!feed.id) errors.push('feed zonder id');
    else if (seen.has(feed.id)) errors.push(`dubbele feed-id: ${feed.id}`);
    seen.add(feed.id);
    if (!feed.shop) errors.push(`${label}: 'shop' ontbreekt`);
    else if (shops && !shops[feed.shop]) errors.push(`${label}: onbekende winkel '${feed.shop}'`);
    if (!feed.urlEnv) errors.push(`${label}: 'urlEnv' ontbreekt (naam van het secret met de feed-URL)`);
    else if (/^https?:/i.test(feed.urlEnv)) errors.push(`${label}: 'urlEnv' hoort een secretnaam te zijn, geen URL`);
    if (feed.format && !['auto', 'csv', 'xml'].includes(feed.format)) {
      errors.push(`${label}: onbekend formaat '${feed.format}'`);
    }
  }
  return { errors, warnings };
}

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
    if (shop.searchUrl && !shop.searchUrl.includes('{q}')) errors.push(`winkel ${shopId}: 'searchUrl' mist {q}`);
    if (!shop.searchUrl && !shop.browseUrls?.length && shop.enabled !== false) {
      errors.push(`winkel ${shopId}: geen 'searchUrl' en geen 'browseUrls', producten zijn dan niet te vinden`);
    }
    if (shop.discovery === 'browse' && !shop.browseUrls?.length && shop.enabled !== false) {
      warnings.push(`winkel ${shopId}: discovery staat op 'browse' maar er zijn geen browseUrls`);
    }
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

    if (product.gtins !== undefined) {
      if (!Array.isArray(product.gtins)) errors.push(`${label}: 'gtins' moet een lijst zijn`);
      else {
        for (const gtin of product.gtins) {
          if (!isValidGtin(gtin)) errors.push(`${label}: ongeldig artikelnummer '${gtin}' (controlecijfer klopt niet)`);
        }
        if (!product.gtins.length) warnings.push(`${label}: lege 'gtins'-lijst, er wordt niet op EAN gecontroleerd`);
      }
    }
    if (product.strictGtin === true && !product.gtins?.length) {
      errors.push(`${label}: strictGtin staat aan maar er is geen 'gtins'-lijst`);
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
