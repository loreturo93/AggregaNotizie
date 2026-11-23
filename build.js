#!/usr/bin/env node
// Genera public/news.json: utile per pubblicare il sito come pagina statica (es. GitHub Pages)
// rigenerando il file periodicamente invece di tenere acceso un server.

const fs = require('node:fs');
const path = require('node:path');
const { aggregate } = require('./lib/aggregator');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'feeds.json'), 'utf8'));

// Riusa le immagini già trovate nella versione pubblicata, così si scaricano solo gli articoli nuovi.
async function previousImages() {
  const cache = new Map();
  const url = process.env.PREVIOUS_NEWS_URL;
  if (!url) return cache;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (res.ok) for (const it of (await res.json()).items || []) if (it.image) cache.set(it.link, it.image);
    console.log(`Immagini riutilizzate dalla versione precedente: ${cache.size}`);
  } catch (e) {
    console.warn(`Versione precedente non disponibile (${e.message})`);
  }
  return cache;
}

previousImages().then((imageCache) => aggregate(config, { imageCache })).then((data) => {
  for (const e of data.errors) console.warn(`  ! ${e.source}: ${e.url} (${e.error})`);
  // Se nessun feed risponde non sovrascriviamo il sito con una pagina vuota.
  if (!data.items.length) {
    console.error('Nessuna notizia scaricata: pubblicazione annullata.');
    process.exit(1);
  }
  const out = path.join(__dirname, 'public', 'news.json');
  fs.writeFileSync(out, JSON.stringify(data));
  console.log(`Scritte ${data.items.length} notizie in ${out}`);
  const bySource = {};
  for (const it of data.items) {
    const s = (bySource[it.source] ||= { notizie: 0, conImmagine: 0 });
    s.notizie++;
    if (it.image) s.conImmagine++;
  }
  console.table(bySource);
});
