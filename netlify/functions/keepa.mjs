/* ============================================================================
 *  KEEPA — the detail pages, read through Keepa's API for the Listing QC page.
 *
 *  The page sends the ASINs it knows and the marketplace; this function asks
 *  Keepa for each product and hands back the same fields the Product Viewer
 *  export carries, in the shape the page already reads. The key is the
 *  site's own, in KEEPA_KEY, and never reaches the browser. Team only, like
 *  saving: a brand's viewer cannot spend the tokens.
 *
 *  Variables in Netlify:
 *    KEEPA_KEY   the Keepa API key (Keepa → API → your key)
 *
 *  Keepa's product request: /product?key&domain&asin=…(up to 100)&stats=1
 *  &history=0&aplus=1&videos=1. About one token per product. A POST with
 *  { tokens: true } asks /token instead — how many are left, none spent. Prices come in
 *  cents, the rating ×10, -1 where there is none; pictures as `images`, an
 *  array of { l: large file name, m: medium file name } on m.media-amazon.com
 *  (the older comma list in `imagesCSV` is deprecated and comes back empty on
 *  current answers — read only when there is no `images`). The Buy Box seller is not part of a
 *  product request (that is an offers request, several tokens per product),
 *  so it stays blank here — the Product Viewer export carries it.
 * ========================================================================= */
import { authOf, json } from './_shared.mjs';

const KEEPA = 'https://api.keepa.com/product';
const IMG = 'https://m.media-amazon.com/images/I/';
const BATCH = 100;

/* The product attributes a brand can map a column of its own to, on the
   Products page (Add column → Keepa field). Each is handed back as one line
   of text under `extra`, however Keepa carries it: arrays joined, sizes in
   mm and g with their unit, a category path with " > ", yes/no for flags,
   dates as YYYY-MM-DD. The list is mirrored in the page (KEEPA_FIELDS). */
export const KEEPA_EXTRA = [
  ['description', 'Description'],
  ['shortDescription', 'Short description'],
  ['specialFeatures', 'Special features'],
  ['brand', 'Brand'],
  ['manufacturer', 'Manufacturer'],
  ['model', 'Model'],
  ['partNumber', 'Part number'],
  ['color', 'Color'],
  ['size', 'Size'],
  ['style', 'Style'],
  ['material', 'Material'],
  ['materials', 'Materials'],
  ['pattern', 'Pattern'],
  ['scent', 'Scent'],
  ['itemForm', 'Item form'],
  ['itemTypeKeyword', 'Item type keyword'],
  ['targetAudienceKeyword', 'Target audience'],
  ['recommendedUsesForProduct', 'Recommended uses'],
  ['specificUsesForProduct', 'Specific uses'],
  ['productBenefit', 'Product benefit'],
  ['includedComponents', 'Included components'],
  ['safetyWarning', 'Safety warning'],
  ['ingredients', 'Ingredients'],
  ['activeIngredients', 'Active ingredients'],
  ['numberOfItems', 'Number of items'],
  ['unitCount', 'Unit count'],
  ['packageQuantity', 'Package quantity'],
  ['itemWeight', 'Item weight'],
  ['itemHeight', 'Item height'],
  ['itemLength', 'Item length'],
  ['itemWidth', 'Item width'],
  ['packageWeight', 'Package weight'],
  ['packageHeight', 'Package height'],
  ['packageLength', 'Package length'],
  ['packageWidth', 'Package width'],
  ['batteriesRequired', 'Batteries required'],
  ['batteriesIncluded', 'Batteries included'],
  ['releaseDate', 'Release date'],
  ['categoryTree', 'Category path'],
  ['type', 'Product type'],
  ['binding', 'Binding'],
  ['edition', 'Edition'],
  ['format', 'Format'],
  ['languages', 'Languages'],
  ['audienceRating', 'Audience rating'],
  ['brandStoreName', 'Brand store'],
  ['parentAsin', 'Parent ASIN'],
  ['bundleItems', 'Bundle items'],
  ['eanList', 'EAN'],
  ['upcList', 'UPC'],
  ['gtinList', 'GTIN'],
  ['urlSlug', 'URL slug']
];

/** One attribute of a Keepa product as a line of text, or null when it carries nothing. */
export function keepaExtraText(key, v) {
  if (v == null) return null;
  const mm = ['itemHeight', 'itemLength', 'itemWidth', 'packageHeight', 'packageLength', 'packageWidth'];
  const g = ['itemWeight', 'packageWeight'];
  if (mm.indexOf(key) >= 0) return typeof v === 'number' && v > 0 ? v + ' mm' : null;
  if (g.indexOf(key) >= 0) return typeof v === 'number' && v > 0 ? v + ' g' : null;
  if (key === 'numberOfItems' || key === 'packageQuantity') return typeof v === 'number' && v > 0 ? String(v) : null;
  if (key === 'releaseDate') { const d = String(v); return /^\d{8}$/.test(d) ? d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8) : (v > 0 ? d : null); }
  if (key === 'unitCount') return v && v.unitValue != null ? v.unitValue + (v.unitType ? ' ' + v.unitType : '') : null;
  if (key === 'categoryTree') return Array.isArray(v) && v.length ? v.map(c => c && c.name).filter(Boolean).join(' > ') : null;
  if (key === 'languages') return Array.isArray(v) && v.length ? v.map(l => Array.isArray(l) ? l.filter(Boolean).join(' (') + (l.length > 1 ? ')' : '') : String(l)).join('; ') : null;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) { const t = v.map(x => String(x == null ? '' : x).trim()).filter(Boolean).join('; '); return t || null; }
  if (key === 'description') return String(v).replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim() || null;
  const t = String(v).trim();
  return t || null;
}

/** One Keepa product → one snapshot record, the shape readKeepaRow gives. */
export function fromKeepaProduct(p) {
  if (!p || !p.asin) return null;
  const cur = (p.stats && Array.isArray(p.stats.current)) ? p.stats.current : [];
  const at = i => { const v = cur[i]; return (v == null || v < 0) ? null : v; };
  const money = v => v == null ? null : Math.round(v) / 100;
  const names = Array.isArray(p.images) && p.images.length
    ? p.images.map(i => i && (i.l || i.m || '')).map(s => String(s).trim()).filter(Boolean)
    : String(p.imagesCSV || '').split(',').map(s => s.trim()).filter(Boolean);
  const images = names.map(n => IMG + n);
  const videos = Array.isArray(p.videos) ? p.videos.length : (p.videos == null ? null : 0);
  const aplus = Array.isArray(p.aPlus) ? p.aPlus.length > 0 : (p.aPlus == null ? null : false);
  const aplusMfr = Array.isArray(p.aPlus) ? p.aPlus.some(m => m && m.fromManufacturer) : null;
  const rating = at(16);
  const listPrice = money(at(8));
  const bb = money(at(18));
  return {
    asin: String(p.asin).toUpperCase(),
    title: p.title || '',
    /* the short line Amazon shows under the title — "Item Highlights" in the Product Viewer export */
    highlights: p.itemHighlights || '',
    bullets: Array.isArray(p.features) ? p.features.map(x => String(x || '').trim()).filter(Boolean).slice(0, 5) : [],
    images: images,
    imageCount: images.length,
    videos: videos,
    aplus: aplus,
    aplusMfr: aplusMfr,
    bbPrice: bb,
    bbSeller: '',
    bbSellerId: '',
    listPrice: listPrice,
    rating: rating == null ? null : rating / 10,
    ratings: at(17),
    url: 'https://www.amazon.' + domainTld(p.domainId) + '/dp/' + p.asin,
    parent: p.parentAsin || '',
    brand: p.brand || '',
    deal: '',
    badge: '',
    /* every mapped attribute the product carries, as text */
    extra: KEEPA_EXTRA.reduce(function (o, f) { const t = keepaExtraText(f[0], p[f[0]]); if (t != null) o[f[0]] = t; return o; }, {}),
  };
}

function domainTld(id) {
  return { 1: 'com', 2: 'co.uk', 3: 'de', 4: 'fr', 5: 'co.jp', 6: 'ca', 8: 'it', 9: 'es', 10: 'in', 11: 'com.mx' }[id] || 'com';
}

/** Ask Keepa for up to 100 products; `fetchFn` is swapped in by the harness. */
export async function readFromKeepa(key, domain, asins, fetchFn) {
  const f = fetchFn || fetch;
  const url = KEEPA + '?key=' + encodeURIComponent(key) + '&domain=' + domain +
    '&asin=' + asins.join(',') + '&stats=1&history=0&aplus=1&videos=1';
  const res = await f(url);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch (e) { throw new Error('Keepa answered with something that is not JSON (' + res.status + ')'); }
  if (!res.ok || body.error) {
    const msg = (body.error && (body.error.message || body.error.type)) || ('Keepa answered ' + res.status);
    throw new Error(msg);
  }
  return { rows: (body.products || []).map(fromKeepaProduct).filter(Boolean), tokensLeft: body.tokensLeft };
}

/** How many tokens the key has left — Keepa's /token, which spends none. */
export async function keepaTokens(key, fetchFn) {
  const f = fetchFn || fetch;
  const res = await f('https://api.keepa.com/token?key=' + encodeURIComponent(key));
  let body;
  try { body = JSON.parse(await res.text()); } catch (e) { throw new Error('Keepa answered with something that is not JSON (' + res.status + ')'); }
  if (!res.ok || body.error) throw new Error((body.error && (body.error.message || body.error.type)) || ('Keepa answered ' + res.status));
  return { tokensLeft: body.tokensLeft, refillIn: body.refillIn, refillRate: body.refillRate };
}

/**
 * Read a list of products, as far as the tokens go.
 *
 * Keepa charges a token a product and lets the count go below nought — and
 * then refuses everything until it has refilled. So the count is asked first
 * (that costs nothing): with none left nothing is asked; with fewer than the
 * list needs only that many are asked, the first of the list (the page puts
 * the ones never read, then the oldest, first). If Keepa still refuses part
 * way, what was read before it did is handed back with the rest, never thrown
 * away — those tokens are spent either way.
 */
export async function pullKeepa(key, domain, asins, fetchFn) {
  let tok = null;
  try { tok = await keepaTokens(key, fetchFn); } catch (e) { tok = null; }
  const have = tok && typeof tok.tokensLeft === 'number' ? tok.tokensLeft : null;
  const out = { ok: true, rows: [], asked: asins.length, tokensLeft: have,
                refillRate: tok ? tok.refillRate : null, refillIn: tok ? tok.refillIn : null };
  if (have != null && have <= 0) { out.outOfTokens = true; out.sent = 0; return out; }
  const list = have != null && have < asins.length ? asins.slice(0, Math.floor(have)) : asins;
  out.sent = list.length;
  if (list.length < asins.length) out.outOfTokens = true;
  for (let i = 0; i < list.length; i += BATCH) {
    try {
      const r = await readFromKeepa(key, domain, list.slice(i, i + BATCH), fetchFn);
      out.rows.push(...r.rows);
      if (r.tokensLeft != null) out.tokensLeft = r.tokensLeft;
    } catch (e) {
      /* refused part way: keep what is in; a refusal for want of tokens is not a fault */
      const tokens = /token|429/i.test(e.message);
      if (!tokens && !out.rows.length) throw e;
      out.outOfTokens = out.outOfTokens || tokens;
      out.sent = i;
      out.stopped = e.message;
      try { const t = await keepaTokens(key, fetchFn); out.tokensLeft = t.tokensLeft; out.refillRate = t.refillRate; out.refillIn = t.refillIn; } catch (e2) { /* keep what was known */ }
      break;
    }
  }
  return out;
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (req.headers.get('x-report-write') !== '1') return json({ error: 'missing write header' }, 400);
  const auth = await authOf(req);
  if (!auth || auth.role !== 'team') return json({ error: 'team only' }, 403);
  const key = (process.env.KEEPA_KEY || '').trim();
  if (!key) return json({ error: 'KEEPA_KEY is not set on this site' }, 500);

  let body;
  try { body = await req.json(); } catch (e) { return json({ error: 'could not read that request' }, 400); }
  /* the page asks every half minute how many tokens are left, for the count beside the button */
  if (body && body.tokens) {
    try { return json(Object.assign({ ok: true }, await keepaTokens(key))); } catch (e) { return json({ error: e.message }, 502); }
  }
  const domain = +body.domain || 1;
  const asins = [...new Set((Array.isArray(body.asins) ? body.asins : [])
    .map(a => String(a || '').trim().toUpperCase()).filter(a => /^[A-Z0-9]{10}$/.test(a)))];
  if (!asins.length) return json({ error: 'no ASINs' }, 400);
  if (asins.length > 1000) return json({ error: 'too many ASINs at once (' + asins.length + ')' }, 400);

  try { return json(await pullKeepa(key, domain, asins)); }
  catch (e) { return json({ error: e.message, rows: [] }, 502); }
};

export const config = { path: '/api/keepa' };
