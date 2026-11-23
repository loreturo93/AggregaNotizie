const { parseFeed, decodeXml, extractOgImage } = require('./parser');

const FETCH_TIMEOUT_MS = 10_000;
const PAGE_TIMEOUT_MS = 6_000;
const MAX_ITEMS_PER_FEED = 30;
const MAX_AGE_DAYS = 7;         // notizie più vecchie vengono scartate (alcuni feed contengono articoli di anni fa)
const IMAGE_CONCURRENCY = 8;    // pagine di articoli scaricate in parallelo per cercare l'immagine
const BROWSER_UA = 'Mozilla/5.0 (compatible; AggregaNotizie/1.0)';

// Parole chiave per assegnare una categoria ai feed che non ne hanno una ("category": "auto").
const KEYWORDS = {
  politica: ['governo', 'parlamento', 'senato', 'camera dei deputati', 'ministro', 'premier', 'meloni', 'elezioni', 'partito', 'quirinale', 'mattarella', 'opposizione', 'decreto'],
  economia: ['economia', 'borsa', 'spread', 'pil', 'inflazione', 'bce', 'tasse', 'fisco', 'manovra', 'lavoro', 'mercati', 'aziende', 'banca', 'pensioni'],
  esteri: ['usa', 'stati uniti', 'cina', 'russia', 'ucraina', 'israele', 'gaza', 'onu', 'nato', 'europa', 'ue', 'casa bianca', 'putin', 'trump'],
  sport: ['calcio', 'serie a', 'champions', 'juventus', 'inter', 'milan', 'napoli', 'roma', 'tennis', 'sinner', 'formula 1', 'motogp', 'olimpiadi', 'partita', 'campionato'],
  cultura: ['cinema', 'film', 'musica', 'libro', 'mostra', 'teatro', 'festival', 'sanremo', 'serie tv', 'concerto', 'arte'],
  tecnologia: ['tecnologia', 'intelligenza artificiale', 'smartphone', 'apple', 'google', 'microsoft', 'app', 'software', 'spazio', 'nasa', 'scienza', 'ricerca', 'clima'],
  cronaca: ['polizia', 'carabinieri', 'arrestato', 'incidente', 'omicidio', 'indagine', 'procura', 'morto', 'vittime', 'tribunale', 'incendio'],
};

function guessCategory(item, categoryIds) {
  const text = ` ${item.title} ${item.description} ${item.feedCategories.join(' ')} `.toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const [cat, words] of Object.entries(KEYWORDS)) {
    if (!categoryIds.includes(cat)) continue;
    const score = words.reduce((n, w) => n + (new RegExp(`[^\\p{L}]${w}[^\\p{L}]`, 'u').test(text) ? 1 : 0), 0);
    if (score > bestScore) [best, bestScore] = [cat, score];
  }
  return best || 'cronaca';
}

async function fetchFeed(feed) {
  const res = await fetch(feed.url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { 'User-Agent': 'AggregaNotizie/1.0 (+RSS reader)', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = decodeXml(new Uint8Array(await res.arrayBuffer()), res.headers.get('content-type') || '');
  return parseFeed(xml).slice(0, MAX_ITEMS_PER_FEED);
}

// Scarica solo l'inizio della pagina di un articolo (fino a </head>) e ne estrae l'immagine di anteprima.
async function fetchPageImage(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(PAGE_TIMEOUT_MS), headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' } });
  if (!res.ok || !res.body) return '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let html = '';
  try {
    while (html.length < 500_000) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      if (/<\/head>/i.test(html)) break;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return extractOgImage(html, res.url || url);
}

// Esegue fn su tutti gli elementi, al massimo `limit` alla volta.
async function eachLimit(list, limit, fn) {
  let i = 0;
  const worker = async () => {
    while (i < list.length) await fn(list[i++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
}

// Per i feed che non includono immagini, prende quella di anteprima dalla pagina dell'articolo.
// `cache` (Map link → immagine) evita di riscaricare le pagine già viste.
async function fillMissingImages(items, cache) {
  const missing = [];
  for (const it of items) {
    if (it.image) continue;
    if (cache.has(it.link)) it.image = cache.get(it.link);
    else missing.push(it);
  }
  await eachLimit(missing, IMAGE_CONCURRENCY, async (it) => {
    it.image = await fetchPageImage(it.link).catch(() => '');
    cache.set(it.link, it.image);
  });
}

// Normalizza un URL per riconoscere la stessa notizia ripetuta in più feed della stessa testata.
function linkKey(link) {
  try {
    const u = new URL(link);
    return (u.host.replace(/^www\./, '') + u.pathname).replace(/\/$/, '');
  } catch {
    return link;
  }
}

/**
 * @param {object} config        contenuto di feeds.json
 * @param {object} [options]
 * @param {boolean} [options.fetchImages=true]  cerca le immagini mancanti nelle pagine degli articoli
 * @param {Map} [options.imageCache]            cache link → immagine, condivisa tra un aggiornamento e l'altro
 * @param {number} [options.maxAgeDays]         scarta le notizie più vecchie (0 = nessun limite)
 */
async function aggregate(config, { fetchImages = true, imageCache = new Map(), maxAgeDays = MAX_AGE_DAYS } = {}) {
  const minDate = maxAgeDays ? new Date(Date.now() - maxAgeDays * 86_400_000).toISOString() : '';
  const categoryIds = config.categories.map((c) => c.id);
  const results = await Promise.allSettled(config.feeds.map(fetchFeed));

  const seen = new Set();
  const items = [];
  const errors = [];

  results.forEach((r, i) => {
    const feed = config.feeds[i];
    if (r.status === 'rejected') {
      errors.push({ source: feed.source, url: feed.url, error: String(r.reason?.message || r.reason) });
      return;
    }
    for (const it of r.value) {
      if (minDate && it.date && it.date < minDate) continue;
      const key = linkKey(it.link);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        title: it.title,
        link: it.link,
        description: it.description,
        date: it.date,
        image: it.image,
        source: feed.source,
        category: categoryIds.includes(feed.category) ? feed.category : guessCategory(it, categoryIds),
      });
    }
  });

  items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  if (fetchImages) await fillMissingImages(items, imageCache);

  return {
    updatedAt: new Date().toISOString(),
    categories: config.categories,
    sources: [...new Set(config.feeds.map((f) => f.source))],
    items,
    errors,
  };
}

module.exports = { aggregate, guessCategory, linkKey };
