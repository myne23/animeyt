# AnimeYT para Kino

Plugin (apiVersion 6) para https://animeyt.cc — anime, donghua y películas sub español.

## Estado: primera corrección de catálogo y búsqueda
La prueba en Kino confirmó que los catálogos principales cargan y que la reproducción funciona con algunas fuentes. Se está corrigiendo por etapas; el test simulado valida lógica, pero no reemplaza la prueba en la app.

## Qué hace
- `home`: En emisión (hero), Resubidos, Últimos episodios, Explorar, Películas. La sección de novedades se extrae desde el encabezado real, evitando confundirla con el enlace del menú; cada episodio usa un ID propio y conserva su miniatura.
- `browse`: paginación `/tv/page/N/` (+ `?tipo=ova|ona|especial|musical`), `categories`.
- `search`: prueba parámetros del buscador (`q`, `buscar`, `search`, `busqueda`, `s`), valida que filtren y guarda el que funcione. Elimina fichas repetidas por slug y distingue temporadas cuando la web devuelve el mismo título para varias fichas. Respaldo: índice local de `/tv/page/N/`.
- `episodes`: cada temporada es una ficha `/tv/` propia → se exponen como `seasons` (sección "Saga").
  Se omiten episodios decimales (13.5, recaps) porque `number` es entero.
- `resolve`: episodio → iframe `mytsumi.com/container.php?id=…` → lee el contenedor (HTML, scripts,
  endpoints) → resolutor directo (OK.ru implementado) → genérico (m3u8/mp4, packer) →
  **último recurso** `kino.browser.capture`. Otros servidores quedan como alternativas ("Servidor").
- Series 18+ (géneros hentai/erótica) se marcan `adult`.

## Integración externa de Abyss (en preparación)

La rama `feature/abyss-external-resolver` delega los embeds de Abyss al protocolo externo de Kino:
`{ external: { protocol: "abyss", ref, resolver: "com.myne23.abyssresolver" } }`.
La aplicación Android acompañante todavía debe construirse, probarse en un dispositivo y publicarse antes de integrar esta rama en `main`. Sin esa app instalada y autorizada, la reproducción de Abyss no funcionará. Las demás fuentes se conservan.

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
En Kino: Ajustes → Plugins → agregá `myne23/animeyt` para instalar la versión de `main`. Este repositorio es independiente: no copies estos archivos encima de DonghuaLife ni de otros plugins.
Validar localmente: `node test/smoke-test.mjs`.
