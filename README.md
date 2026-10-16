# AnimeYT para Kino

Plugin (apiVersion 6) para https://animeyt.cc — anime, donghua y películas sub español.

## Estado: BASE sin probar en la app
Hecho a partir de análisis del sitio sin poder ejecutar red desde el entorno de desarrollo.
`node test/smoke-test.mjs` valida la lógica con HTML simulado, **no** los selectores reales.

## Qué hace
- `home`: En emisión (hero), Resubidos, Últimos episodios, Explorar, Películas.
- `browse`: paginación `/tv/page/N/` (+ `?tipo=ova|ona|especial|musical`), `categories`.
- `search`: prueba en paralelo parámetros del buscador (`q`, `buscar`, `search`, `busqueda`, `s`),
  valida que filtren y guarda el que funcione. Respaldo: índice local de `/tv/page/N/` (se completa en
  varias búsquedas). Si descubrís el parámetro real, ponelo en `SEARCH_PARAM_HINT`.
- `episodes`: cada temporada es una ficha `/tv/` propia → se exponen como `seasons` (sección "Saga").
  Se omiten episodios decimales (13.5, recaps) porque `number` es entero.
- `resolve`: episodio → iframe `mytsumi.com/container.php?id=…` → lee el contenedor (HTML, scripts,
  endpoints) → resolutor directo (OK.ru implementado) → genérico (m3u8/mp4, packer) →
  **último recurso** `kino.browser.capture`. Otros servidores quedan como alternativas ("Servidor").
- Series 18+ (géneros hentai/erótica) se marcan `adult`.

## Qué falta confirmar en la app (mirá `logcat` → KinoPlugin/animeyt, `debug: true`)
1. Búsqueda: línea `search param X`. Si no aparece, usa el índice local.
2. Resolve: el contenedor de mytsumi carga los servidores (Byse, Alpha, MEGA, OK, Epsilon, Abyss) por JS.
   Los logs `container html`, `endpoints` y `endpoint resp` muestran qué encontró. Con la URL real del
   endpoint se agrega al flujo en `containerSources()`.
3. Hosts: el `url` de un Stream debe estar en `hosts` de `kino-plugin.json`. Si el log dice `ok <host>`
   pero no reproduce, agregá el dominio del CDN (y `*.dominio`).
4. Byse/Alpha/Epsilon/Abyss necesitan resolutor propio (agregar en `resolveEmbed`). MEGA no es reproducible.
5. Episodios en "bloques de 50": si series largas muestran solo 50, falta el parámetro de bloque.

Antes de publicar: quitar `"debug": true`.

## Instalar
Copiá estos archivos a un repo generado desde `kinotvapp/kino-plugin-archive` (o sobre el de DonghuaLife,
reemplazando `plugin.js`, `kino-plugin.json`, `icon.png`), y en Kino: Ajustes → Plugins → `usuario/repo`.
Validar: `node sdk/validate.mjs .` y `node sdk/run.mjs ./plugin.js home`.
