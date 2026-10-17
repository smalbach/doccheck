# Bitácora de DocCheck (material para LinkedIn)

Registro vivo de lo que se construyó, por qué y con qué resultado. Cada número sale de un archivo del
repositorio (citado al lado) para que cualquier afirmación del post se pueda verificar. Se actualiza a
medida que avanza el proyecto; los borradores de publicaciones están en [POSTS.md](POSTS.md).

## Qué es, en una frase

DocCheck revisa los documentos de un embarque (factura comercial, packing list, bill of lading e ISF)
antes de que lleguen a la aduana de Canadá (CBSA) o de EE. UU. (CBP): un modelo local lee los PDF,
código probado convierte los valores, 15 reglas deterministas cruzan los documentos y un agente decide
solo los casos ambiguos. Cada hallazgo cita la línea exacta del PDF y el párrafo de la norma.

## Stack

- TypeScript en un monorepo (npm workspaces), Zod para los esquemas, NestJS para la API, React + Vite +
  Radix UI para la web, Vitest y `node --test` para pruebas, GitHub Actions para CI.
- Postgres (datos y trazas de cada llamada al modelo), Redis + BullMQ (cola de extracción), S3
  compatible (SeaweedFS en local) para los PDF.
- Modelos locales con Ollama: `qwen3.8` (27B, Q4_K_M) para extracción y agente, `bge-m3` para
  embeddings. Nada sale de la máquina.
- OCR con tesseract.js (inglés + francés); en prueba: Baidu Unlimited-OCR vía Ollama.
- Búsqueda híbrida propia (embeddings + BM25) sobre memorandos de CBSA y el 19 CFR.

## Cronología (según el historial de git)

| Fecha | Hito |
| --- | --- |
| 12 oct, tarde | Fases 0–5 en el primer commit: esquemas, generador sintético, extracción, motor de reglas, agente + RAG, demo web |
| 12 oct, noche | ISF, OCR para escaneos, reglas X9/X12, corpus normativo ampliado, página de resultados, set v2 de formatos nuevos, modo demo de solo lectura |
| 12–13 oct | Evaluación completa con el modelo local: ~14 h de cómputo en una laptop (se durmió de noche y se pausó) |
| 13 oct | Cuentas y sesiones, web rehecha (Radix, i18n en/es/fr, tema claro/oscuro, auditoría de accesibilidad en CI), rol de administrador, datos extraídos en tablas, progreso en vivo (SSE), despliegue de la demo |
| 13 oct, tarde | Arreglo de escaneos (57.6% → 81.5%), cierre de la evaluación y write-up |

## Resultados medidos

Fuente: [docs/METRICS.md](../METRICS.md) y `eval/reports/`. Datos sintéticos (no hay un set público de
documentos de carga etiquetados), modelo `qwen3.8` build `aaee06c39dcf`.

| Set | PDFs | Campos bien leídos | Reglas de punta a punta (recall / precisión) |
| --- | --- | --- | --- |
| Texto (v1) | 600 | 99.8% | 100% / 99.7% |
| Confirmaciones ISF | 100 | 99.9% | X11: 20 de 20 |
| Escaneos simulados (OCR) | 120 | 81.5% | 81.8% / 67.5% |
| Formatos nunca vistos (v2) | 180 | 98.8% | 100% / 100% |
| Agente, 80 casos con respuesta conocida | — | 0 decisiones equivocadas | — |

## Decisiones de diseño que vale la pena contar

1. **El modelo copia, el código convierte.** El modelo devuelve los valores tal como están impresos
   ("1,140.00", "14-MAR-2026", "2,513 LB") y funciones probadas los pasan a decimales, fechas ISO y
   kilos. Un error de formato es un test que falla, no un prompt que ajustar.
2. **Reglas deterministas primero, agente solo para preguntas acotadas.** El modelo responde
   "¿son la misma empresa?" con veredicto, confianza y razón; solo actúa con confianza ≥ 0.7 y "no
   estoy seguro" nunca descarta un hallazgo.
3. **Las citas se buscan, no se generan.** El párrafo de la norma viene de una búsqueda híbrida sobre
   el corpus oficial; el modelo nunca redacta la base legal.
4. **Evaluar antes de construir.** 200 embarques sintéticos con 293 errores inyectados y etiquetados;
   cada respuesta del modelo queda en caché, así la evaluación se repite en segundos sin modelo.
5. **Local por defecto, y una demo pública sin GPU.** La demo repite respuestas cacheadas, así cabe en
   un servidor chico.

## Aprendizajes (con evidencia)

- **El error peligroso no es leer mal, es rellenar lo que está en blanco.** Cuando a una factura le
  falta el consignatario o el país de origen, el modelo copia el comprador o el país del vendedor,
  aunque el prompt se lo prohíbe. Así el control de campos obligatorios no salta. También inventa el
  puerto de entrada en 11 de 100 facturas canadienses que no lo imprimen. (WRITEUP.md, "Results")
- **Mirar por qué un número es bajo antes de tocar el modelo.** Los escaneos daban 57.6%: casi la
  mitad de los documentos se descartaba entera porque un solo valor (a menudo el país, perdido por el
  OCR) no pasaba la validación. Con las mismas respuestas del modelo y cambios solo en código: 81.5%.
- **Un set con formatos nuevos encuentra bugs antes de gastar GPU.** El set v2 (formatos europeos,
  tablas de 40 líneas, nombres en seis idiomas) destapó tres fallas de normalización sin llamar al
  modelo: "48 600,00" se leía 48, "14.03.2026" no era fecha, y el resaltado no encontraba números
  europeos.
- **Fijar el build del modelo, no la etiqueta.** `qwen3.8:latest` cambió a mitad del día; ahora cada
  respuesta, traza y reporte guarda el digest exacto.
- **Las evaluaciones largas necesitan el mismo cuidado que producción.** Un reporte escrito por un
  proceso que arrancó antes de que existieran tres reglas las mostraba en 0%. Ahora los reportes se
  regeneran desde la caché con el código final antes de publicarse.

## Cómo se construyó: varios agentes de IA en paralelo

Construido con Claude Code. En vez de una sola conversación, hubo varias sesiones trabajando a la vez
sobre el mismo repositorio, coordinándose entre ellas con mensajes:

- Una sesión llevaba datos, extracción, evaluación y el write-up; otra la web, cuentas, administración
  y despliegue. Antes de tocar archivos de la otra, avisaban ("tomo apps/web hasta que avise") y
  revisaban los cambios ajenos (una detectó que el modo demo iba a bloquear el login y lo avisó antes
  del commit).
- Subagentes en worktrees de git para tareas aisladas (corpus normativo, ISF en PDF), luego fusionadas.
- Lo que no delegué: decidir qué medir, leer cada reporte bajo y decidir si el problema era el
  modelo, el código o la métrica.

<!-- Completar con tu experiencia: cuánto tiempo tuyo llevó, qué te sorprendió, qué harías distinto. -->

## OCR de Baidu (Unlimited-OCR), 13 oct

Modelo publicado por Baidu (3B parámetros, MIT). Probado vía Ollama con la versión de la comunidad
`richardyoung/unlimited-ocr` (Q4_K_M, arquitectura deepseek2-ocr), sin integrarlo todavía al pipeline.

- Modos: `<|grounding|>Convert the document to markdown.` devuelve una línea por bloque con su recuadro
  (0–1000) y es el útil. "Free OCR." inventó texto ("Commercial Coffee", fechas en chino).
- Sin límite de salida entra en bucle repitiendo una línea hasta llenar el contexto (15 169 tokens);
  penalizar repeticiones lo corta pero cambia dígitos ("SAI2607606" leído "SAI2607066"). Se usa
  límite de tokens y se descartan las líneas repetidas.
- Las tablas salen como HTML sin las etiquetas de celda (Ollama parece quitar `<td>` por ser tokens
  especiales): "VN53,280 PRS1.8598,568.00".

Recall de texto en 12 PDFs escaneados (mismos que tesseract, misma métrica `findSource`):

| Documento | tesseract | Unlimited-OCR |
| --- | --- | --- |
| Total | 76.4% | 67.5% |
| Factura | 83.0% | 67.9% |
| Packing list | 59.4% | 79.7% |
| BL | 81.6% | 56.6% |
| Tiempo | 20 s | 112 s |

Conclusión con Ollama: no reemplaza a tesseract en esa forma de correrlo.

**Segunda prueba: versión MLX para Mac** (`mlx-community/Unlimited-OCR-8bit` con `mlx-vlm` 0.7.8, prompt
`document parsing.` aplicado con la plantilla de chat; la herramienta de línea de comandos sin plantilla
devolvía basura). Conserva las tablas (`<tr><td>`), no entra en bucle salvo en 1 de 120 páginas, y tarda
2.2 s por página (mediana). Mismos 120 PDFs escaneados, misma métrica:

| | tesseract | Unlimited-OCR MLX 8-bit |
| --- | --- | --- |
| Total | 86.6% | **96.8%** |
| Factura | 87.9% | 96.9% |
| Packing list | 84.4% | 98.7% |
| BL | 86.7% | 95.1% |
| Escaneo 150 dpi | 95.1% | 98.1% |
| Escaneo 110 dpi, borroso | 69.3% | **94.2%** |

Lección: el mismo modelo dio 67.5% o 96.8% según cómo se corre (cuantización y empaquetado de Ollama
vs MLX). Medir la forma concreta de ejecutarlo, no el nombre del modelo. Próximo paso: integrarlo como
motor de OCR y medir la extracción completa (campos y reglas) sobre los escaneos.

**Integrado y medido de punta a punta** (commit `c0c4fb3`, reporte
`eval/reports/extraction-ollama_qwen3.8-v1-scans-unlimited.json`): `OCR_ENGINE=unlimited` +
`scripts/ocr-server.py`. Mismos 120 escaneos, mismo modelo de extracción (qwen3.8):

| Escaneos | tesseract | Unlimited-OCR |
| --- | --- | --- |
| Campos bien leídos | 81.5% | **94.0%** |
| Documentos válidos | 93/120 | 108/120 |
| Envíos con las 3 piezas utilizables | 21/40 | 29/40 |
| Reglas: recall / precisión | 81.8% / 67.5% | **100% / 79.6%** |

Lo que todavía falla: valores pegados dentro de una celda de varias líneas ("PO" + el número de PO)
y nombres de partes. La otra sesión agregó el selector de motor en la configuración de
administrador (commit `d924998`).

## Producto web: hitos del 13 oct (sesión de la app)

Cada hito con su commit. Números medidos en esta máquina; lo marcado [entre corchetes] es opinión
para que la revises.

| Hito | Commit | Dato |
| --- | --- | --- |
| Cuentas y sesiones; envíos privados por usuario | `984ad83` | contraseñas scrypt, la cookie guarda solo un token cuyo hash SHA-256 vive en la base |
| Web rehecha: Radix UI, un componente por archivo | `760c1a3`, `df48d35` | — |
| Inglés, español y francés; tema claro/oscuro; auditoría de accesibilidad | `9fb90be`, `0c0cbf7` | axe en CI para cada página en ambos temas |
| Rol de administrador: modelo, OCR, usuarios, estado del sistema | `0acdabd`, `6a346ba` | — |
| Envíos con paginación y filtros en el servidor, edición, historial de validaciones | `078863c` | — |
| Datos extraídos consolidados: totales, cada línea de factura, cifras por envío; exportar CSV | `e90d7f6`, `cebb6b8` | CSV con BOM y fórmulas neutralizadas (`=`, `+`, `@`) |
| Alertas del panel, corrección manual con auditoría, recuperar contraseña por correo | `01bfa59`, `058437e`, `097acfd` | — |
| Progreso en vivo (SSE): etapas, salida del modelo en streaming, hallazgos mientras valida | `f88f14a`, `b818844`, `bd14a98` | eventos en Postgres + `NOTIFY`, se reanudan con `Last-Event-ID` |
| Panel de actividad con tiempo restante y cancelar; notificaciones al terminar | `d54e580`, `e675de1` | — |
| Datos extraídos como tablas (facturas, líneas, packing, BL, contenedores, ISF, empresas, productos) | `fc661d6` | 13 tablas llenadas por triggers; el backfill de la base local tardó ~0.1 s |
| Vistas de empresas y productos con historial de precios | `22243a1` | en la base local, la normalización final bajó de 98 a 73 empresas; tests de la API: 76 de 76 |
| Menú Datos: un módulo por página; fichas completas de empresa y producto; contenedores | `ec31499` | — |
| Qué hacer con un finding: estados con motivo e historial, corregir desde la evidencia, carta al proveedor en en/es/fr, resueltos y nuevos entre validaciones | `b89f4ae` | tests de la API 77 de 77, web 55 de 55 |
| Correo dentro de la app: pedidos al proveedor, bandeja, hilos, cola de envío con reintentos, recepción por IMAP o webhook, adjuntos al envío, alertas | `19b9c23`, `4b011fa` | tests de la API 78 de 78 (uno cubre el ciclo completo: pedido, envío, respuesta con PDF, importación y respuesta) |
| Buzón configurable desde Admin (SMTP/IMAP, contraseñas cifradas, pruebas) y documentos por correo: un correo con PDF se convierte en un envío extraído y validado sin abrir la app | (este commit) | tests de la API 81 de 81; envío real por Resend con dominio verificado |
| README de portafolio: capturas, métricas con su fuente, qué hace, arquitectura; posts 6 (bandeja) y 7 (flujo de hallazgos) | `d22482c` | 22 de 22 capturas de `docs/screenshots/` enlazadas; `npm run metrics` regenera el bloque de métricas sin cambios desde `eval/reports` |
| Apariencia personalizable en Cuenta: color de acento (6 preajustes o uno propio, ajustado solo lo justo para contraste AA en claro y oscuro), tono de fondo, bordes de paneles (suave, marcado, sombra, plano), esquinas, densidad, tipografía, barra lateral tintada y animaciones reducidas; se aplica antes del primer pintado | (este commit) | 59 de 59 tests del web; verificado en el navegador en claro, oscuro y a 375 px sin desbordes |

Decisiones para contar:

- **El JSON validado sigue siendo la fuente de verdad; las tablas son una proyección.** Triggers en
  Postgres las reconstruyen al extraer, corregir, revertir o re-extraer, así ningún camino del código
  puede dejarlas desincronizadas. Cada tabla guarda un `extra` con los campos que aún no tienen
  columna. [Evita migraciones de datos cuando el esquema crece.]
- **Una empresa es una aunque la escriban distinto.** "ACME Toys Co., Ltd." y "Acme Toys Co Ltd" se
  comparan sin mayúsculas, acentos, puntuación ni forma legal.
- **Productos por SKU o, si no hay, por descripción normalizada**, con precio promedio ponderado por
  cantidad y la lista de compras para ver cómo cambia el precio.

## Arreglo de los campos rellenados, 13 oct

Chequeo determinista en `packages/extraction/src/printed.ts`: un consignatario, país de origen o
puerto de entrada se conserva solo si el PDF lo imprime debajo de su etiqueta, en la misma columna
(o a su derecha en la misma línea). Sin modelo; usa las posiciones de columna que ya guarda el texto.

- Sobre la verdad impresa (sin modelo): 0 descartes falsos en 260 facturas con capa de texto (v1+v2);
  31 de 40 en escaneos con tesseract, así que en documentos con OCR queda apagado.
- v1 de punta a punta: recall de reglas 99.0% → **100%** (C1 6/6, U1 7/7), campos inventados 15 → 0.
- v2: recall 95.3% → **100%**, precisión 97.6% → **100%**.
- Fuente: `docs/METRICS.md`, reportes regenerados desde caché.

## Correo: cuando el servidor no acepta "+códigos", 15 oct

Primera prueba real con un buzón de Hostinger: al responder una solicitud desde Gmail, el proveedor
recibió "Address not found". DocCheck pone en Reply-To `buzon+token@dominio` para enlazar la
respuesta con su conversación, y Hostinger rechaza esas direcciones.

- El `+token` era solo un respaldo: las respuestas ya se enlazan por `In-Reply-To`/`References` y
  por el `[DC-…]` del asunto (`apps/api/src/messaging/mail-inbox.ts`). Se desactivó sin perder nada.
- Detección automática (`plus-check.service.ts`): al guardar el buzón se envía un correo de prueba a
  `buzon+probe-xxxx@`. Si el SMTP lo rechaza o vuelve un rebote, DocCheck apaga los +códigos y lo
  explica en Configuración; si llega por IMAP, confirma que funcionan.
- Límite honesto: el rebote de una respuesta real le llega a quien respondió, no a DocCheck; por eso
  la prueba se hace con un correo propio.
- Prueba e2e con un servidor SMTP falso que rechaza o acepta direcciones con "+" (82/82 tests).

## Funcionalidades del mercado: 11 sesiones en paralelo, 16-17 oct

Comparativa con productos del mercado (IDP logístico, plataformas de forwarding, compliance y
clasificación) y luego 11 sesiones de Claude Code, cada una en su worktree y rama, una por bloque.
Todas fusionadas en `main` (último merge `a602285`), migraciones 040 a 051.

- Organizaciones, roles, comentarios, aprobación en dos pasos, auditoría encadenada por hash,
  retención (CBSA 6 años, CBP 5), TOTP y SSO OpenID Connect (`docs/ORGANIZATIONS.md`).
- Reglas: de 15 a 53 (X13-X24, C3, U2-U4, T1-T13, M/E/K), configurables por organización; tres vías
  contra órdenes de compra; precio contra el historial propio (`README.md`, tabla de reglas).
- Destinos nuevos: México, UE y Reino Unido, con su corpus regulatorio.
- Documentos nuevos (AWB, certificados de origen, CUSMA, aviso de llegada, ISPM 15, mercancías
  peligrosas), Excel/CSV, fotos y PDF combinados.
- Screening de partes restringidas (OFAC, BIS, Canadá, ONU, UE) y UFLPA; clasificación HS con
  agencias (PGA/OGD); aranceles, landed cost y borrador 7501/CAD sin transmitir.
- Portal del proveedor sin cuenta y revisión previa al embarque; API pública v1 con webhooks,
  exportaciones CargoWise/X12; analítica, scorecard de proveedores y preguntas en lenguaje natural.
- Cola de revisión humana, aprendizaje por proveedor, PWA con cámara y planes de uso (Stripe solo en
  modo test).
- Verificación final de `main`: build, tests unitarios, e2e de la API 176/176 y auditoría a11y sin
  violaciones.
- Lecciones de la integración: la rama de organizaciones cambió el modelo de datos, así que cada
  sesión adaptó su rama antes del merge; suites de test y servidores compartiendo Redis, puertos y
  base de datos se pisaban entre sí (cola de extracción robada, puertos repetidos), y las reglas nuevas
  sobre datos sintéticos viejos (SCAC inventados) obligaron a acotar los tests a las reglas de cada set.
- Pendiente: la Ley Aduanera de México no entró al corpus (sitio inaccesible); las muestras v1 aún
  generan hallazgos de las reglas nuevas; certificaciones SOC 2/ISO y transmisión real a CBSA/CBP fuera
  de alcance.

## Proveedores de IA configurables, 17 oct

- Antes: Ollama y Tesseract fijos en el código; la pantalla de admin creaba el proveedor a mano.
- Ahora, desde Administración → Configuración → Proveedores de IA (detalle en `docs/AI-PROVIDERS.md`):
  - Modelo de documentos: Ollama, cualquier API compatible con OpenAI (OpenAI, Groq, OpenRouter,
    vLLM, LM Studio), Azure OpenAI, Anthropic o Gemini.
  - Embeddings: Ollama, compatible con OpenAI, Azure OpenAI o Gemini; índices por modelo y
    reconstrucción desde la pantalla.
  - OCR: Tesseract, Unlimited-OCR, Google Cloud Vision, Amazon Textract o Azure Document Intelligence.
- Interruptor "Solo local" encendido por defecto: solo pasan servidores en la máquina o en la red
  privada. Las claves se guardan cifradas (AES-256-GCM) y la API nunca las devuelve.
- Decisión: la salida de todos los proveedores pasa por la misma validación Zod, caché y traza de
  `LlmClient`, así que la evaluación y el registro de llamadas no cambian con el proveedor.
- Prueba real: Ollama expuesto como API compatible con OpenAI respondió la prueba de conexión en
  13.2 s y extrajo una factura de muestra (CA-001) en 60.7 s (702 tokens de entrada, 1718 de salida,
  registrado en `llm_calls` como `openai:qwen3.8`).
- Tests: 26 unitarios nuevos contra servidores falsos (OpenAI, Anthropic, Gemini, Vision, Textract,
  Azure DI); la firma SigV4 coincide con el caso `post-vanilla` de la suite oficial de AWS; 8 e2e de
  la configuración (`apps/api/test/ai-providers.test.mjs`).
- Pendiente: medir la precisión de extracción con modelos externos (`npm run eval:extraction` con
  `LLM_PROVIDER`), que no se hizo para no enviar datos ni gastar sin tu decisión.

## Pendiente / próximos pasos

- OCR de Baidu en Linux con GPU (vLLM) para no depender de un Mac.
- Probar con documentos reales.
- Publicar la demo de solo lectura.

## Registro de cambios de esta bitácora

- 13 oct 2026: creada con el estado al cierre de la evaluación (commit `739a696`).
- 13 oct 2026: primera prueba del OCR de Baidu.
- 13 oct 2026: OCR de Baidu en MLX: 96.8% contra 86.6% de tesseract.
- 13 oct 2026: OCR de Baidu integrado; escaneos de punta a punta 81.5% → 94.0%, reglas 100% de recall.
- 13 oct 2026: chequeo "impreso bajo su etiqueta": reglas al 100% de recall en v1 y v2.
- 13 oct 2026: hitos de la app web y de las tablas de datos extraídos (sesión de la app).
- 13 oct 2026: menú Datos y flujo de resolución de findings (sesión de la app).
- 13 oct 2026: correo integrado en la app (sesión de la app).
- 14 oct 2026: README de portafolio en la raíz y posts 6 y 7 (commit `d22482c`).
- 14 oct 2026: buzón configurable y documentos por correo (sesión de la app).
- 15 oct 2026: apariencia personalizable (sesión de la app).
- 15 oct 2026: prueba de +códigos del buzón y apagado automático si el servidor los rechaza.
- 17 oct 2026: funcionalidades del mercado en 11 sesiones paralelas, fusionadas en main (`a602285`).
- 17 oct 2026: proveedores de IA configurables (LLM, embeddings, OCR) con "solo local" y claves cifradas.
