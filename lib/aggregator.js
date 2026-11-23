const { parseFeed, decodeXml } = require('./parser');

const FETCH_TIMEOUT_MS = 10_000;
const MAX_ITEMS_PER_FEED = 30;

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

// Normalizza un URL per riconoscere la stessa notizia ripetuta in più feed della stessa testata.
function linkKey(link) {
  try {
    const u = new URL(link);
    return (u.host.replace(/^www\./, '') + u.pathname).replace(/\/$/, '');
  } catch {
    return link;
  }
}

async function aggregate(config) {
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

  return {
    updatedAt: new Date().toISOString(),
    categories: config.categories,
    sources: [...new Set(config.feeds.map((f) => f.source))],
    items,
    errors,
  };
}

module.exports = { aggregate, guessCategory, linkKey };
