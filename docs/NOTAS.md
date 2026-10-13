# Notas del proyecto

El plan completo (alcance, reglas, modelo de datos, servicios y fases) está en el documento DocCheck en Claude.

## Estado de la fase 2

Hecho: `packages/extraction` (pdf.js + clasificación + extracción con Ollama + normalización + puntuación por campo), `npm run eval:extraction`, y la API acepta PDFs (`POST /shipments/:id/documents`) y cita página y bbox en los hallazgos.

Hecho también: Postgres (tablas shipments, documents, extractions, validations, findings; migraciones SQL en `apps/api/migrations` que corren al iniciar la API). Cada validación queda guardada con sus hallazgos y qué documento alimentó cada regla.

Hecho también: PDFs en almacenamiento S3 y extracción en cola BullMQ (Redis). `POST /documents` responde 202 con los documentos en `QUEUED`; un worker en el mismo proceso los extrae (2 intentos con backoff) y los deja en `EXTRACTED` o `FAILED` con el error. `validate` responde 409 mientras haya documentos pendientes.

Pendiente: resultado de la evaluación completa (600 PDFs, corriendo).

Local sin Docker: Redis de Homebrew en 6379 (claves con prefijo `doccheck`), SeaweedFS como S3 en 9100 (`scripts/dev-s3.sh`, datos en `.data/seaweedfs`). MinIO de Homebrew se cae al arrancar en el M5 (falla detectando la CPU) y el proyecto está archivado, por eso SeaweedFS; el compose sigue trayendo MinIO para quien use Docker.

Local: Postgres 18 en el 5432, base `doccheck`, credenciales en `.env` (no versionado). pgvector no está instalado en ese servidor: hace falta para la fase 4 (`brew install pgvector` o usar el compose).

## Fase 5: demo (en curso)

- Despliegue: por ahora local. `scripts/start-local.sh` revisa todas las dependencias, levanta SeaweedFS si hace falta, compila y sirve en :3000. Todo lo necesario para desplegar después está en `docs/DESPLIEGUE.md` (local, respaldos, LaunchAgent, Docker, servidor con GPU con proxy y autenticación, demo estática de solo lectura como idea).
- `Dockerfile` y servicio `app` en el compose escritos pero sin construir (Docker apagado en esta Mac).
- La app no tiene autenticación: no exponerla sin un proxy que la agregue.
- ISF guardado por envío (`PUT /shipments/:id/isf`, tabla `isf_filings`): X11 corre sin mandarlo en cada validación y los envíos US ya no quedan en `NEEDS_INPUT`. Las muestras US traen su ISF. En la web se sube como JSON.
- Cita de X11 por elemento de §149.3 (origen, HTS, vendedor, comprador) en lugar del requisito general; las citas conservan la etiqueta del párrafo ("(7) Country of origin.").
- Evaluación del agente (80 casos, build aaee06c39dcf): descripción BL vs factura 40/40; mismo consignee 35/40 con 0 errores y 5 "unsure" (empresas distintas donde el modelo fue cauto). Como "unsure" mantiene el hallazgo, la acción sobre el hallazgo fue correcta en 80/80; el reporte ahora mide ambas cosas.
- **El modelo `qwen3.8` se actualizó a las 17:02 del 12/10** (digest 22130167c4c2 -> aaee06c39dcf; no fue un pull nuestro). La evaluación completa (desde 17:15) y la del agente usan la versión nueva; la comparación con gemma4 y las pruebas v1/v2 usaron la anterior. Desde ahora la versión exacta queda en la caché, en `llm_calls.model_version` y en los reportes. Pendiente: re-extraer las 18 entradas de caché de la corrida v3 que cruzó el cambio, para que todo el informe sea de una sola versión.
- **Escaneos y OCR.** `npm run synth -- --scans 40` genera `data/eval/v1-scans`: 40 envíos (20 CA, 20 US) como PDF solo imagen, en gris, girados hasta ±1,5°, con desenfoque y ruido; 150 dpi o, en 30% de los casos, 110 dpi más borroso. Misma verdad y etiquetas que v1.
  - Las páginas sin capa de texto pasan por OCR (tesseract.js con el modelo inglés incluido en npm; nada se descarga al correr). Se renderiza a 288 dpi con pdf.js + @napi-rs/canvas y se usa PSM 6: en escaneos malos recuperó 17 de 22 valores clave contra 11 con la configuración por defecto; en los de 150 dpi todo da igual (22/22).
  - El resultado vuelve como líneas con página y bbox, así que citas y resaltado funcionan igual. La extracción agrega el aviso "Read with OCR (confianza X%)".
  - El clasificador fallaba con OCR: el título subrayado salía como "MMERCIAL I ICE" y una referencia "Invoice No." en el packing list contaba como título. Ahora: título tolerante, "Invoice No." no es título, y señales compartidas (N.W., G.W.) no cuentan. 720/720 PDFs bien clasificados (600 con texto, 120 escaneados).
  - Lectura sola, sin modelo (`npm run eval:ocr`, valores de la verdad encontrados en el texto): capa de texto 99,7%; OCR inglés 82,8%; **inglés + francés 86,6%** (150 dpi 95,1%, 110 dpi 69,1%) -> elegido; a 3x 85,3%; con realce de contraste y enfoque 75,1% (descartado: amplifica el ruido).
  - Pendiente: evaluar extracción sobre los escaneos cuando Ollama quede libre (`npm run eval:extraction -- --data data/eval/v1-scans`).
- Reglas X9 (fecha de embarque de la factura vs "shipped on board" del BL, tolerancia 7 días) y X12 (Incoterm vs flete del BL: CIF/CFR prepaid, FOB/FCA/EXW collect), severidad baja. Sin falsos positivos en los 200 envíos; no hay errores inyectados de esos tipos, así que su recall no está medido.
- Citas: entre los pasajes relevantes se cita el que tiene la oración más parecida a la consulta (desempate por densidad). Las 18 citas de X1-X12 en CA y US apuntan al campo del CI1 o al párrafo de 141.86 correcto; tests de regresión con el corpus real.
- Web: panel "extracted data" por documento (avisos como OCR, campos clave, filas) y "Re-extract" con el tipo corregido (`POST /documents/:id/reextract`), para cuando el clasificador se equivoca.
- OCR: en un escaneo real del flujo salieron dos falsos positivos por confusión de caracteres ("H7S" leído "HTS" en un código postal, referencia "rr,,"). Una referencia sin dígitos ahora se descarta como ilegible, y los hallazgos con valores leídos por OCR avisan que hay que confirmarlos contra el documento.
- ngrok: `scripts/tunnel.sh` abre `https://powerful-stallion-purely.ngrok-free.app` -> puerto 3000 con usuario `doccheck` y contraseña aleatoria guardada en `.env` (`NGROK_BASIC_AUTH`, no versionado). Sin credenciales responde 401. Cerrar con `scripts/tunnel.sh stop`.
- Tests de integración de la API (`npm run test:e2e -w @doccheck/api`, `node --test` contra el build): base `doccheck_test` que se recrea en cada corrida (se niega si el nombre no termina en `_test`). Cubren envíos, validación guardada, errores 400/404, ISF y, si existen los PDF y la caché, el camino PDF completo en modo replay. También en CI.

- `apps/web`: Vite + React, sin router ni librería de UI (dos pantallas, rutas por hash). La API sirve el build desde el mismo origen (`npm start` en :3000); en desarrollo Vite en :5173 hace proxy.
- Pantallas: inicio (crear envío, muestras sintéticas con sus errores, envíos recientes) y envío (subir PDFs, estado de extracción con polling, validar con o sin agente, hallazgos ordenados por severidad con evidencia, cita de la norma y razón del agente).
- Visor PDF con pdf.js en el navegador: abre la página citada y marca el bbox de la línea. Se carga solo al abrirlo (pdf.js pesa ~430 kB).
- API nueva: `GET /shipments`, `GET /shipments/:id/validation`, `GET /shipments/:id/documents/:docId/file`, `GET /demo/samples`, `POST /demo/samples/:id`.
- Probado en el navegador con CA-001: X3, X6 y X10 (los errores inyectados), cita de D1-4-1 por campo, visor resaltando el peso bruto del BL; en celular (375 px) sin scroll horizontal.
- Las citas cortan en el límite de cada "Field N:" para no mezclar campos del CI1.

## Fase 4: agente + RAG

- Corpus (`npm run corpus:fetch`): CBSA D1-4-1 en inglés y francés (vigente desde 2013-03-01; la página dice "en revisión" por CARM), 19 CFR 141.86 y Part 149 desde eCFR (texto al 2026-10-08). Markdown con URL y fecha en el front matter. Las filas de la tabla del apéndice A quedan como "Field 7: ..." para que la cita diga el campo.
- 56 fragmentos, embeddings con `bge-m3` en Ollama (multilingüe, por el francés). Índice en `data/corpus/index/bge-m3.json` (versionado, ~0,5 MB): la API solo calcula el embedding de la consulta.
- Búsqueda exacta en memoria (coseno + BM25, fusión RRF) en vez de pgvector: con decenas o cientos de fragmentos es instantánea y no exige la extensión. pgvector (HNSW) cuando el corpus crezca mucho.
- Citas: consulta fija por regla (X*) o el propio mensaje (C1/U1, que nombra el campo y su referencia). Solo se adjunta si BM25 también la pone en el top 5; X10 no tiene cita (ISO 6346 no es norma aduanera).
- Agente = flujo fijo, no un loop abierto: decisiones puntuales con salida estructurada (veredicto yes/no/unsure, confianza, razón). Con un modelo local es más confiable y medible. Actúa solo con confianza ≥ 0,7; "unsure" nunca descarta un hallazgo.
  - X1 con nombres distintos -> ¿misma empresa? Sí con confianza: se descarta; si no, queda con la razón.
  - A1 (nueva, del agente): ¿la descripción del BL corresponde a la mercadería de la factura?
- Trazas: cada llamada al modelo va a la tabla `llm_calls` (proveedor, prompt, caché, ms, tokens, error). Langfuse Cloud descartado porque todo debe quedarse local; se puede exportar desde esa tabla más adelante.
- Prueba en la API con los PDF de CA-059: C1 detecta el origen faltante y cita D1-4-1 "Field 7: Country of origin of goods"; el agente juzga la descripción del BL consistente (0,95).
- Prueba del agente (12 casos): 11 aciertos, 0 errores, 1 "unsure". Evaluación de 80 casos corriendo (`npm run eval:agent`).
- pgvector sigue sin instalar en el Postgres de EDB; ya no hace falta para esta fase.

## Fase 3: reglas

Nuevas: X1 (consignee factura vs BL), X7 (cantidades factura vs packing list por SKU), X8 (packing list referencia la factura), X11 (ISF vs factura, solo US), C1 (campos CBSA del CI1), C2 (idioma en/fr), U1 (campos de 19 CFR 141.86(a)). Perfil CA: X1-X8, X10, C1, C2. Perfil US: X1-X8, X10, X11, U1.

- 274 de 293 errores inyectados ahora tienen regla. Los 19 restantes: campos que ese país no exige (Incoterm o consignee en US, fecha de factura en CA) y un caso donde un error tapa a otro (sin consignee en la factura no hay con qué comparar el BL).
- Sobre datos verdaderos: las reglas marcan exactamente lo esperado en los 200 envíos (test de synth).
- Sobre documentos extraídos (6 envíos): recall y precisión 100% en todas las reglas, después de arreglar un falso positivo de X1: el modelo copiaba ciudad/provincia/CP en las líneas de calle. `streetLines` en rules lo limpia y se usa también al normalizar la extracción.
- X11 necesita el ISF, que hoy solo entra como JSON en `validate`; en envíos US sin ISF queda en `skipped` y el envío pasa a `NEEDS_INPUT`.
- Las referencias de C1/U1 (campo del CI1, párrafo de 141.86) salen del mapeo de los schemas; la cita textual de la norma la agrega el agente en la fase 4.
- `npm run synth -- --labels-only` reescribe etiquetas sin tocar `truth.json` ni PDFs (la caché del modelo sigue valiendo).

## Resultados de extracción (6 envíos, 18 PDFs)

| Modelo | Prompt | Precisión por campo | s/PDF | Envíos con los 3 docs |
| --- | --- | --- | --- | --- |
| qwen3.8 | v1 (2 envíos) | 92,2% | ~27 | 2/2 |
| qwen3.8 | v2 | 96,4% | ~31 | 6/6 |
| gemma4 | v2 | 56,7% | ~12 | 1/6 (deja vacío el peso bruto del BL) |
| **qwen3.8** | **v3** | **99,4%** | ~35 | 6/6, reglas 6/6 |

Modelo elegido: qwen3.8 en un M5 Pro de 64 GB. Falta correr los 200 envíos (~6 h).

## Decisiones tomadas en la fase 2

- Solo modelos locales con Ollama (decisión del usuario): nada sale de la máquina. `LLM_MODEL` elige el modelo.
- El modelo copia valores tal como están impresos; convertir a tipos canónicos es código determinista y probado (`normalize.ts`). Así un error de formato no depende del modelo.
- Texto del PDF con pdf.js (JS puro, funciona en CI) en vez de `pdftotext`; las celdas se alinean por columna para que el modelo lea tablas con celdas de varias líneas.
- Las respuestas del modelo se guardan en `eval/cache/` (versionado): repetir la evaluación es instantáneo y en CI se puede correr en modo `replay`.
- `PROMPT_VERSION` entra en la clave de caché: cambiar el prompt invalida las respuestas viejas.
- Extracción sincrónica dentro del request por ahora (~35 s por PDF); pasa a cola cuando entre Redis.
- `pg` con SQL a mano y migraciones `.sql` numeradas, sin ORM: pocas tablas, consultas simples, JSON de documentos y hallazgos en `jsonb` (ya validado con Zod).
- Los ids de hallazgo del motor se repiten entre corridas, por eso la clave de `findings` es (validation_id, id).
- Almacenamiento detrás de una interfaz (`ObjectStorage`): S3 si hay `S3_ENDPOINT`, disco si no. Sirve igual MinIO, SeaweedFS, AWS S3 o R2.
- Worker de extracción dentro del proceso de la API, concurrencia 1 (el modelo local atiende un pedido a la vez). Se puede separar con `EXTRACTION_WORKER=false` en la API y un proceso worker aparte más adelante.
- Sin `REDIS_URL` la extracción corre en segundo plano en el mismo proceso, sin reintentos (CI y desarrollo rápido).

## Decisiones tomadas en la fase 1

- Generador determinista desde una semilla (mulberry32 propio, nada de `Math.random`). `npm run synth` regenera exactamente el mismo set.
- Empresas y navieras ficticias; puertos con UN/LOCODE reales.
- `truth.json` guarda los documentos tal como se imprimen (con errores): es el objetivo de la extracción. Las etiquetas van aparte en `labels.json`.
- Las etiquetas usan las mismas rutas de campo que la evidencia de las reglas, para poder emparejar hallazgos con errores en la evaluación.
- Errores sin regla todavía (dirección del consignee, cantidad en packing list, campos obligatorios faltantes) quedan con `expectedRuleIds: []`.
- PDFs con Playwright; si no está su Chromium, usa el Chrome local. Los PDF y HTML no se versionan.
- 3 plantillas por documento por ahora; escaneos degradados y más plantillas quedan para cuando la fase 2 muestre qué variaciones importan.

## Decisiones tomadas en la fase 0

- npm workspaces (sin pnpm ni turborepo) para mantenerlo simple.
- TypeScript 6 con `module: nodenext`: es la versión que usa Nest CLI 12.
- Montos y pesos como string decimal; aritmética de punto fijo con BigInt en `packages/rules/src/decimal.ts`.
- Las reglas son funciones puras en su propio paquete: se prueban con vitest sin levantar NestJS.
- La API aún guarda todo en memoria; Postgres entra en la fase 2.
