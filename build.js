#!/usr/bin/env node
// Genera public/news.json: utile per pubblicare il sito come pagina statica (es. GitHub Pages)
// rigenerando il file periodicamente invece di tenere acceso un server.

const fs = require('node:fs');
const path = require('node:path');
const { aggregate } = require('./lib/aggregator');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'feeds.json'), 'utf8'));

aggregate(config).then((data) => {
  const out = path.join(__dirname, 'public', 'news.json');
  fs.writeFileSync(out, JSON.stringify(data));
  console.log(`Scritte ${data.items.length} notizie in ${out}`);
  for (const e of data.errors) console.warn(`  ! ${e.source}: ${e.url} (${e.error})`);
});
