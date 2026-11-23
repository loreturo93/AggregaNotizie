(() => {
  const PER_SECTION = 6;   // notizie per categoria nella home
  const PAGE_SIZE = 24;    // notizie per pagina nella vista di una categoria
  const AUTO_REFRESH_MS = 10 * 60 * 1000;

  const $ = (id) => document.getElementById(id);
  const state = { data: null, query: '', hiddenSources: new Set(), limit: PAGE_SIZE };

  try {
    state.hiddenSources = new Set(JSON.parse(localStorage.getItem('hiddenSources') || '[]'));
  } catch { /* storage non disponibile */ }

  // ---------- Caricamento dati ----------
  async function load(force = false) {
    $('refresh').disabled = true;
    try {
      let res = await fetch(`api/news${force ? '?refresh' : ''}`, { cache: 'no-store' }).catch(() => null);
      // Fallback per la versione statica generata con `npm run build`
      if (!res || !res.ok) res = await fetch('news.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      state.data = await res.json();
      renderSources();
      render();
    } catch (err) {
      if (!state.data) $('content').innerHTML = `<p class="empty">Impossibile caricare le notizie (${escapeHtml(err.message)}).</p>`;
    } finally {
      $('refresh').disabled = false;
    }
  }

  // ---------- Utility ----------
  function escapeHtml(s = '') {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  const rtf = new Intl.RelativeTimeFormat('it', { numeric: 'auto' });
  function timeAgo(iso) {
    if (!iso) return '';
    const diff = (new Date(iso) - Date.now()) / 1000;
    const units = [['day', 86400], ['hour', 3600], ['minute', 60]];
    for (const [unit, sec] of units) {
      if (Math.abs(diff) >= sec || unit === 'minute') return rtf.format(Math.round(diff / sec), unit);
    }
  }

  function currentCategory() {
    const id = decodeURIComponent(location.hash.slice(1));
    return state.data?.categories.some((c) => c.id === id) ? id : null;
  }

  function filteredItems() {
    const q = state.query.trim().toLowerCase();
    return state.data.items.filter(
      (it) =>
        !state.hiddenSources.has(it.source) &&
        (!q || it.title.toLowerCase().includes(q) || it.description.toLowerCase().includes(q)),
    );
  }

  // ---------- Rendering ----------
  function card(it, showCategory) {
    const cat = state.data.categories.find((c) => c.id === it.category);
    const img = it.image ? `<img src="${escapeHtml(it.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : '';
    return `
      <a class="card" data-cat="${it.category}" href="${escapeHtml(it.link)}" target="_blank" rel="noopener noreferrer">
        ${img}
        <div class="card-body">
          <div class="meta">
            <span class="source">${escapeHtml(it.source)}</span>
            ${showCategory && cat ? `<span class="cat">${escapeHtml(cat.label)}</span>` : ''}
            <time datetime="${it.date || ''}" title="${it.date ? new Date(it.date).toLocaleString('it-IT') : ''}">${timeAgo(it.date)}</time>
          </div>
          <h3>${escapeHtml(it.title)}</h3>
          ${it.description ? `<p>${escapeHtml(it.description)}</p>` : ''}
        </div>
      </a>`;
  }

  function renderTabs(items) {
    const active = currentCategory();
    const counts = {};
    for (const it of items) counts[it.category] = (counts[it.category] || 0) + 1;
    $('tabs').innerHTML =
      `<a class="tab" href="#" ${!active ? 'aria-current="page"' : ''}>Tutte<span class="count">${items.length}</span></a>` +
      state.data.categories
        .map(
          (c) =>
            `<a class="tab" data-cat="${c.id}" href="#${c.id}" ${active === c.id ? 'aria-current="page"' : ''}>${escapeHtml(c.label)}<span class="count">${counts[c.id] || 0}</span></a>`,
        )
        .join('');
  }

  function render() {
    if (!state.data) return;
    const items = filteredItems();
    const active = currentCategory();
    renderTabs(items);

    const updated = new Date(state.data.updatedAt);
    $('updated').textContent = `Aggiornato alle ${updated.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;

    const errs = state.data.errors || [];
    $('errors').textContent = errs.length ? `${errs.length === 1 ? '1 feed non raggiungibile' : `${errs.length} feed non raggiungibili`} al momento: ${[...new Set(errs.map((e) => e.source))].join(', ')}.` : '';

    const content = $('content');
    if (!items.length) {
      content.innerHTML = `<p class="empty">Nessuna notizia trovata${state.query ? ` per “${escapeHtml(state.query)}”` : ''}.</p>`;
      return;
    }

    if (active) {
      // Vista di una singola categoria
      const cat = state.data.categories.find((c) => c.id === active);
      const list = items.filter((it) => it.category === active);
      content.innerHTML = `
        <section class="section" data-cat="${active}">
          <div class="section-head"><h2>${escapeHtml(cat.label)}</h2><span class="meta">${list.length} notizie</span></div>
          ${list.length ? `<div class="grid">${list.slice(0, state.limit).map((it) => card(it, false)).join('')}</div>` : '<p class="empty">Nessuna notizia in questa categoria.</p>'}
          ${list.length > state.limit ? '<div class="more"><button id="more" type="button">Mostra altre notizie</button></div>' : ''}
        </section>`;
      $('more')?.addEventListener('click', () => {
        state.limit += PAGE_SIZE;
        render();
      });
      return;
    }

    if (state.query) {
      // Ricerca su tutte le categorie: risultati in un'unica griglia
      content.innerHTML = `
        <section class="section">
          <div class="grid">${items.slice(0, state.limit).map((it) => card(it, true)).join('')}</div>
          ${items.length > state.limit ? '<div class="more"><button id="more" type="button">Mostra altri risultati</button></div>' : ''}
        </section>`;
      $('more')?.addEventListener('click', () => {
        state.limit += PAGE_SIZE;
        render();
      });
      return;
    }

    // Home: una sezione per categoria con le notizie più recenti
    content.innerHTML = state.data.categories
      .map((c) => {
        const list = items.filter((it) => it.category === c.id);
        if (!list.length) return '';
        return `
          <section class="section" data-cat="${c.id}">
            <div class="section-head">
              <h2>${escapeHtml(c.label)}</h2>
              <a href="#${c.id}">Tutte (${list.length}) →</a>
            </div>
            <div class="grid">${list.slice(0, PER_SECTION).map((it) => card(it, false)).join('')}</div>
          </section>`;
      })
      .join('');
  }

  function renderSources() {
    const sources = state.data.sources;
    const visible = sources.filter((s) => !state.hiddenSources.has(s)).length;
    $('sources-count').textContent = `(${visible}/${sources.length})`;
    $('sources').innerHTML = sources
      .map((s) => `<button class="chip" type="button" data-source="${escapeHtml(s)}" aria-pressed="${!state.hiddenSources.has(s)}">${escapeHtml(s)}</button>`)
      .join('');
  }

  // ---------- Anteprima della notizia ----------
  const reader = $('reader');
  let readerList = [];  // card della stessa sezione, per scorrere con ‹ ›
  let readerIndex = 0;

  function itemByLink(link) {
    return state.data.items.find((it) => it.link === link);
  }

  function showInReader(index) {
    const it = itemByLink(readerList[index]?.getAttribute('href'));
    if (!it) return;
    readerIndex = index;
    const cat = state.data.categories.find((c) => c.id === it.category);

    reader.dataset.cat = it.category;
    const img = $('reader-img');
    img.hidden = !it.image;
    if (it.image) img.src = it.image;
    else img.removeAttribute('src');

    $('reader-meta').innerHTML = `
      <span class="source">${escapeHtml(it.source)}</span>
      ${cat ? `<span class="cat">${escapeHtml(cat.label)}</span>` : ''}
      ${it.date ? `<time datetime="${it.date}">${new Date(it.date).toLocaleString('it-IT', { dateStyle: 'full', timeStyle: 'short' })}</time>` : ''}`;
    $('reader-title').textContent = it.title;
    $('reader-desc').textContent = it.description;
    const link = $('reader-link');
    link.href = it.link;
    link.textContent = `Leggi l'articolo completo su ${it.source} ↗`;

    $('reader-pos').textContent = readerList.length > 1 ? `${index + 1} di ${readerList.length}` : '';
    reader.querySelector('[data-nav="-1"]').disabled = index === 0;
    reader.querySelector('[data-nav="1"]').disabled = index === readerList.length - 1;
    reader.scrollTop = 0;
  }

  $('reader-img').addEventListener('error', (e) => (e.target.hidden = true));
  $('reader-close').addEventListener('click', () => reader.close());
  reader.addEventListener('click', (e) => {
    if (e.target === reader) reader.close(); // clic sullo sfondo
    const nav = e.target.closest('[data-nav]');
    if (nav && !nav.disabled) showInReader(readerIndex + Number(nav.dataset.nav));
  });
  reader.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' && readerIndex > 0) showInReader(readerIndex - 1);
    if (e.key === 'ArrowRight' && readerIndex < readerList.length - 1) showInReader(readerIndex + 1);
  });

  $('content').addEventListener('click', (e) => {
    const cardEl = e.target.closest('.card');
    // Ctrl/Cmd/Shift+clic o clic centrale aprono comunque il sito originale in una nuova scheda
    if (!cardEl || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    readerList = [...cardEl.closest('.grid').querySelectorAll('.card')];
    showInReader(readerList.indexOf(cardEl));
    if (!reader.open) reader.showModal();
    $('reader-close').focus();
  });

  // ---------- Eventi ----------
  $('sources').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-source]');
    if (!btn) return;
    const s = btn.dataset.source;
    state.hiddenSources.has(s) ? state.hiddenSources.delete(s) : state.hiddenSources.add(s);
    try { localStorage.setItem('hiddenSources', JSON.stringify([...state.hiddenSources])); } catch { /* ignora */ }
    renderSources();
    render();
  });

  let searchTimer;
  $('search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = e.target.value;
      state.limit = PAGE_SIZE;
      render();
    }, 150);
  });

  window.addEventListener('hashchange', () => {
    state.limit = PAGE_SIZE;
    render();
    window.scrollTo({ top: 0 });
  });

  $('refresh').addEventListener('click', () => load(true));
  setInterval(() => load(), AUTO_REFRESH_MS);

  load();
})();
