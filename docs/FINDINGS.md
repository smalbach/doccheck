# Qué hacer con un finding

Cada finding de la última validación tiene un estado y acciones en su tarjeta.

| Estado | Significa | Cuenta como abierto |
| --- | --- | --- |
| Por resolver | Nadie decidió nada (o se reabrió) | sí |
| Esperando al proveedor | Se pidieron documentos corregidos | sí |
| Riesgo aceptado | Se sigue adelante sabiéndolo; requiere motivo | no |
| Falso positivo | El finding está mal; requiere motivo | no |
| Resuelto | Desapareció en la validación siguiente (se corrigió un valor o se subió otro documento) | — |

Cada decisión queda en el historial del finding con usuario, fecha y motivo.

## Flujo

1. **Ver qué falla:** la tarjeta dice el problema y qué hacer en el idioma de la interfaz, con los valores de cada documento y la página del PDF. El mensaje técnico de la regla sigue debajo, en inglés.
2. **Si el modelo leyó mal:** "Corregir este valor" abre los datos del documento en ese campo. Después de guardar, vuelve a validar.
3. **Si el documento está mal:** "Pedir correcciones" arma un mensaje para el proveedor, en inglés, español o francés, con los findings elegidos, los valores y qué corregir. Se copia o se abre en tu correo; DocCheck no envía nada. Desde ahí se marcan como esperando al proveedor. Al llegar el documento corregido, súbelo y valida.
4. **Si no hace falta corregir:** acepta el riesgo o márcalo como falso positivo, con el motivo.
5. **Al validar de nuevo:** los findings nuevos llevan la etiqueta "Nuevo" y los que ya no están aparecen como resueltos. Una decisión se mantiene mientras el finding sea el mismo: misma regla, mismos campos y valores (aunque el documento se haya vuelto a subir).

Un envío queda **listo** cuando su última validación no tiene findings abiertos. El panel y la lista de envíos cuentan solo los abiertos, y cuántos esperan al proveedor. La alerta de findings críticos ignora los aceptados y los falsos positivos.

## API

- `GET /shipments/:id/validation`: cada finding trae `fingerprint`, `review` (la última decisión), `history` e `isNew`. Además vienen `previous` (la validación anterior) y `resolved`.
- `POST /shipments/:id/findings/review` `{ fingerprints, status, note? }` con `status` = `open` | `waiting_supplier` | `accepted` | `false_positive`. La nota es obligatoria para los dos últimos. Responde con la última validación.

La huella (`fingerprint`) es `md5(regla | campo=valor;…)` y la calcula Postgres al guardar el finding (migración 014).
