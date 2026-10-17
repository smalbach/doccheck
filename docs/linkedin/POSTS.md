# Borradores para LinkedIn

Listos para copiar y ajustar a tu voz. Cada uno tiene versión en español y en inglés, la imagen
sugerida (en `docs/screenshots/`) y de dónde sale cada número ([BITACORA.md](BITACORA.md)). Los
marcados con `[...]` necesitan tu dato personal. Recomendación: publicar el 1 primero y los demás con
una o dos semanas de separación; poner el link del repo o la demo en el primer comentario, no en el
post.

---

## 1. Lanzamiento del proyecto

Imagen: `docs/screenshots/flow.webp` (abrir un envío, validar, clic en la evidencia y el PDF se abre en
la línea citada).

**ES**

Construí DocCheck: revisa los documentos de un embarque antes de que lleguen a la aduana.

Importar un contenedor a Canadá o EE. UU. implica hasta cuatro documentos que tienen que coincidir
entre sí: factura comercial, packing list, bill of lading y el ISF. Un bulto de diferencia, un peso en
la unidad equivocada o un país de origen en blanco pueden retener la carga.

DocCheck:
• lee los PDF (también escaneados) con un modelo que corre en mi propia máquina; nada sale de ella
• convierte los valores con código probado, no con prompts
• cruza los documentos con 15 reglas deterministas y las exigencias de CBSA y CBP
• usa el modelo solo para preguntas acotadas ("¿son la misma empresa?"), con nivel de confianza
• cita la línea exacta del PDF y el párrafo de la norma en cada hallazgo

Medido sobre 200 embarques sintéticos con 293 errores inyectados: 99.8% de los campos bien leídos y
100% de los errores detectados de punta a punta.

Stack: TypeScript, NestJS, React, Postgres, Ollama (qwen3.8 + bge-m3).

[Una línea tuya: por qué te interesó este problema.]

#AI #LLM #Logistics #CustomsCompliance #TypeScript #OpenSource

**EN**

I built DocCheck: it checks a shipment's documents before customs does.

Importing a container into Canada or the US means up to four documents that must agree: commercial
invoice, packing list, bill of lading and the ISF. One package off, a weight in the wrong unit or a
blank country of origin can hold the cargo.

DocCheck:
• reads the PDFs (scans too) with a model that runs on my own machine; nothing leaves it
• converts values with tested code, not prompts
• cross-checks the documents with 15 deterministic rules and CBSA/CBP requirements
• asks the model only narrow questions ("same company?"), with a confidence level
• cites the exact PDF line and regulation passage for every finding

Measured on 200 synthetic shipments with 293 injected errors: 99.8% of fields read correctly and
100% of errors caught end to end.

Stack: TypeScript, NestJS, React, Postgres, Ollama (qwen3.8 + bge-m3).

[One line of yours: why this problem.]

#AI #LLM #Logistics #CustomsCompliance #TypeScript

---

## 2. El error peligroso de un LLM no es leer mal

Imagen: `docs/screenshots/shipment-findings-light.webp`.

**ES**

El error más peligroso que encontré en mi extractor de documentos con LLM no fue leer mal un número.
Fue rellenar lo que estaba en blanco.

Le borré a propósito el consignatario a algunas facturas. El modelo copió el comprador, que estaba
impreso al lado. Le borré el país de origen: tomó el país del vendedor. Las facturas canadienses no
traen puerto de entrada, y en 11 de 100 el modelo inventó uno a partir de "CIF Halifax".

El prompt dice explícitamente "nunca infieras un valor". Lo hace igual cuando hay un valor plausible a
pocas líneas.

¿Por qué importa? Para un agente de aduanas, el control "falta un campo obligatorio" pasa en verde
sobre un documento que la aduana va a rechazar.

Lo que aprendí:
1. Medir con errores inyectados y etiquetados, no solo con documentos limpios: con documentos limpios
   esto no aparece.
2. La solución no fue un modelo más grande, sino una segunda pasada barata y sin IA: un valor
   obligatorio se conserva solo si el PDF lo imprime debajo de su etiqueta, en la misma columna.
   Resultado: las reglas pasaron de detectar el 99.0% al 100% de los errores, sin descartar ningún
   valor correcto en 260 facturas.

#LLM #AIEngineering #Evals #DocumentAI

**EN**

The most dangerous error I found in my LLM document extractor wasn't misreading a number. It was
filling in what was blank.

I deliberately removed the consignee from some invoices. The model copied the buyer printed next to
it. I removed the country of origin: it took the seller's country. Canadian invoices don't print a
port of entry, and in 11 of 100 the model made one up from "CIF Halifax".

The prompt says "never infer a value". It does it anyway when a plausible value sits a few lines
away.

Why it matters: for a customs broker, the "required field missing" check passes on a document
customs will reject.

What I took from it:
1. Evaluate with injected, labeled errors, not only clean documents; clean documents never show this.
2. The fix wasn't a bigger model but a cheap second pass with no AI: a required value is kept only if
   the PDF prints it under its own label, in the same column. The rules went from catching 99.0% to
   100% of the errors, without dropping a single correct value across 260 invoices.

#LLM #AIEngineering #Evals #DocumentAI

---

## 3. De 57.6% a 81.5% sin tocar el modelo

Imagen: `docs/screenshots/evaluation-results.webp`.

**ES**

Mi pipeline leía bien el 57.6% de los campos de documentos escaneados. Lo subí a 81.5% sin cambiar el
modelo, el prompt ni el OCR.

Mirando documento por documento, casi la mitad no estaba mal leída: se descartaba entera. Un solo
valor ilegible (casi siempre la línea del país, perdida por el OCR) hacía fallar la validación del
esquema, y todos los campos del documento contaban como faltantes.

El arreglo:
• una dirección sin país legible se conserva sin país (y en Canadá y EE. UU. se deduce del código
  postal)
• si el documento igual no valida, se guarda lo que sí se leyó y se reporta aparte cuántos quedan
  completos

Documentos utilizables: de 63 a 93 de 120. Mismas respuestas del modelo, repetidas desde caché.

Lección: antes de cambiar el modelo, preguntarse qué está midiendo el número. Este medía el
validador.

#MachineLearning #Evals #OCR #DataQuality

**EN**

My pipeline read 57.6% of the fields on scanned documents correctly. I got it to 81.5% without
changing the model, the prompt or the OCR.

Going document by document, almost half weren't misread: they were thrown away whole. One unreadable
value (usually the country line, lost by OCR) failed schema validation, and every field of the
document counted as missing.

The fix:
• an address with an unreadable country is kept without one (Canada and the US infer it from the
  postal code)
• if a document still fails validation, keep what was read and report separately how many are
  complete

Usable documents: from 63 to 93 of 120. Same model answers, replayed from cache.

Lesson: before changing the model, ask what the number measures. This one measured the validator.

#MachineLearning #Evals #OCR #DataQuality

---

## 4. Construir con varios agentes de IA en paralelo

Imagen: captura de la terminal con dos sesiones, o `docs/screenshots/dashboard-light.webp`.

**ES**

DocCheck lo construí con varios agentes de IA (Claude Code) trabajando a la vez sobre el mismo
repositorio.

Una sesión llevaba datos, extracción y evaluación; otra la web, cuentas, administración y despliegue.
Se coordinaban con mensajes: "tomo apps/web hasta que avise", "no reinicies el servidor, estoy
corriendo la evaluación". Una revisó un cambio de la otra y detectó, antes del commit, que el modo
demo iba a bloquear el inicio de sesión.

Lo que funcionó:
• dividir por áreas del código, con dueño explícito y aviso antes de tocar lo ajeno
• una evaluación automática que cualquiera de las dos podía correr para no romper nada
• subagentes en worktrees de git para tareas aisladas

Lo que no delegué: decidir qué medir, y leer cada número bajo hasta saber si el problema era el
modelo, el código o la métrica.

[Tu opinión: qué cambió en tu forma de trabajar.]

#AI #SoftwareEngineering #ClaudeCode #AIAgents

**EN**

I built DocCheck with several AI agents (Claude Code) working on the same repository at once.

One session owned data, extraction and evaluation; another the web app, accounts, admin and
deployment. They coordinated by message: "taking apps/web until I say so", "don't restart the server,
the evaluation is running". One reviewed the other's change and caught, before the commit, that demo
mode would have blocked sign-in.

What worked:
• splitting by code area, with an explicit owner and a heads-up before touching someone else's
• an automated evaluation either could run so nothing broke
• subagents in git worktrees for isolated tasks

What I didn't delegate: deciding what to measure, and reading every low number until I knew whether
the model, the code or the metric was at fault.

[Your take: what changed in how you work.]

#AI #SoftwareEngineering #ClaudeCode #AIAgents

---

## 5. El mismo modelo: 67.5% o 96.8%, según cómo lo corres

Imagen: la tabla de [BITACORA.md](BITACORA.md), sección "OCR de Baidu".

**ES**

Baidu publicó Unlimited-OCR, un modelo de 3B parámetros para leer documentos. Lo probé en mi
pipeline de aduanas contra el tesseract que ya usaba, sobre los mismos 120 escaneos y con la misma
métrica.

Primer intento, con la versión empaquetada para Ollama: 67.5% en una muestra, peor que tesseract. Las
celdas de las tablas salían pegadas ("1.8598,568.00" en vez de "1.85 | 98,568.00"), a veces repetía
una línea hasta llenar el contexto, y en un modo inventó texto en chino que no estaba en la página.

Segundo intento, mismo modelo en MLX en mi Mac: 96.8% de los valores encontrados contra 86.6% de
tesseract. En los escaneos borrosos de 110 dpi: 94.2% contra 69.3%. Unos 2 segundos por página.

Lección: no evalúes un nombre de modelo, evalúa la forma concreta en que lo vas a correr
(cuantización, empaquetado, plantilla de prompt). La diferencia acá fue de 29 puntos.

Integrado en el pipeline, de punta a punta sobre los mismos escaneos: los campos bien leídos pasaron de 81.5% a 94.0%, y las reglas detectaron el 100% de los errores inyectados (antes 81.8%).

#OCR #DocumentAI #Evals #LLM #AppleSilicon

**EN**

Baidu released Unlimited-OCR, a 3B document-reading model. I tested it in my customs pipeline against
the tesseract I already used, on the same 120 scans with the same metric.

First try, the build packaged for Ollama: 67.5% on a sample, worse than tesseract. Table cells ran
together ("1.8598,568.00" instead of "1.85 | 98,568.00"), it sometimes repeated a line until the
context filled up, and one prompt mode made up Chinese text that wasn't on the page.

Second try, the same model on MLX on my Mac: 96.8% of expected values found vs 86.6% for tesseract.
On blurry 110 dpi scans: 94.2% vs 69.3%. About 2 seconds per page.

Lesson: don't evaluate a model name, evaluate the exact way you'll run it (quantization, packaging,
prompt template). Here that was a 29-point difference.

Integrated into the pipeline, end to end on the same scans: fields read correctly went from 81.5% to 94.0%, and the rules caught 100% of the injected errors (81.8% before).

#OCR #DocumentAI #Evals #LLM #AppleSilicon

---

## 6. Pedir la corrección al proveedor sin salir de la app

Imágenes: `docs/screenshots/conversation.webp` (la conversación: el pedido, la respuesta del proveedor
y su PDF corregido) y `docs/screenshots/request-compose.webp` (el correo redactado desde los
hallazgos).

Fuente: [BITACORA.md](BITACORA.md), hito "Correo dentro de la app" (commits `19b9c23` y `4b011fa`);
detalle en [docs/MESSAGING.md](../MESSAGING.md).

**ES**

Encontrar el error en un documento es la mitad del trabajo. La otra mitad es conseguir que el
proveedor lo corrija.

Hasta ahora DocCheck terminaba en la lista de hallazgos. Después venía copiar valores a un correo,
esperar la respuesta, bajar el PDF corregido y volver a subirlo. Ahora todo eso pasa dentro de la app:

• desde los hallazgos, "Pedir correcciones" redacta el correo al proveedor en inglés, español o
  francés, con cada valor que no coincide y qué corregir; se puede editar antes de enviar
• los hallazgos pasan a "Esperando al proveedor"
• la respuesta llega a la misma conversación (por IMAP o webhook), con su PDF adjunto
• un clic agrega ese PDF al envío; se lee como cualquier otro, se valida de nuevo y los hallazgos
  corregidos aparecen como resueltos
• una bandeja muestra respuestas sin leer, pedidos sin respuesta pasada la fecha y correos que no
  salieron

La parte aburrida fue la que más trabajo llevó: cola de envío con reintentos, hilos por
`In-Reply-To` y un token en la dirección, rebotes, límites de envío por usuario. Un test de la API
recorre el ciclo completo: pedido, envío, respuesta con PDF, importación y respuesta.

[Tu opinión: por qué el seguimiento con el proveedor importa tanto como detectar el error.]

#Logistics #CustomsCompliance #ProductEngineering #TypeScript

**EN**

Finding the error in a document is half the job. The other half is getting the supplier to fix it.

Until now DocCheck stopped at the list of findings. Then came copying values into an email, waiting
for the reply, downloading the corrected PDF and uploading it again. Now all of that happens inside
the app:

• from the findings, "Ask for corrections" drafts the email to the supplier in English, Spanish or
  French, with every value that doesn't match and what to fix; it can be edited before sending
• the findings move to "Waiting for supplier"
• the reply lands in the same conversation (over IMAP or a webhook), with its PDF attached
• one click adds that PDF to the shipment; it's read like any other, validated again, and the fixed
  findings show up as resolved
• an inbox shows unread replies, requests past their follow-up date and emails that didn't go out

The boring part took the most work: an outbox with retries, threading by `In-Reply-To` and a token
in the reply address, bounces, per-user send limits. One API test walks the whole loop: request,
send, reply with a PDF, import and answer.

[Your take: why the follow-up with the supplier matters as much as catching the error.]

#Logistics #CustomsCompliance #ProductEngineering #TypeScript

---

## 7. Un hallazgo no es una tarea terminada

Imagen: `docs/screenshots/shipment-findings-light.webp`.

Fuente: [BITACORA.md](BITACORA.md), hito "Qué hacer con un finding" (commit `b89f4ae`); detalle en
[docs/FINDINGS.md](../FINDINGS.md).

**ES**

Una lista de errores no le dice a nadie qué hacer. Así que en DocCheck cada hallazgo ahora termina en
una decisión.

Cada hallazgo tiene un estado:
• por resolver
• esperando al proveedor
• riesgo aceptado, con motivo obligatorio
• falso positivo, con motivo obligatorio

Cada decisión queda en un historial con quién, cuándo y por qué.

Si el problema es que el modelo leyó mal, "Corregir este valor" abre los datos del documento justo en
ese campo, desde la evidencia del hallazgo. Se guarda, se valida de nuevo, y listo.

Al validar otra vez, los hallazgos nuevos llevan la etiqueta "Nuevo" y los que desaparecieron se
muestran como resueltos. Una decisión se mantiene mientras el hallazgo sea el mismo (misma regla,
mismos campos y valores), aunque el documento se haya vuelto a subir. Un envío queda listo cuando su
última validación no tiene hallazgos abiertos.

[Tu opinión: por qué "aceptar el riesgo" con motivo escrito vale más que ignorar una alerta.]

#ProductDesign #Logistics #CustomsCompliance #AIEngineering

**EN**

A list of errors doesn't tell anyone what to do. So in DocCheck every finding now ends in a
decision.

Each finding has a status:
• to resolve
• waiting for the supplier
• risk accepted, with a required reason
• false positive, with a required reason

Every decision goes into a history with who, when and why.

If the model misread a value, "Correct this value" opens the document's data right on that field,
from the finding's evidence. Save, validate again, done.

On the next validation, new findings get a "New" tag and the ones that went away show as resolved. A
decision sticks while the finding is the same (same rule, same fields and values), even if the
document was uploaded again. A shipment is ready when its last validation has no open findings.

[Your take: why accepting a risk with a written reason beats ignoring an alert.]

#ProductDesign #Logistics #CustomsCompliance #AIEngineering

## 8. Once agentes, una rama cada uno, un main que pasa todo

Captura sugerida: `docs/screenshots/dashboard-light.webp` (regenerar con `node scripts/screenshots.mjs`).

**ES**

Comparé DocCheck con lo que ofrecen los productos de cumplimiento aduanero y automatización de
documentos de carga, y le pedí a 11 agentes de IA que construyeran lo que faltaba, cada uno en su
propia rama.

Lo que entró:
• organizaciones, roles, auditoría y SSO
• de 15 a 53 reglas, configurables
• México, UE y Reino Unido como destinos
• AWB, certificados de origen, Excel y fotos
• screening de partes restringidas y clasificación arancelaria
• aranceles y costo puesto en destino
• portal del proveedor, API pública y analítica

Lo difícil no fue escribir el código, fue juntarlo: una rama cambió el modelo de datos de "usuario" a
"organización" y las otras diez tuvieron que adaptarse antes de entrar. Al final, main pasa 176 de 176
pruebas de la API y la auditoría de accesibilidad sin violaciones.

[Tu opinión: qué aprendiste de coordinar agentes en paralelo.]

#AIEngineering #Logistics #CustomsCompliance #SoftwareEngineering

**EN**

I compared DocCheck with what customs compliance and freight document automation products offer, and
had 11 AI agents build what was missing, each on its own branch.

What landed:
• organizations, roles, audit log and SSO
• from 15 to 53 rules, configurable
• Mexico, the EU and the UK as destinations
• air waybills, certificates of origin, spreadsheets and photos
• denied party screening and tariff classification
• duties and landed cost
• a supplier portal, a public API and analytics

The hard part wasn't writing the code, it was putting it together: one branch moved the data model
from "user" to "organization", and the other ten had to adapt before going in. In the end, main passes
176 of 176 API tests and the accessibility audit with no violations.

[Your take: what you learned from coordinating agents in parallel.]

#AIEngineering #Logistics #CustomsCompliance #SoftwareEngineering

## 9. Local por defecto, abierto si lo decides

Captura sugerida: la pestaña Administración → Configuración → Proveedores de IA (no hay captura aún;
tomarla de la app).

**ES**

DocCheck leía documentos solo con modelos locales. Ahora el administrador puede elegir el proveedor
para cada tarea, sin tocar código:

• extracción: Ollama, cualquier API compatible con OpenAI, Azure OpenAI, Claude o Gemini
• embeddings para las citas regulatorias: local o por API
• OCR: Tesseract, Google Vision, Amazon Textract o Azure Document Intelligence

Lo que no cambió: "Solo local" viene encendido. Mientras lo esté, nada sale de la máquina o de la red
privada, y las claves se guardan cifradas y nunca se devuelven.

La prueba: Ollama expuesto como API compatible con OpenAI extrajo una factura en 60 s por el mismo
camino que usaría un proveedor en la nube, con la misma validación y la misma caché.

[Tu opinión: cuándo usarías un modelo en la nube y cuándo uno local.]

#AIEngineering #Logistics #DataPrivacy #SoftwareEngineering

**EN**

DocCheck used to read documents with local models only. Now an admin picks the provider for each job,
without touching code:

• extraction: Ollama, any OpenAI-compatible API, Azure OpenAI, Claude or Gemini
• embeddings for regulation citations: local or through an API
• OCR: Tesseract, Google Vision, Amazon Textract or Azure Document Intelligence

What didn't change: "Local only" is on by default. While it is, nothing leaves the machine or the
private network, and keys are stored encrypted and never sent back.

The check: Ollama, exposed as an OpenAI-compatible API, extracted an invoice in 60 s through the same
path a cloud provider would use, with the same validation and the same cache.

[Your take: when you'd use a cloud model and when a local one.]

#AIEngineering #Logistics #DataPrivacy #SoftwareEngineering
