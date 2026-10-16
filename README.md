# AnimeYT para Kino

Plugin de Kino (API 6) para https://animeyt.cc — anime, donghua y películas en español.

## Estado

**Base inicial, todavía sin validar contra AnimeYT real ni probar en la app.**

La prueba `node test/smoke-test.mjs` usa HTML simulado: comprueba parte de la lógica, pero no confirma que los selectores, la búsqueda o la reproducción funcionen en el sitio actual.

## Funciones incluidas

- `home`: filas de En emisión, Resubidos, Últimos episodios, Explorar y Películas.
- `browse`: catálogo con paginación y categorías para TV, OVA, ONA y especiales.
- `search`: intenta descubrir el parámetro real de búsqueda y tiene un índice local como alternativa.
- `episodes`: extrae episodios y temporadas enlazadas desde las fichas de serie.
- `resolve`: examina el iframe de `mytsumi.com/container.php`, intenta resolver OK.ru y fuentes multimedia directas y deja la captura del navegador de Kino como último recurso.
- Las fichas detectadas como hentai/eróticas se marcan como contenido para adultos.

## Pendiente de comprobar

1. **Búsqueda real:** confirmar que devuelve resultados relevantes y no el catálogo completo.
2. **Catálogo y episodios:** probar fichas reales, temporadas múltiples y series largas; todavía no se conoce el comportamiento de todas las páginas.
3. **Reproducción:** OK.ru tiene un resolutor dedicado. Byse, Alpha, Epsilon y Abyss todavía necesitan investigación y/o resolutores propios; MEGA no está implementado.
4. **Hosts de vídeo:** si una fuente se resuelve pero Kino la rechaza, revisar el dominio CDN y declararlo en `kino-plugin.json` cuando corresponda.
5. **Validación:** usar el SDK incluido para ejecutar `node sdk/validate.mjs .` y `node sdk/run.mjs ./plugin.js home`, además de `node test/smoke-test.mjs`.
6. **Depuración:** `debug: true` se conserva durante las pruebas para facilitar el diagnóstico; revisarlo antes de una publicación estable.

## Instalación para pruebas

En Kino, agregá `myne23/animeyt@test-animeyt` desde Ajustes → Plugins para instalar esta rama de pruebas. No uses `myne23/animeyt` a secas, porque eso instala la rama principal (`main`).

Este repositorio es independiente. **No copies estos archivos encima de DonghuaLife ni de los demás plugins.** Los cambios experimentales deben probarse en una rama separada antes de llevarlos a `main`.

## Desarrollo

- Manifiesto: `kino-plugin.json`
- Código: `plugin.js`
- Contrato y declaraciones del SDK: `contract.json`, `kino.d.ts`, `sdk/`
- Prueba simulada: `test/smoke-test.mjs`
