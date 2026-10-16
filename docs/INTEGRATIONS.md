# Integraciones

DocCheck se conecta con otros sistemas: una API REST pública con claves de API, webhooks firmados, alertas en Slack o Teams, carpetas que vigila (SFTP, S3 o local), exportaciones a CargoWise y X12, y seguimiento de contenedores. Todo se configura en **Integraciones** (menú lateral, grupo Conectar); la **Referencia de la API** está al lado.

Los modelos siguen corriendo localmente: ninguna integración manda documentos a un servicio de IA externo. Lo que sale hacia afuera (webhooks, chat, exportaciones) lo decide la organización.

## Organización

Claves, webhooks, alertas, carpetas y seguimiento pertenecen a una **organización** ([ORGANIZATIONS.md](ORGANIZATIONS.md)) y se borran con ella; `created_by` guarda quién los configuró y se conserva si esa persona se va. Administrarlos (página Integraciones, rutas `/integrations/...`) requiere el permiso `integrations.manage`, que tienen owner y admin; los demás roles reciben 403 y no ven la página en el menú.

Una **clave de API** actúa en su organización con lo que permiten sus alcances, en los términos de la tabla de roles: `read` da `shipment.read` y `data.read`; `write` da `shipment.write`. Las rutas de `/api/v1` nombran su permiso con `@Permission()`, como las de la app, y `ApiKeyGuard` lo revisa contra la clave; después la solicitud lleva la organización de la clave (`req.org`), así que `ApiShipmentGuard` usa la misma comprobación que `ShipmentOwnerGuard` y responde 404 para envíos de otra organización. Una clave nunca actúa como cliente. Los envíos creados con una clave quedan en la organización a nombre de quien creó la clave, y el registro de auditoría los anota con ese usuario y `api-key dck_…` como actor.

Los eventos solo van a los webhooks y alertas de la organización dueña del envío (la del envío al momento del evento; para respuestas de proveedor, la de la conversación). Crear o revocar claves y crear, cambiar o borrar webhooks, alertas, carpetas y el seguimiento se anota en el registro de auditoría con `AuditService.note`, sin secretos: de una clave solo el prefijo, de un webhook nunca el secreto de firma, de una alerta solo el host de la URL, de una carpeta ni contraseña ni clave, del seguimiento solo si hay clave guardada.

## API REST v1

Bajo `/api/v1`, solo con clave de API (`Authorization: Bearer dck_…` o `X-API-Key`). La cookie de sesión no sirve ahí, y una clave no abre las rutas propias de la app.

| Método | Ruta | Permiso | Qué hace |
| --- | --- | --- | --- |
| GET | `/api/v1/shipments?status=&destination=&q=&limit=&offset=` | read | Lista de envíos |
| POST | `/api/v1/shipments` | write | Crea un envío `{ reference?, destination?, transportMode? }` (201) |
| GET | `/api/v1/shipments/:id` | read | Envío, documentos y estado |
| POST | `/api/v1/shipments/:id/documents` | write | Sube PDF (multipart `files`, hasta 10 de 20 MB); 202, la extracción sigue en segundo plano |
| GET | `/api/v1/shipments/:id/documents/:documentId` | read | Documento y datos extraídos normalizados |
| POST | `/api/v1/shipments/:id/validate?agent=&wait=` | write | 202 y la validación corre; con `wait=true`, 200 con el resultado |
| GET | `/api/v1/shipments/:id/findings` | read | Última validación con hallazgos, evidencia, cita y decisiones (404 antes de validar) |
| GET | `/api/v1/shipments/:id/exports/:format` | read | `cargowise-xml`, `x12-856` o `x12-310` como descarga |
| POST | `/api/v1/shipments/:id/exports/:format/send` | write | Envía la exportación por un conector `{ connector }` |
| GET | `/api/v1/openapi.json` | público | Documento OpenAPI 3.1 |

- **Claves:** `dck_<8 caracteres>_<32 secretos>`. Se muestran una sola vez; se guarda su SHA-256 y el prefijo para reconocerlas. Alcances `read` y/o `write`, límite por minuto (120 por defecto), último uso (anotado como máximo una vez por minuto) y revocación definitiva.
- **Límite de solicitudes:** ventanas de un minuto por clave; con `REDIS_URL` el conteo es compartido por todos los procesos, sin Redis cada proceso cuenta el suyo. Cada respuesta lleva `RateLimit-Limit`, `RateLimit-Remaining` y `RateLimit-Reset`; un 429 lleva `Retry-After`.
- **Idempotencia:** crear y subir aceptan `Idempotency-Key`. La primera solicitud reserva la clave; si sale bien, su respuesta se guarda 24 horas y un reintento igual la recibe de nuevo (`Idempotent-Replayed: true`) sin repetir el trabajo. La misma clave con otra solicitud da 422; mientras la primera corre, 409. Una solicitud que falla libera la clave.
- **Errores:** siempre `{ statusCode, error, message, issues? }` (`issues` por campo en un 400).
- **OpenAPI:** se genera de los mismos esquemas Zod con que la API valida (`v1.schemas.ts` → `openapi.ts`, con `z.toJSONSchema`), así que no se desfasa. `node scripts/api-contract.mjs --write-only` lo escribe en [`docs/api/openapi.json`](api/openapi.json) junto con la colección de Postman.

### Prueba de contrato con Postman

[`docs/api/doccheck.postman_collection.json`](api/doccheck.postman_collection.json) se genera del documento OpenAPI: 19 solicitudes en orden (crear, repetir con la misma clave de idempotencia, subir, validar, leer, exportar, enviar al conector, y los errores 400/401/404/422) y cada respuesta se compara con el esquema que el documento da para su código.

```bash
npm run build && npm start          # o cualquier servidor con LLM_CACHE_MODE=replay
node scripts/api-contract.mjs --url http://localhost:3000
```

El script crea una cuenta y una clave descartables y corre `postman collection run` con `--no-report-events` (nada va a la nube de Postman). Sube los PDF de `data/eval/v1/CA-001` (`npm run synth`; `--pdf-dir` cambia la carpeta).

### Cliente TypeScript

[`packages/client`](../packages/client): `DocCheckClient` (sin dependencias: `fetch` y `node:crypto`), con reintento tras un 429, `waitForExtraction()` y `verifyWebhook()`. Ejemplos en `packages/client/examples`: `validate-shipment.mts` (crea, sube, valida, imprime los hallazgos y guarda el XML de CargoWise) y `webhook-receiver.mts`.

## Webhooks

Por organización: URL, descripción y eventos. DocCheck hace `POST` con JSON `{ id, type, createdAt, data }` y las cabeceras `DocCheck-Event`, `DocCheck-Delivery` y `DocCheck-Signature: t=<unix>,v1=<hex>`.

| Evento | Cuándo | `data` |
| --- | --- | --- |
| `document.extracted` | Un PDF quedó leído | `shipment`, `document { id, fileName, type, normalized, pages }` |
| `validation.completed` | Terminó una validación (después del seguimiento de contenedores, si está activo) | `shipment`, `validation { id, findings, skipped, bySeverity }` |
| `finding.created` | Un hallazgo que no estaba en la validación anterior | `shipment`, `validationId`, `finding { fingerprint, ruleId, severity, message }` |
| `finding.resolved` | Un hallazgo de la validación anterior que ya no está | igual |
| `supplier.replied` | Llegó correo en una conversación con un proveedor | `shipment`, `thread { id, subject, url }`, `message { id, from, receivedAt, attachments }` |
| `ping` | Botón "Enviar evento de prueba" | `{ message }` |

`shipment` es `{ id, reference, url }`, con el enlace a la app (`APP_URL`).

- **Firma:** HMAC-SHA256 con el secreto del webhook (`whsec_…`) sobre `"<t>.<cuerpo tal cual>"`. El receptor rechaza firmas de más de 5 minutos. El secreto se guarda cifrado con `SETTINGS_KEY` (hay que leerlo para firmar), se puede ver de nuevo y rotar. Tests de firma en `packages/integrations` y `packages/client`.
- **Origen de los eventos:** los eventos de progreso que ya escuchan todos los procesos (LISTEN/NOTIFY) dan `document.extracted`, `validation.completed` y los hallazgos nuevos o resueltos (comparando huellas con la validación anterior); `supplier.replied` sale de revisar `mail_messages` cada 15 s. Cada evento se guarda una vez en `integration_events` con una clave única (`dedupe_key`): solo el proceso que lo insertó lo entrega.
- **Entregas y reintentos:** una fila por evento y destino en `integration_deliveries`. Con `REDIS_URL`, cada entrega es un trabajo de BullMQ (cola `integration-deliveries`) con espera exponencial; sin Redis, un lector de la tabla toma las entregas vencidas con `for update skip locked`. 7 intentos por defecto: 30 s, 1, 2, 4, 8 y 16 min (`WEBHOOK_MAX_ATTEMPTS`, `WEBHOOK_BACKOFF_MS`). Una respuesta 2xx en 10 s es éxito. "Enviar de nuevo" crea otra entrega con el mismo id de evento, para que el receptor la reconozca.
- **Direcciones:** solo `https`, sin credenciales en la URL, y nunca hacia direcciones privadas, locales o de metadatos de la nube; la revisión se hace dentro de la búsqueda DNS del socket, así que se conecta a la dirección revisada. No se siguen redirecciones. `INTEGRATIONS_ALLOW_PRIVATE_URLS=true` lo levanta (servidor dentro de una red de empresa, y tests).

## Alertas de chat (Slack y Teams)

URL de webhook entrante por organización, con sus eventos. Slack recibe Block Kit; Teams una Adaptive Card (sirve para Workflows y para los conectores antiguos). El mensaje dice qué pasó (cantidades, regla, gravedad) con un enlace al envío o a la conversación, y **no cita nada de los documentos** salvo que se active "Incluir mensajes de hallazgos, nombres de archivo y remitentes". La URL es una credencial: se guarda cifrada y solo se muestra el host. Solo se aceptan `hooks.slack.com` y los hosts de Microsoft (`*.webhook.office.com`, `*.logic.azure.com`, `*.powerplatform.com`). Las entregas usan el mismo registro y reintentos que los webhooks.

## Carpetas (ingesta)

Una carpeta local, un servidor SFTP o un prefijo S3 se revisa cada `poll_seconds` (30 s a 1 día). Cada PDF nuevo (por ruta y tamaño/fecha o ETag) se agrupa por una referencia:

- **folder:** el nombre de la carpeta donde está: `SHP-1001/factura.pdf` → `SHP-1001`.
- **filename:** el primer grupo del patrón sobre el nombre; por defecto lo que va antes del primer `_` o espacio: `SHP-1001_factura.pdf`. Los patrones del usuario necesitan un grupo de captura y no pueden tener repeticiones anidadas.

Los archivos con la misma referencia van al envío de la organización con esa referencia, a nombre de quien configuró la carpeta, (de los últimos 120 días) o a uno nuevo, con el destino de la fuente si tiene. Se extraen como cualquier carga y, si la fuente lo pide y hay destino, se validan cuando terminan de leerse. Nada se mueve ni se borra en el origen; `ingested_files` recuerda qué se importó, se omitió (sin referencia, más de 20 MB, no es PDF) o falló.

- Contraseña, clave privada SSH o secret access key: cifradas con `SETTINGS_KEY`, nunca vuelven al navegador.
- Carpetas locales solo dentro de `INGEST_LOCAL_ROOT` (por defecto `.data/inbox`), para que nadie lea otros archivos del servidor.
- SFTP con la misma regla de direcciones que los webhooks. La clave del servidor SSH no se verifica todavía.
- `INGESTION_ENABLED=false` apaga la revisión periódica; "Revisar ahora" y "Probar" siguen funcionando.

## Exportaciones y conectores

De un envío validado, con los documentos que leyó su última validación (`validations.inputs`):

- **CargoWise Universal Shipment** (XML de eAdapter, `ForwardingShipment`): ruta, buque, contenedores, partes, términos y líneas de la factura con HS, origen y precios. Valores como quedaron normalizados (decimales en texto, fechas ISO, kg).
- **X12 004010 856** (aviso de embarque): niveles envío/pedido/artículo con BL, contenedores, bultos, peso, partes y una línea por línea de factura.
- **X12 004010 310** (conocimiento marítimo): buque y viaje, puertos, partes, un bucle por contenedor y totales.

Los ids de intercambio vienen de `X12_SENDER_ID`, `X12_RECEIVER_ID` y `X12_USAGE` (`T` por defecto, `P` producción). Los nombres de elementos siguen los formatos públicos; cada instalación de CargoWise o guía de un socio puede pedir más códigos, así que hay que revisarlo con ellos antes de usarlo en producción. En la app: menú **Exportar** del envío.

Un **conector** (`ShipmentConnector` en `packages/integrations`) envía una exportación a otro sistema. Viene uno simulado (`mock`, `EXPORT_MOCK_CONNECTOR=false` lo quita) que guarda en memoria lo recibido y rechaza archivos incompletos. Una conexión real con CargoWise o una VAN necesita las credenciales del socio y se agrega registrando otro conector.

## Seguimiento de contenedores

Apagado hasta que la organización lo activa. Después de cada validación busca los contenedores del BL con el proveedor y agrega a esa misma validación tres reglas deterministas, con evidencia del BL y del proveedor (`documentId: "tracking:<proveedor>"`):

| Regla | Qué revisa |
| --- | --- |
| T1 | Buque o viaje de la primera carga distintos de los del BL (normalizados: "M/V Ever Given" = "EVER-GIVEN", "012E" = "12E") |
| T2 | Puerto de la primera carga distinto del puerto de carga del BL (UN/LOCODE si ambos lo tienen, si no el nombre) |
| T3 | Entrada a la terminal (gate-in) después de la fecha de embarque a bordo del BL, comparando la fecha local de la terminal |

Solo cuentan eventos reales, nunca estimados; si falta un dato en un lado, la regla no corre. Los eventos usados quedan en `tracking_snapshots` (`GET /shipments/:id/tracking`).

Proveedores: **simulado** (eventos armados con el propio BL: "coinciden" o "no coinciden", para probar), y normalizadores para las respuestas de **project44** (Ocean v4), **Vizion** y **Terminal49** (JSON:API). Para los reales se configura el endpoint que devuelve los eventos de un contenedor (con `{container}`, `{bl}`, `{scac}`) y la clave; cada proveedor necesita registrar los contenedores antes en su consola o API. Los normalizadores siguen la documentación pública y están probados con muestras, no contra cuentas reales.

## Configuración

| Variable | Para qué |
| --- | --- |
| `SETTINGS_KEY` | Cifra secretos de webhooks, URL de chat, credenciales de carpetas y clave del proveedor de seguimiento |
| `REDIS_URL` | Límite de solicitudes compartido y reintentos de entregas con BullMQ |
| `APP_URL` | Enlaces en los eventos y mensajes de chat |
| `INTEGRATIONS_ALLOW_PRIVATE_URLS` | Permite webhooks, endpoints y SFTP en direcciones privadas o locales |
| `WEBHOOK_MAX_ATTEMPTS`, `WEBHOOK_BACKOFF_MS`, `WEBHOOK_POLL_MS` | Reintentos de entregas |
| `INGEST_LOCAL_ROOT`, `INGESTION_ENABLED`, `INGESTION_TICK_MS` | Carpetas |
| `X12_SENDER_ID`, `X12_RECEIVER_ID`, `X12_USAGE`, `EXPORT_MOCK_CONNECTOR` | Exportaciones |

## Rutas de la app (sesión)

`/integrations` (resumen), `/integrations/api-keys` (+ `/:id/revoke`), `/integrations/webhooks` (+ `/:id`, `/:id/test`, `/:id/secret`, `/:id/rotate-secret`, `/:id/deliveries`), `/integrations/chat-alerts` (+ `/:id`, `/:id/test`, `/:id/deliveries`), `/integrations/deliveries/:id` (+ `/redeliver`), `/integrations/ingestion` (+ `/test`, `/:id`, `/:id/poll`), `/integrations/tracking`, `/shipments/:id/exports/:format`, `/shipments/:id/tracking`.

## Tests

- `packages/integrations`: firmas, mensajes de chat, agrupación, XML de CargoWise, X12 856 y 310 (sobre, conteos, separadores), conector simulado, normalizadores de proveedores y T1–T3.
- `packages/client`: cliente con `fetch` falso y `verifyWebhook` contra la firma del servidor.
- `apps/api/test/integrations.test.mjs`: de punta a punta contra Postgres (su propia base, el nombre de la de pruebas con `_integrations` antes de `_test`, y el puerto `E2E_PORT + 2`): claves, permisos, límites, idempotencia, OpenAPI, webhooks firmados con reintentos y reenvío, eventos una sola vez, respuestas de proveedor, alertas de chat, exportaciones, seguimiento y carpetas.
- `apps/api/test/orgs.test.mjs`: una clave de otra organización recibe 404 en cada ruta de `/api/v1` y en las exportaciones y el seguimiento de la app; viewer, client y analyst no administran integraciones (403); una clave crea envíos en su organización y la auditoría lo anota sin la clave.
- `scripts/api-contract.mjs`: la colección de Postman contra un servidor.
- `npm run a11y` revisa Integraciones (cada pestaña, con datos) y la Referencia de la API.

Migración `048_integrations.sql`: `api_keys`, `api_idempotency`, `integration_events`, `webhook_subscriptions`, `chat_alerts`, `integration_deliveries`, `integration_cursors`, `ingestion_sources`, `ingested_files`, `tracking_settings`, `tracking_snapshots`.
