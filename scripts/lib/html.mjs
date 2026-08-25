/** Kleine HTML-helpers zonder externe dependencies. */

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', euro: '€',
  eacute: 'é', egrave: 'è', euml: 'ë', iuml: 'ï', ouml: 'ö',
  uuml: 'ü', auml: 'ä', ccedil: 'ç', reg: '®', trade: '™',
  copy: '©', deg: '°', hellip: '…', ndash: '–', mdash: '—',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', middot: '·',
};

export function decodeEntities(input = '') {
  return String(input)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z][a-z0-9]*);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

function safeCodePoint(code) {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/** Verwijdert script/style/tags en normaliseert witruimte. */
export function stripTags(html = '') {
  return decodeEntities(
    String(html)
      .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ').trim();
}

/** Alle JSON-LD blokken als geparste objecten (ongeldige blokken worden overgeslagen). */
export function extractJsonLd(html = '') {
  const out = [];
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '').trim();
    if (!raw) continue;
    try {
      out.push(JSON.parse(raw));
    } catch {
      // Sommige winkels zetten er ongeldige JSON in; die blokken negeren we.
    }
  }
  return out;
}

/** Vlakt @graph en arrays uit tot een lijst losse nodes. */
export function flattenJsonLd(nodes) {
  const flat = [];
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    flat.push(node);
    if (node['@graph']) walk(node['@graph']);
  };
  walk(nodes);
  return flat;
}

export function jsonLdType(node) {
  const t = node?.['@type'];
  return (Array.isArray(t) ? t : [t]).filter(Boolean).map((x) => String(x).toLowerCase());
}

/** Waarde van <meta property|name="..." content="..."> (beide volgordes van attributen). */
export function metaContent(html = '', key) {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name|itemprop)\\s*=\\s*["']${esc}["'][^>]*content\\s*=\\s*["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content\\s*=\\s*["']([^"']*)["'][^>]*(?:property|name|itemprop)\\s*=\\s*["']${esc}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return decodeEntities(m[1]).trim();
  }
  return null;
}

/** Alle href-waarden in volgorde van voorkomen, ontdubbeld. */
export function extractLinks(html = '') {
  const seen = new Set();
  const out = [];
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = decodeEntities(m[1]).trim();
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    out.push(href);
  }
  return out;
}

export function pageTitle(html = '') {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim() : null;
}
