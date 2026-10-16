# App instalable y escaneo con la cámara

## Instalar

La web es una PWA: `apps/web/public/manifest.webmanifest` (nombre, íconos de 192 y 512 px y uno *maskable*, inicio en `#/app`, pantalla `standalone`) y un service worker (`public/sw.js`) que se registra solo en el build de producción. Chrome y Edge ofrecen instalarla; en iOS, Compartir → Añadir a pantalla de inicio. Hace falta HTTPS (o `localhost`).

### Qué guarda el service worker

Solo archivos estáticos, por lista blanca de pedidos GET al mismo origen:

| Pedido | Estrategia |
| --- | --- |
| Navegación a `/` o `/index.html` (la app) | Red primero; la copia guardada sin conexión |
| `/assets/*` (bundles con hash de Vite) e `/icons/*` | Caché primero |
| `/manifest.webmanifest` | Red primero |
| Todo lo demás: API, eventos, PDF, otros orígenes, cualquier pedido que no sea GET | Nunca se toca |

Además solo guarda respuestas 200 del mismo origen que no sean PDF: los datos de envíos y los documentos nunca quedan en la caché. Sin conexión la app abre, y los pedidos a la API fallan como siempre. La API sirve `sw.js` y el manifiesto con `cache-control: no-cache`, así un build nuevo se toma al recargar. Los bundles viejos se acumulan en la caché hasta que se sube `VERSION` en `sw.js`, que borra las cachés anteriores al activarse.

## Escanear con la cámara

En **Nuevo envío**, *Escanear con la cámara* abre un diálogo que usa `getUserMedia` (cámara trasera):

1. **Capturar página**: se toma el cuadro y se buscan los bordes del documento (`lib/detectDocumentQuad.ts`: escala de grises y desenfoque sobre una copia de ~360 px, umbral de Otsu, la región clara u oscura conexa más grande y sus esquinas extremas; si la forma no convence, se usa el cuadro entero).
2. La vista previa muestra el contorno encontrado sobre la foto y el recorte enderezado (`lib/perspectiveWarp.ts`: homografía de 4 puntos con muestreo bilineal). Se elige **conservar el recorte**, **usar la foto entera** o **repetir**.
3. Se pueden capturar varias páginas (miniaturas, quitar una).
4. **Crear PDF** arma un único PDF en el navegador, con cada página como JPEG (`lib/jpegPdf.ts`, sin dependencias), crea el envío con el destino y la referencia del formulario, lo sube y abre el envío. La extracción lo trata como un escaneo (OCR). Si la subida falla (por ejemplo, el límite del plan), el envío recién creado se borra.

Sin cámara, sin permiso o sin HTTPS, el diálogo lo explica y ofrece elegir o tomar fotos (`<input type="file" accept="image/*" capture="environment" multiple>`), que pasan por la misma vista previa. Al cerrar el diálogo se apaga la cámara.

Probado en Chrome sin interfaz con una cámara simulada y una foto sintética de una hoja inclinada; falta probarlo en un teléfono real.
