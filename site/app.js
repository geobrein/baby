/** Babyprijs — filtert en toont de dagelijks opgehaalde winkelprijzen. */

const euro = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' });
const euroPrecise = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', minimumFractionDigits: 3, maximumFractionDigits: 3 });
const dateTime = new Intl.DateTimeFormat('nl-NL', { dateStyle: 'full', timeStyle: 'short' });

const PIECE_LABELS = {
  luiers: 'per luier',
  luierbroekjes: 'per broekje',
  billendoekjes: 'per doekje',
};

const state = {
  q: '',
  category: 'alle',
  sizes: new Set(),
  brands: new Set(),
  inStock: false,
  sort: 'unit',
};

const dom = {
  updated: document.getElementById('updated'),
  results: document.getElementById('results'),
  empty: document.getElementById('empty'),
  count: document.getElementById('count'),
  categories: document.getElementById('categories'),
  sizes: document.getElementById('sizes'),
  brands: document.getElementById('brands'),
  q: document.getElementById('q'),
  sort: document.getElementById('sort'),
  inStock: document.getElementById('instock'),
  reset: document.getElementById('reset'),
  demo: document.getElementById('demo-notice'),
};

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
  renderFilters();
  render();
}

function bindControls() {
  dom.q.value = state.q;
  dom.sort.value = state.sort;
  dom.inStock.checked = state.inStock;

  dom.q.addEventListener('input', debounce(() => {
    state.q = dom.q.value.trim();
    render();
  }, 150));
  dom.sort.addEventListener('change', () => {
    state.sort = dom.sort.value;
    render();
  });
  dom.inStock.addEventListener('change', () => {
    state.inStock = dom.inStock.checked;
    render();
  });
  dom.reset.addEventListener('click', () => {
    state.q = '';
    state.category = 'alle';
    state.sizes.clear();
    state.brands.clear();
    state.inStock = false;
    dom.q.value = '';
    dom.inStock.checked = false;
    renderFilters();
    render();
  });
}

function renderMeta() {
  const when = data.updatedAt ? dateTime.format(new Date(data.updatedAt)) : 'onbekend';
  dom.updated.textContent = `Prijzen bijgewerkt op ${when} · ${data.stats?.offers ?? 0} prijzen uit ${Object.keys(data.shops ?? {}).length} winkels`;
  if (data.mock) {
    dom.updated.append(' ', el('span', { class: 'badge demo' }, 'demo'));
    dom.demo.hidden = false;
  }
}

function renderFilters() {
  const categories = [{ id: 'alle', label: 'Alle producten' }, ...(data.categories ?? [])];
  dom.categories.replaceChildren(
    el('span', { class: 'chip-label' }, 'Categorie'),
    ...categories.map((c) => chip(c.label, state.category === c.id, () => {
      state.category = c.id;
      // Maten van een andere categorie zijn hier niet meer zinvol.
      state.sizes.clear();
      renderFilters();
      render();
    })),
  );

  const inCategory = data.products.filter((p) => state.category === 'alle' || p.category === state.category);

  const sizes = [...new Set(inCategory.map((p) => p.size).filter(Boolean))]
    .sort((a, b) => String(a).localeCompare(String(b), 'nl', { numeric: true }));
  dom.sizes.replaceChildren(...(sizes.length
    ? [el('span', { class: 'chip-label' }, 'Maat'), ...sizes.map((size) => chip(`Maat ${size}`, state.sizes.has(size), () => {
      toggle(state.sizes, size);
      renderFilters();
      render();
    }))]
    : []));

  const brands = [...new Set(inCategory.map((p) => p.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'nl'));
  dom.brands.replaceChildren(...(brands.length
    ? [el('span', { class: 'chip-label' }, 'Merk'), ...brands.map((brand) => chip(brand, state.brands.has(brand), () => {
      toggle(state.brands, brand);
      renderFilters();
      render();
    }))]
    : []));
}

function render() {
  const products = filterProducts().sort(sorter(state.sort));
  dom.results.replaceChildren(...products.map(card));
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
    if (state.inStock && !p.offers.some((o) => o.inStock !== false)) return false;
    if (!terms.length) return true;
    const haystack = `${p.name} ${p.brand ?? ''} ${p.category} ${p.size ? `maat ${p.size}` : ''}`.toLowerCase();
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

function card(product) {
  const offers = visibleOffers(product);
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
  );

  if (cheapest) {
    const best = el('div', { class: 'best' },
      el('span', { class: 'best-price' }, euro.format(cheapest.price)),
      cheapest.unitPrice != null
        ? el('span', { class: 'best-unit' }, `${formatUnit(cheapest.unitPrice)} ${unitLabel(product, cheapest)}`)
        : null,
      el('span', { class: 'best-meta' }, metaLine(product, cheapest, saving)),
    );
    head.append(best);
  }

  const list = el('ul', { class: 'offers' }, ...offers.map((offer, i) => offerRow(product, offer, i === 0)));
  return el('article', { class: 'card' }, head, list);
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
      el('div', { class: 'offer-sub' }, offer.packSize ? packLabel(offer.packSize, product.category) : (offer.title ?? '')),
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

function visibleOffers(product) {
  const offers = state.inStock ? product.offers.filter((o) => o.inStock !== false) : product.offers;
  return [...offers].sort((a, b) => {
    if (state.sort === 'price') return a.price - b.price;
    const av = a.unitPrice ?? Infinity;
    const bv = b.unitPrice ?? Infinity;
    return av === bv ? a.price - b.price : av - bv;
  });
}

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

/* Kleine helpers */

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
  state.q = params.get('q') ?? '';
  state.category = params.get('cat') ?? 'alle';
  state.sort = ['unit', 'price', 'name'].includes(params.get('sort')) ? params.get('sort') : 'unit';
  state.inStock = params.get('voorraad') === '1';
  for (const size of (params.get('maat') ?? '').split(',').filter(Boolean)) state.sizes.add(size);
  for (const brand of (params.get('merk') ?? '').split(',').filter(Boolean)) state.brands.add(brand);
}

function writeStateToUrl() {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.category !== 'alle') params.set('cat', state.category);
  if (state.sort !== 'unit') params.set('sort', state.sort);
  if (state.inStock) params.set('voorraad', '1');
  if (state.sizes.size) params.set('maat', [...state.sizes].join(','));
  if (state.brands.size) params.set('merk', [...state.brands].join(','));
  const query = params.toString();
  history.replaceState(null, '', query ? `?${query}` : location.pathname);
}
