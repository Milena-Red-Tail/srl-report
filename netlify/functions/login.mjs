import { env, sameSecret, makeToken, setCookie, json, throttle, clearThrottle,
         brandName, brandSlug, SESSION_HOURS } from './_shared.mjs';

/**
 * The brand's own password, and nothing else. There is no list of Red-Tail
 * people in this project — a team member arrives through /api/enter from the
 * hub. So whoever can read this project's variables learns one password, for
 * one brand, and nothing about the team or any other brand.
 */
export default async (req, context) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const secret = env('SESSION_SECRET');
  const pass = env('BRAND_PASS');
  if (!secret || !pass) {
    return json({ error: 'This report is not configured yet — SESSION_SECRET ' +
      'and BRAND_PASS have to be set in Netlify.' }, 500);
  }

  const ip = req.headers.get('x-nf-client-connection-ip') ||
             (context && context.ip) || '';
  const gate = await throttle(ip);
  if (gate.blocked) {
    return json({ error: 'Too many attempts. Try again in ' +
      Math.ceil(gate.retryInSeconds / 60) + ' minutes.' }, 429);
  }

  let body = {};
  try { body = await req.json(); } catch (e) { body = {}; }
  if (!sameSecret(String(body.password || ''), pass)) {
    return json({ error: 'That password does not match.' }, 401);
  }

  await clearThrottle(ip);
  const who = { user: brandName(), role: 'brand' };
  return json({ user: who.user, role: 'brand', brand: brandSlug() }, 200,
    { 'set-cookie': setCookie(await makeToken(who, secret), SESSION_HOURS * 3600) });
};

export const config = { path: '/api/login' };
