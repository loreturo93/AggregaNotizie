const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { parseFeed, parseDate, extractOgImage, decodeXml } = require('../lib/parser');
const { aggregate, guessCategory } = require('../lib/aggregator');

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
<channel><title>Test</title>
  <item>
    <title><![CDATA[Il governo approva la manovra &amp; altro]]></title>
    <link>https://example.it/politica/manovra</link>
    <description><![CDATA[<p><img src="https://example.it/img.jpg"/>Testo <b>della</b> notizia &egrave;</p>]]></description>
    <pubDate>Mon, 23 Nov 2026 10:00:00 +0100</pubDate>
    <category>Politica</category>
  </item>
  <item>
    <title>Seconda notizia</title>
    <link>https://example.it/politica/seconda</link>
    <media:content url="https://example.it/media.jpg" medium="image"/>
    <pubDate>Mon, 23 Nov 2026 12:00:00 +0100</pubDate>
  </item>
  <item><title>Senza link</title></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title type="html">Sinner vince in finale</title>
    <link rel="alternate" href="https://example.org/sport/sinner"/>
    <link rel="self" href="https://example.org/self"/>
    <updated>2026-11-23T09:30:00Z</updated>
    <summary>Il campione di tennis conquista il titolo.</summary>
    <category term="Tennis"/>
  </entry>
</feed>`;

test('parseFeed legge RSS 2.0 con CDATA, entità e immagini', () => {
  const items = parseFeed(RSS);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Il governo approva la manovra & altro');
  assert.equal(items[0].link, 'https://example.it/politica/manovra');
  assert.equal(items[0].description, 'Testo della notizia è');
  assert.equal(items[0].image, 'https://example.it/img.jpg');
  assert.equal(items[0].date, '2026-11-23T09:00:00.000Z');
  assert.deepEqual(items[0].feedCategories, ['Politica']);
  assert.equal(items[1].image, 'https://example.it/media.jpg');
});

test('parseFeed legge Atom e sceglie il link alternate', () => {
  const [it] = parseFeed(ATOM);
  assert.equal(it.title, 'Sinner vince in finale');
  assert.equal(it.link, 'https://example.org/sport/sinner');
  assert.equal(it.date, '2026-11-23T09:30:00.000Z');
  assert.deepEqual(it.feedCategories, ['Tennis']);
});

test('decodeXml rispetta l\'encoding ISO-8859-1 dichiarato', () => {
  const xml = '<?xml version="1.0" encoding="ISO-8859-1"?><rss><channel><item><title>Città più</title><link>https://x.it/a</link></item></channel></rss>';
  const bytes = new Uint8Array(Buffer.from(xml, 'latin1'));
  assert.equal(parseFeed(decodeXml(bytes))[0].title, 'Città più');
});

test('guessCategory assegna la categoria dalle parole chiave', () => {
  const ids = ['politica', 'cronaca', 'economia', 'esteri', 'sport', 'cultura', 'tecnologia'];
  const mk = (title) => ({ title, description: '', feedCategories: [] });
  assert.equal(guessCategory(mk('Champions, l\'Inter vince la partita'), ids), 'sport');
  assert.equal(guessCategory(mk('Il ministro presenta il decreto in Senato'), ids), 'politica');
  assert.equal(guessCategory(mk('Lo spread scende, Borsa in rialzo'), ids), 'economia');
  assert.equal(guessCategory(mk('Titolo generico'), ids), 'cronaca');
});

test('aggregate unisce i feed, deduplica, ordina e segnala gli errori', async (t) => {
  const server = http.createServer((req, res) => {
    if (req.url === '/rss') return res.end(RSS);
    if (req.url === '/atom') return res.end(ATOM);
    res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const data = await aggregate({
    categories: [{ id: 'politica', label: 'Politica' }, { id: 'sport', label: 'Sport' }],
    feeds: [
      { source: 'A', category: 'politica', url: `${base}/rss` },
      { source: 'A', category: 'politica', url: `${base}/rss` }, // duplicato
      { source: 'B', category: 'auto', url: `${base}/atom` },
      { source: 'C', category: 'sport', url: `${base}/manca` },
    ],
  }, { fetchImages: false, maxAgeDays: 0 });

  assert.equal(data.items.length, 3);
  assert.deepEqual(data.items.map((i) => i.link), [
    'https://example.it/politica/seconda',
    'https://example.org/sport/sinner',
    'https://example.it/politica/manovra',
  ]);
  assert.equal(data.items[1].category, 'sport'); // categoria dedotta
  assert.deepEqual(data.sources, ['A', 'B', 'C']);
  assert.equal(data.errors.length, 1);
  assert.equal(data.errors[0].source, 'C');
});

test('parseDate capisce le date scritte in italiano', () => {
  assert.equal(parseDate('lun, 23 nov 2026 12:53:55 GMT'), '2026-11-23T12:53:55.000Z');
  assert.equal(parseDate('mar, 3 mar 2026 10:00:00 +0100'), '2026-03-03T09:00:00.000Z');
  assert.equal(parseDate('Mon, 23 Nov 2026 13:17:48 +0100'), '2026-11-23T12:17:48.000Z');
  assert.equal(parseDate('non è una data'), null);
});

test('extractOgImage legge og:image in qualsiasi ordine di attributi e risolve URL relativi', () => {
  assert.equal(extractOgImage('<head><meta content="https://x.it/a.jpg" property="og:image"></head>', 'https://x.it/'), 'https://x.it/a.jpg');
  assert.equal(extractOgImage("<meta name='twitter:image' content='/img/b.jpg'>", 'https://y.it/art/1'), 'https://y.it/img/b.jpg');
  assert.equal(extractOgImage('<head></head><meta property="og:image" content="https://z.it/body.jpg">', 'https://z.it/'), '');
});

test('aggregate prende le immagini mancanti dalla pagina, usa la cache e scarta le notizie vecchie', async (t) => {
  const now = Date.now();
  const rfc = (ms) => new Date(ms).toUTCString();
  let pageHits = 0;
  const server = http.createServer((req, res) => {
    const base = `http://127.0.0.1:${server.address().port}`;
    if (req.url === '/feed') {
      return res.end(`<rss><channel>
        <item><title>Nuova</title><link>${base}/art/1</link><pubDate>${rfc(now)}</pubDate></item>
        <item><title>In cache</title><link>${base}/art/2</link><pubDate>${rfc(now - 3600e3)}</pubDate></item>
        <item><title>Vecchia</title><link>${base}/art/3</link><pubDate>${rfc(now - 30 * 86400e3)}</pubDate></item>
      </channel></rss>`);
    }
    if (req.url.startsWith('/art/')) {
      pageHits++;
      return res.end(`<html><head><meta property="og:image" content="/img${req.url.slice(4)}.jpg"></head><body>…</body></html>`);
    }
    res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const imageCache = new Map([[`${base}/art/2`, 'https://cache.it/2.jpg']]);
  const data = await aggregate(
    { categories: [{ id: 'cronaca', label: 'Cronaca' }], feeds: [{ source: 'X', category: 'cronaca', url: `${base}/feed` }] },
    { imageCache },
  );

  assert.deepEqual(data.items.map((i) => i.title), ['Nuova', 'In cache']);
  assert.equal(data.items[0].image, `${base}/img/1.jpg`);
  assert.equal(data.items[1].image, 'https://cache.it/2.jpg');
  assert.equal(pageHits, 1);
  assert.equal(imageCache.get(`${base}/art/1`), `${base}/img/1.jpg`);
});
