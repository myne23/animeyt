/// <reference path="./kino.d.ts" />
// AnimeYT para Kino (apiVersion 6). Parseo por regex sobre anclas: no depende de clases CSS.
// Catálogo/episodios: HTML del sitio (WordPress, tema "aniyt").
// Reproducción: iframe mytsumi.com/container.php -> servidores -> resolutores directos;
// kino.browser.capture solo como último recurso.

const BASE = "https://animeyt.cc";
const UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
const TAG = "[animeyt]";
// Si descubrís el parámetro real del buscador de /tv/, ponelo acá (ej. "q") y se usa primero.
const SEARCH_PARAM_HINT = "";

const log = (...a) => { try { kino.log(TAG, ...a); } catch (e) {} };

// ---------- utilidades ----------
const ENT = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", hellip: "…", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”" };
function dec(s) {
  return String(s == null ? "" : s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => (ENT[n.toLowerCase()] !== undefined ? ENT[n.toLowerCase()] : m));
}
const clean = (s) => dec(String(s || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
const absUrl = (u, base) => { try { return new URL(dec(u), base || BASE + "/").toString(); } catch (e) { return ""; } };
const pathOf = (u) => { try { const x = new URL(u, BASE + "/"); return x.pathname + x.search; } catch (e) { return ""; } };

function itemId(slug) {
  let id = String(slug).replace(/[^A-Za-z0-9._~-]/g, "-");
  if (id.length > 120) {
    let h = 0;
    for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
    id = id.slice(0, 100) + "-" + h.toString(36);
  }
  return id;
}

async function get(pathOrUrl, opts) {
  opts = opts || {};
  const url = absUrl(pathOrUrl);
  const r = await kino.fetch(url, {
    headers: Object.assign({ "User-Agent": UA, "Accept-Language": "es-ES,es;q=0.9", Referer: BASE + "/" }, opts.headers || {}),
    timeoutMs: opts.timeoutMs || 10000,
  });
  if (!r.ok) {
    const c = r.status === 404 ? "not_found" : r.status === 429 ? "rate_limited" : r.status === 403 ? "geo_blocked" : "unavailable";
    throw kino.error(c, "HTTP " + r.status + " " + url);
  }
  return r.text();
}

// ---------- parseo de tarjetas ----------
const ANCHOR = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
const attr = (tag, name) => { const m = new RegExp("\\b" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')", "i").exec(tag); return m ? dec(m[1] != null ? m[1] : m[2]) : ""; };

function firstImg(inner) {
  const re = /<img\b[^>]*>/gi; let m;
  while ((m = re.exec(inner))) {
    for (const n of ["data-src", "data-lazy-src", "data-original", "src"]) {
      const v = attr(m[0], n);
      if (v && !/^data:/i.test(v)) return absUrl(v);
    }
  }
  return "";
}
function imgAlt(inner) { const m = /<img\b[^>]*>/i.exec(inner); return m ? clean(attr(m[0], "alt")) : ""; }

function posterOf(u) { return u ? u.replace(/&#038;/g, "&") : undefined; }

function badgesOf(text) {
  const out = [];
  for (const b of ["Donghua", "Sin Censura", "ONA", "OVA", "Corto", "Blu-ray", "Especial", "Película"]) if (new RegExp("\\b" + b + "\\b", "i").test(text)) out.push(b);
  return out.slice(0, 3);
}

/** Tarjetas /tv/slug/ y /pelicula/slug/ de un fragmento HTML. */
function parseCards(html) {
  const bySlug = new Map();
  // títulos desde encabezados: <h3><a href=..>Título</a></h3>
  const titles = new Map();
  const hre = /<h[1-4][^>]*>\s*<a\b([^>]*)>([\s\S]*?)<\/a>/gi; let hm;
  while ((hm = hre.exec(html))) {
    const t = clean(hm[2]);
    const p = pathOf(attr(hm[1], "href")).split("#")[0];
    if (t && !titles.has(p)) titles.set(p, t);
  }
  let m; ANCHOR.lastIndex = 0;
  while ((m = ANCHOR.exec(html))) {
    const p = pathOf(attr(m[1], "href")).split("#")[0].split("?")[0];
    const mm = /^\/(tv|pelicula)\/([^/]+)\/?$/.exec(p);
    if (!mm || mm[2] === "page") continue;
    const kindPath = mm[1], slug = mm[2];
    const key = kindPath + "/" + slug;
    const it = bySlug.get(key) || { slug, kindPath, path: "/" + kindPath + "/" + slug + "/" };
    const inner = m[2];
    const img = firstImg(inner);
    if (img && !it.poster) it.poster = img;
    const txt = clean(inner);
    if (!it.alt) it.alt = imgAlt(inner);
    if (txt) it.text = (it.text ? it.text + " " : "") + txt;
    bySlug.set(key, it);
  }
  const out = [];
  for (const it of bySlug.values()) {
    if (!it.poster) continue; // sin imagen = enlace de menú/relacionados
    const title = titles.get(it.path) || titles.get(it.path.replace(/\/$/, "")) || it.alt || humanize(it.slug);
    const txt = it.text || "";
    const rm = /★\s*(\d+(?:[.,]\d+)?)/.exec(txt);
    out.push({
      slug: it.slug, kindPath: it.kindPath, path: it.path, title,
      poster: posterOf(it.poster),
      rating: rm ? Math.min(10, parseFloat(rm[1].replace(",", "."))) : undefined,
      badges: badgesOf(txt),
    });
  }
  return out;
}
const humanize = (s) => String(s).replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

let ADULT = null;
async function adultSet() {
  if (ADULT) return ADULT;
  try { const c = kino.storage.get("adult"); if (c) { ADULT = new Set(JSON.parse(c)); return ADULT; } } catch (e) {}
  const s = new Set();
  const pages = await Promise.all(["/genres/hentai/", "/genres/erotica/"].map((p) => get(p, { timeoutMs: 6000 }).catch(() => "")));
  for (const h of pages) for (const c of parseCards(h)) s.add(c.slug);
  ADULT = s;
  try { kino.storage.set("adult", JSON.stringify([...s]), { ttlMs: 86400000 }); } catch (e) {}
  return s;
}

function toItem(c, adult) {
  const movie = c.kindPath === "pelicula";
  const it = {
    id: itemId(c.slug),
    ref: (movie ? "m|" : "s|") + c.path,
    title: c.title,
    kind: movie ? "movie" : "series",
    poster: c.poster,
  };
  if (c.rating) it.rating = c.rating;
  if (c.badges && c.badges.length) it.badges = c.badges;
  if (adult && adult.has(c.slug)) it.adult = true;
  return it;
}
async function toItems(cards) {
  const a = await adultSet().catch(() => new Set());
  return cards.map((c) => toItem(c, a));
}

// ---------- home ----------
function region(html, startRe, endRe) {
  const s = html.search(startRe);
  if (s < 0) return "";
  const rest = html.slice(s);
  const e = endRe ? rest.slice(10).search(endRe) : -1;
  return e < 0 ? rest : rest.slice(0, e + 10);
}

// Extrae una sección por su encabezado real, no por el primer enlace del menú.
// Conserva los h3 de cada tarjeta y termina al llegar al siguiente encabezado de igual
// o mayor nivel (por ejemplo, de "Últimos episodios" a "Programación").
function sectionByHeading(html, label) {
  const re = /<h([1-6])\b[^>]*>[\s\S]*?<\/h\1>/gi;
  const headings = [];
  let m;
  while ((m = re.exec(html))) headings.push({ level: Number(m[1]), start: m.index, end: re.lastIndex, text: clean(m[0]) });
  const normalize = (v) => String(v).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const wanted = normalize(label);
  const heading = headings.find((h) => normalize(h.text).includes(wanted));
  if (!heading) return "";
  const next = headings.find((h) => h.start > heading.start && h.level <= heading.level);
  return html.slice(heading.end, next ? next.start : html.length);
}

function lookBackHeading(html, idx) {
  const win = html.slice(Math.max(0, idx - 2500), idx);
  const hs = win.match(/<h[1-3][^>]*>[\s\S]*?<\/h[1-3]>/gi);
  return hs ? clean(hs[hs.length - 1]) : "";
}

function parseHero(html) {
  const out = []; let m; ANCHOR.lastIndex = 0;
  const seen = new Set();
  while ((m = ANCHOR.exec(html))) {
    if (!/ver ficha/i.test(clean(m[2]))) continue;
    const p = pathOf(attr(m[1], "href")).split("#")[0];
    const mm = /^\/tv\/([^/]+)\/?$/.exec(p);
    if (!mm || seen.has(mm[1])) continue;
    seen.add(mm[1]);
    const win = html.slice(Math.max(0, m.index - 2500), m.index);
    const imgs = win.match(/<img\b[^>]*>/gi) || [];
    let img = "";
    for (let i = imgs.length - 1; i >= 0 && !img; i--) img = firstImg(imgs[i]);
    out.push({ slug: mm[1], kindPath: "tv", path: "/tv/" + mm[1] + "/", title: lookBackHeading(html, m.index) || humanize(mm[1]), poster: posterOf(img) });
  }
  return out;
}

function parseLatest(html) {
  const out = []; const seen = new Set(); let m; ANCHOR.lastIndex = 0;
  const titles = new Map();
  const hre = /<h[1-4][^>]*>\s*<a\b([^>]*)>([\s\S]*?)<\/a>/gi; let hm;
  while ((hm = hre.exec(html))) titles.set(pathOf(attr(hm[1], "href")), clean(hm[2]));
  while ((m = ANCHOR.exec(html))) {
    const p = pathOf(attr(m[1], "href")).split("#")[0];
    const mm = /^\/(\d+)\/anime\/([^/]+)\/?$/.exec(p);
    if (!mm || seen.has(mm[1])) continue;
    const img = firstImg(m[2]);
    if (!img) continue;
    seen.add(mm[1]);
    const label = clean(m[2]).replace(/\s+/g, " ");
    const title = titles.get(p) || humanize(mm[2].replace(/-capitulo-\d+(?:-\d+)?(?:-\d{4})?$/, ""));
    // ID por episodio, no por serie: dos capítulos de la misma serie deben ser tarjetas distintas.
    out.push({
      id: itemId("ep-" + mm[1]), ref: "x|" + p,
      title, kind: "series", poster: posterOf(img), backdrop: posterOf(img),
      badges: badgesOf(label).concat(/(T\d+\s*)?EP\s*[\d.]+/i.test(label) ? [(/(T\d+\s*)?EP\s*[\d.]+/i.exec(label) || [""])[0].trim()] : []).slice(0, 3),
    });
  }
  return out;
}

async function home() {
  const [h, tv, mv] = await Promise.all([
    get("/"), get("/tv/").catch(() => ""), get("/pelicula/").catch(() => ""),
  ]);
  const rows = [];
  const push = (id, title, items, ref, genre, limit) => { if (items && items.length) rows.push({ id, title, items: items.slice(0, limit || 24), ref, genre }); };

  const hero = await toItems(parseHero(h));
  push("hero", "En emisión", hero, undefined, "anime");
  const resub = await toItems(parseCards(sectionByHeading(h, "Resubidos")));
  push("resubidos", "Resubidos", resub, undefined, "anime");
  // La sección de episodios recientes es más larga que las filas de catálogo normales.
  push("latest", "Últimos episodios", parseLatest(sectionByHeading(h, "Últimos episodios")), undefined, "anime", 60);
  push("explore", "Explorar", await toItems(parseCards(tv)), "b|/tv/", "anime");
  push("movies", "Películas", await toItems(parseCards(mv)), "b|/pelicula/", "peliculas");
  if (!rows.length) throw kino.error("unavailable", "Home vacío: revisar selectores");
  return rows;
}

// ---------- browse ----------
function pageUrl(ref, page) {
  const [p, q] = ref.split("?");
  const base = p.replace(/\/page\/\d+\/?$/, "").replace(/\/?$/, "/");
  return (page > 1 ? base + "page/" + page + "/" : base) + (q ? "?" + q : "");
}
async function browse(ref, cursor) {
  const path = String(ref).replace(/^b\|/, "");
  const page = cursor ? parseInt(cursor, 10) || 1 : 1;
  const html = await get(pageUrl(path, page));
  const cards = parseCards(html);
  const hasNext = new RegExp("/page/" + (page + 1) + "/").test(html);
  const res = { items: await toItems(cards) };
  if (hasNext && cards.length) res.next = String(page + 1);
  return res;
}

async function categories() {
  const tiles = [
    { id: "tv", title: "Anime TV", ref: "b|/tv/?tipo=tv" },
    { id: "pelicula", title: "Películas", ref: "b|/pelicula/" },
    { id: "ova", title: "OVA", ref: "b|/tv/?tipo=ova" },
    { id: "ona", title: "ONA", ref: "b|/tv/?tipo=ona" },
    { id: "especial", title: "Especiales", ref: "b|/tv/?tipo=especial" },
    { id: "musical", title: "Musicales", ref: "b|/tv/?tipo=musical" },
  ];
  try {
    const h = await get("/", { timeoutMs: 6000 });
    const m = /<a\b([^>]*href=["'][^"']*\/temporada\/[^"']+["'][^>]*)>([\s\S]*?)<\/a>/i.exec(h);
    if (m) tiles.unshift({ id: "temporada", title: clean(m[2]) || "Temporada actual", ref: "b|" + pathOf(attr(m[1], "href")) });
  } catch (e) {}
  return tiles;
}

// ---------- búsqueda ----------
function dedupeSearchCards(cards) {
  const seen = new Set();
  return cards.filter((c) => {
    const key = c.kindPath + "|" + c.slug;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function labelSeasonDuplicates(cards) {
  const counts = new Map();
  for (const c of cards) {
    const key = clean(c.title).toLocaleLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return cards.map((c) => {
    if ((counts.get(clean(c.title).toLocaleLowerCase()) || 0) < 2) return c;
    const match = /(?:-temporada-(\d+)|-t(\d+))(?:-|$)/i.exec(c.slug);
    if (!match || /temporada\s*\d+/i.test(c.title)) return c;
    const n = Number(match[1] || match[2]);
    return Object.assign({}, c, { title: c.title + " Temporada " + n });
  });
}

async function search(q) {
  const text = String(q.q || "").trim();
  if (!text) return [];
  const enc = encodeURIComponent(text);
  const variants = [text].concat(q.originalTitle ? [q.originalTitle] : [], (q.altTitles || []).slice(0, 2));
  const relevant = (items) => (kino.rank && kino.rank.filterRelevant ? kino.rank.filterRelevant(items, variants) : items);
  const sorted = (items) => (kino.rank && kino.rank.sortBySimilarity ? kino.rank.sortBySimilarity(items, variants) : items);

  // 1) probar parámetros de búsqueda del sitio (en paralelo) y validar que realmente filtran
  let base = [];
  try { base = parseCards(await get("/tv/", { timeoutMs: 6000 })).slice(0, 8).map((c) => c.slug); } catch (e) {}
  let saved = ""; try { saved = kino.storage.get("sk") || ""; } catch (e) {}
  const keys = [...new Set([SEARCH_PARAM_HINT, saved, "q", "buscar", "search", "busqueda", "s"].filter(Boolean))];
  const tries = keys.map((k) => ({ k, url: "/tv/?" + k + "=" + enc })).concat([{ k: "?s", url: "/?s=" + enc }]);
  const results = await Promise.all(tries.map((t) => get(t.url, { timeoutMs: 7000 }).then((h) => ({ t, cards: parseCards(h) })).catch(() => null)));
  for (const r of results) {
    if (!r || !r.cards.length) continue;
    const same = r.cards.slice(0, 8).map((c) => c.slug).join() === base.join();
    if (same) continue;
    const ok = relevant(r.cards.map((c) => ({ title: c.title, c }))).map((x) => x.c);
    if (ok.length) {
      const labeled = labelSeasonDuplicates(dedupeSearchCards(ok));
      try { kino.storage.set("sk", r.t.k); } catch (e) {}
      log("search param", r.t.k, labeled.length);
      return await toItems(sorted(labeled.map((c) => Object.assign({ title: c.title }, c))));
    }
  }

  // 2) respaldo: índice local (slug|título|poster) construido de /tv/page/N/
  const idx = await buildIndex();
  const hits = relevant(idx.map((e) => ({ title: e.title, e }))).map((x) => x.e);
  return await toItems(sorted(hits.slice(0, 40)).map((e) => ({ slug: e.slug, kindPath: "tv", path: "/tv/" + e.slug + "/", title: e.title, poster: e.poster })));
}

async function buildIndex() {
  let idx = [], done = 0;
  try { const c = JSON.parse(kino.storage.get("idx") || "null"); if (c) { idx = c.e.map((r) => ({ slug: r[0], title: r[1], poster: r[2] ? "https://i0.wp.com/animeyt.cc/wp-content/uploads/" + r[2] + "?resize=360%2C510&ssl=1" : undefined })); done = c.done; } } catch (e) {}
  if (done >= 60) return idx;
  const from = done + 1, to = from + 11; // 12 páginas por llamada
  const pages = [];
  for (let p = from; p <= to; p++) pages.push(p);
  const got = await Promise.all(pages.map((p) => get(p === 1 ? "/tv/" : "/tv/page/" + p + "/", { timeoutMs: 8000 }).then((h) => parseCards(h)).catch(() => null)));
  const known = new Set(idx.map((e) => e.slug));
  let reached = done, end = false;
  got.forEach((cards, i) => {
    if (cards === null) return;
    if (!cards.length) { end = true; return; }
    reached = Math.max(reached, pages[i]);
    for (const c of cards) if (c.kindPath === "tv" && !known.has(c.slug)) {
      known.add(c.slug);
      idx.push({ slug: c.slug, title: c.title, poster: c.poster });
    }
  });
  try {
    const compact = idx.map((e) => [e.slug, e.title, ((e.poster || "").split("/wp-content/uploads/")[1] || "").split("?")[0]]);
    kino.storage.set("idx", JSON.stringify({ done: end ? 999 : reached, e: compact }), { ttlMs: 604800000 });
  } catch (e) { log("idx no guardado", String(e)); }
  return idx;
}

// ---------- episodios ----------
function slugOfPath(p) { const m = /\\/(?:tv|pelicula)\\/([^/#?]+)/.exec(p); return m ? m[1] : ""; }

// Parsea las tarjetas de episodios tanto del HTML inicial como del endpoint AJAX.
function parseEpisodeCards(html) {
  const eps = []; const seen = new Set(); let m; ANCHOR.lastIndex = 0;
  const titles = new Map();
  const hre = /<h[1-4][^>]*>\\s*<a\\b([^>]*)>([\\s\\S]*?)<\\/a>/gi; let hm;
  while ((hm = hre.exec(html))) titles.set(pathOf(attr(hm[1], "href")), clean(hm[2]));
  while ((m = ANCHOR.exec(html))) {
    const p = pathOf(attr(m[1], "href")).split("#")[0];
    const mm = /^\\/(\\d+)\\/anime\\/([^/]+)\\/?$/.exec(p);
    if (!mm || seen.has(p)) continue;
    const nm = /capitulo-(\\d+)(?:-(\\d+))?/.exec(mm[2]);
    if (!nm) continue;
    // Mantener la lógica ya existente para episodios .5 y evitar sufijos dobles falsos.
    if (nm[2] && nm[2] !== "5") continue;
    const num = parseInt(nm[1], 10) + (nm[2] === "5" ? 0.5 : 0);
    if (num < 1 || num > 99999) continue;
    seen.add(p);
    const ep = { season: 1, number: num, ref: "e|" + p };
    const t = titles.get(p); if (t) ep.title = t;
    const img = firstImg(m[2]); if (img) ep.still = posterOf(img);
    eps.push(ep);
  }
  return eps;
}

function episodeQuality(ep) {
  return (ep.title ? 2 : 0) + (ep.still ? 1 : 0);
}
function mergeEpisodeLists(...lists) {
  const byNumber = new Map();
  for (const list of lists) for (const ep of list) {
    const old = byNumber.get(ep.number);
    if (!old || episodeQuality(ep) > episodeQuality(old)) byNumber.set(ep.number, ep);
  }
  return [...byNumber.values()].sort((a, b) => a.number - b.number);
}

function episodeBrowserInfo(html) {
  const section = /<section\\b[^>]*data-abismo-episode-browser[^>]*>/i.exec(html);
  if (!section) return null;
  const tag = section[0];
  const animeId = attr(tag, "data-anime-id");
  const blocks = parseInt(attr(tag, "data-blocks"), 10);
  const endpoint = attr(tag, "data-endpoint");
  if (!animeId || !Number.isFinite(blocks) || blocks < 1 || !endpoint) return null;
  return { animeId, blocks: Math.min(blocks, 100), endpoint: absUrl(endpoint) };
}

async function fetchEpisodeBlock(info, block) {
  const url = new URL(info.endpoint);
  url.searchParams.set("anime_id", info.animeId);
  url.searchParams.set("block", String(block));
  url.searchParams.set("order", "ASC");
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const raw = await get(url.toString(), { timeoutMs: 4500 });
      const data = JSON.parse(raw);
      if (typeof data.html !== "string") throw new Error("respuesta sin html para bloque " + block);
      return parseEpisodeCards(data.html);
    } catch (e) {
      lastError = e;
      if (attempt < 2) log("reintento bloque", block, attempt + 1, String((e && e.message) || e));
    }
  }
  log("bloque no disponible", block, String((lastError && lastError.message) || lastError));
  return [];
}

async function episodes(ref) {
  let path = String(ref).replace(/^[a-z]\\|/, "");
  if (/^x\\|/.test(ref) || /^\\/\\d+\\/anime\\//.test(path)) {
    const eh = await get(path);
    const m = /href=["'](?:https?:\\/\\/animeyt\\.cc)?(\\/tv\\/[^"'#?]+\\/?)/i.exec(eh);
    if (!m) throw kino.error("not_found", "No encontré la serie del episodio");
    path = m[1];
  }
  const html = await get(path);
  const slug = slugOfPath(path);
  const initial = parseEpisodeCards(html);
  let eps = initial;

  // Las fichas largas cargan los demás bloques mediante el navegador de episodios Abismo.
  // Si el endpoint falla, conservamos los episodios del HTML inicial.
  const info = episodeBrowserInfo(html);
  if (info && info.blocks > 0) {
    const started = Date.now();
    const all = [];
    for (let from = 0; from < info.blocks && Date.now() - started < 20000; from += 6) {
      const batch = [];
      for (let b = from; b < Math.min(from + 6, info.blocks); b++) batch.push(b);
      const results = await Promise.all(batch.map((b) => fetchEpisodeBlock(info, b)));
      all.push(...results.flat());
    }
    if (all.length) {
      eps = mergeEpisodeLists(initial, all);
      log("episode browser", slug, "bloques", info.blocks, "iniciales", initial.length, "recuperados", all.length, "únicos", eps.length);
    } else {
      log("episode browser sin resultados; uso HTML inicial", slug, initial.length);
    }
  }

  const list = mergeEpisodeLists(eps);
  if (!list.length) throw kino.error("not_found", "Sin episodios publicados");

  const og = (n) => { const r = new RegExp("<meta[^>]+property=[\\\"']og:" + n + "[\\\"'][^>]*content=[\\\"']([^\\\"']*)", "i").exec(html) || new RegExp("<meta[^>]+content=[\\\"']([^\\\"']*)[\\\"'][^>]+property=[\\\"']og:" + n + "[\\\"']", "i").exec(html); return r ? dec(r[1]) : ""; };
  const genres = []; const gre = /\\/genres\\/[^"']+["'][^>]*>([^<]+)</gi; let gm;
  while ((gm = gre.exec(html)) && genres.length < 5) { const g = clean(gm[1]); if (g && !genres.includes(g)) genres.push(g); }
  const series = { title: og("title") || undefined, poster: og("image") || undefined, overview: og("description") || undefined, genres };

  // temporadas: cada una es su propia ficha /tv/ (sección "Saga")
  const base = slug.replace(/-temporada-\\d+.*$/, "");
  const seasons = []; const sseen = new Set();
  const saga = region(html, />\\s*Saga\\s*</i, /Informaci[oó]n|Reparto/i) || html;
  ANCHOR.lastIndex = 0;
  while ((m = ANCHOR.exec(saga))) {
    const p = pathOf(attr(m[1], "href")).split("#")[0];
    const mm = /^\\/tv\\/([^/]+)\\/?$/.exec(p);
    if (!mm || sseen.has(mm[1])) continue;
    const s = mm[1];
    if (s !== base && !s.startsWith(base + "-temporada-")) continue;
    sseen.add(s);
    const tn = /-temporada-(\\d+)/.exec(s);
    const n = tn ? parseInt(tn[1], 10) : 1;
    seasons.push({ id: itemId(s), ref: "s|/tv/" + s + "/", title: "Temporada " + n, number: n, current: s === slug });
  }
  const res = { series, episodes: list };
  if (seasons.length > 1) res.seasons = seasons.sort((a, b) => a.number - b.number);
  return res;
}

// ---------- resolutores ----------
const MEDIA_RE = /https?:\\?\/\\?\/[^\s"'<>\\)]+?\.(?:m3u8|mp4|mpd)(?:\?[^\s"'<>\\)]*)?/gi;
const mimeOf = (u) => (/\.m3u8/i.test(u) ? "application/x-mpegURL" : /\.mpd/i.test(u) ? "application/dash+xml" : "video/mp4");
const unesc = (s) => dec(String(s).replace(/\\\//g, "/").replace(/\\u0026/gi, "&").replace(/\\u002F/gi, "/"));
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return ""; } };
const labelOf = (u) => { const h = hostOf(u); return /ok\.ru/.test(h) ? "OK.ru" : h || "Servidor"; };

function unpackAll(text) {
  const out = [];
  const re = /eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\('([\s\S]*?)',(\d+),(\d+),'([\s\S]*?)'\.split\('\|'\)/g; let m;
  while ((m = re.exec(text))) {
    try {
      const a = parseInt(m[2], 10); let c = parseInt(m[3], 10); const k = m[4].split("|");
      const enc = (n) => (n < a ? "" : enc(Math.floor(n / a))) + ((n = n % a) > 35 ? String.fromCharCode(n + 29) : n.toString(36));
      const d = {}; while (c--) d[enc(c)] = k[c] || enc(c);
      out.push(m[1].replace(/\\'/g, "'").replace(/\b\w+\b/g, (w) => (d[w] !== undefined ? d[w] : w)));
    } catch (e) {}
  }
  return out;
}

function harvest(text) {
  const t = unesc(text);
  const all = t + "\n" + unpackAll(t).join("\n");
  const media = [...new Set((all.match(MEDIA_RE) || []).map((u) => unesc(u)))];
  const urls = [...new Set((all.match(/https?:\/\/[^\s"'<>\\)]+/g) || []).map(unesc))];
  const embeds = urls.filter((u) => !/\.(png|jpe?g|gif|webp|svg|css|js|ico|woff2?|m3u8|mp4|mpd)(\?|$)/i.test(u) &&
    !/(google|gstatic|googletagmanager|facebook|twitter|cloudflare|jquery|fonts\.|wp\.com|animeyt\.cc|w3\.org|schema\.org)/i.test(hostOf(u)) &&
    !/mytsumi\.com\/container\.php/.test(u) && /(embed|\/e\/|\/v\/|player|video|iframe|ok\.ru)/i.test(u));
  return { media, embeds };
}

const OK_RANK = { mobile: 1, lowest: 2, low: 3, sd: 4, hd: 5, full: 6, quad: 7, ultra: 8 };
async function resolveOk(url, referer) {
  const id = (/(?:videoembed|video)\/(\d+)/.exec(url) || [])[1];
  if (!id) throw kino.error("not_found", "ok.ru sin id");
  const r = await kino.fetch("https://ok.ru/videoembed/" + id, { headers: { "User-Agent": UA, Referer: referer || BASE + "/" }, timeoutMs: 9000 });
  const html = r.text();
  if (/vp_video_stub|video-removed|content_removed/i.test(html) && !/data-options/.test(html)) throw kino.error("not_found", "ok.ru video no disponible");
  const m = /data-options="([^"]+)"/.exec(html);
  if (!m) throw kino.error("unavailable", "ok.ru sin data-options");
  const opts = JSON.parse(dec(m[1]));
  let meta = opts.flashvars && opts.flashvars.metadata;
  if (typeof meta === "string") meta = JSON.parse(meta);
  if (!meta) throw kino.error("unavailable", "ok.ru sin metadata");
  const headers = { Referer: "https://ok.ru/", "User-Agent": UA };
  const vids = (meta.videos || []).filter((v) => v.url).sort((a, b) => (OK_RANK[b.name] || 0) - (OK_RANK[a.name] || 0));
  const hls = meta.hlsManifestUrl || meta.hlsMasterPlaylistUrl || meta.ondemandHls;
  const mp4s = vids.map((v) => ({ url: v.url, mime: "video/mp4", headers, label: "OK.ru " + v.name }));
  if (hls) return { url: hls, mime: "application/x-mpegURL", headers, label: "OK.ru HLS", alternatives: mp4s.slice(0, 4) };
  if (mp4s.length) return { url: mp4s[0].url, mime: "video/mp4", headers, label: mp4s[0].label, alternatives: mp4s.slice(1, 4) };
  throw kino.error("unavailable", "ok.ru sin fuentes");
}

async function resolveGeneric(url, referer) {
  const r = await kino.fetch(url, { headers: { "User-Agent": UA, Referer: referer || BASE + "/" }, timeoutMs: 9000 });
  const { media } = harvest(r.text());
  const best = media.find((u) => /\.m3u8/i.test(u)) || media[0];
  if (!best) throw kino.error("unavailable", "sin media en " + hostOf(url));
  return { url: best, mime: mimeOf(best), headers: { Referer: url, "User-Agent": UA }, label: labelOf(url) };
}

async function resolveEmbed(url, referer) {
  if (/(^|\.)ok\.ru$|odnoklassniki/i.test(hostOf(url))) return resolveOk(url, referer);
  if (/mega\.nz|mega\.io/i.test(hostOf(url))) throw kino.error("unavailable", "MEGA no reproducible");
  return resolveGeneric(url, referer);
}

/** Lee el contenedor de mytsumi: busca servidores/endpoints en su HTML/JS. */
async function containerSources(cUrl, referer) {
  const found = { media: [], embeds: [] };
  const merge = (h) => { h.media.forEach((u) => !found.media.includes(u) && found.media.push(u)); h.embeds.forEach((u) => !found.embeds.includes(u) && found.embeds.push(u)); };
  const idm = /[?&]id=([^&]+)/.exec(cUrl); const cid = idm ? idm[1] : "";
  const open = cUrl.replace(/&?only=[^&]*/g, "").replace(/&?lang=[^&]*/g, "").replace(/[?&]open=1/, "") + (cUrl.includes("?") ? "&" : "?") + "open=1";
  let html = "";
  try { html = (await kino.fetch(open.replace("?&", "?"), { headers: { "User-Agent": UA, Referer: referer }, timeoutMs: 9000 })).text(); } catch (e) { log("container fetch", String(e)); }
  merge(harvest(html));
  log("container html", html.length, "media", found.media.length, "embeds", found.embeds.length);

  // scripts externos propios (mytsumi) + endpoints mencionados en el JS
  const scripts = (html.match(/<script[^>]+src=["'][^"']+["']/gi) || []).map((s) => absUrlFrom(attr(s, "src"), open)).filter((u) => /mytsumi/i.test(hostOf(u)));
  let js = html;
  for (const s of scripts.slice(0, 3)) { try { js += "\n" + (await kino.fetch(s, { headers: { "User-Agent": UA, Referer: open }, timeoutMs: 7000 })).text(); } catch (e) {} }
  if (js !== html) merge(harvest(js));

  if (!found.media.length && !found.embeds.length) {
    const eps = new Set();
    const re = /(?:fetch|\.get|\.post|getJSON|open)\(\s*(?:["'](?:GET|POST)["']\s*,\s*)?["'`]([^"'`]+)["'`]|\burl\s*:\s*["'`]([^"'`]+)["'`]/g; let m;
    while ((m = re.exec(js))) { const u = m[1] || m[2]; if (u && !/\.(css|png|jpe?g|svg|ico|woff2?)/i.test(u) && !/^(#|javascript:|data:)/.test(u)) eps.add(u); }
    log("endpoints", [...eps].slice(0, 8).join(" , "));
    const calls = [];
    for (const e of [...eps].slice(0, 6)) {
      const base = absUrlFrom(e.replace(/\{id\}|\$\{[^}]*\}/g, cid), open);
      if (!/mytsumi/i.test(hostOf(base))) continue;
      const withId = /[?&]id=/.test(base) ? base : base + (base.includes("?") ? "&" : "?") + "id=" + cid;
      calls.push(withId);
      for (const n of [1, 2, 3, 4, 5, 6]) calls.push(withId + "&server=" + n);
    }
    const rs = await Promise.all(calls.slice(0, 14).map((u) => kino.fetch(u, { headers: { "User-Agent": UA, Referer: open, "X-Requested-With": "XMLHttpRequest" }, timeoutMs: 7000 }).then((r) => (r.ok ? r.text() : "")).catch(() => "")));
    rs.forEach((t, i) => { if (t) { log("endpoint resp", calls[i], t.length); merge(harvest(t)); } });
  }
  return found;
}
function absUrlFrom(u, base) { try { return new URL(unesc(u), base).toString(); } catch (e) { return ""; } }

function pageEmbeds(html) {
  const out = [];
  const add = (u) => { u = absUrlFrom(u, BASE + "/"); if (u && !/^about:/.test(u) && !out.includes(u)) out.push(u); };
  (unesc(html).match(/https?:\/\/(?:www\.)?mytsumi\.com\/container\.php\?[^\s"'<>\\]+/g) || []).forEach(add);
  const re = /<iframe\b[^>]*>/gi; let m;
  while ((m = re.exec(html))) for (const n of ["src", "data-src", "data-lazy-src"]) { const v = attr(m[0], n); if (v && !/ads|doubleclick/i.test(v)) add(v); }
  (unesc(html).match(/https?:\/\/(?:[a-z0-9-]+\.)?ok\.ru\/videoembed\/\d+/g) || []).forEach(add);
  return out;
}

const T0 = () => Date.now();
async function resolve(ref) {
  const started = T0();
  const left = () => 24000 - (T0() - started);
  ref = String(ref);

  // alternativa perezosa: v|<url del embed>
  if (/^v\|/.test(ref)) {
    const url = ref.slice(2);
    return await resolveEmbed(url, BASE + "/");
  }

  const path = ref.replace(/^[a-z]\|/, "");
  let html = await get(path);
  let embeds = pageEmbeds(html);
  if (!embeds.length) { // película: la ficha puede enlazar a una página de reproducción
    const wm = /href=["'](?:https?:\/\/animeyt\.cc)?(\/\d+\/anime\/[^"'#]+)/i.exec(html);
    if (wm) { html = await get(wm[1]); embeds = pageEmbeds(html); }
  }
  if (!embeds.length) throw kino.error("not_found", "El episodio no tiene reproductor publicado");
  log("embeds", embeds.join(" | "));

  const candidates = []; // { url, kind }
  for (const e of embeds) {
    if (/mytsumi\.com\/container\.php/.test(e)) {
      if (left() < 6000) break;
      const lang = (/[?&]only=([A-Za-z]+)/.exec(e) || [])[1] || "";
      const src = await containerSources(e, absUrlFrom(path, BASE + "/"));
      src.media.forEach((u) => candidates.push({ url: u, media: true, lang }));
      src.embeds.forEach((u) => candidates.push({ url: u, lang }));
      candidates.push({ url: e, container: true, lang });
    } else candidates.push({ url: e });
  }
  const prio = (c) => (c.media ? 0 : /ok\.ru/i.test(c.url) ? 1 : c.container ? 9 : 5);
  candidates.sort((a, b) => prio(a) - prio(b));

  let primary = null; const lazy = [];
  for (const c of candidates) {
    if (c.container) continue;
    if (primary) { lazy.push({ label: labelOf(c.url), ref: "v|" + c.url }); continue; }
    if (left() < 5000) break;
    try {
      primary = c.media ? { url: c.url, mime: mimeOf(c.url), headers: { Referer: "https://mytsumi.com/", "User-Agent": UA }, label: labelOf(c.url) } : await resolveEmbed(c.url, "https://mytsumi.com/");
      log("ok", labelOf(c.url));
    } catch (e) { log("falló", labelOf(c.url), String((e && e.message) || e)); }
  }

  // último recurso: navegador oculto de Kino sobre el contenedor
  if (!primary) {
    const cont = candidates.find((c) => c.container);
    if (cont && left() > 8000) {
      try {
        const cap = await kino.browser.capture(cont.url, { timeoutMs: Math.min(18000, left() - 2000), headers: { Referer: BASE + "/" } });
        const m = cap.media[0];
        if (m) { primary = { url: m.url, mime: m.mime || mimeOf(m.url), headers: m.headers, label: "Navegador" }; log("capture", hostOf(m.url)); }
      } catch (e) { log("capture falló", String((e && e.code) || e)); }
    }
  }
  if (!primary) throw kino.error("unavailable", "No se pudo extraer video", { userMessage: "No pude obtener el video de este episodio todavía." });
  if (lazy.length) primary.alternatives = (primary.alternatives || []).concat(lazy).slice(0, 8);
  return primary;
}

// ---------- exports ES module requeridos por Kino ----------
export { search, home, browse, categories, episodes, resolve };
