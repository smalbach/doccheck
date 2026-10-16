# Correo dentro de la app

Las conversaciones con proveedores viven en DocCheck: se escriben, se envían, se reciben y se siguen desde la app, sin copiar textos a un cliente de correo.

## Qué hace

- **Pedir correcciones** desde los hallazgos de un envío. El mensaje se redacta en en/es/fr con cada hallazgo, los valores de cada documento y qué corregir; se puede editar antes de enviar. Al enviarlo, los hallazgos pasan a "Esperando al proveedor".
- **Escribir a una empresa** desde su página, o sobre un envío desde su página.
- **Bandeja** (menú lateral, con el número de respuestas sin leer): filtros Abiertas, Sin leer, Esperando respuesta, Vencidas, No enviadas, Cerradas y Todas, con búsqueda.
- **Conversación:** todos los correos en orden, el estado de entrega de cada uno (en cola, enviando, enviado, no enviado con su error y "Reenviar"), los adjuntos recibidos, los hallazgos consultados con su estado actual, responder y cerrar o reabrir.
- **Adjuntos:** un PDF recibido se agrega al envío con un clic y se lee como cualquier carga. Después se vuelve a validar y los hallazgos corregidos aparecen como resueltos.
- **Alertas** en el panel: respuesta del proveedor, sin respuesta pasada la fecha de seguimiento, correo no enviado.
- **Portal de proveedores:** la solicitud de corrección puede llevar un enlace para que el proveedor, sin cuenta, vea qué corregir en su idioma y suba los PDF corregidos, que llegan a la conversación y se revisan; también hay revisiones previas al embarque. Ver [PORTAL.md](PORTAL.md).
- **Admin:** correo recibido que no responde a ninguna conversación ("sin asignar"), para asignarlo; y en Sistema, cómo envía y recibe este servidor.

## Cómo funciona

| Pieza | Detalle |
| --- | --- |
| Salida | Cada mensaje se guarda primero en `mail_messages` (en cola) y un worker lo envía por `SMTP_URL`. Si falla por algo temporal, reintenta a 1, 2, 4 y 8 minutos y luego queda "no enviado"; un rechazo permanente del servidor (SMTP 5xx, como un dominio sin verificar) queda "no enviado" de inmediato, con el motivo. Varios procesos pueden enviar a la vez (`for update skip locked`). Sin `SMTP_URL` el mensaje solo se registra: log, y un `.eml` en `MAIL_CAPTURE_DIR`. |
| Hilos | Cada conversación tiene un token: va en el asunto (`[DC-k3x9p2]`) y en la dirección de respuesta (`docs+k3x9p2@…`). Cada mensaje lleva su `Message-ID`, y las respuestas llevan `In-Reply-To` y `References`. |
| Entrada | IMAP (`IMAP_URL`, consulta periódica que recuerda el último UID) o un webhook (`POST /mail/inbound` con `X-Inbound-Secret`). La respuesta se asigna por `In-Reply-To`/`References`, luego por el `+token` de la dirección y luego por el token del asunto; lo que no coincide queda sin asignar. Se descartan duplicados por `Message-ID`. Un aviso de rebote marca como no enviado el mensaje que rebotó. |
| Adjuntos | Solo de correo que pertenece a una conversación: PDF, imágenes, CSV y documentos de Office, hasta 20 MB cada uno, 10 por mensaje y 40 MB en total, en el mismo almacenamiento que los PDF del envío. Se sirven con `nosniff` y una CSP cerrada, nunca como página. El correo sin asignar guarda solo el texto y se borra a los 30 días. |
| Remitente | Se guarda una sola dirección, la que el mensaje dice, y a ella se responde (nunca a la lista del texto From). Si el servidor que lo recibió reporta que DMARC, DKIM o SPF fallaron, el mensaje lleva el aviso "Remitente sin verificar". |
| Rebotes | Solo cuenta un informe de entrega real (`multipart/report; report-type=delivery-status`), y solo el Message-ID de su parte de cabeceras originales. |
| Robustez | Un mensaje que no se puede guardar no traba el buzón: se registra en el log y el lector sigue. Los mensajes de más de 25 MB se saltan. Los caracteres NUL se eliminan. |
| Límites | Por usuario, 60 mensajes por hora y 300 por día; para todo el servidor, 1000 por hora (`MAIL_USER_HOURLY`, `MAIL_USER_DAILY`, `MAIL_SERVER_HOURLY`). Se cuentan dentro de la transacción con un lock por usuario, así que las solicitudes en paralelo no los saltan, y reenviar también cuenta. `MAIL_ALLOWED_SENDERS=admins` deja enviar solo a los admins: úsalo si el registro está abierto en un servidor público. El webhook revisa el secreto antes de leer el cuerpo (máximo 25 MB). `/mail/status` muestra la configuración completa solo a los admins. En la demo pública todo es de solo lectura y el worker no corre. |

Migraciones `015_mail.sql`, `016_mail_hardening.sql` y `017_mail_intake.sql` (recepción de documentos: `mail_intakes`, `users.intake_token`): `mail_threads`, `mail_messages`, `mail_attachments`, `mail_contacts` (direcciones usadas, sugeridas la próxima vez junto con los correos que imprimen los documentos de la empresa) y `mail_cursors`.

## Configuración desde la app

En **Admin → Configuración → Buzón de correo**:
- **Envío (SMTP)** y **Recepción (IMAP)**, con valores precargados para Gmail, Outlook/Microsoft 365, Resend (solo envío) y Zoho.
- Remitente, dirección de respuesta y el uso de `+códigos`.
- Botones **Enviar correo de prueba** (al correo del admin) y **Probar el buzón**, que usan los valores del formulario antes de guardar.
- Lo guardado reemplaza a `.env` hasta que se pulsa **Usar .env**.

Las contraseñas se guardan cifradas (AES-256-GCM) con `SETTINGS_KEY`, o con una clave generada en `.data/settings.key` si esa variable no está; nunca vuelven al navegador. Si la clave cambia, hay que volver a escribirlas. En contenedores define `SETTINGS_KEY` (32 bytes en base64), porque el disco no se conserva.

## Documentos por correo

Con **Documentos por correo** activado (en la misma tarjeta), un correo con PDF adjuntos se convierte en un envío revisado:

1. **De quién es:**
   - Si va a la dirección personal del usuario, `buzón+in-<código>@…`, es de ese usuario. La dirección aparece en su página **Cuenta**.
   - Si llega desde el propio correo del usuario, también es suyo, pero solo cuando el servidor receptor verificó al remitente (DMARC o DKIM `pass`).
2. **A qué envío va:** si el asunto contiene la referencia de un envío del usuario (de los últimos 120 días), los PDF se agregan a ese envío. Si no, se crea uno nuevo con el asunto como referencia.
3. **Proceso:** los PDF se extraen como cualquier carga. Si el envío no tiene destino, se toma de los documentos: puerto de descarga o de entrega del BL, puerto de entrada de la factura o país del consignatario (CA o US). Luego se valida.
4. **Aviso:** la conversación queda sin leer en la Bandeja, con el estado de la recepción (leyendo, validado con N hallazgos, falta el destino, no se pudo validar) y el botón **Validar de nuevo**. En el panel aparece la alerta "Documentos por correo". Si quien envió es el propio usuario, recibe un correo con el resultado y el enlace.

Límites: 30 correos con documentos por usuario y hora. Los PDF ilegibles se ignoran.

## Configuración

Variables en `.env.example`: `SMTP_URL`, `MAIL_FROM`, `MAIL_REPLY_TO`, `MAIL_PLUS_ADDRESSING`, `IMAP_URL`, `IMAP_MAILBOX`, `IMAP_POLL_MS`, `MAIL_INBOUND_SECRET` y `MAIL_FOLLOW_UP_DAYS`.

- **Gmail o Google Workspace:** SMTP `smtps://usuario:contraseña-de-aplicación@smtp.gmail.com:465`, IMAP `imaps://usuario:contraseña-de-aplicación@imap.gmail.com:993`. El `+token` funciona sin configurar nada.
- **Proveedor transaccional** (Resend, Postmark, Mailgun) para enviar, y su reenvío de entrada (o Cloudflare Email Routing con un Worker) apuntando a `POST /mail/inbound` con el mensaje crudo como cuerpo, o JSON `{ "raw": "<base64>" }`.

## API

| Método | Ruta |
| --- | --- |
| GET | `/mail/summary`, `/mail/status`, `/mail/threads?filter=&q=&shipmentId=&partyId=`, `/mail/threads/:id`, `/mail/contacts?partyId=`, `/mail/attachments/:id/file` |
| POST | `/mail/threads` (`kind`: `correction_request` o `conversation`), `/mail/threads/:id/reply`, `/mail/threads/:id/read`, `/mail/threads/:id/status`, `/mail/messages/:id/retry`, `/mail/attachments/:id/import` |
| Admin | GET `/mail/unassigned`, POST `/mail/messages/:id/assign` |
| Público | POST `/mail/inbound` (con secreto) |
