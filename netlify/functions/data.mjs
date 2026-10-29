import { authOf, brandSlug, store, DATA_KEY, legacyDataKey, json }
  from './_shared.mjs';

/**
 * What a brand is sent.
 *
 * The report is the brand's own trading, and it is shown to them whole:
 * costs, margin and break-even included. Red-Tail works out those figures
 * from a cost file the brand itself provides, so hiding them back from the
 * brand was never protecting anything — it only made their copy of the
 * report read as if the numbers were missing.
 *
 * One thing does not travel: the upload log. That is the record of Red-Tail's
 * own work on the document — who saved it, what was dropped on it and when —
 * and it belongs with the upload page, which a brand cannot open.
 */
function forViewer(ds) {
  /* A brand selling in several countries keeps one dataset per country under
     `markets`; each is treated the same way, so no country's log travels by
     being the one nobody looked at. */
  if (ds && ds.markets && typeof ds.markets === 'object') {
    const out = Object.assign({}, ds);
    out.markets = {};
    Object.keys(ds.markets).forEach(function (c) {
      out.markets[c] = stripOne(ds.markets[c] || {});
    });
    delete out.log;
    return out;
  }
  return stripOne(ds);
}

function stripOne(ds) {
  const out = Object.assign({}, ds);
  delete out.log;
  /* the Products page's saved versions are the team's working history — a
     viewer gets the list as it stands, not every version of it */
  delete out.prodHistory;
  return out;
}

export default async (req) => {
  const auth = await authOf(req);
  if (!auth) return json({ error: 'not signed in' }, 401);

  /* The page still sends ?brand= — the same file runs on the shared site. Here
     there is only one brand and the answer never depends on the query string,
     but a request naming a different brand is a sign something is pointed at
     the wrong project, and saying so is more useful than quietly serving the
     wrong report. */
  const asked = new URL(req.url).searchParams.get('brand');
  if (asked && asked !== brandSlug()) {
    return json({ error: 'this project only serves ' + brandSlug() }, 403);
  }

  const role = auth.role === 'team' ? 'admin' : 'viewer';
  const s = await store('report');
  let ds = null;
  try { ds = await s.get(DATA_KEY, { type: 'json' }); } catch (e) { ds = null; }
  /* Data copied over from the shared site arrives under its old branded key.
     Read it once more here so the split does not look like data loss; the next
     save writes it to the bare key and this stops mattering. */
  if (!ds) { try { ds = await s.get(legacyDataKey(), { type: 'json' }); } catch (e) { ds = null; } }
  if (!ds) return json({ role: role, brand: brandSlug(), dataset: null });

  return json({ role: role, brand: brandSlug(),
                dataset: role === 'admin' ? ds : forViewer(ds) });
};

export const config = { path: '/api/data' };
