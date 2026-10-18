// Prueba de humo con respuestas simuladas. Valida lógica y sintaxis, NO el sitio real.
import { readFileSync } from "node:fs";
const card = (slug, t, rt) => `<article><a href="https://animeyt.cc/tv/${slug}/"><img src="" data-src="https://i0.wp.com/animeyt.cc/wp-content/uploads/2026/09/${slug}.jpg?resize=360%2C510&#038;ssl=1" alt="${t}"> ★ ${rt}<span>Donghua</span></a><h3><a href="https://animeyt.cc/tv/${slug}/">${t}</a></h3><p>En emisión · Otoño 2026</p></article>`;
const pages = {
  "https://animeyt.cc/": `<h2>Tensei <span>Temporada 2</span></h2><a href="/tv/tensei-temporada-2/">Ver ficha</a><img src="https://i0.wp.com/x/h.jpg">
   <h2>Resubidos</h2>${card("black-clover","Black Clover","8,0")}<h2>Últimos episodios</h2><section id="ultimos" data-endpoint="/wp-json/aniyt/v1/home/episodes">
   <article data-episode-id="118225"><a href="https://animeyt.cc/118225/anime/tensei-temporada-2-capitulo-3/"><img src="https://i0.wp.com/a.jpg"> T2 EP 3 HOY</a><h3><a href="https://animeyt.cc/118225/anime/tensei-temporada-2-capitulo-3/">Tensei</a></h3></article></section><h2>Programación</h2>
   <a href="/temporada/otono-2026/">Otoño 2026</a>`,
  "https://animeyt.cc/tv/": card("kyoufu","Kyoufu Collector","8,0")+card("x".repeat(250),"Largo","7,0")+`<a href="/tv/page/2/">2</a>`,
  "https://animeyt.cc/tv/?s=Black%20Clover": card("black-clover","Black Clover","9,6")+card("black-clover-temporada-2","Black Clover","9,5"),
  "https://animeyt.cc/pelicula/": card("peli","Una Peli","9,0").replace("/tv/","/pelicula/").replace("/tv/","/pelicula/"),
  "https://animeyt.cc/tv/tensei-temporada-2/": `<meta property="og:title" content="Tensei T2"><meta property="og:image" content="https://x/p.jpg">
   <h2>Saga</h2><a href="/tv/tensei/"><img src="https://i0.wp.com/s.jpg"></a><a href="/tv/tensei-temporada-2/"><img src="https://i0.wp.com/s2.jpg"></a><h2>Información</h2>
   <a href="/118225/anime/tensei-temporada-2-capitulo-3/"><img src="https://i0.wp.com/e3.jpg"></a><h3><a href="/118225/anime/tensei-temporada-2-capitulo-3/">El monstruo</a></h3>
   <a href="/116432/anime/tensei-temporada-2-capitulo-1/"><img src="https://i0.wp.com/e1.jpg"></a><a href="/1/anime/tensei-temporada-2-capitulo-13-5/"><img src="https://i0.wp.com/e.jpg"></a>
   <a href="/genres/accion/">Acción</a>`,
  "https://animeyt.cc/118225/anime/tensei-temporada-2-capitulo-3/": `<a href="https://animeyt.cc/tv/tensei-temporada-2/#episodios">Lista</a><iframe src="about:blank"></iframe><iframe data-src="https://mytsumi.com/container.php?id=abc&#038;only=SUB&#038;lang=SUB"></iframe>`,
  "https://mytsumi.com/container.php?id=abc&open=1": `<div data-embed="https://ok.ru/videoembed/123"></div>`,
  "https://ok.ru/videoembed/123": `<div data-options="${JSON.stringify({flashvars:{metadata:JSON.stringify({hlsManifestUrl:"https://vd1.okcdn.ru/x.m3u8",videos:[{name:"hd",url:"https://vd1.okcdn.ru/h.mp4"},{name:"sd",url:"https://vd1.okcdn.ru/s.mp4"}]})}}).replace(/"/g,"&quot;")}"></div>`,
};

// Simula una ficha larga con 4 bloques remotos (como Black Clover, 170 episodios).
const episodeCards = (from, to) => {
  let html = "";
  for (let n = from; n <= to; n++) {
    const id = 200000 + n;
    const slug = "black-clover-capitulo-" + n;
    html += `<article><a href="/${id}/anime/${slug}/"><img src="data:image/gif;base64,AA==" data-src="https://i0.wp.com/episodes/${n}.jpg"></a><h3><a href="/${id}/anime/${slug}/">Black Clover Capítulo ${n}</a></h3></article>`;
  }
  return html;
};
pages["https://animeyt.cc/tv/black-clover/"] =
  `<meta property="og:title" content="Black Clover"><h2>Saga</h2><a href="/tv/black-clover/"><img src="https://i0.wp.com/s1.jpg"></a><a href="/tv/black-clover-temporada-2/"><img src="https://i0.wp.com/s2.jpg"></a><h2>Información</h2><section data-abismo-episode-browser data-anime-id="86" data-blocks="4" data-endpoint="https://animeyt.cc/wp-json/aniyt/v1/anime-episode-browser">${episodeCards(151,170)}</section>`;
for (const [block, from, to] of [[0,1,50],[1,51,100],[2,101,150],[3,151,170]]) {
  pages[`https://animeyt.cc/wp-json/aniyt/v1/anime-episode-browser?anime_id=86&block=${block}&order=ASC`] =
    JSON.stringify({ html: episodeCards(from,to), count: to-from+1 });
}
const store = {};
let latestEndpointCalls = 0;
const kino = {
  fetch: async (u) => {
    if (u.startsWith("https://animeyt.cc/wp-json/aniyt/v1/home/episodes?")) {
      latestEndpointCalls++;
      const html = `<article data-episode-id="118226"><a href="/118226/anime/tensei-temporada-2-capitulo-2/"><img src="data:image/svg+xml;base64,AA==" data-src="https://i0.wp.com/a2.jpg"> T2 EP 2</a><h3><a href="/118226/anime/tensei-temporada-2-capitulo-2/">Tensei</a></h3></article><article data-episode-id="118227"><a href="/118227/anime/tensei-temporada-2-capitulo-1/"><img data-src="https://i0.wp.com/a1.jpg"> T2 EP 1</a><h3><a href="/118227/anime/tensei-temporada-2-capitulo-1/">Tensei</a></h3></article>`;
      return { ok:true, status:200, url:u, text:()=>JSON.stringify({html,ids:["118226","118227"],has_more:false}) };
    }
    const t = pages[u] ?? pages[u.replace(/\?.*/, "")];
    if (t === undefined) return { ok:false, status:404, text:()=>"" };
    return { ok:true, status:200, url:u, text:()=>t };
  },
  error: (c, m) => Object.assign(new Error(m), { code: c }),
  log: () => {}, storage: { get: k => store[k] ?? null, set: (k, v) => { store[k] = v; } },
  browser: { capture: async (url) => {
    if (/bysesukior\.com|mega\.(?:nz|io)|abyssplayer\.com/i.test(url)) {
      return { media: [{ url: "https://cdn.example.test/captured.m3u8", mime: "application/x-mpegURL", headers: { Referer: url } }] };
    }
    throw Object.assign(new Error("x"), { code: "browser_unavailable" });
  } },
};
// Kino carga plugin.js como módulo ES: inyectamos el mock global antes de importarlo.
globalThis.kino = kino;
const source = readFileSync(new URL("../plugin.js", import.meta.url), "utf8");
const p = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) { console.error("FAIL", m, JSON.stringify(a), "!=", JSON.stringify(b)); process.exit(1); } };

const rows = await p.home();
console.log("rows:", rows.map(r => `${r.id}(${r.items.length})`).join(" "));
eq(rows[0].items[0].title, "Tensei Temporada 2", "hero title");
const tvRow = rows.find(r => r.id === "explore").items;
eq(tvRow[1].id.length <= 128, true, "id largo");
eq(rows.find(r=>r.id==="movies").items[0].kind, "movie", "movie kind");
const latest = rows.find(r => r.id === "latest");
eq(!!latest, true, "latest section present");
eq(latest.items[0].poster, "https://i0.wp.com/a.jpg", "latest episode thumbnail preserved");
eq(latest.items[0].id, "ep-118225", "latest item has unique episode id");
eq(latest.items.length, 1, "latest uses only the initial HTML batch");
eq(latestEndpointCalls, 0, "home does not request extra latest episodes");
const found = await p.search({ q: "Black Clover" });
eq(found.length, 2, "search returns both original and season");
eq(found.find(x => x.ref.includes("black-clover-temporada-2")).title, "Black Clover Temporada 2", "season search title disambiguated");
const cats = await p.categories(); eq(cats[0].ref, "b|/temporada/otono-2026/", "temporada");
const b = await p.browse("b|/tv/", null); eq(b.next, "2", "next page");
const ep = await p.episodes("s|/tv/tensei-temporada-2/");
eq(ep.episodes.map(e => e.number), [1, 3, 13.5], "episodios incluyen .5 y quedan ordenados");
eq(ep.seasons.map(s => s.title), ["Temporada 1", "Temporada 2"], "seasons");
eq(ep.seasons.find(s=>s.current).ref, "s|/tv/tensei-temporada-2/", "season current");
const ep2 = await p.episodes("x|/118225/anime/tensei-temporada-2-capitulo-3/"); eq(ep2.episodes.length, 3, "x| delega a serie e conserva episodios .5");
const long = await p.episodes("s|/tv/black-clover/");
eq(long.episodes.length, 50, "la ficha larga muestra solo el primer bloque de 50");
eq(long.episodes[0].number, 1, "primer bloque empieza en episodio 1");
eq(long.episodes[49].number, 50, "primer bloque termina en episodio 50");
eq(long.episodes[0].still, "https://i0.wp.com/episodes/1.jpg", "miniatura data-src conservada en bloque remoto");
eq(long.seasons.some(s => s.title === "Capítulos 1-50 T1" && s.current), true, "selector identifica bloque actual");
eq(long.seasons.some(s => s.title === "Temporada 1"), false, "la temporada actual no duplica los bloques");
eq(long.seasons.some(s => s.title === "Temporada 2"), true, "se conserva la otra temporada real");
eq(long.seasons.slice(0, 5).map(s => s.title), ["Capítulos 1-50 T1", "Capítulos 51-100 T1", "Capítulos 101-150 T1", "Capítulos 151-170 T1", "Temporada 2"], "los bloques aparecen antes de la siguiente temporada real");
const long2 = await p.episodes("pb|/tv/black-clover/|1");
eq(long2.episodes.length, 50, "segundo bloque tiene 50 episodios");
eq(long2.episodes[0].number, 51, "segundo bloque empieza en episodio 51");
eq(long2.episodes[49].number, 100, "segundo bloque termina en episodio 100");
eq(long2.seasons.some(s => s.title === "Capítulos 51-100 T1" && s.current), true, "selector del segundo bloque queda seleccionado");
const longLast = await p.episodes("pb|/tv/black-clover/|3");
eq(longLast.episodes.length, 20, "último bloque muestra solo los 20 episodios restantes");
eq(longLast.episodes[0].number, 151, "último bloque empieza en episodio 151");
eq(longLast.episodes[19].number, 170, "último bloque termina en episodio 170");
const st = await p.resolve("e|/118225/anime/tensei-temporada-2-capitulo-3/");
eq(st.url, "https://vd1.okcdn.ru/x.m3u8", "resolve ok.ru HLS");
console.log("stream:", st.label, st.mime, "alts:", (st.alternatives||[]).length);
for (const host of ["https://bysesukior.com/e/test", "https://mega.nz/embed/test"]) {
  const captured = await p.resolve("v|" + host);
  eq(captured.url, "https://cdn.example.test/captured.m3u8", "browser capture for " + new URL(host).hostname);
  eq(captured.mime, "application/x-mpegURL", "browser capture MIME for " + new URL(host).hostname);
}
const abyss = await p.resolve("v|https://player.abyssplayer.com/m27Fa0uPI");
eq(abyss.external.protocol, "abyss", "Abyss uses external resolver protocol");
eq(abyss.external.resolver, "com.myne23.abyssresolver", "Abyss names the companion app");
eq(abyss.external.ref, "abyss:https%3A%2F%2Fplayer.abyssplayer.com%2Fm27Fa0uPI:best:https%3A%2F%2Fmytsumi.com%2F", "Abyss ref preserves the exact embed URL, quality and referer");
const abyssMovie = await p.resolve("v|https://abyssplayer.com/7XMhdjzJz");
eq(abyssMovie.external.protocol, "abyss", "Abyss movie apex hostname uses external resolver");
eq(abyssMovie.external.ref, "abyss:https%3A%2F%2Fabyssplayer.com%2F7XMhdjzJz:best:https%3A%2F%2Fmytsumi.com%2F", "Abyss movie ref preserves apex hostname and slug");
console.log("TODO OK");
