# Datos extraídos como tablas

`extractions.data` (jsonb, validado con los esquemas de `packages/schemas`) sigue siendo la fuente de verdad: es lo que lee la validación y lo que se corrige a mano. La migración `013_document_tables.sql` lo proyecta a tablas normalizadas para consultar, filtrar y agrupar sin recorrer JSON.

## Sincronización

Triggers de Postgres, sin código en la API:

| Evento | Efecto |
| --- | --- |
| Insert/update de `extractions.data` (extracción, re-extracción, corrección, revert) | `dc_project_document(document_id)` borra y reconstruye las filas del documento |
| Cambio de `documents.status` o `detected_type` | Igual: solo un documento `EXTRACTED` tiene filas (mientras re-extrae, no) |
| Insert/update/delete en `isf_filings` | `dc_project_isf(shipment_id)` |
| Cambio de dueño de un envío | Re-proyecta sus documentos (partes y productos son por usuario) |
| Borrar documento o envío | Cascada |

Si la proyección cambia, una migración reemplaza la función `dc_project_*` y ejecuta `select dc_reproject_all();` (también limpia partes y productos que ya no nombra ningún documento).

## Tablas

Todas llevan `shipment_id` y `user_id` para filtrar sin joins, y `extra jsonb` con las claves del JSON que la proyección no mapea: un campo nuevo en un esquema queda guardado antes de tener columna.

Números en `numeric` (sin floats), fechas en `date`, pesos en kg con el valor y unidad originales (`*_raw_value`, `*_raw_unit`), lugares como `*_name`, `*_locode`, `*_country`.

### Entidades (por usuario)

- **`parties`**: empresas. Clave = nombre normalizado (`dc_norm`: minúsculas, sin acentos, puntuación ni forma legal), así "ACME Toys Co., Ltd." y "Acme Toys Co Ltd" son la misma. Nombre, país y tax id del último documento.
- **`products`**: por SKU (`sku:TB-200`) o, sin SKU, por descripción normalizada. HS, HS6, origen, unidad y último vendedor.

### Por documento

- **`document_parties`**: cada parte tal como la imprime el documento (rol: seller, buyer, consignee, exporter, originator, shipper, notify, manufacturer, ship_to, consolidator), con dirección, contacto y `party_id`.
- **`invoices`**: cabecera de la factura: número, fechas, PO, moneda, incoterm, pago, puertos, pesos, totales, cargos, `line_count` y `lines_total` (suma de líneas en la moneda de la factura, para comparar con `invoice_total`).
- **`invoice_lines`**: SKU, descripción, marcas, cantidad y unidad, precio, total, `computed_total` (cantidad × precio), origen, HS con `hs_digits`, `hs2`, `hs4`, `hs6`, `product_id`.
- **`invoice_adjustments`**: flete, seguro, embalaje y descuentos, una fila cada uno.
- **`packing_lists`**, **`packing_packages`** (grupos de bultos: rango, tipo, pesos, dimensiones, volumen unitario), **`packing_contents`** (contenido de cada grupo, con `product_id`).
- **`bills_of_lading`**: número, tipo, booking, naviera y SCAC, buque y viaje, los cuatro lugares, bultos, peso, carga, flete, fechas, referencias.
- **`bl_containers`**: número, owner code ISO 6346, sello, tipo, bultos, peso, volumen.
- **`isf_details`**: ISF por envío (JSON o PDF): números de importador y consignatario, origen, HTS, lugar de consolidación y las cinco partes.

### Vista

- **`current_documents`**: el documento de cada tipo que usa la validación (el último extraído).

### Reglas por cuenta (migración 019)

No son proyección de documentos: las escribe la cuenta.

- **`rule_settings`**: ajustes de reglas por ámbito (`scope` = `user`, más adelante `organization`; `scope_id`). `config` guarda solo lo que difiere de los valores por defecto (`RuleConfig`: reglas apagadas, severidad, tolerancias, SCAC conocidos); sin fila, la validación se comporta igual que sin ajustes.
- **`purchase_orders`**: órdenes de compra importadas (CSV o JSON) para la regla X24. `po_key` (mayúsculas, solo letras y dígitos) las encuentra desde el PO de la factura; `lines` en jsonb con cantidades y precios como texto decimal. El mismo número reemplaza la orden anterior.
- **`validations.rule_config`**: lo que aplicó cada validación: ajustes, todas las tolerancias vigentes, fecha de la corrida (`asOf`), reglas apagadas y cuánta historia de la cuenta comparó (facturas, precios, orden de compra). Las reglas X17 y X23 leen `invoices` e `invoice_lines` de los otros envíos de la cuenta.

## En la app

Grupo **Datos** del menú lateral, una página por módulo:

| Página | Ruta | API |
| --- | --- | --- |
| Resumen | `#/app/data` | `GET /insights/summary` |
| Mercancías | `#/app/goods?q=&origin=&hs=` | `GET /insights/lines` (también `party=` y `product=`) |
| Empresas | `#/app/companies` | `GET /insights/parties?role=supplier\|customer&q=` |
| Empresa | `#/app/companies/<id>` | `GET /insights/parties/:id`: datos, variantes del nombre, direcciones y contactos, empresas en los mismos documentos, productos, envíos; sus mercancías con `lines?party=` |
| Productos | `#/app/products` | `GET /insights/products?q=&hs=&origin=` |
| Producto | `#/app/products/<id>` | `GET /insights/products/:id`: precio mínimo, promedio ponderado, máximo y último por moneda, gráfico, precios por vendedor, cómo lo escriben las facturas (descripciones, HS, orígenes) y cada compra |
| Contenedores | `#/app/containers` | `GET /insights/containers?q=` |
| Por envío | `#/app/data/shipments` | `GET /insights/shipments` |

El filtro de destino es uno para todas estas páginas.

## Ejemplos

```sql
-- Valor comprado por proveedor y moneda
select p.name, l.line_total_currency, sum(l.line_total)
from invoice_lines l join invoices i using (document_id) join parties p on p.id = i.seller_id
where l.user_id = $1 group by 1, 2 order by 3 desc;

-- Historial de precio de un producto
select i.invoice_date, l.unit_price, l.unit_price_currency
from invoice_lines l join invoices i using (document_id)
where l.product_id = $1 order by i.invoice_date;

-- Líneas cuyo total no cuadra con cantidad × precio
select * from invoice_lines where user_id = $1 and computed_total <> line_total;
```
