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
  for (const b of ["Donghua", "Sin Censura", "Maduro", "Ecchi", "ONA", "OVA", "Corto", "Blu-ray", "Especial", "Película"]) if (new RegExp("\\b" + b + "\\b", "i").test(text)) out.push(b);
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
    // El póster es opcional: algunos títulos (incluidos los de géneros especiales) no lo exponen en el HTML.
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
  try { const c = kino.storage.get("adult2"); if (c) { ADULT = new Set(JSON.parse(c)); return ADULT; } } catch (e) {}
  const s = new Set();
  const pages = await Promise.all(["/genres/hentai/", "/genres/erotica/"].map((p) => get(p, { timeoutMs: 6000 }).catch(() => "")));
  for (const h of pages) for (const c of parseCards(h)) s.add(c.slug);
  ADULT = s;
  try { kino.storage.set("adult2", JSON.stringify([...s]), { ttlMs: 86400000 }); } catch (e) {}
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
  if ((adult && adult.has(c.slug)) || (c.badges || []).some((b) => /^(sin censura|maduro)$/i.test(b))) it.adult = true;
  if ((c.badges || []).some((b) => /^sin censura$/i.test(b)) && !(it.badges || []).some((b) => /^ecchi$/i.test(b))) it.badges = (it.badges || []).concat("Ecchi");
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
    out.push({
      id: itemId("ep-" + mm[1]), ref: "x|" + p,
      title, kind: "series", poster: posterOf(img), backdrop: posterOf(img),
      badges: badgesOf(label).concat(/(T\d+\s*)?EP\s*[\d.]+/i.test(label) ? [(/(T\d+\s*)?EP\s*[\d.]+/i.exec(label) || [""])[0].trim()] : []).slice(0, 3),
    });
  }
  return out;
}

export async function home() {
  const [h, tv, mv] = await Promise.all([
    get("/"), get("/tv/").catch(() => ""), get("/pelicula/").catch(() => ""),
  ]);
  const rows = [];
  const push = (id, title, items, ref, genre, limit) => { if (items && items.length) rows.push({ id, title, items: items.slice(0, limit || 24), ref, genre }); };

  const hero = await toItems(parseHero(h));
  push("hero", "En emisión", hero, undefined, "anime");
  const resub = await toItems(parseCards(sectionByHeading(h, "Resubidos")));
  push("resubidos", "Resubidos", resub, undefined, "anime");
  // Mantener la home rápida: usamos solo los episodios que ya vienen en el HTML inicial.
  const latestHtml = sectionByHeading(h, "Últimos episodios");
  push("latest", "Últimos episodios", parseLatest(latestHtml), undefined, "anime", 30);
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
export async function browse(ref, cursor) {
  const path = String(ref).replace(/^b\|/, "");
  const page = cursor ? parseInt(cursor, 10) || 1 : 1;
  const html = await get(pageUrl(path, page));
  const cards = parseCards(html);
  const hasNext = new RegExp("/page/" + (page + 1) + "/").test(html);
  const res = { items: await toItems(cards) };
  if (hasNext && cards.length) res.next = String(page + 1);
  return res;
}

export async function categories() {
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

export async function search(q) {
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
  try {
    const c = JSON.parse(kino.storage.get("idx3") || "null");
    if (c) {
      idx = c.e.map((r) => ({ slug: r[0], title: r[1], poster: r[2] ? "https://i0.wp.com/animeyt.cc/wp-content/uploads/" + r[2] + "?resize=360%2C510&ssl=1" : undefined }));
      done = c.done;
    }
  } catch (e) {}

  // Siempre complementar el índice, incluso si la paginación general ya terminó.
  // Estas secciones exponen títulos recientes/especiales que no siempre aparecen en /tv/page/N/.
  const known = new Set(idx.map((e) => e.slug));
  const extras = await Promise.all(["/", "/anime/", "/genres/hentai/", "/genres/erotica/"].map((p) =>
    get(p, { timeoutMs: 7000 }).then((h) => parseCards(h)).catch(() => [])
  ));
  for (const cards of extras) for (const c of cards) {
    if (c.kindPath !== "tv" || known.has(c.slug)) continue;
    known.add(c.slug);
    idx.push({ slug: c.slug, title: c.title, poster: c.poster });
  }

  if (done < 60) {
    const from = done + 1, to = from + 11;
    const pages = [];
    for (let p = from; p <= to; p++) pages.push(p);
    const got = await Promise.all(pages.map(async (p) => {
      const url = p === 1 ? "/tv/" : "/tv/page/" + p + "/";
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const html = await get(url, { timeoutMs: 9000 });
          return { page: p, cards: parseCards(html), hasNext: new RegExp("/page/" + (p + 1) + "/").test(html) };
        } catch (e) {}
      }
      return null;
    }));

    let contiguous = done;
    let endReached = false;
    for (let i = 0; i < got.length; i++) {
      const result = got[i];
      if (!result) break;
      contiguous = result.page;
      if (!result.cards.length && !result.hasNext) {
        endReached = true;
        break;
      }
      for (const c of result.cards) if (c.kindPath === "tv" && !known.has(c.slug)) {
        known.add(c.slug);
        idx.push({ slug: c.slug, title: c.title, poster: c.poster });
      }
    }
    done = endReached ? 999 : contiguous;
  }

  try {
    const compact = idx.map((e) => [e.slug, e.title, ((e.poster || "").split("/wp-content/uploads/")[1] || "").split("?")[0]]);
    kino.storage.set("idx3", JSON.stringify({ done, e: compact }), { ttlMs: 604800000 });
  } catch (e) { log("idx no guardado", String(e)); }
  return idx;
}

// ---------- episodios ----------
function slugOfPath(p) { const m = /\/(?:tv|pelicula)\/([^/#?]+)/.exec(p); return m ? m[1] : ""; }

// Parsea las tarjetas de episodios tanto del HTML inicial como del endpoint AJAX.
function parseEpisodeCards(html) {
  const eps = []; const seen = new Set(); let m; ANCHOR.lastIndex = 0;
  const titles = new Map();
  const hre = /<h[1-4][^>]*>\s*<a\b([^>]*)>([\s\S]*?)<\/a>/gi; let hm;
  while ((hm = hre.exec(html))) titles.set(pathOf(attr(hm[1], "href")), clean(hm[2]));
  while ((m = ANCHOR.exec(html))) {
    const p = pathOf(attr(m[1], "href")).split("#")[0];
    const mm = /^\/(\d+)\/anime\/([^/]+)\/?$/.exec(p);
    if (!mm || seen.has(p)) continue;
    const nm = /capitulo-(\d+)(?:-(\d+))?/.exec(mm[2]);
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
  const section = /<section\b[^>]*data-abismo-episode-browser[^>]*>/i.exec(html);
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

export async function episodes(ref) {
  const rawRef = String(ref);
  const blockRef = /^pb\|([^|]+)\|(\d+)$/.exec(rawRef);
  const requestedBlock = blockRef ? parseInt(blockRef[2], 10) : 0;
  let path = blockRef ? blockRef[1] : rawRef.replace(/^[a-z]\|/, "");
  if (/^x\|/.test(ref) || /^\/\d+\/anime\//.test(path)) {
    const eh = await get(path);
    const m = /href=["'](?:https?:\/\/animeyt\.cc)?(\/tv\/[^"'#?]+\/?)/i.exec(eh);
    if (!m) throw kino.error("not_found", "No encontré la serie del episodio");
    path = m[1];
  }
  const html = await get(path);
  const slug = slugOfPath(path);
  const initial = parseEpisodeCards(html);
  let eps = initial;
  const info = episodeBrowserInfo(html);
  const seasonMatch = /-temporada-(\d+)/i.exec(slug);
  const seasonNo = seasonMatch ? parseInt(seasonMatch[1], 10) : 1;
  let blockSelectors = [];

  // Solicita solo el bloque elegido: 50 episodios por vista.
  if (info && info.blocks > 1) {
    const blockIndex = Math.min(Math.max(0, requestedBlock), info.blocks - 1);
    const from = blockIndex * 50 + 1;
    const knownLast = initial.reduce((max, ep) => Math.max(max, ep.number), 0);
    const estimatedTotal = knownLast > (info.blocks - 1) * 50 ? knownLast : info.blocks * 50;
    const to = blockIndex === info.blocks - 1 ? estimatedTotal : (blockIndex + 1) * 50;
    const all = await fetchEpisodeBlock(info, blockIndex);
    if (all.length) {
      eps = all.filter((ep) => ep.number >= from && ep.number <= to);
    } else if (blockIndex === info.blocks - 1) {
      eps = initial.filter((ep) => ep.number >= from && ep.number <= to);
    } else {
      eps = [];
    }
    log("episode browser", slug, "bloque", blockIndex, "rango", from + "-" + to, "recuperados", eps.length);

    for (let b = 0; b < info.blocks; b++) {
      const bFrom = b * 50 + 1;
      const bTo = b === info.blocks - 1 ? estimatedTotal : (b + 1) * 50;
      blockSelectors.push({
        id: itemId(slug + "-episodes-block-" + b),
        ref: "pb|" + path + "|" + b,
        title: "Capítulos " + bFrom + "-" + bTo + " T" + seasonNo,
        // Ordena los bloques en la posición de su temporada (antes de la siguiente temporada real).
        number: seasonNo + (b + 1) / 100,
        current: b === blockIndex,
      });
    }
  }

  const list = mergeEpisodeLists(eps);
  if (!list.length) throw kino.error("not_found", "Sin episodios publicados en este bloque");

  const og = (n) => { const r = new RegExp("<meta[^>]+property=[\"']og:" + n + "[\"'][^>]*content=[\"']([^\"']*)", "i").exec(html) || new RegExp("<meta[^>]+content=[\"']([^\"']*)[\"'][^>]+property=[\"']og:" + n + "[\"']", "i").exec(html); return r ? dec(r[1]) : ""; };
  const genres = []; const gre = /\/genres\/[^"']+["'][^>]*>([^<]+)</gi; let gm;
  while ((gm = gre.exec(html)) && genres.length < 5) { const g = clean(gm[1]); if (g && !genres.includes(g)) genres.push(g); }
  const series = { title: og("title") || undefined, poster: og("image") || undefined, overview: og("description") || undefined, genres };

  const base = slug.replace(/-temporada-\d+.*$/, "");
  const seasons = []; const sseen = new Set(); let m;
  const saga = region(html, />\s*Saga\s*</i, /Informaci[oó]n|Reparto/i) || html;
  ANCHOR.lastIndex = 0;
  while ((m = ANCHOR.exec(saga))) {
    const p = pathOf(attr(m[1], "href")).split("#")[0];
    const mm = /^\/tv\/([^/]+)\/?$/.exec(p);
    if (!mm || sseen.has(mm[1])) continue;
    const s = mm[1];
    if (s !== base && !s.startsWith(base + "-temporada-")) continue;
    sseen.add(s);
    const tn = /-temporada-(\d+)/.exec(s);
    const n = tn ? parseInt(tn[1], 10) : 1;
    seasons.push({ id: itemId(s), ref: "s|/tv/" + s + "/", title: "Temporada " + n, number: n, current: s === slug });
  }
  if (blockSelectors.length) {
    // El selector de la temporada actual se reemplaza por sus bloques para evitar duplicados.
    // Las demás temporadas reales se conservan y los bloques quedan junto a su temporada.
    const currentSeasonRef = "s|/tv/" + slug + "/";
    const otherSeasons = seasons.filter((s) => s.ref !== currentSeasonRef);
    seasons.length = 0;
    seasons.push(...otherSeasons, ...blockSelectors);
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
const safeUrl = (u) => { try { const x = new URL(u); return x.origin + x.pathname; } catch (e) { return String(u).split("?")[0].slice(0, 180); } };
const describeUrls = (urls) => urls.slice(0, 12).map((u) => safeUrl(u)).join(" | ") || "(ninguna)";

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
  // Algunos hostings publican URL que terminan en .mp4 pero responden con HTML de descarga.
  // No son medios directos y provocan parsing_container_unsupported en Kino.
  const media = [...new Set((all.match(MEDIA_RE) || []).map((u) => unesc(u)))].filter((u) => {
    const host = hostOf(u);
    let path = "";
    try { path = new URL(u).pathname; } catch (e) {}
    if (/^mediafire\.com$/i.test(host) && /^\/file\//i.test(path)) return false;
    if (/^fireload\.com$/i.test(host) && /^\/[a-f0-9]{12,}\//i.test(path)) return false;
    return true;
  });
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
  const body = r.text();
  const harvested = harvest(body);
  const media = harvested.media;
  log("resolver inspección", safeUrl(url), "status", r.status, "html", body.length, "media", describeUrls(media), "embeds", describeUrls(harvested.embeds));
  const best = media.find((u) => /\.m3u8/i.test(u)) || media[0];
  if (!best) throw kino.error("unavailable", "sin media en " + hostOf(url));
  log("resolver medio", safeUrl(url), "=>", safeUrl(best), "tipo", mimeOf(best));
  return { url: best, mime: mimeOf(best), headers: { Referer: url, "User-Agent": UA }, label: labelOf(url) };
}

async function resolveWithBrowser(url, referer) {
  const started = T0();
  const host = hostOf(url);
  const timeoutMs = 12000;
  log("navegador inicio", host, safeUrl(url), "timeout_ms", timeoutMs);
  try {
    const cap = await kino.browser.capture(url, {
      timeoutMs,
      headers: { "User-Agent": UA, Referer: referer || BASE + "/" },
    });
    const media = (cap && Array.isArray(cap.media) ? cap.media : [])
      .filter((m) => m && m.url)
      .sort((a, b) => (/\.m3u8/i.test(b.url) ? 1 : 0) - (/\.m3u8/i.test(a.url) ? 1 : 0));
    log("navegador resultado", host, "ms", T0() - started,
      "medios", media.map((m) => safeUrl(m.url) + ":" + (m.mime || mimeOf(m.url))).join(" | ") || "(ninguno)");
    const m = media[0];
    if (!m) throw kino.error("unavailable", "navegador sin media en " + host);
    log("navegador elegido", host, safeUrl(m.url), "tipo", m.mime || mimeOf(m.url), "ms", T0() - started);
    return {
      url: m.url,
      mime: m.mime || mimeOf(m.url),
      headers: Object.assign({ Referer: url, "User-Agent": UA }, m.headers || {}),
      label: labelOf(url) + " (navegador)",
    };
  } catch (e) {
    log("navegador fallido", host, "ms", T0() - started, "error", String((e && e.message) || e));
    throw e;
  }
}


// ---------- Bysekoze / n1mwq encrypted playback API ----------
function b64urlToBytes(value) {
  const s = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = s + "=".repeat((4 - s.length % 4) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
function bytesToB64(bytes) {
  let raw = "";
  for (let i = 0; i < bytes.length; i += 0x8000) raw += String.fromCharCode(...bytes.subarray(i, Math.min(i + 0x8000, bytes.length)));
  return btoa(raw);
}
function b64url(value) {
  return String(value || "").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function byseRotate(x, n) {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}
function byseMix(a) {
  a[0] = (a[0] + a[1]) >>> 0;
  a[3] = byseRotate((a[3] ^ a[0]) >>> 0, 16);
  a[2] = (a[2] + a[3]) >>> 0;
  a[1] = byseRotate((a[1] ^ a[2]) >>> 0, 12);
  a[0] = (a[0] + a[1]) >>> 0;
  a[3] = byseRotate((a[3] ^ a[0]) >>> 0, 8);
  a[2] = (a[2] + a[3]) >>> 0;
  a[1] = byseRotate((a[1] ^ a[2]) >>> 0, 7);
}
// Reutilizar buffers evita crear cientos de miles de arrays durante el PoW.
const BYSE_POW_STATE = new Uint32Array(4);
const BYSE_POW_MEMORY = new Uint32Array(512);
const BYSE_POW_OUT = new Uint32Array(8);
function byseWorkHash(input) {
  const state = BYSE_POW_STATE;
  state[0] = 1779033703;
  state[1] = 3144134277;
  state[2] = 1013904242;
  state[3] = 2773480762;
  const memory = BYSE_POW_MEMORY;
  for (let i = 0; i < input.length; i++) {
    state[0] = byseRotate((state[0] + input.charCodeAt(i)) >>> 0, 7);
    byseMix(state);
  }
  for (let i = 0; i < 8; i++) byseMix(state);
  for (let i = 0; i < 512; i++) {
    byseMix(state);
    memory[i] = (state[0] ^ state[2]) >>> 0;
  }
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < 512; i++) {
      const a = memory[i] & 511;
      let c = (memory[i] + memory[a]) >>> 0;
      c = byseRotate(c, 13);
      c = (c ^ Math.imul(memory[(i + 1) & 511], 2654435761)) >>> 0;
      memory[i] = c;
      state[0] = (state[0] ^ c) >>> 0;
      byseMix(state);
    }
  }
  const out = BYSE_POW_OUT;
  for (let i = 0; i < 8; i++) {
    byseMix(state);
    let v = state[0] >>> 0;
    for (let j = i * 64; j < (i + 1) * 64; j++) {
      const d = memory[j];
      v = (v + d) >>> 0;
      v = byseRotate(v, 5);
      v = (v ^ Math.imul(d, 2246822519)) >>> 0;
    }
    out[i] = (v ^ state[2]) >>> 0;
  }
  return out;
}
function byseLeadingZeroBits(words) {
  let count = 0;
  for (const word of words) {
    if (word === 0) { count += 32; continue; }
    return count + Math.clz32(word);
  }
  return count;
}
async function byseSolvePow(nonce, difficulty) {
  const bits = Number(difficulty);
  if (!Number.isFinite(bits) || bits < 0 || bits > 32) return null;
  if (bits <= 0) return "0";
  const start = Date.now();
  let counter = 0;
  for (; counter < 200000 && Date.now() - start < 14000; counter++) {
    const hash = byseWorkHash(String(nonce) + ":" + counter);
    if (byseLeadingZeroBits(hash) >= bits) {
      log("Bysekoze PoW resuelto", "bits", bits, "intentos", counter + 1, "ms", Date.now() - start);
      return String(counter);
    }
    // Yield menos seguido: dormir cada 32 intentos añadía demasiada sobrecarga.
    if ((counter & 255) === 255) await kino.sleep(0);
  }
  log("Bysekoze PoW agotado", "bits", bits, "intentos", counter, "ms", Date.now() - start);
  return null;
}
function byseFingerprint(tokenData) {
  return { token: tokenData.token, viewer_id: tokenData.viewer_id, device_id: tokenData.device_id, confidence: tokenData.confidence };
}
async function resolveBysekoze(embed, site, label, headers) {
  const inputUrl = new URL(embed);
  const code = (inputUrl.pathname.match(/\/(?:e|embed|sovm9|boh)\/([a-z0-9_-]+)/i) || [])[1];
  if (!code) return null;
  // Follow the site's redirect first: Bysekoze commonly forwards to its rotating n1mwq.org origin.
  const byseHeaders = { ...headers, "User-Agent": "Mozilla/5.0 (Linux; Android 6.0.1; SM-G5510 Build/MMB29M) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/59.0.3071.125 Mobile Safari/537.36 SamsungBrowser/7.2" };
  let pageResponse;
  try { pageResponse = await kino.fetch(embed, { headers: byseHeaders, timeoutMs: 9000 }); } catch { return null; }
  if (!pageResponse.ok) return null;
  let origin = inputUrl.origin;
  try { origin = new URL(pageResponse.url || embed).origin; } catch {}
  const pageUrl = pageResponse.url || embed;
  const pageHeaders = {
    ...byseHeaders,
    Origin: origin,
    Referer: pageUrl,
    "X-Embed-Origin": new URL(site.base).origin,
    "X-Embed-Referer": site.base + "/",
    "X-Embed-Parent": embed
  };
  // If the redirect ends on the main site, use its embed API paths and keep the response's cookies.
  const embedMode = /\/(?:e|embed|sovm9|boh)\//i.test(new URL(pageUrl).pathname);
  const prefix = "/api/videos/" + code + (embedMode ? "/embed" : "");
  const getJson = async (path, opts) => {
    const r = await kino.fetch(origin + path, { headers: pageHeaders, timeoutMs: 12000, ...(opts || {}) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  };
  try {
    const settings = await getJson(prefix + "/settings");
    let fingerprint = null;
    let captchaToken = "";
    if (settings && settings.captcha_required) {
      const challenge = await getJson("/api/videos/access/challenge", { method: "POST", body: { json: {} }, timeoutMs: 15000 });
      if (!challenge || !challenge.nonce || !challenge.challenge_id) throw new Error("challenge incompleto");
      const pair = kino.crypto.generateKeyPair({ type: "ec", namedCurve: "P-256" });
      const signature = b64url(kino.crypto.sign({ key: pair.privateKey, data: challenge.nonce, hash: "SHA-256", format: "ieee-p1363", outputEncoding: "base64" }));
      const rand = () => Number.parseInt(kino.crypto.randomBytes(4, "hex"), 16) / 0xffffffff;
      const fingerprintHash = (n) => {
        const hex = kino.crypto.hash("sha256", String(n), { outputEncoding: "hex" });
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
        return b64url(bytesToB64(bytes));
      };
      const r = rand();
      const client = {
        user_agent: byseHeaders["User-Agent"],
        architecture: "arm", bitness: "32", platform: "Android", platform_version: "6.0.1",
        model: "SM-G5510", ua_full_version: "59.0.3071.125",
        brand_full_versions: [{ brand: "SamsungBrowser", version: "7.2" }],
        pixel_ratio: 1, screen_width: 1280, screen_height: 720, color_depth: 24,
        languages: ["en-US"], timezone: "America/New_York", hardware_concurrency: 4,
        device_memory: 2, touch_points: 1,
        canvas_hash: fingerprintHash(r), audio_hash: fingerprintHash(r + 1),
        fonts_hash: fingerprintHash(r + 3), codecs_hash: fingerprintHash(r + 4),
        media_devices: "ai1ao1vi4", pointer_type: "coarse",
        extra: { vendor: "Samsung", appVersion: "7.2" }
      };
      const attest = await getJson("/api/videos/access/attest", {
        method: "POST",
        body: { json: {
          viewer_id: "", device_id: "", challenge_id: challenge.challenge_id, nonce: challenge.nonce,
          signature, public_key: { ...pair.publicKey.jwk, ext: true, key_ops: ["verify"] },
          client, storage: {}, attributes: { entropy: "high" }
        } },
        timeoutMs: 20000
      });
      if (!attest || !attest.token || !attest.viewer_id || !attest.device_id) throw new Error("atestación incompleta");
      fingerprint = byseFingerprint(attest);
      const captcha = await getJson(prefix + "/captcha", { method: "POST", body: { json: { fingerprint } }, timeoutMs: 15000 });
      if (!captcha || !captcha.pow_nonce || !captcha.pow_token) throw new Error("desafío PoW incompleto");
      const solution = await byseSolvePow(captcha.pow_nonce, captcha.pow_difficulty);
      if (solution == null) throw new Error("PoW agotó el tiempo");
      const verified = await getJson(prefix + "/captcha/verify", {
        method: "POST", body: { json: { pow_token: captcha.pow_token, solution, fingerprint } }, timeoutMs: 15000
      });
      captchaToken = String((verified && verified.token) || "");
      if (!captchaToken) throw new Error("verificación CAPTCHA sin token");
    }
    const playback = await getJson(prefix + "/playback", {
      method: "POST",
      headers: { ...pageHeaders, ...(captchaToken ? { "X-Captcha-Token": captchaToken } : {}) },
      body: { json: settings && settings.captcha_required ? { fingerprint } : {} },
      timeoutMs: 20000
    });
    let sources = Array.isArray(playback.sources) ? playback.sources : null;
    if (!sources && playback.playback && Array.isArray(playback.playback.key_parts)) {
      const pd = playback.playback;
      let parts = pd.key_parts;
      const version = Number(pd.version);
      if (version && version >= 1 && version <= parts.length) parts = [parts[version - 1], parts[parts.length - version]];
      const keyBytes = parts.map(b64urlToBytes);
      const keyLength = keyBytes.reduce((sum, b) => sum + b.length, 0);
      const key = new Uint8Array(keyLength);
      let offset = 0;
      for (const bytes of keyBytes) { key.set(bytes, offset); offset += bytes.length; }
      const decrypted = kino.crypto.decrypt("aes-256-gcm", {
        key: bytesToB64(key), keyEncoding: "base64",
        iv: bytesToB64(b64urlToBytes(pd.iv)), ivEncoding: "base64",
        data: bytesToB64(b64urlToBytes(pd.payload)), inputEncoding: "base64", outputEncoding: "utf8"
      });
      const parsed = JSON.parse(decrypted);
      sources = Array.isArray(parsed.sources) ? parsed.sources : [];
    }
    if (!sources || !sources.length) throw new Error("el playback no devolvió fuentes");
    const candidates = sources.map((x) => ({
      label: String(x.label || x.name || "Bysekoze"),
      url: String(x.url || "")
    })).filter((x) => x.url);
    candidates.sort((a, b) => {
      const quality = (s) => Number((/(\d{3,4})\s*[pP]?/.exec(s) || [])[1]) || 0;
      return quality(b.label) - quality(a.label);
    });
    const chosen = candidates.find((x) => /^https?:\/\//i.test(x.url)) || candidates[0];
    if (!chosen) throw new Error("fuentes sin URL");
    const streamUrl = new URL(chosen.url, origin + "/").href;
    let streamHost = "host desconocido";
    let streamPath = "/";
    try {
      const u = new URL(streamUrl);
      streamHost = u.hostname;
      streamPath = u.pathname.slice(0, 90);
    } catch {}
    log("servidor " + label + ": Bysekoze entregó " + chosen.label.slice(0, 24) + " (" + streamHost + streamPath + ")");
    // Playback URLs can be bound to the embed origin and browser fingerprint.
    // Pass the same browser identity and embed referer to the player for the
    // manifest and every child playlist/segment request.
    const streamHeaders = {
      "User-Agent": byseHeaders["User-Agent"],
      Referer: pageUrl,
      Origin: origin,
      "X-Embed-Origin": new URL(site.base).origin,
      "X-Embed-Referer": site.base + "/",
      "X-Embed-Parent": embed
    };
    return {
      url: streamUrl,
      label: ("Bysekoze · " + chosen.label + " · " + site.name).slice(0, 48),
      headers: streamHeaders,
      mime: /\.m3u8(?:$|[?#])/i.test(streamUrl) ? "application/x-mpegURL" : /\.mpd(?:$|[?#])/i.test(streamUrl) ? "application/dash+xml" : "video/mp4",
      expiresInSeconds: 300
    };
  } catch (e) {
    const message = String(e && e.message || e);
    log("servidor " + label + ": Bysekoze HTTP no completó la resolución (" + message.slice(0, 80) + ")");
    // When PoW itself times out, opening the same player in the browser has
    // already proved unproductive and adds another full 20-second wait.
    if (/PoW agotó el tiempo/i.test(message)) return { skipBrowser: true, reason: "PoW agotó el tiempo" };
    return null;
  }
}

function abyssExternal(embed, referer) {
  let parsed;
  try { parsed = new URL(embed); } catch { throw kino.error("not_found", "Referencia de Abyss inválida"); }
  if (parsed.protocol !== "https:" || parsed.hostname !== "player.abyssplayer.com") {
    throw kino.error("not_found", "El enlace no pertenece a AbyssPlayer");
  }
  const slug = parsed.pathname.split("/").filter(Boolean).pop() || "";
  if (!/^[A-Za-z0-9_-]{4,120}$/.test(slug)) {
    throw kino.error("not_found", "No se encontró el identificador del reproductor Abyss");
  }
  // Pass the exact embed URL: Abyss may use different path prefixes, so the app must not guess /embed/ or /e/.
  const ref = "abyss:" + encodeURIComponent(parsed.href) + ":best:" + encodeURIComponent(String(referer || "https://mytsumi.com/"));
  log("AbyssPlayer: delegando al resolutor externo", slug);
  return { external: { protocol: "abyss", ref } };
}

function abyssLazyRef(embed, referer) {
  return "a|" + encodeURIComponent(embed) + "|" + encodeURIComponent(String(referer || "https://mytsumi.com/"));
}

async function resolveEmbed(url, referer, options) {
  options = options || {};
  const host = hostOf(url);
  // Se preservan los resolutores que ya funcionan: OK.ru directo y archivos directos del contenedor.
  if (/(^|\.)ok\.ru$|odnoklassniki/i.test(host)) return resolveOk(url, referer);
  // Bysekoze/Filemoon: resolver HTTP específico (API, desafío y URL real) antes de la captura genérica.
  if (/bysekoze\.com|bysesukior\.com|n1mwq\.org/i.test(host)) {
    const started = T0();
    const site = { name: "AnimeYT", base: "https://mytsumi.com" };
    const headers = { "User-Agent": UA, Referer: referer || "https://mytsumi.com/" };
    const direct = await resolveBysekoze(url, site, "Bysekoze", headers);
    if (direct && direct.skipBrowser) {
      if (options.allowBrowserOnPow) {
        log("Bysekoze: PoW agotado en selección manual; pruebo captura del navegador");
        return await resolveWithBrowser(url, referer);
      }
      log("Bysekoze: omito navegador tras agotar PoW en resolución automática");
      throw kino.error("unavailable", "Bysekoze agotó el desafío PoW");
    }
    if (direct) {
      log("Bysekoze directo completado ms", T0() - started);
      return direct;
    }
    log("Bysekoze directo sin resultado; pruebo inspección HTML y navegador");
    try { return await resolveGeneric(url, referer); }
    catch (e) { log("Bysekoze HTML sin media; se probará navegador", String((e && e.message) || e)); }
    return resolveWithBrowser(url, referer);
  }
  // AbyssPlayer necesita descifrar la cabecera MP4 fuera del sandbox de Kino.
  if (/^player\\.abyssplayer\\.com$/i.test(host)) return abyssExternal(url, referer);
  return resolveGeneric(url, referer);
}

/** Lee el contenedor de mytsumi: busca servidores/endpoints en su HTML/JS. */
async function containerSources(cUrl, referer) {
  const found = { media: [], embeds: [] };
  const merge = (h) => { h.media.forEach((u) => !found.media.includes(u) && found.media.push(u)); h.embeds.forEach((u) => !found.embeds.includes(u) && found.embeds.push(u)); };
  const idm = /[?&]id=([^&]+)/.exec(cUrl); const cid = idm ? idm[1] : "";
  // Conservar id, idioma y filtros del servidor tal como los usa el navegador real.
  // Solo añadir open=1 si todavía no está presente.
  const open = /[?&]open=1(?:&|$)/.test(cUrl) ? cUrl : cUrl + (cUrl.includes("?") ? "&" : "?") + "open=1";
  log("container URL", "open=1", /[?&]open=1(?:&|$)/.test(open) ? "sí" : "no", "filtros", /[?&]lang=/.test(open) ? "lang presente" : "lang ausente", /[?&]only=/.test(open) ? "only presente" : "only ausente");
  let html = "";
  try { html = (await kino.fetch(open.replace("?&", "?"), { headers: { "User-Agent": UA, Referer: referer }, timeoutMs: 9000 })).text(); } catch (e) { log("container fetch", String(e)); }
  const htmlFound = harvest(html);
  merge(htmlFound);
  const playerFound = harvestMytsumiPlayers(html, open);
  merge(playerFound);
  if (playerFound.media.length || playerFound.embeds.length) {
    log("container botones MyTsumi", "media", describeUrls(playerFound.media), "embeds", describeUrls(playerFound.embeds));
  }
  log("container HTML", safeUrl(open), "chars", html.length, "media", describeUrls(htmlFound.media), "embeds", describeUrls(htmlFound.embeds));

  // Separar enlaces presentes en el HTML de los que solo aparecen en scripts externos.
  const scripts = (html.match(/<script[^>]+src=["'][^"']+["']/gi) || []).map((s) => absUrlFrom(attr(s, "src"), open)).filter((u) => /mytsumi/i.test(hostOf(u)));
  let js = html;
  let externalJs = "";
  for (const scriptUrl of scripts.slice(0, 3)) {
    try { externalJs += "\n" + (await kino.fetch(scriptUrl, { headers: { "User-Agent": UA, Referer: open }, timeoutMs: 7000 })).text(); }
    catch (e) { log("container script error", safeUrl(scriptUrl), String((e && e.message) || e)); }
  }
  if (externalJs) {
    const scriptFound = harvest(externalJs);
    merge(scriptFound);
    log("container scripts", scripts.slice(0, 3).map(safeUrl).join(" | "), "media", describeUrls(scriptFound.media), "embeds", describeUrls(scriptFound.embeds));
    js += externalJs;
  } else log("container scripts", "sin scripts externos propios");

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
    rs.forEach((t, i) => {
      if (t) {
        const endpointFound = harvest(t);
        merge(endpointFound);
        log("endpoint resp", safeUrl(calls[i]), "chars", t.length, "media", describeUrls(endpointFound.media), "embeds", describeUrls(endpointFound.embeds));
      }
    });
  }
  log("container total", "media", found.media.length, describeUrls(found.media), "embeds", found.embeds.length, describeUrls(found.embeds));
  return found;
}
function decodeBase64Url(value) {
  const s = String(value || "").replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "", buffer = 0, bits = 0;
  for (const ch of s) { if (ch === "=") break; const n = alphabet.indexOf(ch); if (n < 0) continue; buffer = (buffer << 6) | n; bits += 6; if (bits >= 8) { bits -= 8; out += String.fromCharCode((buffer >> bits) & 255); } }
  return out;
}
function mytsumiContainerUrl(html, base) {
  const source = unesc(html);
  const m = /(?:const|let|var)\s+azakuEncodedURL\s*=\s*["\']([^"\']+)["\']/i.exec(source);
  if (!m) return "";
  const url = absUrl(decodeBase64Url(m[1]), base);
  try { const x = new URL(url); if (x.hostname.replace(/^www\./i, "").toLowerCase() !== "mytsumi.com" || !/\/multiplayer\/contenedor\.php$/i.test(x.pathname) || !x.searchParams.has("id")) return ""; return x.toString(); } catch (e) { return ""; }
}
function absUrlFrom(u, base) { try { return new URL(unesc(u), base).toString(); } catch (e) { return ""; } }

// MyTsumi publica los servidores del reproductor como botones con data-player-url.
// Extraerlos explícitamente evita depender de que la URL aparezca en un script o texto suelto.
function harvestMytsumiPlayers(html, base) {
  const out = { media: [], embeds: [] };
  const source = unesc(String(html || ""));
  // El contenedor publica los servidores en const videoTabs = [{tab_name,url,is_mp4,...}].
  const tabsMatch = /(?:const|let|var)\s+videoTabs\s*=\s*(\[[\s\S]*?\])\s*;/i.exec(source);
  if (tabsMatch) {
    try { const tabs = JSON.parse(tabsMatch[1]); for (const tab of tabs) { if (!tab || !tab.url) continue; const url = absUrlFrom(tab.url, base); if (!/^https?:\/\//i.test(url)) continue; if (tab.is_mp4 === true || /\.(?:mp4|m3u8|mpd|webm)(?:$|[?#])/i.test(url)) { if (!out.media.includes(url)) out.media.push(url); } else if (!out.embeds.includes(url)) out.embeds.push(url); } log("MyTsumi videoTabs", "pestañas", tabs.length, "media", out.media.length, "embeds", out.embeds.length); }
    catch (e) { log("MyTsumi videoTabs parse falló", String((e && e.message) || e)); }
  }
  const tags = source.match(/<(?:button|a)\b[^>]*>/gi) || [];
  for (const tag of tags) { const raw = attr(tag, "data-player-url"); if (!raw) continue; const url = absUrlFrom(raw, base); if (!/^https?:\/\//i.test(url)) continue; const kind = attr(tag, "data-player-kind").toLowerCase(); if (kind === "video" || /\.(?:mp4|m3u8|mpd|webm)(?:$|[?#])/i.test(url)) { if (!out.media.includes(url)) out.media.push(url); } else if (!out.embeds.includes(url)) out.embeds.push(url); }
  return out;
}
function pageEmbeds(html) {
  const out = [];
  const source = unesc(html);
  const add = (u) => {
    u = absUrlFrom(u, BASE + "/");
    if (!u || /^about:/i.test(u)) return;
    // No filtrar por "ads" en la URL completa: parámetros legítimos como /uploads/ contienen esa secuencia.
    let filterUrl;
    try { filterUrl = new URL(u); } catch (e) { return; }
    const filterHost = filterUrl.hostname.toLowerCase();
    if (/doubleclick|googlesyndication|googleadservices|adservice/i.test(filterHost) ||
        /(?:^|\/)ads?(?:\/|\.|$)/i.test(filterUrl.pathname)) return;
    let x;
    try { x = new URL(u); } catch (e) { return; }
    const h = x.hostname.replace(/^www\./i, "").toLowerCase();
    // MyTsumi puede aparecer como iframe real o como enlace <a> con el texto "iframe".
    if (h === "mytsumi.com" &&
        ((x.pathname === "/container.php" && x.searchParams.has("id")) ||
         x.pathname === "/multiplayer/options.php")) {
      if (!out.includes(u)) out.push(u);
      return;
    }
    // YouTube embeds in these episode pages are trailers/widgets, not the published player.
    if (/^(?:www\.)?(?:youtube\.com|youtube-nocookie\.com|youtu\.be)$/i.test(h)) return;
    if (/^(?:[a-z0-9-]+\.)?ok\.ru$/i.test(h) && /\/videoembed\/\d+/.test(x.pathname)) {
      if (!out.includes(u)) out.push(u);
      return;
    }
    // Mantener la detección de iframes de los demás proveedores.
    if (/\.(?:png|jpe?g|gif|webp|svg|css|js|ico|woff2?)(?:$|\?)/i.test(x.pathname)) return;
    if (/(embed|\/e\/|\/v\/|player|video|iframe)/i.test(x.pathname) && !/animeyt\.cc|i0\.wp\.com/i.test(h)) {
      if (!out.includes(u)) out.push(u);
    }
  };
  const tagRe = /<(?:iframe|a|button|source)\b[^>]*>/gi;
  let m;
  while ((m = tagRe.exec(source))) {
    for (const n of ["src", "data-src", "data-lazy-src", "href", "data-href", "data-url", "data-player-url"]) {
      // Algunos templates sirven el enlace sin comillas; attr() solo cubre atributos quoted.
      const re = new RegExp("\\b" + n + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i");
      const a = re.exec(m[0]);
      const v = a ? dec(a[1] != null ? a[1] : a[2] != null ? a[2] : a[3]) : "";
      if (v) add(v);
    }
  }
  // Respaldo para URLs completas serializadas dentro de scripts o atributos escapados.
  (source.match(/https?:\/\/[^\s"'<>\\]+/g) || []).forEach(add);
  // En películas el anchor puede apuntar a options.php sin iframe convencional.
  const optionsRe = /https?:\\?\/\\?\/(?:www\\?\.)?mytsumi\.com\\?\/multiplayer\\?\/options\.php[^\s"'<>\\]*/gi;
  let om;
  while ((om = optionsRe.exec(source))) add(unesc(om[0]).replace(/\\\//g, "/"));
  return out;
}

const T0 = () => Date.now();
export async function resolve(ref) {
  const started = T0();
  const left = () => 24000 - (T0() - started);
  ref = String(ref);

  // Alternativas de media directa: no hacer fetch del MP4 como HTML (Archive.org puede superar 5 MB).
  if (/^d\|/.test(ref)) {
    const url = ref.slice(2);
    const host = hostOf(url);
    return {
      url,
      mime: mimeOf(url),
      headers: { Referer: "https://mytsumi.com/", "User-Agent": UA },
      label: /(^|\.)archive\.org$/.test(host) ? "Archive.org" : labelOf(url)
    };
  }

  // alternativa perezosa: v|<url del embed>
  if (/^a\|/.test(ref)) {
    const parts = ref.split("|");
    let url = "", sourcePage = "";
    try { url = decodeURIComponent(parts[1] || ""); sourcePage = decodeURIComponent(parts[2] || ""); } catch {}
    return abyssExternal(url, sourcePage || "https://mytsumi.com/");
  }

  if (/^v\|/.test(ref)) {
    const url = ref.slice(2);
    if (/^player\.abyssplayer\.com$/i.test(hostOf(url))) return abyssExternal(url, "https://mytsumi.com/");
    // Como en donghuas-sub-es: si el usuario elige Filemoon manualmente,
    // permitir la captura de navegador incluso cuando el PoW HTTP agota el tiempo.
    return await resolveEmbed(url, BASE + "/", { allowBrowserOnPow: true });
  }

  const path = ref.replace(/^[a-z]\|/, "");
  let html = await get(path);
  let embeds = pageEmbeds(html);
  if (!embeds.length) {
    // Las fichas de películas enlazan a una ruta independiente /<id>/anime/<slug>/.
    // Buscarla tanto en href normales como en atributos/URLs escapadas, porque el
    // HTML que devuelve Kino puede no conservar exactamente la forma del enlace.
    const decoded = unesc(html);
    const playbackPaths = [];
    const addPlaybackPath = (value) => {
      if (!value) return;
      const u = absUrlFrom(value, absUrlFrom(path, BASE + "/"));
      const p = pathOf(u).split("#")[0];
      if (/^\/\d+\/anime\/[^/?#]+\/?$/.test(p) && !playbackPaths.includes(p)) playbackPaths.push(p);
    };
    const attrRe = /\b(?:href|data-href|data-url|data-src)\s*=\s*(["'])(.*?)\1/gi;
    let am;
    while ((am = attrRe.exec(decoded))) addPlaybackPath(am[2]);
    const rawPathRe = /(?:https?:\/\/animeyt\.cc)?(\/\d+\/anime\/[^\s"'<>\\?#]+)/gi;
    let pm;
    while ((pm = rawPathRe.exec(decoded))) addPlaybackPath(pm[1]);
    for (const playbackPath of playbackPaths.slice(0, 5)) {
      try {
        const playbackHtml = await get(playbackPath);
        const found = pageEmbeds(playbackHtml);
        if (found.length) {
          html = playbackHtml;
          embeds = found;
          break;
        }
      } catch (e) {
        log("película enlace no disponible", playbackPath, String((e && e.message) || e));
      }
    }
  }
  if (!embeds.length) {
    log("sin reproductor detectable", safeUrl(absUrlFrom(path, BASE + "/")), "tipo", /\/pelicula\//i.test(path) ? "ficha de película" : "página de episodio");
    throw kino.error("not_found", "El episodio no tiene reproductor publicado");
  }
  log("embeds", embeds.join(" | "));

  const candidates = []; // { url, kind }
  for (const e of embeds) {
    if (/mytsumi\.com\/(?:container\.php|multiplayer\/options\.php)/i.test(e)) {
      if (left() < 6000) break;
      const lang = (/[?&]only=([A-Za-z]+)/.exec(e) || [])[1] || "";
      let sourceUrl = e;
      if (/mytsumi\.com\/multiplayer\/options\.php/i.test(e)) {
        try { const optionsHtml = (await kino.fetch(e, { headers: { "User-Agent": UA, Referer: absUrlFrom(path, BASE + "/") }, timeoutMs: 8000 })).text(); const decodedContainer = mytsumiContainerUrl(optionsHtml, e); if (decodedContainer) { sourceUrl = decodedContainer; log("MyTsumi options puente", safeUrl(e), "=>", safeUrl(sourceUrl)); } else log("MyTsumi options sin azakuEncodedURL", safeUrl(e)); }
        catch (err) { log("MyTsumi options fetch falló", String((err && err.message) || err)); }
      }
      const src = await containerSources(sourceUrl, absUrlFrom(path, BASE + "/"));
      src.media.forEach((u) => candidates.push({ url: u, media: true, origin: "media-del-contenedor", lang }));
      src.embeds.forEach((u) => { if (/mega\.nz|mega\.io/i.test(hostOf(u))) { log("fuente omitida", safeUrl(u), "MEGA no es compatible con Kino"); return; } candidates.push({ url: u, origin: "embed-del-contenedor", lang }); });
      candidates.push({ url: sourceUrl, container: true, origin: "contenedor", lang });
    } else candidates.push({ url: e });
  }
  // Prioridad global: Archive.org primero (media directa), Bysekoze segundo,
  // OK.ru después y el resto de servidores al final. Si una fuente falla, se prueban las siguientes.
  const prio = (c) => {
    const h = hostOf(c.url);
    if (c.container) return 99;
    if (/(^|\.)archive\.org$/.test(h)) return 0;
    if (/bysekoze\.com$|bysesukior\.com$|n1mwq\.org$/.test(h)) return 10;
    if (/(^|\.)ok\.ru$|odnoklassniki/i.test(h)) return 20;
    return 30;
  };
  candidates.sort((a, b) => prio(a) - prio(b));
  log("candidatos de fuente", candidates.map((c, i) => (i + 1) + ":" + (c.origin || "iframe") + ":" + (c.media ? "media" : c.container ? "container" : "embed") + ":" + safeUrl(c.url) + (c.lang ? ":lang=" + c.lang : "")).join(" || ") || "(ninguno)");

  let primary = null; const lazy = [];
  for (const c of candidates) {
    if (c.container) continue;
    if (primary) {
      const h = hostOf(c.url);
      // Prueba: pasar Abyss directamente como alternativa externa, sin una segunda llamada resolve(ref).
      if (/^player\.abyssplayer\.com$/i.test(h)) {
        const delegated = abyssExternal(c.url, "https://mytsumi.com/");
        lazy.push({ label: "AbyssPlayer", external: delegated.external });
        log("AbyssPlayer: alternativa externa directa registrada");
        continue;
      }
      const ref = (c.media ? "d|" : "v|") + c.url;
      lazy.push({ label: c.media ? (/archive\.org/i.test(h) ? "Archive.org" : labelOf(c.url)) : (/bysekoze\.com$|bysesukior\.com$|n1mwq\.org$/.test(h) ? "Bysekoze" : labelOf(c.url)), ref });
      continue;
    }
    if (left() < 5000) break;
    if (/^player\.abyssplayer\.com$/i.test(hostOf(c.url))) return abyssExternal(c.url, "https://mytsumi.com/");
    try {
      primary = c.media ? { url: c.url, mime: mimeOf(c.url), headers: { Referer: "https://mytsumi.com/", "User-Agent": UA }, label: labelOf(c.url) } : await resolveEmbed(c.url, "https://mytsumi.com/");
      log("fuente resuelta", c.origin || "iframe", "embed", safeUrl(c.url), "nombre", labelOf(c.url), "media final", safeUrl(primary.url), "tipo", primary.mime || mimeOf(primary.url));
    } catch (e) { log("fuente fallida", c.origin || "iframe", "embed", safeUrl(c.url), "nombre", labelOf(c.url), "error", String((e && e.message) || e)); }
  }

  // último recurso: navegador oculto de Kino sobre el contenedor
  if (!primary) {
    const cont = candidates.find((c) => c.container);
    if (cont && left() > 8000) {
      try {
        // Mantener los filtros de idioma/servidor originales y añadir open=1,
        // igual que en la navegación real de MyTsumi.
        const captureUrl = cont.url.replace(/[?&]open=1(?:&|$)/, (m) => m.startsWith("?") ? "?" : "");
        const playableContainerUrl = captureUrl + (captureUrl.includes("?") ? "&" : "?") + "open=1";
        log("navegador captura inicio", safeUrl(playableContainerUrl));
        const cap = await kino.browser.capture(playableContainerUrl, {
          timeoutMs: Math.min(18000, left() - 2000),
          headers: { Referer: absUrlFrom(path, BASE + "/") || BASE + "/" }
        });
        const media = cap && Array.isArray(cap.media) ? cap.media : [];
        const m = media[0];
        log("navegador captura", "medios", media.map((x) => safeUrl(x.url) + ":" + (x.mime || mimeOf(x.url))).join(" | ") || "(ninguno)");
        if (m) { primary = { url: m.url, mime: m.mime || mimeOf(m.url), headers: m.headers, label: "Navegador" }; log("navegador elegido", safeUrl(m.url), "tipo", primary.mime); }
      } catch (e) { log("capture falló", String((e && e.code) || e)); }
    }
  }
  if (!primary) throw kino.error("unavailable", "No se pudo extraer video", { userMessage: "No pude obtener el video de este episodio todavía." });
  if (lazy.length) primary.alternatives = (primary.alternatives || []).concat(lazy).slice(0, 8);
  return primary;
}

