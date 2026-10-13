# Despliegue

DocCheck corre hoy **localmente** en una Mac con Apple Silicon. Esta guía deja documentado cómo levantarlo, operarlo y, más adelante, llevarlo a un servidor.

> **La aplicación no tiene autenticación.** Cualquiera que llegue al puerto puede subir PDFs, ver envíos y descargar documentos. Mientras sea así, no la expongas a internet sin un proxy con autenticación delante (ver [Servidor con GPU](#3-servidor-con-gpu)).

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
- **Pendiente de verificar:** el Dockerfile no se ha construido todavía (Docker no estaba corriendo en esta Mac). Es lo primero que hay que probar.
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

Con `DEMO_READONLY=true` la misma app corre sin modelo: muestra una selección de envíos sintéticos y repite las respuestas que el modelo ya dio en local. Sirve un VPS chico (1 vCPU, 1 GB) con Postgres; no hace falta Ollama, Redis ni S3.

Qué cambia en modo demo:

- La API rechaza con 403 toda escritura salvo `POST /demo/samples/:id` y `POST /shipments/:id/validate`: no se suben PDFs, no se edita el ISF, no se re-extrae, no se borra.
- El modelo corre solo desde caché (`LLM_CACHE_MODE=replay`, `LLM_CACHE_DIR` por defecto `eval/cache/ollama_<LLM_MODEL>`). Las muestras se leen de `data/demo` y solo se listan las que tienen su extracción en caché.
- Cada muestra se carga una sola vez: todos los visitantes ven el mismo envío, así la base no crece.
- Citas: los vectores de las consultas están en `data/corpus/index/bge-m3.queries.json`; si falta una, la búsqueda usa solo palabras clave (BM25).
- Si falta la respuesta del agente para un envío, la validación igual devuelve los hallazgos de las reglas y dice que el agente no está disponible.
- La web pregunta a `GET /health` (`demo: true`), oculta subida, borrar y editar ISF y muestra un aviso.

Preparar las muestras (una vez, y de nuevo si cambia el prompt o el modelo):

```bash
npm start                         # modo normal, con Ollama
node scripts/demo-build.mjs       # elige ~24 muestras (cada tipo de error, CA y US, más limpias),
                                  # las corre por la API, llena las cachés y copia todo a data/demo
git add data/demo eval/cache data/corpus/index/bge-m3.queries.json
```

Levantar la demo:

```bash
docker compose --profile demo up -d --build      # app + Postgres, en :3000
```

o sin Docker: `DEMO_READONLY=true npm start`.

Para publicarla: VPS con Docker, proxy con TLS (Caddy como en la sección 3; el basic auth es opcional porque nada se puede modificar) y no publicar el puerto de Postgres. Probado en local con una segunda API en :3105 contra un Ollama inexistente: muestras, validación y citas funcionan; las escrituras dan 403; en celular sin scroll horizontal. El build de la imagen sigue pendiente (Docker apagado).

## Variables de entorno

| Variable | Por defecto | Uso |
| --- | --- | --- |
| `PORT` | 3000 | Puerto de la API y la web |
| `DATABASE_URL` | — (obligatoria) | Conexión a Postgres |
| `MIGRATE_ON_START` | `true` | Aplicar migraciones al arrancar |
| `STORAGE_DIR` | `.data/uploads` | PDFs cuando no hay S3 |
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
