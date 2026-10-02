# Rodando UTP

PWA académica para compartir trayectos entre estudiantes de la Universidad Tecnológica de Puebla.

## Archivos principales
- `index.html`: interfaz y estructura semántica.
- `css/styles.css`: diseño responsivo verde/oscuro.
- `js/app.js`: filtros, reservas, rutas locales, instalación y registro del Service Worker.
- `data/rutas.json`: datos de ejemplo en JSON.
- `manifest.webmanifest`: metadatos de instalación de la PWA.
- `service-worker.js`: caché del app shell y soporte offline básico.

## Probar localmente
Los Service Workers requieren `localhost` o HTTPS. En VS Code puedes usar **Live Server** y abrir `index.html`.

También puedes iniciar un servidor desde la carpeta con:

```bash
python -m http.server 5500
```

Luego abre `http://localhost:5500`.
