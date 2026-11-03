// Servidor estático simple para Render
// Sirve los archivos del frontend y maneja rutas del SPA (PWA)

const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 10000;
const PUBLIC_DIR = path.join(__dirname);

// Middleware para parsear JSON
app.use(express.json());

// Headers de seguridad y CORS para permitir llamadas a Neon Functions
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Cookie, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

// Headers de caché: no cachear HTML, JS, CSS, Service Worker, Manifest
app.use((req, res, next) => {
  const ext = path.extname(req.url);
  if (['.html', '.js', '.css', '.webmanifest', '.json'].includes(ext) || req.url.includes('service-worker')) {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});

// Ruta de salud
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'Rodando UTP Frontend', platform: 'Render' });
});

// Servir archivos estáticos con headers apropiados
app.use(express.static(PUBLIC_DIR, {
  extensions: ['html'],
  index: 'index.html',
  fallthrough: true
}));

// Manejo de rutas del SPA: cualquier ruta que no sea un archivo existente devuelve index.html
app.get('*', (req, res) => {
  const filePath = path.join(PUBLIC_DIR, req.path);
  
  // Si es un archivo existente, servirlo
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return res.sendFile(filePath);
  }
  
  // Si es una ruta del SPA o de la PWA, servir index.html
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Rodando UTP Frontend corriendo en puerto ${PORT}`);
});
