import { authOf, brandSlug, brandName, hubUrl, store, META_KEY, legacyMetaKey, json }
  from './_shared.mjs';

/**
 * One brand, so the list this returns always has exactly one entry. That is
 * deliberate: the page already knows what to do with a session that can open
 * a single brand — it opens it, rather than drawing a cards page with one card
 * on it. The same report file therefore runs here and on the hub without
 * knowing which it is.
 */
export default async (req) => {
  const auth = await authOf(req);
  /* Signed out, the page is told where the hub is and which brand this is,
     so its sign-in page can offer the team the hub's door (/go/<brand>).
     Neither is a secret: the hub's address is where every team member signs
     in anyway, and the brand's slug is in this site's own address. */
  if (!auth) return json({ error: 'not signed in', hub: hubUrl(), slug: brandSlug() }, 401);

  const b = { slug: brandSlug(), name: brandName() };
  const s = await store('report');
  let m = null;
  try { m = await s.get(META_KEY, { type: 'json' }); } catch (e) { m = null; }
  if (!m) { try { m = await s.get(legacyMetaKey(), { type: 'json' }); } catch (e) { m = null; } }
  if (m) { b.savedAt = m.savedAt || null; b.savedBy = m.savedBy || null;
           b.days = m.days || 0; b.to = m.to || null; }

  /* Only the team came here from the cards, so only the team is offered the
     way back to them. A brand signing in at its own address has no session on
     the hub and nothing to see there. */
  return json({ user: auth.user, role: auth.role,
                brand: auth.role === 'brand' ? b.slug : null, brands: [b],
                hub: auth.role === 'team' ? hubUrl() : null });
};

export const config = { path: '/api/session' };
