# Aranceles, valor en aduana y costo puesto en destino

`packages/duties` estima, para cada envío, el valor en aduana, el arancel, los aranceles adicionales, las tasas e impuestos y el costo puesto en destino, por línea de factura y en total, y arma un borrador de la declaración (CBP 7501 o CBSA CAD). Son funciones puras: documentos normalizados, respuestas del usuario y tablas fechadas entran, la estimación sale. Todo el dinero va en decimales de punto fijo (`BigInt` con 12 decimales, `src/decimal.ts`), nunca en floats. Nada sale del servidor: las tablas se descargan de fuentes públicas y los documentos no se envían a ningún servicio.

Es una estimación para planificar, no una resolución aduanera, y **nada se transmite a CBSA ni a CBP**: no hay conexión ABI ni CARM.

## Tablas (`data/duties`)

Cada tabla lleva su fuente, URL, revisión o versión y fecha; la estimación lista las que usó.

| Archivo | Qué es | Cómo se actualiza |
| --- | --- | --- |
| `us-hts.json.gz` | HTSUS completo (USITC): tasa general, especial por programa (`S`, `CO`, `KR`…) y columna 2, por subpartida de 8 dígitos y sus sufijos estadísticos | `npm run duties:fetch` (o `node scripts/fetch-duty-data.mjs --us`) |
| `ca-tariff.json.gz` | Customs Tariff completo (archivo Access de la CBSA): NMF y cada tratamiento preferencial (UST, MXT, CEUT, CPTPT, COLT, GPT…) por partida de 8 dígitos | `--ca` (o `--ca-file archivo.accdb`) |
| `fx-ca.json` | Tipos diarios del Banco de Canadá (CAD por unidad) | `--fx --from AAAA-MM-DD` |
| `fx-us.json` | Federal Reserve H.10 (tipos del mediodía en Nueva York, en la dirección publicada) | `--fx` |
| `us-additional-duties.json` | Sección 301 (listas de China y trabajo forzoso), 232 (contenido de acero), 122 e IEEPA (ya anulados, para entradas de esas fechas) | a mano |
| `ca-surtaxes.json` | Sobretasas canadienses (China Surtax Order) | a mano |
| `us-fees.json` | MPF (tasa, mínimo y máximo por año fiscal) y HMF | a mano, cada 1 de octubre |
| `ca-taxes.json` | GST, HST por provincia con fechas, PST/QST/RST y capítulos con impuestos especiales | a mano |
| `adcvd-cases.json` | Casos AD/CVD (EE. UU.) y medidas SIMA (Canadá) por HS y origen: solo marcan, no calculan | a mano |
| `fta.json` | Tratados por destino, prueba de origen que exige cada uno y pistas de reglas de origen CUSMA por capítulo | a mano |

Las tablas a mano tienen `dataDate` y `validThrough`; cada entrada de aranceles adicionales tiene sus fechas de vigencia, su fuente y `verified`. Una entrada sin verificar contra la lista oficial se aplica, pero la estimación lo dice (D10). Un archivo `.json` sin comprimir gana sobre el `.gz`, así que una copia editada se puede dejar al lado; `DUTY_DATA_DIR` apunta a otra carpeta.

## Valor en aduana

- **EE. UU.** (19 U.S.C. 1401a, 19 CFR 152.103): precio realmente pagado o por pagar, sin flete ni seguro internacionales. Bajo términos C o D se descuentan si la factura los muestra; si no los muestra, el valor queda sobrestimado y sale D1. Se suman embalaje cobrado aparte, *assists* y regalías. El valor declarado se redondea a dólares enteros por línea, como en la casilla 32 del 7501.
- **Canadá** (Customs Act s. 48): precio en el lugar de expedición directa a Canadá. Se descuenta el flete y seguro desde ese lugar (s. 48(5)(b)(i)) y se suma el transporte hasta él (s. 48(5)(a)(vi)): bajo EXW, o FCA en un lugar que no es el puerto de carga del B/L, falta ese transporte y sale D2 hasta que se ingresa.
- Si los cargos de la factura suman con las líneas al total, están **aparte**; si no, son un desglose de lo que las líneas ya incluyen.
- Conversión con el tipo del día del embarque (B/L *shipped on board*, si no la fecha de embarque de la factura) o del día hábil anterior, hasta 7 días.

## Arancel por línea

1. Se busca la partida: con 8 o 10 dígitos, la línea exacta; con 6, todas las que cuelgan de ella. Si tienen tasas distintas se usa la más alta y sale D5 con el rango; el número completo se puede ingresar por línea.
2. Tratamiento: NMF / general, o el tratado reclamado si el origen de la línea es parte de él.
3. Tasas *ad valorem*, específicas (por kg con el peso neto del packing list por SKU, por litro, por unidad), compuestas y con mínimo o máximo. Un texto que no se entiende no se adivina: la línea queda sin arancel (estado `partial`).
4. Aranceles adicionales vigentes en la fecha de entrada para el origen y la partida: los que no se acumulan (`notWith`: el 301 de trabajo forzoso no aplica a mercancía 232) se descartan, los de piso (`topUpTo`, UE "10 % en total") completan hasta el piso, los de contenido de metal usan el valor ingresado o, si falta, el valor de la línea con D10.
5. EE. UU.: MPF 0,3464 % con mínimo y máximo del año fiscal (no sobre líneas USMCA) y HMF 0,125 % en carga marítima, repartidos por valor. Canadá: GST 5 % sobre valor + aranceles + sobretasas; la parte provincial de la HST se muestra como autoliquidada (la CBSA no la cobra en importaciones comerciales) y no entra en el costo.
6. Costo puesto en destino = mercancía + flete + seguro + transporte interior y agente + aranceles + tasas + impuestos cobrados en frontera.

Los repartos de montos del envío entre líneas usan resto mayor, así que las partes suman exactamente el total.

## Hallazgos de la estimación

Aparte de las reglas X1-X12, C1, C2 y U1 (no entran en el motor de reglas ni en la evaluación). Cada uno cita la evidencia (documento y campo, con la página del PDF cuando el valor está impreso), el pasaje del corpus cuando hay uno (19 CFR 152, D13-4-7, D11-4-2) y la pregunta que lo responde.

| Código | Cuándo |
| --- | --- |
| D1 | Términos C/D sin flete o seguro detallado; DDP |
| D2 | Canadá, EXW o FCA tierra adentro sin el transporte hasta el lugar de expedición directa |
| D3 | Vinculación sin responder (bajo) o vinculados (medio) |
| D4 | *Assists* y regalías sin responder |
| D5 | Sin HS, HS que no está en la tabla, varias líneas con tasas distintas, falta el sufijo de 10 dígitos |
| D6 | Sin tipo de cambio para una moneda |
| D7 | Preferencia reclamada sin prueba, con la certificación CUSMA incompleta (lista los elementos que faltan de los 9 del Anexo 5-A), sin ninguna línea elegible, o cargada en un país que no es parte |
| D8 | Origen cubierto por un tratado sin reclamarlo: ahorro posible |
| D9 | Caso AD/CVD o SIMA por HS y origen (no se calcula) |
| D10 | Aranceles adicionales sin verificar, tabla vencida, origen no revisado, contenido de metal |
| D11 | Tasa específica sin la cantidad en su unidad |
| D12 | Capítulo con impuestos especiales en Canadá (no se calcula) |
| D13 | Línea sin país de origen |
| D14 | Provincia desconocida (Canadá) |

## Borrador de declaración

`entryDraft` arma el CBP 7501 (EE. UU.) o el CAD de la CBSA (Canadá, el antiguo B3) con lo que dicen los documentos y la estimación: partes, B/L, buque, puertos, fechas, MID del fabricante (construido como indica CBP), por línea el número arancelario (con `.__` donde falta el sufijo), números del capítulo 99, valor, cargos, vinculación, tasa y arancel, y los totales con los códigos de clase 499 (MPF) y 501 (HMF). Lo que solo sabe el declarante (número de entrada, fianza, código de puerto, número de empresa, control de carga) queda en blanco. Siempre lleva `status: "Draft, not transmitted"`. Se ve en un panel, se descarga como JSON y se imprime solo.

## API y app

| Método | Ruta | Qué hace |
| --- | --- | --- |
| GET | `/shipments/:id/duties` | `{ estimate, entry?, inputsUpdatedAt? }` con las respuestas guardadas |
| PUT | `/shipments/:id/duties/inputs` | Guarda las respuestas (`DutyInputs`) y devuelve la estimación nueva |
| POST | `/shipments/:id/duties/preview` | Estima con estas respuestas sin guardarlas (permitido en la demo de solo lectura) |

Las respuestas viven en `shipment_duty_inputs` (migración `046_duty_inputs.sql`), con el `org_id` del envío (trigger `dc_org_from_shipment`) y siempre leídas y escritas dentro de la organización activa; la estimación no se guarda, se calcula en cada pedido con los documentos actuales. Leer la estimación y el borrador sigue al envío (`shipment.read`, también clientes con el envío compartido); guardar respuestas pide `shipment.write` y queda en el registro de auditoría (`duties.inputs`, antes y después). Un miembro de otra organización recibe 404 en las tres rutas (`test/orgs.test.mjs`). Las tablas de tasas son globales y las edita el administrador del servidor. En la página del envío, la tarjeta **Aranceles y costo puesto en destino** muestra los totales, la tabla por línea, el valor en aduana con sus ajustes y tipos de cambio, tasas, impuestos y aranceles adicionales, el tratado reclamado, los hallazgos y el formulario de preguntas; el JSON exportado incluye `duties` y el informe impreso, la tarjeta.

## Ejemplos

Calculados a mano y comprobados en `packages/duties/src/*.test.ts`.

**EE. UU., CIF New York**, 10 000,00 USD de rodamientos chinos (8482.10.50.08, 9 %), flete 800,00 y seguro 50,00 en la factura, entrada el 2026-10-16:

| Concepto | Cálculo | Monto |
| --- | --- | --- |
| Valor declarado | 10 000 − 800 − 50 | 9 150 |
| Arancel | 9 % | 823,50 |
| Sección 301, lista 1 | 25 % | 2 287,50 |
| Sección 301, trabajo forzoso | 12,5 % | 1 143,75 |
| MPF | 0,3464 % = 31,70, menos que el mínimo | 34,58 |
| HMF | 0,125 % = 11,4375 | 11,44 |
| Costo puesto en destino | 9 150 + 800 + 50 + 823,50 + 2 287,50 + 1 143,75 + 34,58 + 11,44 | 14 300,77 |

**Canadá, CFR Vancouver**, 20 000,00 EUR de camisetas alemanas (6109.10.00, NMF 18 %, CEUT libre), flete 1 500,00 EUR incluido, 1 EUR = 1,5000 CAD, consignatario en Ontario:

| Concepto | Cálculo | Monto (CAD) |
| --- | --- | --- |
| Valor en aduana | (20 000 − 1 500) × 1,5 | 27 750,00 |
| Arancel NMF | 18 % | 4 995,00 |
| GST | 5 % de 32 745,00 | 1 637,25 |
| HST provincial, autoliquidada | 8 % de 32 745,00 | 2 619,60 |
| Costo puesto en destino | 27 750 + 2 250 + 4 995 + 1 637,25 | 36 632,25 |
| Con CETA reclamado y prueba de origen | arancel 0, GST 1 387,50 | ahorro 5 244,75 |

## Otros documentos y destinos

- **Certificación de origen CUSMA** (tipo `CUSMA_CERTIFICATION`, la que revisa la regla T9): si el envío la tiene, sus nueve elementos cuentan para un reclamo CUSMA (`cusmaElements`: el exportador no hace falta si certifica el productor; el período general vale como "envío único" si nombra la factura). Las casillas del formulario completan lo que le falte. Si está pero no se reclama la preferencia, D8 lo dice.
- **Envíos aéreos**: la guía aérea (`AIR_WAYBILL`) da la fecha del vuelo para el tipo de cambio, el número, la aerolínea y los aeropuertos del borrador (7501 casilla 9 = 40 Air) y quita la HMF, que es solo marítima. La guía no imprime el monto del flete: bajo términos C o D sale de la factura o de la respuesta (D1 lo indica).
- **México, UE y Reino Unido**: no hay tablas de tasas para esos destinos, así que no hay estimación ni borrador; la tarjeta lo dice en lugar de mostrar números equivocados.

## Límites

- Con 6 dígitos la partida no es única: la estimación usa la tasa más alta y lo dice. La clasificación completa la da el usuario (o la búsqueda de nomenclatura de otra parte de DocCheck).
- Los aranceles adicionales cambian por aviso: la tabla tiene fecha y lo que no se verificó contra la lista oficial está marcado. Revisarla antes de usar los montos.
- AD/CVD, SIMA e impuestos especiales solo se marcan.
- El tipo de la Reserva Federal es el que FRBNY certifica a CBP en la práctica, pero el que cuenta es el de ACE para esa fecha.
- Los códigos de tratamiento y VFD de la CAD distintos de NMF (2), UST (10) y MXT (11) se nombran, no se codifican: revisar contra el memorando D17-1-10.
