/* ============================================================================
 *  ONE BRAND, ONE PROJECT.
 *
 *  This project is the whole of one brand's report. There is no brand list and
 *  no routing by slug: the data in this project's blob store belongs to this
 *  brand, and there is no code path that could reach another's.
 *
 *  Variables in Netlify:
 *
 *    BRAND_SLUG      heale            must match the hub's BRANDS row
 *    BRAND_NAME      Heale            what the brand is called on screen
 *    BRAND_PASS      ...              the password given to the brand
 *    SESSION_SECRET  ...              signs this project's own cookie; make it
 *                                     different from every other project's, so
 *                                     a cookie from one cannot be used on
 *                                     another
 *    HANDOFF_SECRET  ...              shared with the hub, and only for this
 *                                     brand. The hub keeps its copy as
 *                                     HANDOFF_HEALE.
 *
 *  Two ways in. The brand types BRAND_PASS and gets a read-only session. A
 *  Red-Tail person arrives from the hub carrying a signed note and gets the
 *  full one — the only session that may upload.
 * ========================================================================= */

const enc = new TextEncoder();

export function env(name) {
  const v = process.env[name];
  return v == null ? '' : String(v);
}
export const SESSION_HOURS = 12;

export function brandSlug() { return env('BRAND_SLUG') || 'report'; }
export function brandName() { return env('BRAND_NAME') || brandSlug(); }

/**
 * Where the cards live, so a report can offer the way back to them.
 *
 * A brand project knows nothing about the hub — that is the point of the
 * split — so the address is told to it in one variable, HUB_URL. Without it
 * the report simply offers no such button: a link to a guessed address would
 * be worse than none.
 */
export function hubUrl() {
  const u = env('HUB_URL').trim();
  return /^https?:\/\//i.test(u) ? u.replace(/\/+$/, '') : null;
}


/* Comparing with === leaks how many characters matched through timing. */
export function sameSecret(a, b) {
  const x = enc.encode(String(a)), y = enc.encode(String(b));
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

/* ---------- signing ---------- */
const b64url = buf => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

async function hmac(payload, secret) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(payload)));
}

export async function sign(obj, secret) {
  const body = b64url(enc.encode(JSON.stringify(obj)));
  return body + '.' + await hmac(body, secret);
}

export async function unsign(token, secret) {
  if (!token || typeof token !== 'string' || !secret) return null;
  const dot = token.indexOf('.');
  if (dot < 1) return null;
  const body = token.slice(0, dot), sig = token.slice(dot + 1);
  if (!sameSecret(sig, await hmac(body, secret))) return null;
  try {
    const o = JSON.parse(unb64url(body).toString('utf8'));
    if (!o || typeof o.exp !== 'number' || Date.now() > o.exp) return null;
    return o;
  } catch (e) {
    return null;
  }
}

/* ---------- this project's own session cookie ---------- */
export async function makeToken(who, secret) {
  return sign({ u: who.user, r: who.role,
                exp: Date.now() + SESSION_HOURS * 3600 * 1000 }, secret);
}

export async function readToken(token, secret) {
  const o = await unsign(token, secret);
  if (!o || (o.r !== 'team' && o.r !== 'brand')) return null;
  return { user: String(o.u || ''), role: o.r, brand: brandSlug() };
}

const COOKIE = 'rt_session';

export function cookieFrom(req) {
  const raw = req.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === COOKIE) return part.slice(i + 1).trim();
  }
  return null;
}

export function setCookie(token, maxAgeSeconds) {
  return COOKIE + '=' + token + '; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=' +
    maxAgeSeconds;
}

export async function authOf(req) {
  const secret = env('SESSION_SECRET');
  if (!secret) return null;
  return readToken(cookieFrom(req), secret);
}

/* ---------- notes from the hub ----------
 * Verified against HANDOFF_SECRET, which the hub holds a copy of under this
 * brand's name and no other brand's project has. A note is checked for the
 * audience it was written for and the brand it names, so a status probe can
 * never be replayed as a sign-in, and a note minted for another brand cannot
 * be spent here even if the two ever shared a secret by mistake.
 */
export async function readHandoff(token, audience) {
  const o = await unsign(token, env('HANDOFF_SECRET'));
  if (!o) return null;
  if (o.a !== audience) return null;
  if (o.b !== brandSlug()) return null;
  return o;
}

/* ---------- responses ---------- */
export const json = (data, status = 200, headers = {}) => new Response(
  JSON.stringify(data),
  { status: status, headers: Object.assign({
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    }, headers) });

/* ---------- blob store ----------
 * The in-memory fallback exists so the functions can be run and tested off
 * Netlify. It is behind an explicit flag: silently keeping a brand's data in
 * memory in production would lose it on every cold start. */
const MEM = new Map();
export async function store(name) {
  if (env('LOCAL_DEV') === '1') {
    return {
      get: async (k, o) => {
        const v = MEM.get(name + '/' + k);
        if (v === undefined) return null;
        return o && o.type === 'json' ? JSON.parse(v) : v;
      },
      setJSON: async (k, v) => { MEM.set(name + '/' + k, JSON.stringify(v)); },
      set: async (k, v) => { MEM.set(name + '/' + k, v); },
      delete: async (k) => { MEM.delete(name + '/' + k); },
    };
  }
  const { getStore } = await import('@netlify/blobs');
  return getStore(name);
}

/* One brand per project, so the keys are bare. The branded key is read as a
   fallback so a project split out of the shared site finds the data that was
   copied across under its old name. */
export const DATA_KEY = 'dataset';
export const META_KEY = 'meta';
export const legacyDataKey = () => 'dataset:' + brandSlug();
export const legacyMetaKey = () => 'meta:' + brandSlug();

/* ---------- login throttle ---------- */
export async function throttle(ip) {
  const s = await store('auth');
  const key = 'rl:' + (ip || 'unknown');
  const now = Date.now();
  let rec = null;
  try { rec = await s.get(key, { type: 'json' }); } catch (e) { rec = null; }
  if (!rec || now > rec.until) rec = { n: 0, until: now + 15 * 60 * 1000 };
  rec.n += 1;
  await s.setJSON(key, rec);
  return { blocked: rec.n > 10, retryInSeconds: Math.ceil((rec.until - now) / 1000) };
}
export async function clearThrottle(ip) {
  const s = await store('auth');
  try { await s.delete('rl:' + (ip || 'unknown')); } catch (e) { /* nothing to clear */ }
}
