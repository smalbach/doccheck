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

Medido sobre 200 embarques sintéticos con 293 errores inyectados: 99.7% de los campos bien leídos y
99.0% de los errores detectados de punta a punta.

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

Measured on 200 synthetic shipments with 293 injected errors: 99.7% of fields read correctly and
99.0% of errors caught end to end.

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
2. La solución probablemente no es un modelo más grande, sino una segunda pasada barata: "¿este
   valor está impreso debajo de esta etiqueta?"

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
2. The fix is probably not a bigger model but a cheap second pass: "is this value printed under this
   label?"

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

## 5. Probar el modelo de OCR nuevo antes de adoptarlo (borrador, actualizar con el resultado final)

Imagen: tabla comparativa de [BITACORA.md](BITACORA.md), sección "OCR de Baidu".

**ES**

Baidu publicó Unlimited-OCR, un modelo de 3B parámetros para leer documentos. Lo probé en mi
pipeline antes de adoptarlo, contra el tesseract que ya usaba, sobre los mismos escaneos y con la
misma métrica.

Resultado en 12 documentos: tesseract 76.4% de los valores encontrados, Unlimited-OCR 67.5% (y 5
veces más lento en mi laptop). Gana claramente en packing lists (79.7% vs 59.4%) y pierde en facturas
y BL.

No es que el modelo sea malo. En la versión que corre en Ollama, las etiquetas de las celdas de tabla
se pierden y los números quedan pegados ("1.8598,568.00" en vez de "1.85 | 98,568.00"). Y en uno de
los modos inventó texto en chino que no estaba en el documento.

Lección: un benchmark público no reemplaza medir en tus datos y con tu forma de correrlo.

[Actualizar con la prueba de la versión MLX si se hace.]

#OCR #DocumentAI #Evals #LLM

**EN**

Baidu released Unlimited-OCR, a 3B document-reading model. I tested it in my pipeline before
adopting it, against the tesseract I already used, on the same scans with the same metric.

On 12 documents: tesseract found 76.4% of the expected values, Unlimited-OCR 67.5% (and was 5x slower
on my laptop). It clearly wins on packing lists (79.7% vs 59.4%) and loses on invoices and bills of
lading.

The model isn't bad. In the build that runs on Ollama, table cell tags are lost and numbers run
together ("1.8598,568.00" instead of "1.85 | 98,568.00"). And one prompt mode made up Chinese text
that wasn't on the page.

Lesson: a public benchmark doesn't replace measuring on your data, the way you'll run it.

#OCR #DocumentAI #Evals #LLM
