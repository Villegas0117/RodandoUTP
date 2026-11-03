# Rodando UTP

PWA académica para compartir trayectos entre estudiantes de la Universidad
Tecnológica de Puebla.

---

## 🏗 Arquitectura actual (Full Stack)

| Capa | Tecnología | Despliegue |
|------|-----------|------------|
| **Frontend** | HTML5, CSS3, JavaScript vanilla (PWA) | GitHub Pages |
| **Backend** | Neon Functions (Hono + TypeScript) | Neon Functions |
| **Base de datos** | PostgreSQL (Neon) | Neon PostgreSQL |
| **Conexión SQL** | `pg` con pool de conexiones | `DATABASE_URL` |
| **Autenticación** | Cookie HttpOnly + PBKDF2-HMAC-SHA256 | Sesiones de 8 horas |
| **CORS** | Configurado para GitHub Pages | `https://villegas0117.github.io` |

### URLs públicas

- **Frontend (GitHub Pages):** https://villegas0117.github.io/RodandoUTP/
- **Backend (Neon Functions):** https://br-sparkling-snow-b75n6yfe-api.compute.c-13.us-east-1.aws.neon.tech/
- **Endpoint de salud:** `GET https://br-sparkling-snow-b75n6yfe-api.compute.c-13.us-east-1.aws.neon.tech/api/health`

---

## 🚀 Puesta en marcha

### Backend (Neon Functions)

El backend ya está desplegado en Neon Functions. No se requiere instalación local para usarlo.

Para desarrollo local del backend:

```bash
cd backend
npm install
npm run build   # verifica TypeScript
neon deploy     # despliega a Neon Functions
```

### Frontend (GitHub Pages)

El frontend se despliega automáticamente mediante GitHub Actions al hacer push a `main`.

Para pruebas locales, abre cualquiera de los archivos HTML en un servidor web local (el Service Worker requiere `localhost` o HTTPS):

```bash
# Desde la raíz del proyecto
python3 -m http.server 5500
# Abre http://localhost:5500
```

---

## 📱 PWA

Rodando UTP es una Aplicación Web Progresiva con:

- **Manifest:** `manifest.webmanifest` (nombre, iconos, colores, modo standalone)
- **Service Worker:** `service-worker.js` (caché de app shell, funcionamiento offline)
- **Iconos:** 192x192 y 512x512 para instalación
- **Cache API:** Recursos estáticos en caché para acceso sin conexión

### Funcionamiento offline

Los recursos estáticos (HTML, CSS, JS, imágenes, Leaflet) se almacenan en caché mediante el Service Worker. Las operaciones que requieren PostgreSQL (autenticación, rutas, reservas) necesitan conexión a internet.

---

## 🔐 Cuentas de demostración

| Rol | Correo | Contraseña |
|-----|--------|------------|
| Administrador | `admin@rodandoutp.mx` | `admin123` |
| Conductora · Cholula | `mariana@rodandoutp.mx` | `utp12345` |
| Conductor · Angelópolis | `diego@rodandoutp.mx` | `utp12345` |
| Estudiante · Cholula | `ana@rodandoutp.mx` | `utp12345` |

Además, se crearon **20 usuarios de prueba** con formato institucional:
`utp0001@alumno.utpuebla.edu.mx` a `utp0020@alumno.utpuebla.edu.mx`
(contraseña: `utp12345`).

---

## 📚 Documentación relacionada

- `REPORTE_IMPLEMENTACION.md` — Informe detallado de implementación, pruebas y resultados
- `BACKEND_NEON.md` — Configuración de Neon CLI, Functions, PostgreSQL y despliegue del backend

---

## 🛠 Tecnologías utilizadas

- **Frontend:** HTML5, CSS3, JavaScript (ES6+), Leaflet 1.9.4 (mapas), OpenStreetMap (mosaicos)
- **Backend:** TypeScript, Hono, Node.js (`pg` pool)
- **Base de datos:** PostgreSQL (Neon)
- **Infraestructura:** Neon CLI, Neon Functions, GitHub Actions, GitHub Pages
- **Autenticación:** PBKDF2-HMAC-SHA256, cookies HttpOnly/SameSite=Lax
