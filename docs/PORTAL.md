# Portal de proveedores

Una página que el proveedor abre desde un enlace, sin crear una cuenta, para ver qué corregir y subir los documentos corregidos, o para revisar el borrador de sus documentos antes del embarque. Está montado sobre el correo de la app ([MESSAGING.md](MESSAGING.md)): cada solicitud del portal tiene su conversación, y lo que el proveedor hace en el portal aparece en ella.

## Qué hace

- **Solicitud de corrección con enlace.** Al pedir correcciones desde los hallazgos de un envío, la casilla **Incluir un enlace para subir documentos** (marcada por defecto) agrega al correo la línea con el enlace, en el idioma del proveedor. El proveedor abre el enlace y ve:
  - los hallazgos de la solicitud, con el texto de "qué hacer" de cada regla en su idioma (en/es/fr), los valores que cita cada documento y la página;
  - "Corregido" en los que ya no aparecen en la última validación;
  - un formulario para subir los PDF corregidos, con un mensaje opcional;
  - cómo fue cada carga (leyendo, revisando, revisado con N puntos por corregir).
- **Revisión previa al embarque.** En la Bandeja (y en la página de cada empresa), **Nueva revisión previa** crea, para una empresa proveedora, un envío borrador con el destino elegido y le envía un correo con el enlace. El proveedor sube el borrador de la factura y de la lista de empaque y ve los hallazgos en el momento. Las reglas que necesitan un documento que todavía no existe (el conocimiento de embarque, el ISF) se muestran aparte, como "Se revisa después del embarque", con el documento que les falta. Puede volver a subir hasta que no quede nada.
- **Historial del proveedor.** Debajo, sus otras solicitudes del mismo importador (misma empresa), solo con tipo, referencia, fecha y estado: no se abren desde ahí.
- **Del lado del importador:**
  - en la conversación, el panel **Portal de proveedores**: estado, hasta cuándo sirve el enlace, **Copiar enlace**, **Enlace nuevo** (el anterior deja de servir), **Desactivar enlace**, **Cerrar solicitud** / **Reabrir**, y la actividad (enlace creado, abierto N veces, subió tal archivo, carga rechazada y por qué, revisado con N puntos, enlace rechazado por vencido o desactivado);
  - una conversación de corrección enviada sin enlace puede tener uno con **Crear enlace para subir documentos**;
  - en la Bandeja, la tarjeta **Revisiones previas al embarque** con el estado de cada proveedor;
  - cada carga llega a la conversación como un mensaje recibido con la etiqueta "Por el portal" y los PDF adjuntos, y la deja sin leer en la Bandeja.

Estados de una solicitud: esperando (al proveedor), revisando (una carga se está leyendo o validando), hay puntos por corregir, no queda nada por corregir, la última carga no se pudo revisar, cerrada. Una corrección que se resolvió por otro camino (por correo, o corrigiendo el valor a mano) queda "no queda nada por corregir" en cuanto se vuelve a validar.

## Cómo funciona

| Pieza | Detalle |
| --- | --- |
| Enlace | `APP_URL/#/portal?t=<token>`. El token va en el fragmento (`#`): el navegador nunca lo manda a un servidor ni en el `Referer`. La página lo guarda en `sessionStorage` y lo quita de la barra de direcciones y del historial apenas lo lee. |
| Token | `<id del enlace>.<HMAC-SHA256 del id>`, firmado con una clave derivada (HKDF) de `SETTINGS_KEY`. Nadie puede fabricar uno sin la clave. En la base solo se guarda un SHA-256 del token, que se compara en tiempo constante, igual que la firma: una copia de la base no abre nada. Como el token sale del id y la clave, la app puede volver a mostrar el enlace (Copiar enlace) sin guardarlo. Si `SETTINGS_KEY` cambia, todos los enlaces dejan de servir. |
| Correos | El texto guardado lleva `{{portal-link}}`, no el enlace. El enlace se arma solo al enviar el correo, con el enlace activo de la conversación; si no hay ninguno (vencido, desactivado, solicitud cerrada) esa línea se quita. Sin `APP_URL` en producción no se puede armar: la línea se quita y el enlace se copia desde la app. |
| Alcance | Un enlace lleva a una sola solicitud. Las rutas del portal (`/portal/*`) no usan la sesión: solo el encabezado `X-Portal-Token`, así que ningún otro sitio puede usarlo desde el navegador del proveedor, y el token no abre ninguna otra ruta. El proveedor no ve ids de documentos ni de envío, ni el razonamiento del agente, ni las notas o decisiones del importador. Un valor de una factura o lista de empaque de otra empresa del importador no se muestra. |
| Vencimiento | 30 días por defecto (`PORTAL_LINK_DAYS`, como máximo 90; también al crear un enlace, `days`). Un enlace nuevo desactiva los anteriores; cerrar la solicitud los desactiva todos. Un token que no es de este servidor o no coincide con un enlace da 404 sin decir por qué; uno vencido, desactivado o de una solicitud cerrada da 410 con el motivo, para que el proveedor sepa pedir otro. |
| Auditoría | Cada uso queda en `portal_events` con dirección IP y navegador: abierto, carga, carga rechazada (con el motivo y los nombres de archivo), revisado, rechazado (con el motivo). Los rechazos que no coinciden con ningún enlace se guardan sin solicitud y se borran a los 30 días. |
| Límites | Por dirección: 300 llamadas cada 15 minutos (`PORTAL_IP_REQUESTS`) y 20 enlaces rechazados cada 15 minutos (`PORTAL_IP_DENIED`), después de lo cual hasta un enlace bueno espera (429 con `Retry-After`). Por solicitud, 20 cargas por hora (`PORTAL_REQUEST_UPLOADS`), y por dirección 30 (`PORTAL_IP_UPLOADS`). En memoria, por proceso. El token se revisa antes de leer el cuerpo de una carga. |
| Cargas | Solo PDF, decidido por los bytes (`%PDF`) y no por el nombre ni el tipo que dice el navegador; los mismos límites que los adjuntos de correo: 20 MB cada uno, 10 por carga y 40 MB en total. Una carga rechazada queda en la actividad. Lo aceptado entra como un mensaje recibido de la conversación con los PDF como adjuntos (mismo almacenamiento, mismas reglas al servirlos: `nosniff` y CSP cerrada), se agrega al envío como documentos que se extraen igual que cualquier carga, y cuando todos los documentos del envío terminaron, el envío se valida de nuevo y el proveedor ve el resultado. Lo que sube el proveedor entra al envío sin que nadie lo apruebe (para que vea el resultado en el momento) y queda marcado "Por el portal" en la conversación: la validación usa el documento más reciente de cada tipo, así que si uno no corresponde, se sube (o se le pide al proveedor) el correcto, y se puede cerrar la solicitud para que no suba más. |
| Validación | Determinista, la de siempre: `POST /shipments/:id/validate` por dentro. En el borrador previo al embarque faltan el conocimiento de embarque y el ISF, así que el motor salta las reglas que los necesitan y lo dice (`skipped`, con los documentos que faltan). Los modelos corren en local: nada del portal sale a un servicio de IA externo. |

Migración `030_supplier_portal.sql`: `portal_requests` (solicitud: corrección o previa al embarque, envío, empresa, conversación, idioma, hallazgos), `portal_links` (hash del token, vencimiento, desactivación, último uso), `portal_events` (auditoría) y `portal_uploads` (cada carga y su revisión).

## Página pública

`#/portal` fuera de la app (sin barra lateral ni sesión): la marca, idioma y tema, una columna que funciona en el teléfono. La primera vez que se abre, toma el idioma de la solicitud; el proveedor lo puede cambiar. Entra en `npm run a11y` (un enlace que funciona y uno que no, en claro y oscuro, a 375 y 1280 px, en los tres idiomas), igual que el panel del importador en la conversación.

## API

| Método | Ruta |
| --- | --- |
| Proveedor (`X-Portal-Token`) | GET `/portal/session` (la solicitud como la ve el proveedor), POST `/portal/uploads` (multipart: `files`, `note` opcional) |
| GET | `/supplier-portal/requests?partyId=&threadId=&shipmentId=&kind=`, `/supplier-portal/requests/:id` (con enlaces y actividad), `/supplier-portal/requests/:id/link` (el enlace activo, para copiarlo) |
| POST | `/supplier-portal/requests` (revisión previa: `partyId` o `supplierName`, `reference`, `destination`, `language`, `to`, `cc`, `subject`, `body`, `days`), `/supplier-portal/requests/:id/links` (enlace nuevo), `/supplier-portal/requests/:id/revoke` (`linkId` opcional), `/supplier-portal/requests/:id/close` (`closed`), `/supplier-portal/threads/:threadId/request` (enlace para una solicitud de corrección que no lo tenía) |
| Correo | POST `/mail/threads` acepta `portal: true` en una solicitud de corrección; `{{portal-link}}` en el texto marca dónde va el enlace (si falta, se agrega la línea al final). |

En la demo pública de solo lectura, el portal se ve pero no acepta cargas.
