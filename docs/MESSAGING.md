# Correo dentro de la app

Las conversaciones con proveedores viven en DocCheck: se escriben, se envían, se reciben y se siguen desde la app, sin copiar textos a un cliente de correo.

## Qué hace

- **Pedir correcciones** desde los hallazgos de un envío. El mensaje se redacta en en/es/fr con cada hallazgo, los valores de cada documento y qué corregir; se puede editar antes de enviar. Al enviarlo, los hallazgos pasan a "Esperando al proveedor".
- **Escribir a una empresa** desde su página, o sobre un envío desde su página.
- **Bandeja** (menú lateral, con el número de respuestas sin leer): filtros Abiertas, Sin leer, Esperando respuesta, Vencidas, No enviadas, Cerradas y Todas, con búsqueda.
- **Conversación:** todos los correos en orden, el estado de entrega de cada uno (en cola, enviando, enviado, no enviado con su error y "Reenviar"), los adjuntos recibidos, los hallazgos consultados con su estado actual, responder y cerrar o reabrir.
- **Adjuntos:** un PDF recibido se agrega al envío con un clic y se lee como cualquier carga. Después se vuelve a validar y los hallazgos corregidos aparecen como resueltos.
- **Alertas** en el panel: respuesta del proveedor, sin respuesta pasada la fecha de seguimiento, correo no enviado.
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

Migraciones `015_mail.sql` y `016_mail_hardening.sql`: `mail_threads`, `mail_messages`, `mail_attachments`, `mail_contacts` (direcciones usadas, sugeridas la próxima vez junto con los correos que imprimen los documentos de la empresa) y `mail_cursors`.

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
