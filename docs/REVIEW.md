# Cola de revisión y aprendizaje por proveedor

La extracción no está igual de segura de todos los valores. La cola de revisión junta los dudosos para que una persona los compare con el PDF, y las correcciones que hace se le devuelven al modelo local como ejemplos para los siguientes documentos del mismo proveedor.

## Confianza por campo

Cada documento extraído recibe una confianza de 0 a 1 por campo (`packages/extraction/src/confidence.ts`), calculada en código con señales que el pipeline ya tiene; no se le pregunta nada más al modelo. La confianza de un campo es la más baja de sus señales.

| Señal | Cuándo baja la confianza | A cuánto |
| --- | --- | --- |
| `not-printed` | El valor que el modelo copió "tal como está impreso" no aparece en ninguna línea del texto del PDF | 0.5 |
| `ocr` | El valor está en una página leída con OCR | La confianza de tesseract de las palabras de las que sale el valor (o la media de la página si no hay puntaje por palabra) |
| `normalizer` | El normalizador no pudo leer lo que copió el modelo y lo descartó ("could not normalize") | 0.3 |
| `passes-disagree` | Una segunda lectura del documento (opcional, `REVIEW_SECOND_PASS`) copia otra cosa | 0.4 |
| `low-logprob` | Probabilidad del token más dudoso del valor, si el proveedor devuelve todas (`LLM_LOGPROBS=true`) | exp(logprob) |

Sobre las probabilidades del modelo: Ollama 0.35 acepta `logprobs: true`, pero con salida estructurada (`format` con esquema JSON) devuelve solo la del primer token. El código mapea tokens a campos (`jsonLeafSpans`, `leafLogprobs`) y solo usa la señal cuando los tokens deletrean la respuesta entera, así que hoy casi nunca aplica. Queda lista para cuando Ollama devuelva todas.

Se puntúan los campos de `REVIEW_FIELDS` (los mismos que mide la evaluación, con su ruta en la respuesta del modelo), más cada valor que el normalizador descartó. Cada entrada guarda el puntero JSON, el valor, lo impreso, la confianza, las razones y la línea del PDF donde está impreso (para resaltarla). Se guarda en `field_confidence` (migración `051_review_queue.sql`) en cada extracción; al arrancar, la API puntúa una vez los documentos extraídos antes de que esto existiera (`REVIEW_BACKFILL=false` lo desactiva).

En los PDF con capa de texto la confianza casi siempre es 1: en la muestra CA-001 no se marcó nada. En un escaneo de `v1-scans`, 3 de 30 valores quedaron bajo el umbral, con su palabra de OCR más débil.

## La cola

- **Revisión** en el menú (`#/app/review`, `GET /review/queue`): documentos de la organización activa con valores bajo el umbral (`REVIEW_THRESHOLD`, 0.85, editable en Administración → Configuración) que nadie revisó, los más dudosos primero.
- El panel muestra cuántos documentos y valores esperan (`GET /review/summary`).
- **Pantalla de revisión** (`#/app/review/<documentId>`, `GET /review/documents/:id`): el PDF a un lado, con la línea del valor elegido resaltada, y los valores al otro, los dudosos primero. Para cada valor: el valor actual, lo que leyó el modelo si se corrigió, la línea impresa, la confianza y por qué.
- Teclado: J o ↓ siguiente valor, K o ↑ anterior, A aceptar, E editar, Intro guardar, Esc cancelar, N siguiente documento. Sin modificadores, para no chocar con el navegador ni el lector de pantalla; no actúan mientras se escribe en un campo.
- **Aceptar** (`POST /review/documents/:id/accept { paths }`) marca el valor como bien leído. `DELETE` sobre la misma ruta deshace las aceptaciones. Leer la cola pide `data.read` (no la ven los clientes); aceptar, corregir y olvidar ejemplos piden `shipment.write` (propietario, administrador, analista). Aceptaciones y correcciones quedan en el registro de auditoría (`review.accept`, `review.correct`). Un documento de otra organización responde 404.
- **Editar** usa la corrección manual de siempre (`PATCH /shipments/:id/documents/:documentId/data`): el documento debe seguir pasando su esquema, el cambio queda en el historial con quién lo hizo, y el envío vuelve a pedir validación. Un campo corregido cuenta como revisado.
- Revertir los valores del modelo devuelve esos campos a la cola. Reextraer el documento borra sus revisiones.

## Aprendizaje por proveedor

Interruptor en Administración → Configuración → Modelo y agente (`SUPPLIER_LEARNING`, apagado por defecto) y número de ejemplos por documento (`SUPPLIER_EXAMPLES`, 5).

1. Cuando alguien corrige un valor de un documento, si el aprendizaje está activo, la corrección se guarda en `supplier_examples` para la organización del envío y el proveedor del documento (vendedor de la factura o lista de empaque, embarcador del BL): el campo de la respuesta del modelo (`netWeight.value`; en un ítem, para todos: `packages[*].netWeight.value`), lo que copió el modelo, el valor correcto y la línea del PDF donde está impreso el valor correcto. Hay un ejemplo por campo: una corrección nueva reemplaza la anterior.
2. Cuando llega otro documento, después de leerlo y clasificarlo y antes de llamar al modelo, se busca en su texto el nombre de un proveedor con ejemplos de la misma organización (nunca de otra) (`detectSupplier`, por nombre normalizado sin forma legal). Si aparece, sus ejemplos más recientes para ese tipo de documento se agregan al final de las instrucciones del modelo.
3. Sin ejemplos, el prompt es exactamente el de siempre: la misma clave de caché y los mismos resultados medidos.

Los ejemplos se ven, y se pueden olvidar por proveedor, en la página de Revisión (`GET /suppliers/examples`, `DELETE /suppliers/examples/:key`). Revertir las correcciones de un documento borra los ejemplos que salieron de él. Nada sale del servidor: los ejemplos van al modelo local.

### Medición

`supplier-eval-cli` simula el uso real: los envíos llegan en orden, un revisor corrige con la verdad del conjunto cada valor que la extracción mostró mal, y cada documento se extrae también sin ejemplos (línea base) para comparar campo por campo. Los resultados están en [METRICS.md](METRICS.md#supplier-learning) y en `eval/reports/supplier-learning-*`.

```bash
npm run build -w @doccheck/synth -w @doccheck/extraction
node scripts/supplier-quirk-set.mjs                       # data/eval/supplier-quirk: un proveedor que imprime los pesos neto y bruto con las etiquetas cambiadas
node packages/extraction/dist/supplier-eval-cli.js --data data/eval/supplier-quirk
node packages/extraction/dist/supplier-eval-cli.js --data data/eval/v1     # que no empeore en el conjunto normal
```
