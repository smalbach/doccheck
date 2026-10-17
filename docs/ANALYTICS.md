# Análisis

Grupo **Análisis** del menú lateral: indicadores sobre el historial de validaciones, evaluación de proveedores, costo evitado, comparación de precios, preguntas en lenguaje natural sobre los datos de la organización y cambios en la normativa citada. Todo se calcula sobre las tablas de datos extraídos ([DATA-MODEL.md](DATA-MODEL.md)), los hallazgos y sus decisiones ([FINDINGS.md](FINDINGS.md)) y las conversaciones con proveedores ([MESSAGING.md](MESSAGING.md)), **de la organización activa** ([ORGANIZATIONS.md](ORGANIZATIONS.md)): cada consulta filtra por su `org_id` y nadie ve números ni filas de otra organización. Todas las rutas piden `data.read` (un cliente no ve análisis); cambiar los supuestos de costo pide `org.settings` (propietarios y administradores).

Código: `apps/api/src/insights` (módulo `AnalyticsModule`, rutas `/analytics/...`) y `apps/web/src/features/analytics`. Migración `049_analytics.sql`.

## Definiciones comunes

- **Primera validación** de un envío: su primera corrida de reglas. El filtro de fechas (`from`, `to`, ambos días incluidos) se aplica a esa fecha; el de destino, al destino del envío.
- **Un hallazgo** a lo largo de las corridas es su `fingerprint` (regla + campos y valores de la evidencia). Está **resuelto** cuando una validación posterior ya no lo tiene; la fecha de resolución es la de esa validación. Aceptado o falso positivo cuenta como **descartado**, no como resuelto.
- **Tasa de error** de un grupo: envíos con al menos un hallazgo en su primera validación ÷ envíos validados del grupo. Para una regla, solo cuentan los envíos en los que corrió (`validations.ran`).
- Proveedor = vendedor de la factura vigente (o el shipper del BL sin factura); origen = cada país de origen de sus líneas (un envío con dos orígenes cuenta en ambos); ruta = puerto de carga → puerto de descarga del BL.

## Indicadores (`#/app/analytics`)

`GET /analytics/kpis?destination=&from=&to=` y `GET /analytics/kpis.csv` (todas las desagregaciones en un CSV, con una columna `Breakdown`).

| Indicador | Cálculo |
| --- | --- |
| Limpios en la primera validación | Envíos sin hallazgos en su primera validación ÷ envíos validados |
| Hallazgos por envío, por mes | Hallazgos de la primera validación ÷ envíos, por mes de esa validación |
| Abiertos / resueltos / descartados | De la última validación: `open` o `waiting_supplier`; resueltos según la definición de arriba |
| Mediana hasta la resolución | Horas entre la primera validación que vio el hallazgo y la que ya no |
| Mediana de respuesta del proveedor | Horas entre el primer correo enviado de una solicitud de corrección y la primera respuesta |
| Por regla, tipo de documento, proveedor, origen, ruta | Tasa de error y hallazgos de la primera validación |

## Evaluación de proveedores (`#/app/analytics/suppliers`)

`GET /analytics/suppliers`, `/analytics/suppliers.csv`, `/analytics/suppliers/:partyId` (tendencia mensual, reglas más incumplidas, solicitudes de corrección). La fórmula está en la página y en `apps/api/src/insights/score.ts`:

```
puntaje = 100 × (0,5 × primera vez + 0,3 × corregidos + 0,2 × respuesta) ÷ (suma de los pesos con datos)
```

- **Primera vez**: envíos validados del proveedor sin hallazgos en la primera validación ÷ envíos validados.
- **Corregidos**: de los hallazgos pedidos al proveedor (sus huellas en una solicitud de corrección, o una decisión `waiting_supplier`), los que una validación posterior ya no tuvo.
- **Respuesta**: `1 − mediana de horas hasta la primera respuesta ÷ 120`; una solicitud sin respuesta cuenta 120 h.
- Una parte sin datos se omite y los pesos se reescalan. Con menos de 3 envíos validados se marca "pocos envíos". El ranking ordena por puntaje, luego por envíos validados.

## Costo evitado (`#/app/analytics/cost`)

`GET /analytics/cost`, `PUT /analytics/cost/assumptions` `{ assumptions }` (`null` o `DELETE` vuelve a los valores por defecto; ambos con `org.settings`), `GET /analytics/cost/defaults`. Los supuestos son de la organización (`analytics_settings.org_id`): todos sus miembros ven los mismos. Es una **estimación**: la página lo dice siempre y muestra los supuestos.

Supuestos por defecto (`apps/api/src/insights/cost/penalties.ts`, revisados el 2026-10-16):

| Concepto | Reglas | Monto | Fuente |
| --- | --- | --- | --- |
| CBSA AMPS C005: información no veraz, exacta y completa (Customs Act s. 7.1), primera vez | X1–X9, X12–X14, X16–X18, X22, C1–C3, T7–T9 (CA) | CAD 150 por documento (225 la segunda, 450 la tercera) | [C005](https://www.cbsa-asfc.gc.ca/trade-commerce/amps/contraventions-infractions/c005-eng.html) |
| CBP ISF: daños liquidados por ISF inexacto, incompleto o tardío (19 CFR Part 149; condición de la fianza, 19 CFR 113.62) | X11, U2, U3 (US) | USD 5.000 por infracción antes de mitigación (la primera suele cerrarse con 1.000–2.000) | [Guía de mitigación de CBP](https://www.cbp.gov/sites/default/files/assets/documents/2020-Feb/Mitigation-Guidelines-advance-electronic-cargo-information-requirement-2018.pdf) |
| Retención en frontera | hallazgos CRITICAL o HIGH | 2 días × 200 por contenedor y día (CAD en CA, USD en US y MX, EUR en la UE, GBP en GB) | Supuesto de demora y almacenaje |
| Tránsito hasta la llegada | — | Marítimo 14 días, aéreo 2, terrestre 3, desde la fecha a bordo del BL (o la creación del envío) | Supuesto |

19 CFR 141.86 no fija un monto por factura incompleta: su costo es la retención. México, la UE y el Reino Unido no tienen todavía una multa en la tabla (sus sanciones dependen de los derechos en juego o del caso), y tampoco X10, X15, X19–X21, X23, X24, U4 ni el resto de T*: para esas reglas solo cuenta la retención si el hallazgo es grave, y la página las lista como "sin multa asignada" (`unmapped` en la respuesta). Un destino sin costo diario no cuenta retención.

Cálculo (`cost/cost.ts`, aritmética de punto fijo): cada multa cuenta una vez por envío cuyos hallazgos incluyen una de sus reglas; la retención, días × costo diario × contenedores (mínimo 1). Un concepto es **evitado** si todos sus hallazgos se resolvieron antes de la llegada estimada, **tarde** si después, **expuesto** si alguno sigue abierto. Aceptados y falsos positivos no cuentan. Los totales van por moneda, sin conversión.

## Comparación de precios (`#/app/analytics/prices`)

`GET /analytics/prices?by=product|hs6&q=&outliers=true` y `GET /analytics/prices/group?by=&key=&currency=&unit=`. Precios unitarios de las facturas vigentes (la misma base que el historial de precios de cada producto), agrupados por producto o por subpartida HS-6 + origen, y siempre dentro de una moneda y unidad. Cuartiles por rango más cercano (precios realmente pagados); atípico fuera de `Q1 − 1,5 × IQR` o `Q3 + 1,5 × IQR`, con 4 precios o más (`price-stats.ts`). El gráfico muestra la mitad central como banda, la mediana, el rango normal punteado y los atípicos como rombos de otro color (forma y color).

## Preguntas sobre los datos (`#/app/analytics/ask`)

`POST /analytics/qa` `{ question }` → `{ sql, explanation, columns, rows, truncated, ms, model, role }`; `POST /analytics/qa/run` `{ sql }` ejecuta una consulta editada con las mismas protecciones.

1. **El modelo local** (Ollama, el mismo de la extracción) recibe la pregunta y la descripción de las vistas (`qa/prompt.ts`). Nunca ve filas de datos.
2. **Guardia** (`qa/sql-guard.ts`, con pruebas): un solo `SELECT` (o `WITH ... SELECT`); solo las vistas permitidas en `FROM`/`JOIN` (`shipments`, `invoices`, `invoice_lines`, `packing_lists`, `bills_of_lading`, `containers`, `isf`, `parties`, `products`, `findings`, `mail_requests`) o CTE propios; solo funciones de una lista (agregados, fecha, texto); sin comentarios, `;` intermedios, parámetros, `$$`, nombres con esquema, `pg_*`, `information_schema`, `set_config`/`current_setting`, casts a `reg*`, `INTO`, `FOR UPDATE`. Si la rechaza, o la base no puede ejecutarla, el modelo recibe el motivo (nunca datos) y escribe otra una vez (`qa/answer.ts`).
3. **Ejecución** (`qa/qa-runner.ts`): transacción `READ ONLY` que siempre termina en `ROLLBACK`, `statement_timeout` de 3 s, `search_path = qa`, la organización activa en `doccheck.qa_org` (las vistas filtran `org_id = dc_qa_org()`; sin ella están vacías; la guardia no deja llamar a `set_config`, `current_setting` ni `dc_qa_org`, ni nombrar tablas fuera de las vistas), rol `doccheck_qa` que solo puede leer las vistas `qa.*`, y como máximo 200 filas (la consulta se envuelve con `LIMIT`). Si la base no permite crear el rol, la API lo avisa en el log y las demás capas siguen.

**Evaluación**: `npm run eval:qa` arma una organización conocida con 40 envíos del set sintético (más otra organización para verificar que ninguna respuesta muestra sus filas), hace las 22 preguntas de `eval/qa/questions.json` y compara el resultado con el de la consulta esperada (mismo número de filas y los valores esperados en cada una; nombres y orden de columnas no importan). Con `qwen3.8`: **22/22 (100 %)**, una tras el reintento (sin reintento 21/22: una columna inexistente), 0 rechazadas por la guardia, 0 filas de otra organización. Reporte en `eval/reports/qa-ollama_qwen3.8.json`; las respuestas del modelo quedan en `eval/cache/qa_ollama_qwen3.8/` (`--replay` corre sin modelo). Ese resultado se midió con el catálogo de 15 reglas; el prompt lista las reglas de `ALL_RULES`, así que con las reglas nuevas (X13–X24, C3, U2–U4, M*, E*, K*, T*) cambia y hay que volver a correr `npm run eval:qa` con el modelo (las respuestas guardadas ya no coinciden).

## Cambios en la normativa (`#/app/analytics/regulations`)

- **Revisión programada** (`regwatch/regwatch.service.ts`): cada `REG_WATCH_HOURS` (24 por defecto; `0` la apaga; nunca en la demo) descarga las fuentes de `scripts/fetch-corpus.mjs`: CBSA y CBP desde `packages/regulations/src/sources.ts` y México, UE y Reino Unido desde `scripts/corpus-intl.mjs` (las fuentes opcionales que no responden conservan su instantánea sin error), divide cada documento en pasajes (párrafos con su ruta de títulos) y compara el hash de cada uno (SHA-256 del texto con espacios normalizados) con la instantánea en `regulation_passages`. El emparejamiento sigue la subsecuencia común más larga, así un párrafo insertado no marca como cambiados a todos los siguientes (`packages/regulations/src/changes.ts`). La primera revisión de un documento solo guarda la instantánea. Los admins tienen **Revisar ahora** (`POST /analytics/regulations/check`). `REG_WATCH_SOURCE=<directorio>` lee el corpus de archivos en vez de la web (servidores sin salida, pruebas).
- Cada cambio (`agregado`, `eliminado`, `modificado`) se guarda con el texto antes y después y **las reglas que pueden citar ese documento** (`rulesCiting` en `packages/agent/src/cite.ts`, el inverso de `citationScope`).
- Los cambios son globales; **lo que afectan es por organización** (`GET /analytics/regulations`): sus envíos con hallazgos abiertos en la última validación de esas reglas y destino, y si la cita guardada del hallazgo es justamente ese pasaje. Lo nuevo es por miembro y organización (`regulation_reads`): los cambios desde la última visita en esa organización (o desde que entró a ella) llevan la etiqueta "Nuevo" y cuentan en el menú (`/analytics/regulations/unread`; abrir la página los marca leídos).

## Pruebas

- `npm test -w @doccheck/api`: guardia SQL, costo, puntaje y estadística de precios. `packages/regulations`: diff de pasajes y conversores. `packages/agent`: `rulesCiting`.
- `npm run test:e2e -w @doccheck/api` incluye `test/analytics.test.mjs` (base de `DATABASE_URL_TEST` con `_analytics_test`, puerto `E2E_PORT + 3`): indicadores y CSV, ranking, supuestos de costo, precios, aislamiento entre organizaciones en cada vista, rechazos de la guardia, límite de tiempo, rol sin acceso a las tablas, y una revisión de normativa con línea base y un pasaje cambiado.
- `test/orgs.test.mjs` comprueba que un miembro de otra organización ve cero en indicadores, proveedores, precios, costo, CSV y cada vista de Data Q&A, que un `viewer` invitado ve los números y los supuestos pero no puede cambiarlos, y que un `client` recibe 403 en todas las rutas de análisis.
