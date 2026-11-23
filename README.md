# AggregaNotizie

Una pagina web che raccoglie le notizie delle principali testate italiane dai loro feed RSS e le divide per categoria.

**Categorie:** Politica · Cronaca · Economia · Esteri · Sport · Cultura e Spettacoli · Tecnologia e Scienza

**Testate:** ANSA, la Repubblica, Corriere della Sera, Il Sole 24 Ore, Sky TG24, Il Post, La Gazzetta dello Sport

## Funzionalità

- Home con una sezione per categoria e le notizie più recenti di ognuna
- Pagina dedicata per ogni categoria (`/#sport`, `/#esteri`, …) con caricamento progressivo
- Ricerca testuale su tutte le notizie
- Filtro per testata (la scelta resta salvata nel browser)
- Notizie doppie eliminate, ordinamento per data, orario relativo ("15 minuti fa")
- Aggiornamento automatico ogni 10 minuti, tema chiaro e scuro, layout adatto ai telefoni

## Avvio

Serve Node.js 18 o superiore. Non ci sono dipendenze da installare.

```bash
npm start
```

Poi apri <http://localhost:3000>.

Variabili d'ambiente facoltative:

| Variabile | Default | Significato |
|---|---|---|
| `PORT` | `3000` | Porta del server |
| `CACHE_MINUTES` | `10` | Ogni quanti minuti rileggere i feed |

## Come funziona

Il browser non può leggere direttamente i feed RSS di altri siti (blocco CORS). Per questo un piccolo server Node (`server.js`) scarica i feed, li unisce e li serve alla pagina come JSON su `/api/news`.

```
feeds.json          elenco di testate, feed e categorie
lib/parser.js       lettura dei feed RSS 2.0 e Atom
lib/aggregator.js   download in parallelo, deduplica, ordinamento, categorie
server.js           server HTTP: pagina + API /api/news con cache
build.js            genera public/news.json per la versione statica
public/             la pagina web (HTML, CSS, JS)
```

## Aggiungere o cambiare testate

Modifica `feeds.json`. Ogni feed ha una testata, una categoria e un URL:

```json
{ "source": "Il Fatto Quotidiano", "category": "politica", "url": "https://www.ilfattoquotidiano.it/politica-palazzo/feed/" }
```

Se un feed mescola più argomenti, usa `"category": "auto"`: la categoria verrà dedotta dalle parole chiave del titolo (l'elenco è in `lib/aggregator.js`).

Anche le categorie si cambiano in `feeds.json`. Per dare un colore a una categoria nuova, aggiungi una riga `[data-cat="..."]` in `public/style.css`.

## Versione statica (senza server)

```bash
npm run build
```

Il comando genera `public/news.json`. La cartella `public/` si può pubblicare su un hosting statico (GitHub Pages, Netlify, …): se `/api/news` non esiste, la pagina legge `news.json`. Per tenere le notizie aggiornate bisogna rigenerare il file regolarmente, ad esempio con una GitHub Action pianificata.

## Test

```bash
npm test
```
