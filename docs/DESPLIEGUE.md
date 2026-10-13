# Despliegue

DocCheck corre hoy **localmente** en una Mac con Apple Silicon. Esta guía deja documentado cómo levantarlo, operarlo y, más adelante, llevarlo a un servidor.

> **Cuentas.** Todo, salvo `/health` y `/auth/*`, pide sesión. El registro es abierto (correo, nombre y contraseña de 8+ caracteres; scrypt) y cada envío es privado de quien lo creó. La sesión es una cookie `httpOnly` y `SameSite=Lax`, `Secure` cuando la petición llega por HTTPS a través de un proxy en la misma máquina (`TRUST_PROXY`); los POST con `Origin` de otro sitio se rechazan. Después de 10 intentos fallidos para un correo (o 50 desde una dirección) en 15 minutos, el inicio de sesión se bloquea hasta que pase la ventana. Los envíos creados antes de la migración `007_users.sql` no tienen dueño y no se muestran. El registro abierto significa que cualquiera con la URL puede crear cuenta y subir PDFs: para un servidor expuesto, sigue siendo buena idea un proxy con autenticación o lista de IPs delante.

> **Administración.** Las cuentas de `ADMIN_EMAILS` ven en la web Configuración (modelo de extracción entre los instalados en Ollama, revisión del agente, idiomas, escala y modo del OCR), Usuarios (roles y contraseña nueva para quien olvidó la suya: no hay recuperación por correo; se genera una aleatoria, se cierran todas las sesiones de esa cuenta y queda en el log qué admin lo hizo) y Sistema (estado de Ollama, modelo y build en uso, índice de normativa, cola, almacenamiento, caché). Un cambio se guarda en la tabla `settings`, se aplica sin reiniciar y manda sobre `.env` hasta que se restablece; quien lo hizo y cuándo queda registrado. Cambiar el modelo invalida la caché de respuestas (todo se vuelve a extraer) y un modelo sin medir lo dice antes de confirmar. En modo demo la configuración es de solo lectura. Las evaluaciones por línea de comandos (`npm run eval:*`) siguen leyendo solo `.env`.

## Componentes

| Componente | Para qué | Local hoy | Obligatorio |
| --- | --- | --- | --- |
| Node 22+ | API (NestJS) y build de la web | Node 24 | sí |
| PostgreSQL | Envíos, documentos, extracciones, validaciones, hallazgos, trazas del modelo | EDB Postgres 18, puerto 5432, base `doccheck` | sí |
| Ollama | Extracción y agente (`qwen3.8`), embeddings de la normativa (`bge-m3`) | app de Ollama, puerto 11434 | sí |
| Redis | Cola de extracción (BullMQ), claves con prefijo `doccheck` | Homebrew, puerto 6379 | no: sin `REDIS_URL` se extrae dentro del proceso, sin reintentos |
| Almacenamiento S3 | PDFs subidos | SeaweedFS, puerto 9100 (`scripts/dev-s3.sh`) | no: sin `S3_ENDPOINT` van a `.data/uploads` |

La API sirve también la web (`apps/web/dist`), así que todo queda en una sola URL.

### Hardware

- `qwen3.8` ocupa ~19 GB en memoria con contexto de 16k; `bge-m3`, ~1,2 GB. Hace falta una máquina con **32 GB o más** de memoria unificada (Apple Silicon) o una GPU con 24 GB.
- En un M5 Pro de 64 GB la extracción tarda ~30 s por página y una decisión del agente ~10–40 s. Ollama atiende un pedido a la vez: si corre una evaluación, la app espera su turno.

## 1. Local (sin Docker) — lo que está funcionando

### Primera vez

```bash
npm install
```
```bash
cp .env.example .env
```

Edita `.env` (no se versiona). Configuración actual de esta Mac:

```
PORT=3000
DATABASE_URL=postgres://postgres:<contraseña>@localhost:5432/doccheck
STORAGE_DIR=.data/uploads
LLM_MODEL=qwen3.8
EMBED_MODEL=bge-m3
OLLAMA_BASE_URL=http://localhost:11434
S3_ENDPOINT=http://localhost:9100
S3_BUCKET=doccheck
S3_ACCESS_KEY=doccheck
S3_SECRET_KEY=doccheck-secret
REDIS_URL=redis://localhost:6379
```

Crea la base (una sola vez; las tablas las crean las migraciones al arrancar):

```bash
psql -h localhost -U postgres -c "create database doccheck"
```

Modelos en Ollama:

```bash
ollama pull qwen3.8
```
```bash
ollama pull bge-m3
```

Almacenamiento S3 local (SeaweedFS; MinIO de Homebrew no arranca en Apple M5):

```bash
brew install seaweedfs
```

El índice de normativa (`data/corpus/index/bge-m3.json`) ya está en el repositorio. Si cambias de modelo de embeddings o actualizas el corpus:

```bash
npm run corpus:fetch
```
```bash
npm run corpus:index
```

### Arrancar

```bash
scripts/start-local.sh
```

El script revisa Node, Postgres, Redis, el almacenamiento S3 (y levanta SeaweedFS si no está corriendo), Ollama y los dos modelos, el índice de normativa y que el puerto esté libre; después compila y arranca en `http://localhost:3000`. Opciones:

- `scripts/start-local.sh --check` solo revisa, no arranca.
- `scripts/start-local.sh --no-build` arranca el build existente.
- `PORT=3100 scripts/start-local.sh` usa otro puerto.

Al arrancar, la API aplica las migraciones pendientes (`apps/api/migrations`). Para aplicarlas a mano: `npm run db:migrate -w @doccheck/api`.

### Verificar

```bash
curl -s localhost:3000/health
```

Debe responder `"status":"ok"` y `"database":"ok"`. En el navegador, "Try a sample" carga un envío sintético con errores conocidos; al validar deben aparecer exactamente esos errores.

### Dónde quedan los datos

| Qué | Dónde | Respaldo |
| --- | --- | --- |
| Envíos, extracciones, hallazgos, trazas | Postgres, base `doccheck` | `pg_dump -h localhost -U postgres -Fc doccheck > doccheck.dump` |
| PDFs subidos | SeaweedFS en `.data/seaweedfs` (o `.data/uploads` sin S3) | copiar la carpeta con el servicio detenido |
| Respuestas del modelo en evaluaciones | `eval/cache/` (versionado) | git |

Restaurar: `pg_restore -h localhost -U postgres -d doccheck --clean doccheck.dump`.

### Detener

`Ctrl+C` en la terminal de la app. SeaweedFS sigue en segundo plano: `pkill -f "weed server"`. Redis y Postgres son servicios del sistema y quedan corriendo.

### Arranque automático (opcional)

- Redis: `brew services start redis`.
- Postgres de EDB arranca con el sistema.
- Ollama: abrir la app al iniciar sesión (Ajustes del sistema → Ítems de inicio).
- SeaweedFS y la app: un LaunchAgent por cada uno. Plantilla para la app (`~/Library/LaunchAgents/com.doccheck.app.plist`, cambiando la ruta):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.doccheck.app</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>-lc</string><string>cd /Users/smalbach/Documents/doccheck &amp;&amp; scripts/start-local.sh --no-build</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/doccheck.log</string>
  <key>StandardErrorPath</key><string>/tmp/doccheck.log</string>
</dict>
</plist>
```

Cargar con `launchctl load ~/Library/LaunchAgents/com.doccheck.app.plist`. Repetir con `scripts/dev-s3.sh` para SeaweedFS.

### Verlo desde el celular u otra red (ngrok)

```bash
scripts/tunnel.sh
```

Abre el túnel de ngrok hacia la app (puerto 3000) **con usuario y contraseña**, tomados de `.env`:

```
NGROK_URL=https://powerful-stallion-purely.ngrok-free.app
NGROK_BASIC_AUTH=doccheck:<contraseña de 8+ caracteres>
```

El navegador pide esas credenciales al abrir la URL; sin ellas responde 401. ngrok gratuito muestra además una página de aviso la primera vez ("Visit Site"). Cerrar: `scripts/tunnel.sh stop`. Registro en `.data/ngrok.log`.

## 2. Docker (autoalojado)

`Dockerfile` construye una imagen con la API, la web y el corpus de normativa. `docker-compose.yml` la levanta con Postgres (con pgvector), Redis y MinIO bajo el perfil `app`; Ollama queda en el host para usar la GPU.

```bash
docker compose --profile app up -d --build
```

- App en `http://localhost:3000`. Credenciales de la base y de MinIO: las del compose (cambiarlas fuera de un entorno de prueba).
- La galería de muestras usa `data/eval/v1` montado como volumen: corre `npm run synth` antes si no existen los PDFs.
- **Pendiente de verificar:** la imagen no se ha construido con Docker todavía (el daemon no estaba corriendo en esta Mac); sus pasos sí se reprodujeron fuera de Docker (sección 4). Es lo primero que hay que probar.
- La imagen guarda los PDFs en `STORAGE_DIR=/data/uploads` cuando no hay S3; monta un volumen en `/data` para conservarlos.
- En Mac, el puerto 9000 de MinIO choca con php-fpm local: cambia el mapeo `9000:9000` o detén php-fpm.

## 3. Servidor con GPU

Para dejarlo accesible a otras personas con los modelos locales:

1. Servidor Linux con GPU NVIDIA de 24 GB o más (o una Mac con Apple Silicon de 32 GB o más), Docker y el NVIDIA Container Toolkit.
2. Instalar Ollama en el host, `ollama pull qwen3.8` y `ollama pull bge-m3`. Limitar Ollama a localhost (es el valor por defecto).
3. Clonar el repositorio, `cp .env.example .env` y poner credenciales propias, luego `docker compose --profile app up -d --build`.
4. Poner un proxy con TLS y autenticación delante. Ejemplo con Caddy (`/etc/caddy/Caddyfile`):

   ```
   doccheck.ejemplo.com {
     basic_auth {
       usuario <hash generado con: caddy hash-password>
     }
     reverse_proxy localhost:3000
   }
   ```

5. No publicar los puertos de Postgres, Redis ni MinIO: en el compose, quitar sus `ports` o ligarlos a `127.0.0.1`.
6. Respaldos diarios con `pg_dump` y del volumen de MinIO.

Límite de subida: 10 PDFs por pedido, 20 MB cada uno (`apps/api/src/shipments/shipments.controller.ts`). Si el proxy tiene su propio límite, debe ser igual o mayor.

## 4. Demo pública de solo lectura (sin GPU)

Con `DEMO_READONLY=true` la misma app corre sin modelo: muestra una selección de envíos sintéticos y repite las respuestas que el modelo ya dio en local. Basta una VM chica (1 vCPU compartida, 512 MB) con Postgres; no hace falta Ollama, Redis, S3 ni GPU.

Qué cambia en modo demo:

- La API rechaza con 403 toda escritura salvo `POST /demo/samples/:id` y `POST /shipments/:id/validate` (y la cuenta propia: registro, sesión, perfil, contraseña, borrar la cuenta): no se suben PDFs, no se edita el ISF, no se re-extrae, no se borra.
- El modelo corre solo desde caché (`LLM_CACHE_MODE=replay`, `LLM_CACHE_DIR` por defecto `eval/cache/ollama_<LLM_MODEL>`); nunca llama a Ollama. Las muestras se leen de `data/demo` y solo se listan las que tienen su extracción en caché.
- Hay que crear cuenta para entrar (el registro funciona también en modo demo). Cada usuario recibe su propio envío por muestra, porque los envíos son privados: la base crece como usuarios × muestras (unas 24 por usuario).
- Citas: los vectores de las consultas están en `data/corpus/index/bge-m3.queries.json`; si falta una, la búsqueda usa solo palabras clave (BM25).
- Si falta la respuesta del agente para un envío, la validación igual devuelve los hallazgos de las reglas y dice que el agente no está disponible.
- La web pregunta a `GET /health` (`demo: true`), oculta subida, borrar y editar ISF y muestra un aviso.

### Archivos

| Archivo | Para qué |
| --- | --- |
| `Dockerfile` | Imagen multi-etapa: compila todo y deja solo lo que corre (dependencias de producción de la API, `dist`, migraciones, web, corpus, `eval/cache`, `eval/reports`, `data/demo`). Corre como usuario `node`; `HEALTHCHECK` contra `/health`. Argumentos: `OCR=false` quita Tesseract (~65 MB; la demo nunca hace OCR) y `REQUIRE_DEMO_SAMPLES=true` hace fallar el build si `data/demo` está vacío |
| `scripts/docker-entrypoint.sh` | Si el contenedor arranca como root (volúmenes de Fly y Render se montan como root), le da `STORAGE_DIR` al usuario `node` y baja a ese usuario antes de arrancar la API |
| `fly.toml` | Fly.io (recomendado): VM `shared-cpu-1x` de 512 MB que se apaga sin visitas, volumen de 1 GB en `/data`, chequeo de `/health`, HTTPS forzado, variables de la demo |
| `render.yaml` | Alternativa en Render (Blueprint): instancia `starter` con disco de 1 GB |
| `docker-compose.demo.yml` | La demo en local tal como corre en producción (mismos argumentos y variables), con un Postgres local en lugar de Neon |

### Requisitos

1. **Muestras preparadas y versionadas.** La imagen copia `data/demo`, `eval/cache` y `data/corpus/index/bge-m3.queries.json` del repositorio; sin muestras el build de la demo falla a propósito. Prepararlas (una vez, y de nuevo si cambia el prompt o el modelo), en esta Mac con Ollama:

   ```bash
   npm run synth                                            # PDFs de data/eval/v1 (no se versionan)
   ```
   ```bash
   LLM_CACHE_DIR=eval/cache/ollama_qwen3.8 npm start        # modo normal, con Ollama; deja la terminal abierta
   ```
   ```bash
   npm run demo:build                                       # en otra terminal: elige ~24 muestras, las corre por la API,
                                                            # llena las cachés y copia PDFs, verdad y etiquetas a data/demo
   ```
   ```bash
   git add data/demo eval/cache data/corpus/index/bge-m3.queries.json && git commit -m "Demo samples"
   ```

   Sin `LLM_CACHE_DIR` las respuestas no quedan en caché y la demo no las encuentra. El script descarta las muestras cuyo agente no terminó.
2. **Cuenta en Fly.io** con tarjeta registrada y `flyctl` instalado e iniciado (`brew install flyctl`, `fly auth login`).
3. **Postgres.** Recomendado: [Neon](https://neon.tech), plan gratuito (0,5 GB), proyecto en AWS `us-east-1` (cerca de la región `iad` de Fly). Copiar la cadena de conexión y cambiar el final por `?sslmode=verify-full`. La app no necesita pgvector ni extensiones; las tablas las crean las migraciones al arrancar. Alternativa dentro de Fly: `fly postgres create --name doccheck-demo-db --region iad --initial-cluster-size 1 --vm-size shared-cpu-1x --volume-size 1` y luego `fly postgres attach doccheck-demo-db` (pone `DATABASE_URL` sola; ~2–4 USD/mes más, y Fly no administra esa base: respaldos y actualizaciones quedan por cuenta propia).

### Probar en local antes de publicar

```bash
docker compose -f docker-compose.demo.yml up -d --build
```
```bash
curl -s localhost:4060/health
```

Debe responder `"status":"ok"` y `"demo":true`. En `http://localhost:4060`: crear cuenta, "Try a sample", validar; subir o borrar debe dar 403. El puerto se cambia con `DEMO_PORT=4070 docker compose -f docker-compose.demo.yml up -d --build`. Apagar y borrar la base de prueba:

```bash
docker compose -f docker-compose.demo.yml down -v
```

Sin Docker: `DEMO_READONLY=true npm start`.

Verificado el 13/10/2026 sin Docker (el daemon estaba apagado): se reprodujeron los pasos del `Dockerfile` (dependencias de producción de la API sin Tesseract, solo `dist`) en una carpeta aparte y se arrancó como en `fly.toml`, sin `.env` ni Ollama: migraciones al arrancar, 24 muestras listadas, carga y validación con hallazgos, agente y citas desde caché, PDF guardado en `STORAGE_DIR`, crear y borrar envíos dan 403, cookie `Secure` detrás de un proxy HTTPS y con `SIGNUP_LIMIT_PER_HOUR=3` el 4.º registro desde una misma dirección da 429 mientras otra dirección sigue pudiendo. ~200 MB de memoria residente. Falta construir la imagen con Docker y probar `docker-compose.demo.yml`.

### Publicar en Fly.io

Desde la raíz del repositorio, con las muestras ya versionadas. El nombre de la app es único en todo Fly: cambia `doccheck-demo` por uno propio (queda la URL `https://<nombre>.fly.dev`).

```bash
fly launch --copy-config --no-deploy --name doccheck-demo --region iad
```

Usa el `fly.toml` del repositorio y crea la app sin desplegar. Si pregunta por ajustes, Postgres, Redis o almacenamiento de Fly, responder que no (la base va por secreto).

```bash
fly volumes create doccheck_data --size 1 --region iad --yes
```
```bash
fly secrets set DATABASE_URL='postgres://<usuario>:<contraseña>@<host>.neon.tech/neondb?sslmode=verify-full' ADMIN_EMAILS='tu@correo.com'
```
```bash
fly deploy
```
```bash
curl -s https://doccheck-demo.fly.dev/health
```

`fly deploy` construye la imagen en los servidores de Fly (no hace falta Docker local). Al arrancar, la API aplica las migraciones. Debe quedar una sola máquina (el volumen y el límite de registros son por máquina): `fly scale count 1` si `fly status` muestra más. Logs: `fly logs`.

### Costo estimado (precios publicados de Fly y Neon; verificar al contratar)

| Qué | Costo mensual |
| --- | --- |
| VM `shared-cpu-1x` 512 MB | ~3,2 USD si estuviera encendida todo el mes; con `auto_stop_machines` se paga solo el tiempo encendida (una demo con pocas visitas: ~0,5–1,5 USD) |
| Volumen de 1 GB | ~0,15 USD |
| Neon, plan gratuito | 0 USD (0,5 GB; la base se suspende sin uso y despierta en ~1 s) |
| Tráfico saliente | centavos (0,02 USD/GB en Norteamérica y Europa) |
| **Total** | **~1–4 USD/mes** |

Con Render (`render.yaml`): instancia `starter` 7 USD + disco 0,25 USD ≈ 7,3 USD/mes, más Neon gratis.

### Actualizar

Cada cambio de código, de prompt o de muestras: volver a preparar las muestras si cambió el prompt o el modelo (Requisitos, paso 1), hacer commit y

```bash
fly deploy
```

Las migraciones nuevas se aplican solas al arrancar (con bloqueo, una vez). Volver a la versión anterior: `fly releases` y `fly deploy --image <imagen de esa versión>`.

### Reiniciar la base de la demo

Borra todas las cuentas y envíos; las tablas se recrean al reiniciar. Con Neon, en su consola (SQL Editor) o con `psql`:

```bash
psql "$DATABASE_URL" -c "drop schema public cascade; create schema public;"
```
```bash
fly ssh console -C "sh -c 'rm -rf /data/uploads/*'"
```
```bash
fly apps restart doccheck-demo
```

En Neon también sirve restaurar la rama a un punto anterior (Branches → Restore). En local: `docker compose -f docker-compose.demo.yml down -v`.

### Seguridad

- **Solo lectura**: nadie puede subir archivos, editar ni borrar envíos; solo cargar muestras propias y validarlas. No hay Ollama ni modelo detrás: una respuesta que no esté en caché da error, nunca una llamada a un modelo.
- **Registro**: abierto, con `SIGNUP_LIMIT_PER_HOUR=5` cuentas por dirección y hora. `TRUST_PROXY=1` hace que cuente la dirección real del visitante (la que agrega el proxy de Fly) y que la cookie de sesión salga `Secure`; sin eso todos los visitantes compartirían la dirección del proxy. El límite vive en memoria: se reinicia cuando la máquina se apaga. Si hay abuso, un admin (`ADMIN_EMAILS`) cierra el registro desde Configuración, o `fly secrets set REGISTRATION_OPEN=false`.
- **Inicio de sesión**: bloqueo tras 10 intentos fallidos por correo o 50 por dirección en 15 minutos.
- **Secretos**: `DATABASE_URL` y `ADMIN_EMAILS` solo como `fly secrets`, nunca en `fly.toml` ni en el repositorio. Neon exige TLS (`sslmode=verify-full`) y contraseña; la base no tiene otra exposición.
- **Contenedor**: la API corre como usuario `node`; solo `/data/uploads` es escribible. HTTPS forzado (`force_https`).
- **Crecimiento**: cada usuario puede generar ~24 envíos (uno por muestra); el plan gratuito de Neon (0,5 GB) alcanza para miles de cuentas. Si se llena, reiniciar la base.
- **Datos**: todo es sintético; no subir datos reales a la demo (tampoco se puede).

### Alternativa: Render

`render.yaml` describe el mismo servicio. En Render: New → Blueprint → elegir el repositorio; pide `DATABASE_URL` (Neon) y `ADMIN_EMAILS`. Render pasa las variables (`OCR`, `REQUIRE_DEMO_SAMPLES`) también como argumentos del build. El disco persistente exige instancia de pago (`starter`); en el plan gratuito los PDFs de las muestras cargadas se pierden en cada reinicio. `TRUST_PROXY=1` está pensado para un solo proxy delante; en Render no se ha verificado cuántos saltos agrega su borde.

## Variables de entorno

| Variable | Por defecto | Uso |
| --- | --- | --- |
| `PORT` | 3000 | Puerto de la API y la web |
| `DATABASE_URL` | — (obligatoria) | Conexión a Postgres |
| `MIGRATE_ON_START` | `true` | Aplicar migraciones al arrancar |
| `STORAGE_DIR` | `.data/uploads` (`/data/uploads` en la imagen Docker) | PDFs cuando no hay S3 |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION` | — | Almacenamiento S3 (MinIO, SeaweedFS, AWS, R2); el bucket se crea solo |
| `REDIS_URL` | — | Cola de extracción; sin ella, extracción en el mismo proceso |
| `EXTRACTION_CONCURRENCY` | 1 | Extracciones simultáneas (subir solo con varias GPUs o modelos) |
| `EXTRACTION_WORKER` | `true` | `false` para una API sin worker (worker en otro proceso) |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Servidor de modelos |
| `LLM_MODEL` | `qwen3.8` | Modelo de extracción y del agente |
| `EMBED_MODEL` | `bge-m3` | Modelo de embeddings; debe coincidir con el índice |
| `AGENT_ENABLED` | `true` | Revisión del agente en `/validate` (por pedido: `?agent=false`) |
| `CORPUS_DIR` | `data/corpus` | Corpus de normativa e índice |
| `EVAL_DIR` | `data/eval/v1` (`data/demo` en modo demo) | Muestras para la galería |
| `DEMO_READONLY` | `false` | Demo pública de solo lectura: sin escrituras, modelo desde caché (sección 4) |
| `LLM_CACHE_DIR`, `LLM_CACHE_MODE` | — | Caché de respuestas del modelo (`readwrite`, `replay`, `off`) |
| `TRUST_PROXY` | `loopback` | Proxies cuyas cabeceras `X-Forwarded-*` se creen (cookie `Secure` y dirección del cliente). Valor de Express `trust proxy`: `loopback`, una IP o subred, un número de saltos (`1` detrás del borde de Fly.io o Render), `true` o `false` |
| `ADMIN_EMAILS` | — | Correos de administradores (separados por coma). Solo así se obtiene el rol admin; registrarse nunca lo da. Un admin puede ascender a otros desde la web |
| `REGISTRATION_OPEN` | `true` | Registro abierto; un admin lo cierra desde Configuración. Cerrado, solo se registran los correos de `ADMIN_EMAILS` |
| `SIGNUP_LIMIT_PER_HOUR` | 5 | Cuentas nuevas por dirección y hora (las peticiones desde la misma máquina no cuentan; detrás del túnel cuenta la IP real del visitante) |
| `OCR_LANGS`, `OCR_SCALE`, `OCR_PSM` | `eng+fra`, `4`, `6` | OCR de páginas escaneadas: idiomas instalados, escala de render (4 = 288 dpi) y modo de página de Tesseract |
| `DEMO_BUILD_EMAIL`, `DEMO_BUILD_PASSWORD` | — | Cuenta con la que `scripts/demo-build.mjs` inicia sesión; sin ellas crea una cuenta desechable |

## Problemas conocidos

| Síntoma | Causa | Solución |
| --- | --- | --- |
| `minio` se cae con `SIGSEGV` en `go-m1cpu` | El binario de Homebrew no reconoce la CPU M5; además MinIO está archivado | Usar SeaweedFS (`scripts/dev-s3.sh`) o MinIO en Docker |
| `brew install pgvector` falla con `cannot load such file -- macho` | Homebrew no soporta macOS 27; además el Postgres de EDB no carga extensiones de Homebrew | No hace falta: la búsqueda de normativa usa índice en memoria. Si se necesita, compilar pgvector contra `/Library/PostgreSQL/18/bin/pg_config` |
| La extracción queda en `QUEUED` | Ollama ocupado (evaluación corriendo) o worker detenido | Esperar, o revisar que `REDIS_URL` apunte al Redis correcto y que la API muestre "Extraction queue ready" |
| `Ollama is not reachable` | Ollama cerrado, o otro programa (p. ej. AnythingLLM con su propio Ollama) en el puerto 11434 | Abrir Ollama; `lsof -nP -iTCP:11434` para ver quién tiene el puerto |
| Un documento quedó con el tipo equivocado | El clasificador falló (más probable en escaneos) | En la web, "extracted data" → elegir el tipo → Re-extract |
| `validate` responde 409 | Documentos todavía extrayéndose | Esperar a que todos estén `extracted` |
| Envío US en `NEEDS_INPUT` | Falta el ISF, que necesita X11 | Subir el ISF como JSON en la página del envío (o `PUT /shipments/:id/isf`) |
