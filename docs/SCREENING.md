# Control de partes restringidas y trabajo forzoso

En cada validación, después de las reglas de documentos, DocCheck compara cada parte del envío con las listas públicas de partes denegadas y restringidas, y busca señales de trabajo forzoso (UFLPA). Las listas se descargan al servidor y se consultan desde el disco: la validación funciona sin red y ningún dato de las partes sale del servidor.

## Listas

| Id | Lista | Publica | Archivo |
| --- | --- | --- | --- |
| `ofac-sdn` | Specially Designated Nationals (SDN) | OFAC, Tesoro de EE. UU. | `sdn.csv`, `add.csv`, `alt.csv` |
| `ofac-cons` | Consolidated (non-SDN) | OFAC | `cons_prim.csv`, `cons_add.csv`, `cons_alt.csv` |
| `bis-el`, `bis-dpl`, `bis-uvl`, `bis-meu` | Entity List, Denied Persons, Unverified, Military End-User | BIS, Comercio de EE. UU. | Consolidated Screening List de trade.gov (JSON); se ignoran sus listas de OFAC |
| `ca-sema` | Consolidated Canadian Autonomous Sanctions List | Global Affairs Canada | `sema-lmes.xml` |
| `un-sc` | Consolidated List del Consejo de Seguridad | ONU | `consolidated.xml` |
| `eu-fsf` | Consolidated Financial Sanctions List | Comisión Europea | CSV de FSF |
| `dhs-uflpa` | UFLPA Entity List | DHS (FLETF) | la página dhs.gov/uflpa-entity-list (tablas HTML) |

`npm run screening:fetch` (o **Administración › Listas restringidas › Actualizar listas**) descarga, normaliza y guarda en `data/screening` (`SCREENING_DIR` para otra carpeta):

- `manifest.json`: por lista, fuente, URLs descargadas, fecha de versión (la que trae el archivo o, si no, `Last-Modified`), fecha de descarga, SHA-256 de lo descargado, número de entradas y, si la última actualización falló, el error. Una fuente que falla conserva su versión anterior.
- `lists/<id>.json`: las entradas normalizadas (nombre, alias, tipo, países ISO, direcciones, programas, observaciones, enlace).

Las listas completas pesan unos 20 MB y no se versionan. Los tests usan `packages/screening/fixtures`: unas 50 entradas reales de cada lista y fragmentos de los archivos originales para probar los lectores. `--from <carpeta>` lee archivos ya descargados (`<fuente>-<archivo>`, por ejemplo `eu-fsf-csv`).

## Comparación de nombres

Determinista: las mismas listas y la misma parte dan siempre las mismas coincidencias, en el mismo orden.

1. Normalización de X1 (mayúsculas, acentos, puntuación, forma jurídica) más las formas jurídicas y palabras vacías que imprimen las listas y no las facturas (OOO, FZE, SDN BHD, "of", "the"). "S.A." es una palabra.
2. Cada palabra pesa según lo rara que es entre todas las entradas (IDF): "Huafu" o "Xinjiang" pesan más que "Trading".
3. Cada palabra de un lado busca la más parecida del otro (Jaro-Winkler ≥ 0,88, longitudes parecidas): una errata sigue contando. La puntuación es la media de la cobertura ponderada de ambos lados, así que palabras de más en cualquier lado la bajan. Nombres que solo difieren en espacios valen 1.
4. Se compara con el nombre y con cada alias; cuenta el mejor.
5. País: +0,03 si coincide con la entrada, −0,05 si la entrada solo da otros países. Ciudad: +0,02 si aparece en una dirección de la entrada.
6. Nombres cortos ("ADF") solo coinciden escritos igual. No se compara con buques ni aeronaves.

## Reglas

| Id | Regla | Gravedad |
| --- | --- | --- |
| S1 | La parte está en una lista: puntuación ≥ umbral de coincidencia (0,92) | Alta |
| S2 | Posible coincidencia: entre el umbral de revisión (0,82) y el de coincidencia | Media |
| S3 | Riesgo de trabajo forzoso: parte vinculada a Xinjiang con mercancía de origen China, o líneas de origen China de algodón (cap. 52), confección (61, 62), polisilicio (2804.61) o tomate (0702, 2002) | Media |

Se revisan vendedor y embarcador, comprador, consignatario, exportador, parte a notificar y, en el ISF, fabricante, ship-to y consolidador. Una misma parte impresa en varios documentos es una sola, con toda su evidencia. Hay un finding por parte y por lista (la mejor entrada), con el nombre que coincidió, la puntuación y, como pasaje citado, la lista, la entrada con su enlace, sus programas y la consecuencia de estar en ella. S3 cita la UFLPA (sección 3(a)) para EE. UU. y la partida 9897.00.00 del Customs Tariff para Canadá. Los nombres de Xinjiang que existen fuera (Aksu, Altay, Hami, Ili) solo cuentan si la parte está en China o no indica país.

Los umbrales se cambian en **Administración › Listas restringidas** (o con `SCREENING_MATCH_THRESHOLD` y `SCREENING_REVIEW_THRESHOLD`); un umbral de revisión mayor que el de coincidencia se lee como el de coincidencia. Son del servidor, no de cada organización, como las listas: definen qué cuenta como coincidencia con una lista de sanciones, y que un equipo pudiera subirlos para no ver coincidencias sería una forma de ocultarlas. Lo que cada organización decide son sus excepciones, una por una y con motivo.

**El agente** solo ve las coincidencias S2: compara la parte con la entrada y su explicación queda en el finding; un "es la misma" con confianza ≥ 0,7 sube el finding a gravedad alta. Nunca descarta una coincidencia, y las S1 no se le preguntan: descartar una posible coincidencia con una lista de sanciones es decisión de una persona.

## Lista de excepciones (falsos positivos)

Las excepciones son de la **organización** (ver [ORGANIZATIONS.md](ORGANIZATIONS.md)): desde **Listas restringidas › Comprobar un nombre**, "No es esta parte" guarda, para la organización activa, que ese nombre de parte no es esa entrada, con un motivo obligatorio. La validación de los envíos de esa organización omite esa coincidencia exacta (nombre normalizado + lista + entrada); S3 se mantiene, y las demás organizaciones siguen viendo la coincidencia. "Restablecer" la quita con un motivo opcional.

- Ver la lista: permiso `data.read` (todos los roles salvo cliente). Descartar o restablecer: `finding.decide` (propietario, administrador, analista, revisor), porque es una decisión sobre findings. Un visor o un cliente recibe 403; un miembro de otra organización, 404.
- Las filas nunca se borran: la tabla (`screening_allowlist`, migración 044, `org_id` con `on delete cascade`) guarda quién descartó qué, cuándo y por qué, y quién lo restableció. Cada alta y baja queda además en el registro de auditoría como `screening.allowlist.add` / `screening.allowlist.remove`, con los valores.
- Los administradores del servidor ven las de todas las organizaciones en Administración › Listas restringidas (solo lectura).

## API

| Método | Ruta | Descripción |
| --- | --- | --- |
| GET | `/screening/lists` | Listas con versión, SHA-256, entradas, errores, estado de la actualización y umbrales |
| GET | `/screening/search?q=&country=&city=` | Las 10 entradas más parecidas, con puntuación y resultado (`match`, `review`, `below`) |
| GET | `/screening/allowlist?history=true&all=true` | Excepciones de la organización activa (`all`: de todas, solo administradores del servidor); `history` incluye las restablecidas |
| POST | `/screening/allowlist` | `{ partyName, list, entryId, reason }` (`finding.decide`) |
| DELETE | `/screening/allowlist/:id` | `{ reason? }` (`finding.decide`; 404 fuera de la organización) |
| GET | `/admin/screening` | Lo mismo que `/screening/lists` (administradores del servidor, fuera de toda organización) |
| POST | `/admin/screening/refresh` | `{ only?: string[] }`: descarga en segundo plano (202); una a la vez |
| PUT / DELETE | `/admin/screening/thresholds` | `{ match, review }` entre 0,5 y 1; DELETE vuelve a los valores por defecto |

## Evaluación

`npm run eval:screening` (fixture) y `npm run eval:screening -- --lists data/screening` (listas completas) toman los 260 envíos sintéticos (v1 y v2), cuyas partes son inventadas, y miden:

- los envíos tal cual: cualquier S1/S2 es un falso positivo;
- cada envío con una parte reemplazada por una entidad de las listas, escrita de seis maneras (exacta, mayúsculas y otra forma jurídica, alias, errata, palabra de más, palabras en otro orden);
- cada envío con un comprador señuelo que comparte una palabra con una entidad.

Con las listas completas (38.383 entradas, octubre de 2026): 0 falsos positivos; recall 99,2 % (S1 o S2) y 100 % como S1 en exacta, forma jurídica, alias y orden; la palabra de más queda casi siempre como S2. Informe en `eval/reports/screening-full.md`.

## Límites

- Los nombres en otros alfabetos (cirílico, árabe, chino) no se comparan: las facturas se imprimen en alfabeto latino.
- No se comparan fechas de nacimiento ni números de identificación: los documentos de carga no los traen.
- La lista UFLPA se lee de la página de DHS; si cambia su formato, la actualización de esa fuente falla y se conserva la versión anterior.
- Es una ayuda, no una determinación de cumplimiento: un S1 se resuelve con el área de cumplimiento.
