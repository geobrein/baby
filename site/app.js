/** Babyprijs — filtert en toont de dagelijks opgehaalde winkelprijzen. */
import {
  diaperRows, cheapestPerBrand, comparisonSummary, availableSizes, availableBrands, defaultSize,
  DIAPERS_PER_MONTH,
} from './compare.mjs';

const euro = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' });
const euroPrecise = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', minimumFractionDigits: 3, maximumFractionDigits: 3 });
const dateTime = new Intl.DateTimeFormat('nl-NL', { dateStyle: 'full', timeStyle: 'short' });

const PIECE_LABELS = {
  luiers: 'per luier',
  luierbroekjes: 'per broekje',
  billendoekjes: 'per doekje',
};

const VERIFICATION = {
  exact: { label: 'zelfde artikel', short: '✓ zelfde artikel', title: 'Het EAN-artikelnummer komt overeen met de andere winkels.' },
  variant: { label: 'andere verpakking', short: 'andere verpakking', title: 'Ander EAN-artikelnummer: hetzelfde product in een andere verpakking. Vergelijkbaar per stuk.' },
  afwijkend: { label: 'ander artikel', short: 'ander artikel', title: 'Het EAN-artikelnummer staat niet in de lijst van dit product.' },
  onbekend: { label: 'EAN onbekend', short: 'EAN onbekend', title: 'Deze winkel publiceert geen artikelnummer, of er is geen tweede winkel om mee te vergelijken.' },
};

const state = {
  view: 'producten',
  q: '',
  category: 'alle',
  sizes: new Set(),
  brands: new Set(),
  inStock: false,
  onlyExact: false,
  sort: 'unit',
  compare: {
    category: 'luiers',
    size: null,
    brands: new Set(),
    inStock: false,
    onlyExact: false,
  },
};

const dom = {};
for (const id of [
  'updated', 'results', 'empty', 'count', 'categories', 'sizes', 'brands', 'q', 'sort', 'instock',
  'exact', 'reset', 'demo-notice', 'view-producten', 'view-luiers',
  'c-categories', 'c-sizes', 'c-brands', 'c-instock', 'c-exact', 'c-count', 'c-summary',
  'c-brandbest', 'c-rows', 'c-empty',
]) {
  dom[id] = document.getElementById(id);
}

let data = { products: [], categories: [], shops: {} };

init();

async function init() {
  readStateFromUrl();
  bindControls();
  try {
    const res = await fetch('data/prices.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    dom.updated.textContent = 'Prijzen konden niet geladen worden.';
    dom.results.append(el('p', { class: 'empty' }, `Kon data/prices.json niet laden (${err.message}). Draai eerst "npm run fetch".`));
    return;
  }
  renderMeta();
  renderView();
}

function bindControls() {
  dom.q.value = state.q;
  dom.sort.value = state.sort;
  dom.instock.checked = state.inStock;
  dom.exact.checked = state.onlyExact;
  dom['c-instock'].checked = state.compare.inStock;
  dom['c-exact'].checked = state.compare.onlyExact;

  for (const tab of document.querySelectorAll('.view-tab')) {
    tab.addEventListener('click', () => {
      state.view = tab.dataset.view;
      renderView();
    });
  }

  dom.q.addEventListener('input', debounce(() => {
    state.q = dom.q.value.trim();
    renderProducts();
  }, 150));
  dom.sort.addEventListener('change', () => {
    state.sort = dom.sort.value;
    renderProducts();
  });
  dom.instock.addEventListener('change', () => {
    state.inStock = dom.instock.checked;
    renderProducts();
  });
  dom.exact.addEventListener('change', () => {
    state.onlyExact = dom.exact.checked;
    renderProducts();
  });
  dom.reset.addEventListener('click', () => {
    Object.assign(state, { q: '', category: 'alle', inStock: false, onlyExact: false });
    state.sizes.clear();
    state.brands.clear();
    dom.q.value = '';
    dom.instock.checked = false;
    dom.exact.checked = false;
    renderProductFilters();
    renderProducts();
  });

  dom['c-instock'].addEventListener('change', () => {
    state.compare.inStock = dom['c-instock'].checked;
    renderCompare();
  });
  dom['c-exact'].addEventListener('change', () => {
    state.compare.onlyExact = dom['c-exact'].checked;
    renderCompare();
  });
}

function renderMeta() {
  const shopCount = Object.keys(data.shops ?? {}).length;
  const verified = data.stats?.verifiedOffers ?? 0;
  dom.updated.textContent = `Prijzen bijgewerkt op ${data.updatedAt ? dateTime.format(new Date(data.updatedAt)) : 'onbekend'} · `
    + `${data.stats?.offers ?? 0} prijzen uit ${shopCount} winkels · ${verified} bevestigd op artikelnummer`;
  if (data.mock) {
    dom.updated.append(' ', el('span', { class: 'badge demo' }, 'demo'));
    dom['demo-notice'].hidden = false;
  }
}

function renderView() {
  for (const tab of document.querySelectorAll('.view-tab')) {
    tab.setAttribute('aria-pressed', String(tab.dataset.view === state.view));
  }
  dom['view-producten'].hidden = state.view !== 'producten';
  dom['view-luiers'].hidden = state.view !== 'luiers';
  if (state.view === 'producten') {
    renderProductFilters();
    renderProducts();
  } else {
    renderCompareFilters();
    renderCompare();
  }
  writeStateToUrl();
}

/* ---------- Weergave 1: alle producten ---------- */

function renderProductFilters() {
  const categories = [{ id: 'alle', label: 'Alle producten' }, ...(data.categories ?? [])];
  dom.categories.replaceChildren(
    el('span', { class: 'chip-label' }, 'Categorie'),
    ...categories.map((c) => chip(c.label, state.category === c.id, () => {
      state.category = c.id;
      state.sizes.clear();
      renderProductFilters();
      renderProducts();
    })),
  );

  const inCategory = data.products.filter((p) => state.category === 'alle' || p.category === state.category);

  const sizes = [...new Set(inCategory.map((p) => p.size).filter(Boolean))]
    .sort((a, b) => String(a).localeCompare(String(b), 'nl', { numeric: true }));
  dom.sizes.replaceChildren(...(sizes.length
    ? [el('span', { class: 'chip-label' }, 'Maat'), ...sizes.map((size) => chip(`Maat ${size}`, state.sizes.has(size), () => {
      toggle(state.sizes, size);
      renderProductFilters();
      renderProducts();
    }))]
    : []));

  const brands = [...new Set(inCategory.map((p) => p.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'nl'));
  dom.brands.replaceChildren(...(brands.length
    ? [el('span', { class: 'chip-label' }, 'Merk'), ...brands.map((brand) => chip(brand, state.brands.has(brand), () => {
      toggle(state.brands, brand);
      renderProductFilters();
      renderProducts();
    }))]
    : []));

  for (const row of [dom.categories, dom.sizes, dom.brands]) centerSelected(row);
}

function renderProducts() {
  const products = filterProducts()
    .map((p) => ({ product: p, offers: visibleOffers(p) }))
    .filter((entry) => entry.offers.length)
    .sort((a, b) => sorter(state.sort)(a.product, b.product));

  dom.results.replaceChildren(...products.map((entry) => card(entry.product, entry.offers)));
  dom.empty.hidden = products.length > 0;
  dom.count.textContent = products.length === 1 ? '1 product' : `${products.length} producten`;
  writeStateToUrl();
}

function filterProducts() {
  const terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
  return data.products.filter((p) => {
    if (state.category !== 'alle' && p.category !== state.category) return false;
    if (state.sizes.size && !state.sizes.has(p.size)) return false;
    if (state.brands.size && !state.brands.has(p.brand)) return false;
    if (!terms.length) return true;
    const haystack = `${p.name} ${p.brand ?? ''} ${p.category} ${p.size ? `maat ${p.size}` : ''} ${p.gtin ?? ''}`.toLowerCase();
    return terms.every((t) => haystack.includes(t));
  });
}

function sorter(mode) {
  if (mode === 'name') return (a, b) => a.name.localeCompare(b.name, 'nl');
  if (mode === 'price') return (a, b) => (a.bestPrice ?? Infinity) - (b.bestPrice ?? Infinity);
  return (a, b) => {
    const av = a.bestUnitPrice ?? Infinity;
    const bv = b.bestUnitPrice ?? Infinity;
    if (av === bv) return (a.bestPrice ?? Infinity) - (b.bestPrice ?? Infinity);
    return av - bv;
  };
}

function visibleOffers(product) {
  let offers = product.offers;
  if (state.inStock) offers = offers.filter((o) => o.inStock !== false);
  if (state.onlyExact) offers = offers.filter((o) => o.verification === 'exact');
  return [...offers].sort((a, b) => {
    if (state.sort === 'price') return a.price - b.price;
    const av = a.unitPrice ?? Infinity;
    const bv = b.unitPrice ?? Infinity;
    return av === bv ? a.price - b.price : av - bv;
  });
}

function card(product, offers) {
  const cheapest = offers[0];
  const dearest = offers[offers.length - 1];
  const saving = cheapest && dearest && dearest.price > cheapest.price ? dearest.price - cheapest.price : 0;

  const head = el('div', { class: 'card-head' },
    el('h2', {}, product.name),
    el('div', { class: 'tags' },
      ...[
        product.brand,
        product.size ? `Maat ${product.size}` : null,
        product.weight,
        cheapest?.packSize ? packLabel(cheapest.packSize, product.category) : null,
      ].filter(Boolean).map((t) => el('span', { class: 'tag' }, t)),
    ),
    el('div', { class: 'best' },
      el('span', { class: 'best-price' }, euro.format(cheapest.price)),
      cheapest.unitPrice != null
        ? el('span', { class: 'best-unit' }, `${formatUnit(cheapest.unitPrice)} ${unitLabel(product, cheapest)}`)
        : null,
      el('span', { class: 'best-meta' }, metaLine(product, cheapest, saving)),
    ),
    identityLine(product, offers),
  );

  const list = el('ul', { class: 'offers' }, ...offers.map((offer, i) => offerRow(product, offer, i === 0)));
  return el('article', { class: 'card' }, head, list);
}

function identityLine(product, offers) {
  const exact = offers.filter((o) => o.verification === 'exact').length;
  if (!product.gtin && !exact) {
    return el('p', { class: 'identity unknown' }, 'Geen artikelnummer beschikbaar — vergelijking op productnaam en verpakking.');
  }
  const source = product.gtinSource === 'catalogus' ? 'vastgelegd in de catalogus' : 'bevestigd door meerdere winkels';
  return el('p', { class: 'identity' },
    el('span', { class: 'check' }, '✓'),
    ` EAN ${product.gtin} (${source}) · ${exact} van ${offers.length} winkels verkopen exact dit artikel`,
  );
}

function metaLine(product, cheapest, saving) {
  const parts = [`goedkoopst bij ${cheapest.shopName}`];
  if (saving > 0) parts.push(`${euro.format(saving)} goedkoper dan de duurste winkel`);
  if (product.lowest30 != null && product.lowest30 < cheapest.price) {
    parts.push(`laagste prijs in 30 dagen: ${euro.format(product.lowest30)}`);
  }
  return parts.join(' · ');
}

function offerRow(product, offer, isCheapest) {
  const classes = ['offer'];
  if (isCheapest) classes.push('cheapest');
  if (offer.inStock === false) classes.push('out');

  return el('li', { class: classes.join(' ') },
    el('div', {},
      el('div', { class: 'offer-shop' }, offer.shopName),
      el('div', { class: 'offer-sub' },
        offer.packSize ? packLabel(offer.packSize, product.category) : (offer.title ?? ''),
        ' ', verificationBadge(offer),
      ),
    ),
    el('div', { class: 'offer-price' },
      el('div', { class: 'offer-total' }, euro.format(offer.price)),
      offer.unitPrice != null
        ? el('div', { class: 'offer-unit' }, `${formatUnit(offer.unitPrice)} ${unitLabel(product, offer)}`)
        : null,
    ),
    el('a', {
      class: 'offer-link',
      href: offer.url,
      target: '_blank',
      rel: 'noopener nofollow',
      'aria-label': `${product.name} bekijken bij ${offer.shopName}`,
    }, 'Naar winkel'),
  );
}

function verificationBadge(offer) {
  const info = VERIFICATION[offer.verification] ?? VERIFICATION.onbekend;
  const title = offer.gtin ? `${info.title} (EAN ${offer.gtin})` : info.title;
  const badge = el('span', { class: `vbadge v-${offer.verification}`, title }, info.short);
  if (offer.gtinChanged) badge.append(' ⚠');
  return badge;
}

/* ---------- Weergave 2: luiervergelijker ---------- */

function renderCompareFilters() {
  const categories = (data.categories ?? []).filter((c) => c.id === 'luiers' || c.id === 'luierbroekjes');
  dom['c-categories'].replaceChildren(
    el('span', { class: 'chip-label' }, 'Soort'),
    ...categories.map((c) => chip(c.label, state.compare.category === c.id, () => {
      state.compare.category = c.id;
      state.compare.size = null;
      state.compare.brands.clear();
      renderCompareFilters();
      renderCompare();
    })),
  );

  const sizes = availableSizes(data.products, state.compare.category);
  if (!sizes.includes(state.compare.size)) {
    state.compare.size = defaultSize(data.products, state.compare.category);
  }
  dom['c-sizes'].replaceChildren(
    el('span', { class: 'chip-label' }, 'Maat'),
    ...sizes.map((size) => chip(`Maat ${size}`, state.compare.size === size, () => {
      state.compare.size = size;
      state.compare.brands.clear();
      renderCompareFilters();
      renderCompare();
    })),
  );

  const brands = availableBrands(data.products, state.compare.category, state.compare.size ? [state.compare.size] : []);
  dom['c-brands'].replaceChildren(...(brands.length
    ? [el('span', { class: 'chip-label' }, 'Merk'), ...brands.map((brand) => chip(brand, state.compare.brands.has(brand), () => {
      toggle(state.compare.brands, brand);
      renderCompareFilters();
      renderCompare();
    }))]
    : []));

  for (const row of [dom['c-categories'], dom['c-sizes'], dom['c-brands']]) centerSelected(row);
}

function renderCompare() {
  const rows = diaperRows(data.products, {
    category: state.compare.category,
    sizes: state.compare.size ? [state.compare.size] : [],
    brands: [...state.compare.brands],
    onlyExact: state.compare.onlyExact,
    inStockOnly: state.compare.inStock,
  });

  const noun = PIECE_LABELS[state.compare.category]?.replace('per ', '') ?? 'stuk';
  const summary = comparisonSummary(rows);

  dom['c-summary'].hidden = !summary;
  if (summary) {
    dom['c-summary'].replaceChildren(
      el('div', { class: 'summary-main' },
        el('span', { class: 'summary-price' }, `${formatUnit(summary.cheapest.unitPrice)} ${PIECE_LABELS[state.compare.category] ?? 'per stuk'}`),
        el('span', { class: 'summary-where' }, `${summary.cheapest.brand} bij ${summary.cheapest.shopName}`),
      ),
      el('p', { class: 'summary-sub' },
        `Goedkoopste van ${summary.brands} ${summary.brands === 1 ? 'merk' : 'merken'} in ${summary.shops} winkels. `
        + `Bij ${DIAPERS_PER_MONTH} ${noun}s per maand kost dit ${euro.format(summary.cheapest.monthly)} per maand — `
        + `${euro.format(summary.monthlyDifference)} minder dan de duurste optie (${summary.dearest.brand} bij ${summary.dearest.shopName}).`),
    );
  }

  const best = cheapestPerBrand(rows);
  dom['c-brandbest'].replaceChildren(...(best.length > 1
    ? [
      el('h2', { class: 'section-title' }, 'Goedkoopste per merk'),
      el('div', { class: 'brand-grid' }, ...best.map((row) => el('div', { class: 'brand-card' },
        el('div', { class: 'brand-name' }, row.brand),
        el('div', { class: 'brand-unit' }, `${formatUnit(row.unitPrice)} ${PIECE_LABELS[state.compare.category] ?? 'per stuk'}`),
        el('div', { class: 'brand-meta' }, `${euro.format(row.monthly)} per maand · ${row.shopName}`),
      ))),
    ]
    : []));

  dom['c-rows'].replaceChildren(...(rows.length
    ? [
      el('h2', { class: 'section-title' }, `Alle aanbiedingen, goedkoopste ${PIECE_LABELS[state.compare.category] ?? 'per stuk'} eerst`),
      el('div', { class: 'ranking-head' },
        el('span', {}, '#'),
        el('span', {}, 'Product'),
        el('span', {}, 'Winkel'),
        el('span', { class: 'num' }, 'Per maand'),
        el('span', { class: 'num' }, 'Prijs'),
        el('span', {}, ''),
      ),
      ...rows.map(compareRow),
    ]
    : []));

  dom['c-empty'].hidden = rows.length > 0;
  dom['c-count'].textContent = rows.length === 1 ? '1 aanbieding' : `${rows.length} aanbiedingen`;
  writeStateToUrl();
}

function compareRow(row) {
  const classes = ['ranking-row'];
  if (row.rank === 1) classes.push('cheapest');
  if (row.inStock === false) classes.push('out');

  return el('div', { class: classes.join(' ') },
    el('span', { class: 'rank' }, String(row.rank)),
    el('div', { class: 'ranking-product' },
      el('div', { class: 'ranking-name' }, row.product),
      el('div', { class: 'ranking-sub' },
        row.packSize ? packLabel(row.packSize, state.compare.category) : '',
        ' ', verificationBadge(row),
      ),
    ),
    el('span', { class: 'ranking-shop' }, row.shopName),
    el('span', { class: 'num ranking-monthly' }, euro.format(row.monthly)),
    el('span', { class: 'num ranking-price' },
      el('strong', {}, `${formatUnit(row.unitPrice)}`),
      el('small', {}, ` ${euro.format(row.price)} totaal`),
    ),
    el('a', {
      class: 'offer-link',
      href: row.url,
      target: '_blank',
      rel: 'noopener nofollow',
      'aria-label': `${row.product} bekijken bij ${row.shopName}`,
    }, 'Naar winkel'),
  );
}

/* ---------- Helpers ---------- */

function unitLabel(product, offer) {
  if (offer.packSize?.unit === 'stuk') return PIECE_LABELS[product.category] ?? 'per stuk';
  return offer.unitLabel ?? '';
}

function formatUnit(value) {
  return value < 1 ? euroPrecise.format(value) : euro.format(value);
}

function packLabel(packSize, category) {
  if (packSize.unit === 'stuk') {
    const noun = (PIECE_LABELS[category] ?? 'per stuk').replace('per ', '');
    return `${packSize.amount} ${packSize.amount === 1 ? noun : `${noun}s`}`;
  }
  return `${packSize.amount} ${packSize.unit}`;
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value != null) node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child);
  }
  return node;
}

/** Houdt de gekozen chip in beeld wanneer de rij horizontaal scrolt (mobiel). */
function centerSelected(container) {
  const selected = container.querySelector('.chip[aria-pressed="true"]');
  if (!selected || container.scrollWidth <= container.clientWidth) return;
  container.scrollLeft = Math.max(0, selected.offsetLeft - (container.clientWidth - selected.offsetWidth) / 2);
}

function chip(label, pressed, onClick) {
  const button = el('button', { type: 'button', class: 'chip', 'aria-pressed': String(pressed) }, label);
  button.addEventListener('click', onClick);
  return button;
}

function toggle(set, value) {
  if (set.has(value)) set.delete(value);
  else set.add(value);
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function readStateFromUrl() {
  const params = new URLSearchParams(location.search);
  state.view = params.get('view') === 'luiers' ? 'luiers' : 'producten';
  state.q = params.get('q') ?? '';
  state.category = params.get('cat') ?? 'alle';
  state.sort = ['unit', 'price', 'name'].includes(params.get('sort')) ? params.get('sort') : 'unit';
  state.inStock = params.get('voorraad') === '1';
  state.onlyExact = params.get('ean') === '1';
  for (const size of (params.get('maat') ?? '').split(',').filter(Boolean)) state.sizes.add(size);
  for (const brand of (params.get('merk') ?? '').split(',').filter(Boolean)) state.brands.add(brand);

  if (state.view === 'luiers') {
    state.compare.category = params.get('soort') === 'luierbroekjes' ? 'luierbroekjes' : 'luiers';
    state.compare.size = params.get('maat') || null;
    state.compare.inStock = state.inStock;
    state.compare.onlyExact = state.onlyExact;
    for (const brand of (params.get('merk') ?? '').split(',').filter(Boolean)) state.compare.brands.add(brand);
  }
}

function writeStateToUrl() {
  const params = new URLSearchParams();
  if (state.view === 'luiers') {
    params.set('view', 'luiers');
    if (state.compare.category !== 'luiers') params.set('soort', state.compare.category);
    if (state.compare.size) params.set('maat', state.compare.size);
    if (state.compare.brands.size) params.set('merk', [...state.compare.brands].join(','));
    if (state.compare.inStock) params.set('voorraad', '1');
    if (state.compare.onlyExact) params.set('ean', '1');
  } else {
    if (state.q) params.set('q', state.q);
    if (state.category !== 'alle') params.set('cat', state.category);
    if (state.sort !== 'unit') params.set('sort', state.sort);
    if (state.inStock) params.set('voorraad', '1');
    if (state.onlyExact) params.set('ean', '1');
    if (state.sizes.size) params.set('maat', [...state.sizes].join(','));
    if (state.brands.size) params.set('merk', [...state.brands].join(','));
  }
  const query = params.toString();
  history.replaceState(null, '', query ? `?${query}` : location.pathname);
}
