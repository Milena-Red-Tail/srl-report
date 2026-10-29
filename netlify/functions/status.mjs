import { readHandoff, store, META_KEY, legacyMetaKey, json } from './_shared.mjs';

/**
 * /api/status?t=… — what the hub's cards page puts under a brand's name.
 *
 * Only a date, who saved it, and how many days it covers. No revenue, no
 * products, no costs. Even so it wants the hub's signature: a stranger has no
 * business learning that this site exists, is configured, and was updated on
 * Tuesday.
 */
export default async (req) => {
  const t = new URL(req.url).searchParams.get('t') || '';
  if (!await readHandoff(t, 'status')) return json({ error: 'not for you' }, 403);

  const s = await store('report');
  let m = null;
  try { m = await s.get(META_KEY, { type: 'json' }); } catch (e) { m = null; }
  if (!m) { try { m = await s.get(legacyMetaKey(), { type: 'json' }); } catch (e) { m = null; } }
  if (!m) return json({ savedAt: null, savedBy: null, days: 0, to: null });

  return json({ savedAt: m.savedAt || null, savedBy: m.savedBy || null,
                days: m.days || 0, to: m.to || null });
};

export const config = { path: '/api/status' };
