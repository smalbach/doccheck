# Consumo, planes y cobro (modo de prueba)

## Qué se cuenta

Por organización y por mes calendario (UTC), en `usage_counters` (migración `050_usage_plans.sql`): todo lo que hacen sus miembros cuenta para la organización activa, no para la cuenta de cada uno.

| Contador | Cuándo suma |
| --- | --- |
| `extraction` | Cada documento que el modelo leyó y quedó guardado (una reextracción vuelve a contar) |
| `validation` | Cada validación guardada |

La página **Consumo** (`#/app/usage`, `GET /usage`) muestra el plan, un medidor por contador, cuándo vuelven a cero y los meses anteriores. El panel muestra los documentos extraídos del mes y un aviso cuando un medidor está cerca o pasado del límite; Nuevo envío también muestra ese aviso.

## Planes

Tres planes en la tabla `plans`, que los administradores del servidor editan en **Administración → Planes** (`#/app/admin/plans`, `PUT /admin/plans/:id`); ahí también se ve el consumo del mes de cada organización y se cambia su plan a mano (`PUT /admin/usage/:orgId/plan`). El plan es de la organización (`organizations.plan`). Cada cambio de plan (a mano, por Stripe o de los límites) queda en el registro de auditoría (`org.plan`, `plan.update`).

| Plan | Documentos / mes | Validaciones / mes | Al llegar al límite |
| --- | --- | --- | --- |
| Free | 50 | 100 | Estricto |
| Pro | 1000 | 2000 | Suave |
| Business | Sin límite | Sin límite | Suave |

- **Límite suave** (`warnPercent`, 80 %): desde ese porcentaje la web avisa.
- **Al llegar al límite**, un plan estricto (`hard`) rechaza el trabajo nuevo con `402` y un cuerpo `{ code: "usage_limit", kind, used, limit, plan, resetsAt, message }`: subir PDF, reextraer y validar. Una subida de varios PDF que pasaría el límite se rechaza entera, antes de guardar nada. Un plan suave (`soft`) deja seguir y la web muestra que está por encima del plan.
- Una organización cuyo propietario es administrador del servidor (`ADMIN_EMAILS`) se cuenta pero nunca se bloquea. `USAGE_ENFORCEMENT=false` quita los bloqueos para todos (se sigue contando). La demo de solo lectura no bloquea.
- Dos subidas simultáneas pueden pasar juntas el control (se comprueba antes y se cuenta al extraer): el exceso queda acotado al tamaño de esas subidas.

## Stripe, solo en modo de prueba

Opcional y apagado si faltan variables. Solo se aceptan claves de prueba: una clave `sk_live_…` apaga el cobro y lo dice en el log, y un evento de webhook con `livemode: true` se rechaza. El cliente de Stripe es la organización (`organizations.stripe_customer_id`); comprar y gestionar el plan requiere el permiso `billing.manage` (propietario y administrador de la organización). A Stripe solo van el nombre y el id de la organización y el correo de quien compra; nunca documentos.

```bash
STRIPE_SECRET_KEY=sk_test_…        # o una clave restringida rk_test_…
STRIPE_WEBHOOK_SECRET=whsec_…      # stripe listen --forward-to localhost:3000/billing/webhook
STRIPE_PRICE_PRO=price_…           # precio recurrente de prueba de cada plan que se pueda comprar
STRIPE_PRICE_BUSINESS=price_…
APP_URL=http://localhost:3000      # adonde Stripe devuelve al usuario
```

| Ruta | Qué hace |
| --- | --- |
| `GET /billing` | `{ enabled, plans }`: si la web muestra los botones de compra y para qué planes |
| `POST /billing/checkout { plan }` | Crea el cliente de Stripe de la organización la primera vez y devuelve la URL de Checkout (suscripción); `client_reference_id` y `metadata.org_id` son el id de la organización |
| `POST /billing/portal` | URL del portal del cliente: cambiar o cancelar la suscripción, facturas, tarjeta |
| `POST /billing/webhook` | Público, firmado. `checkout.session.completed` pone el plan comprado; `customer.subscription.created/updated` sigue el precio de la suscripción; `deleted` (o un estado que no sea activo, de prueba o vencido) vuelve a Free |

El webhook guarda el cuerpo sin procesar para verificar `Stripe-Signature` (HMAC-SHA256 de `t.cuerpo`, máximo 5 minutos de antigüedad) y aplica cada evento una sola vez (`billing_events`); si aplicarlo falla, lo olvida para que el reintento de Stripe lo vuelva a intentar. No usa el SDK de Stripe: dos llamadas a la API REST con `fetch` (`apps/api/src/billing/stripe.ts`).

Pruebas: `apps/api/test/usage-review.test.mjs` firma eventos con un secreto de prueba; no hace falta una cuenta de Stripe.
