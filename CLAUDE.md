# AggregaNotizie — contesto per Claude

Aggregatore di notizie delle principali testate italiane, diviso per categorie.
L'utente scrive in italiano: rispondere in italiano, in modo semplice (non è uno sviluppatore esperto).

## Stato attuale (novembre 2026)

- Sito online: https://loreturo93.github.io/AggregaNotizie/ (repository **pubblico**, GitHub Pages gratuito).
- Branch di sviluppo: `claude/news-aggregator-categories-wmzxue`; ogni modifica finita viene portata anche su `main`
  (fast-forward), che fa partire la pubblicazione.
- Funzioni presenti: home con una sezione per categoria, pagina per categoria (`#sport`, …), ricerca, filtro testate
  (salvato in localStorage), tema chiaro/scuro, layout mobile, immagine per ogni notizia, anteprima della notizia in un
  pannello (`<dialog id="reader">`) con frecce ‹ › e pulsante "Leggi l'articolo completo" verso il sito originale.

## Architettura (Node ≥ 18, nessuna dipendenza)

```
feeds.json                    testate, URL dei feed e categorie (category "auto" = dedotta da parole chiave)
lib/parser.js                 parser RSS/Atom a regex, entità HTML, date in italiano, extractOgImage
lib/aggregator.js             download parallelo, scarto notizie > 7 giorni, deduplica per URL, ordinamento,
                              immagini mancanti prese da og:image della pagina (solo <head>, 8 in parallelo, cache)
server.js                     modalità server: pagina + /api/news con cache 10 min (npm start, porta 3000)
build.js                      modalità statica: scrive public/news.json; riusa le immagini dal news.json pubblicato
                              (env PREVIOUS_NEWS_URL); esce con errore se 0 notizie (non pubblica una pagina vuota)
public/                       index.html, style.css, app.js (prova /api/news, poi news.json)
.github/workflows/pages.yml   test + build + deploy su Pages: a ogni push su main, ogni ora (minuto 7), manuale
test/aggregator.test.js       8 test con node:test (npm test), feed finti su server HTTP locale
```

## Feed verificati (funzionanti da GitHub Actions il 23/11/2026)

- ANSA `ansa.it/sito/notizie/<sezione>/<sezione>_rss.xml`: nessuna immagine nel feed → og:image.
- Repubblica `repubblica.it/rss/<sezione>/rss2.0.xml`: immagine in `<enclosure>`. La sezione sport non esiste (404), tolta.
- Corriere `corriere.it/dynamic-feed/rss/section/<Sezione>.xml` (Politica, Cronaca, Economia, Esteri, Sport, Cultura,
  Spettacoli, Tecnologia, Scienze). I vecchi `xml2.corriereobjects.it` sono fermi al 2024 con titoli vuoti: non usarli.
- Gazzetta `gazzetta.it/dynamic-feed/rss/section/last.xml` (il vecchio `rss/home.xml` è fermo al 2023).
- Sole 24 Ore `ilsole24ore.com/rss/<sezione>.xml`: immagine in enclosure `type="image/jpg"`.
- Sky TG24 `tg24.sky.it/rss/tg24_<sezione>.xml`: date in italiano ("lun, 23 nov 2026 …"), niente immagini → og:image.
- Il Post `ilpost.it/<sezione>/feed/`: niente immagini → og:image.

Ultimo risultato: ~920 notizie, quasi tutte con immagine, build in ~20 s.

## Note operative

- Dal container di Claude i siti delle testate e `github.io` sono **bloccati** dal proxy (403). Per verificare feed
  reali si usa un workflow temporaneo (`.github/workflows/diag.yml`, trigger push sul branch di sviluppo) e si leggono
  i log con gli strumenti GitHub MCP; poi va rimosso. Per la UI si usa Playwright con `/api/news` simulato.
- Decisione presa con l'utente: **non** ripubblicare il testo integrale degli articoli (diritto d'autore, diritto
  connesso degli editori, paywall). L'anteprima mostra solo titolo, immagine e sommario del feed; per leggere senza
  pubblicità è stato consigliato uBlock Origin e la modalità lettura del browser. Restare dentro questo limite.
- Idee rimaste in sospeso: nessuna richiesta aperta; l'utente deve ancora provare l'anteprima e dare un parere.
