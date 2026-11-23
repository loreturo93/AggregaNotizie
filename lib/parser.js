// Parser RSS 2.0 / Atom minimale, senza dipendenze.
// Non è un parser XML completo: estrae solo i campi che servono a un aggregatore.

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  agrave: 'à', aacute: 'á', egrave: 'è', eacute: 'é', igrave: 'ì', iacute: 'í',
  ograve: 'ò', oacute: 'ó', ugrave: 'ù', uacute: 'ú', ccedil: 'ç', ntilde: 'ñ',
  auml: 'ä', ouml: 'ö', uuml: 'ü', szlig: 'ß', euro: '€', deg: '°', copy: '©', reg: '®',
  laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  ndash: '–', mdash: '—', hellip: '…', middot: '·', bull: '•',
};
// Le maiuscole accentate (Egrave, Agrave, …) si ottengono dalle minuscole.
const entityValue = (name) => ENTITIES[name] ?? (/^[A-Z][a-z]+$/.test(name) ? ENTITIES[name.toLowerCase()]?.toUpperCase() : undefined);

function decodeEntities(str) {
  return str.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return entityValue(code) ?? m;
  });
}

function unwrapCdata(str) {
  return str.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

function stripHtml(str) {
  return str
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Contenuto testuale del primo tag `name` (supporta namespace es. "dc:date").
function tagText(xml, name) {
  const re = new RegExp(`<${escapeRe(name)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapeRe(name)}>`, 'i');
  const m = xml.match(re);
  return m ? unwrapCdata(m[1]).trim() : '';
}

// Valore di un attributo del primo tag `name` che soddisfa `filter`.
function tagAttr(xml, name, attr, filter = () => true) {
  const re = new RegExp(`<${escapeRe(name)}\\b([^>]*)/?>`, 'gi');
  let m;
  while ((m = re.exec(xml))) {
    const attrs = m[1];
    if (!filter(attrs)) continue;
    const a = attrs.match(new RegExp(`\\b${escapeRe(attr)}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
    if (a) return decodeEntities(a[2] ?? a[3]);
  }
  return '';
}

function clean(text) {
  return decodeEntities(stripHtml(decodeEntities(text)));
}

function parseDate(str) {
  if (!str) return null;
  const d = new Date(str.trim());
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function findImage(block, rawDescription) {
  const isImage = (attrs) => !/type\s*=\s*["'](?!image)/i.test(attrs) || /type\s*=\s*["']image/i.test(attrs);
  return (
    tagAttr(block, 'media:content', 'url', isImage) ||
    tagAttr(block, 'media:thumbnail', 'url') ||
    tagAttr(block, 'enclosure', 'url', isImage) ||
    (decodeEntities(unwrapCdata(rawDescription)).match(/<img[^>]+src\s*=\s*["']([^"']+)["']/i) || [])[1] ||
    ''
  );
}

function parseItem(block) {
  const rawDescription =
    tagText(block, 'description') || tagText(block, 'summary') || tagText(block, 'content:encoded') || tagText(block, 'content');

  let link = tagText(block, 'link');
  if (!link) {
    link =
      tagAttr(block, 'link', 'href', (a) => !/rel\s*=/i.test(a) || /rel\s*=\s*["']alternate["']/i.test(a)) ||
      tagAttr(block, 'link', 'href');
  }
  if (!link) {
    const guid = tagText(block, 'guid');
    if (/^https?:\/\//.test(guid)) link = guid;
  }

  return {
    title: clean(tagText(block, 'title')),
    link: decodeEntities(link).trim(),
    description: clean(rawDescription).slice(0, 400),
    date: parseDate(tagText(block, 'pubDate') || tagText(block, 'published') || tagText(block, 'updated') || tagText(block, 'dc:date')),
    image: findImage(block, rawDescription),
    feedCategories: [...block.matchAll(/<category\b([^>]*)>([\s\S]*?)<\/category>/gi)]
      .map((m) => clean(unwrapCdata(m[2])))
      .concat([...block.matchAll(/<category\b[^>]*\bterm\s*=\s*["']([^"']+)["']/gi)].map((m) => decodeEntities(m[1])))
      .filter(Boolean),
  };
}

function parseFeed(xml) {
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  return blocks.map(parseItem).filter((it) => it.title && it.link);
}

// Decodifica i byte rispettando l'encoding dichiarato (alcuni feed sono ISO-8859-1).
function decodeXml(buffer, contentType = '') {
  const head = Buffer.from(buffer.slice(0, 200)).toString('latin1');
  const declared = (head.match(/encoding\s*=\s*["']([\w-]+)["']/i) || [])[1] || (contentType.match(/charset=([\w-]+)/i) || [])[1] || 'utf-8';
  try {
    return new TextDecoder(declared.toLowerCase()).decode(buffer);
  } catch {
    return new TextDecoder('utf-8').decode(buffer);
  }
}

module.exports = { parseFeed, decodeXml, decodeEntities, stripHtml };
