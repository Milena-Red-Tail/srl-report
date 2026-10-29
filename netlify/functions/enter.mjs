import { env, readHandoff, makeToken, setCookie, store, json }
  from './_shared.mjs';

/* A note is good once. Keeping the spent ids for ten minutes covers the whole
   life of a sixty-second note with room to spare; after that the note has
   expired on its own and there is nothing left to replay. */
const SPENT_MINUTES = 10;

/**
 * /api/enter?t=… — a team member arriving from the hub.
 *
 * The note in the URL is the only thing that crosses. It is checked, spent,
 * and then thrown away: the reply is a redirect to the report with no token in
 * it, so the address bar, the browser history and anything the brand might
 * later screenshot hold nothing but the plain site address.
 */
export default async (req) => {
  const t = new URL(req.url).searchParams.get('t') || '';
  const note = await readHandoff(t, 'enter');
  if (!note) return sendBack('That sign-in link has expired. Open the brand ' +
    'again from the Red-Tail hub.');

  const secret = env('SESSION_SECRET');
  if (!secret) return json({ error: 'SESSION_SECRET is not set on this project.' }, 500);

  /* Single use. Without this a note copied out of a proxy log or a browser
     history could be spent a second time inside its minute. */
  const s = await store('auth');
  const key = 'spent:' + String(note.j || '');
  if (note.j) {
    let seen = null;
    try { seen = await s.get(key, { type: 'json' }); } catch (e) { seen = null; }
    if (seen && seen.until > Date.now()) {
      return sendBack('That sign-in link has already been used. Open the brand ' +
        'again from the Red-Tail hub.');
    }
    try {
      await s.setJSON(key, { until: Date.now() + SPENT_MINUTES * 60 * 1000 });
    } catch (e) { /* the note still expires in a minute on its own */ }
  }

  const token = await makeToken({ user: String(note.u || 'team'), role: 'team' }, secret);
  /* The hub says which page was chosen — a report, or the upload page. The
     name is checked to the letter before it goes anywhere near a Location
     header; the report itself decides what an unknown page name means. */
  const page = /^[a-z][a-z0-9-]*$/.test(String(note.p || '')) ? String(note.p) : '';
  const landing = page && page !== 'sales' ? '/b/' + env('BRAND_SLUG') + '/' + page : '/';
  return new Response(null, { status: 302, headers: {
    location: landing,
    'set-cookie': setCookie(token, 12 * 3600),
    'cache-control': 'no-store',
  } });
};

/* A refused note is a small page rather than a bare 403, because the person
   reading it is Milena or someone on her team and the useful thing to tell
   them is which door to go back to. */
function sendBack(message) {
  const html = '<!doctype html><meta charset="utf-8">' +
    '<title>Sign-in link</title>' +
    '<style>body{font:15px/1.6 system-ui,sans-serif;margin:0;display:grid;' +
    'place-items:center;height:100vh;background:#F7F5F1;color:#33302B}' +
    'div{max-width:26em;padding:2rem;text-align:center}' +
    'a{color:#2E5E4E}</style>' +
    '<div><p>' + message + '</p><p><a href="/">Back to this report’s ' +
    'sign-in</a></p></div>';
  return new Response(html, { status: 401, headers: {
    'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

export const config = { path: '/api/enter' };
