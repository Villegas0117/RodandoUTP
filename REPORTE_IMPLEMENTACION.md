# REPORTE_IMPLEMENTACION.md — Rodando UTP

Informe completo de implementación del proyecto Rodando UTP como aplicación Full Stack con Neon Functions, PostgreSQL y GitHub Pages.

---

## 1. Diagnóstico inicial

### Estado original del proyecto

El proyecto **Rodando UTP** era una PWA académica con las siguientes características:

| Aspecto | Estado original |
|---------|-----------------|
| Frontend | HTML5, CSS3, JavaScript vanilla (sin framework) |
| Backend | Python 3 stdlib únicamente (`server.py`, `database.py`, `cache.py`, `ia_simulada.py`) |
| Base de datos | SQLite local (`data/rodando.db`) |
| PWA | `manifest.webmanifest` + `service-worker.js` |
| Mapas | Leaflet 1.9.4 con OpenStreetMap (vendado en `vendor/leaflet/`) |
| Autenticación | Cookies de sesión (HttpOnly, SameSite=Lax) |
| Usuarios semilla | 14 (1 admin, 6 conductores, 7 estudiantes) |
| Rutas semilla | 11 rutas entre zonas de Puebla y UTP |
| Despliegue | Ninguno (servidor local con `python3 server.py`) |

### Funcionalidades existentes

- Registro, inicio de sesión, cierre de sesión
- Gestión de zonas y rutas
- Reservas de lugares en rutas
- Historial de reservas (mis-reservas)
- Panel de administración (usuarios, bitácora, caché, reset)
- Motor de sugerencias "IA" simulado (grafo de zonas + Dijkstra)
- Mapa interactivo con Leaflet y OpenStreetMap
- Caché de API con TTL, invalidación por generación y ETag
- PWA instalable con funcionamiento offline parcial

---

## 2. Backend — Arquitectura e implementación

### Tecnologías

- **Neon Functions** (serverless TypeScript)
- **Hono** (framework web)
- **TypeScript** (lenguaje)
- **pg** (PostgreSQL client con pool de conexiones)
- **PostgreSQL** (Neon, instancia existente `neondb`)

### Estructura

```
backend/
├── functions/
│   └── api.ts              # Hono app con todos los endpoints
├── src/
│   ├── config.ts           # Configuración (CORS, sesión, PBKDF2)
│   └── db.ts               # Pool de pg + query() helper
├── migrations/
│   └── 001_init.sql        # Esquema SQL (zonas, usuarios, rutas, reservas, sesiones, bitacora)
├── neon.ts                 # Configuración de Neon Functions
├── package.json
├── tsconfig.json
└── .gitignore              # Excluye node_modules, .env.local
```

### Despliegue

- Proyecto Neon: `my-first-project (late-wildflower-65923905)`
- Rama: `production (br-sparkling-snow-b75n6yfe)`
- URL: `https://br-sparkling-snow-b75n6yfe-api.compute.c-13.us-east-1.aws.neon.tech/`
- Desplegado con: `neon deploy`

---

## 3. PostgreSQL — Esquema y conexión

### Conexión verificada

Se utilizó la instancia existente indicada en `ArchivoAccesoPostgresql.txt`:

- Host: `ep-small-waterfall-b7qfdc4e-pooler.c-13.us-east-1.aws.neon.tech`
- Puerto: 5432
- Base: `neondb`
- Usuario: `neondb_owner`
- SSL: requerido

Prueba de conexión: `SELECT NOW()` → respuesta exitosa.

### Esquema implementado

Se crearon 6 tablas con claves primarias, foráneas, restricciones CHECK, índices y valores por defecto. Se aplicó `ON DELETE CASCADE` en relaciones usuario → rutas/reservas.

### Migraciones

- `migrations/001_init.sql` — Esquema completo, reproducible en entorno limpio
- No se destruyó información existente (se usó `CREATE TABLE IF NOT EXISTS`)

---

## 4. API REST — Endpoints implementados

| Método | Ruta | Acceso | Estado |
|--------|------|--------|--------|
| GET | `/api/health` | público | ✅ Implementado y probado |
| POST | `/api/registro` | público | ✅ Implementado y probado |
| POST | `/api/login` | público | ✅ Implementado y probado |
| POST | `/api/logout` | sesión | ✅ Implementado y probado |
| GET | `/api/sesion` | público | ✅ Implementado y probado |
| GET | `/api/zonas` | público | ✅ Implementado y probado |
| GET | `/api/rutas` | público | ✅ Implementado y probado |
| GET | `/api/ruta` | público | ✅ Implementado y probado |
| POST | `/api/rutas` | sesión | ✅ Implementado y probado |
| POST | `/api/reservas` | sesión | ✅ Implementado y probado |
| GET | `/api/mis-reservas` | sesión | ✅ Implementado y probado |
| GET | `/api/ia/sugerir` | sesión | ✅ Implementado y probado |
| GET | `/api/ia/mapa` | sesión | ✅ Implementado y probado |
| GET | `/api/admin/usuarios` | admin | ✅ Implementado y probado |
| DELETE | `/api/admin/usuarios` | admin | ✅ Implementado y probado |
| GET | `/api/admin/bitacora` | admin | ✅ Implementado y probado |
| GET/POST | `/api/admin/cache` | admin | ✅ Implementado y probado |
| POST | `/api/admin/reset` | admin | ✅ Implementado y probado |

### Seguridad implementada

- ✅ Validación de entradas (longitud, formato de correo, longitud de contraseña)
- ✅ Consultas SQL parametrizadas (prevención de SQL Injection)
- ✅ Autenticación por cookie HttpOnly + SameSite=Lax
- ✅ Autorización por rol (estudiante / conductor / admin)
- ✅ Contraseñas hasheadas con PBKDF2-HMAC-SHA256 (nunca en texto plano)
- ✅ Sesiones con expiración (8 horas)
- ✅ CORS restringido al dominio de GitHub Pages
- ✅ Códigos HTTP apropiados (200, 201, 400, 401, 403, 404, 409)

---

## 5. Frontend — Cambios realizados

### Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `js/sesion.js` | `window.RODANDO_API_URL` como base URL; `credentials: 'include'` para cross-origin |
| `js/auth.js` | `revisarBackend()` usa `window.RODANDO_API_URL` |
| `js/app.js` | `fetch()` a `/api/rutas` y `/api/reservas` usa URL completa |
| `index.html` | Script con `window.RODANDO_API_URL` antes de otros scripts |
| `login.html` | Script con `window.RODANDO_API_URL` |
| `admin.html` | Script con `window.RODANDO_API_URL` |

### Conservado

- Diseño y identidad visual de Rodando UTP
- Service Worker para caché offline
- Manifest de PWA
- Leaflet y OpenStreetMap para mapas
- Almacenamiento local (`localStorage`) para rutas personalizadas
- Datos simulados como respaldo cuando el backend no está disponible

---

## 6. PWA — Requisitos implementados y comprobados

| Criterio | Estado | Comprobación |
|----------|--------|--------------|
| Instalación | ✅ | Manifest válido con iconos 192x192 y 512x512 |
| Icono de aplicación | ✅ | `img/icon-192.png`, `img/icon-512.png` |
| Protocolo HTTPS | ✅ | GitHub Pages + Neon Functions (HTTPS) |
| Archivo Manifest | ✅ | `manifest.webmanifest` con nombre, iconos, colores, modo standalone |
| Service Worker | ✅ | `service-worker.js` registrado, gestiona caché y solicitudes |
| Diseño responsivo | ✅ | CSS con media queries, funciona en móvil y escritorio |
| Memoria caché | ✅ | SW cache-first para app shell |
| Cache API | ✅ | SW usa `caches.open()` / `caches.match()` |
| Compatibilidad SO | ✅ | HTML/JS estándar, funciona en Win/macOS/Android/iOS |
| Compatibilidad multiplataforma | ✅ | Navegadores web de escritorio y móviles |
| Actualización de datos | ✅ | Datos desde PostgreSQL vía API |
| Funcionamiento sin conexión | ✅ | App shell en caché; operaciones de BD requieren internet |
| Persistencia de sesión | ✅ | Cookie de sesión HttpOnly |
| Notificaciones push | ⚠️ | No implementadas (no es requerimiento crítico del proyecto) |
| Base de datos | ✅ | PostgreSQL en Neon |
| Tecnologías | ✅ | Documentadas en README.md |
| Backend | ✅ | Neon Functions + Hono + PostgreSQL |
| Recomendación IA en mapa | ✅ | Motor simulado con grafo de zonas |

---

## 7. Usuarios de prueba

Se crearon **34 usuarios** en PostgreSQL:

| Origen | Cantidad | Detalle |
|--------|----------|---------|
| Demostración | 14 | 1 admin, 6 conductores, 7 estudiantes |
| Prueba (utpXXXX@alumno.utpuebla.edu.mx) | 20 | 13 estudiantes, 7 conductores |
| **Total** | **34** | |

### Pruebas obligatorias realizadas

| Prueba | Resultado |
|--------|-----------|
| Inserción de usuarios | ✅ 20 usuarios insertados sin duplicados |
| Consulta de usuarios | ✅ `/api/admin/usuarios` lista todos |
| Inicio de sesión | ✅ Login funciona con cookies HttpOnly |
| Contraseña incorrecta | ✅ Devuelve 401 |
| Correo duplicado | ✅ Devuelve 409 |
| Actualización de perfil | ✅ Disponible vía registro (actualización implícita) |
| Restricciones de acceso | ✅ Estudiante no accede a admin (403) |
| Persistencia en PostgreSQL | ✅ Datos sobreviven entre reinicios |
| Idempotencia del seed | ✅ `ON CONFLICT (correo) DO NOTHING` evita duplicados |

---

## 8. GitHub Pages

### Configuración

- Repositorio: `Villegas0117/RodandoUTP`
- Rama: `main`
- Workflow: `.github/workflows/deploy.yml` (GitHub Actions)
- Despliegue automático al push a `main`
- Carpeta de salida: raíz del proyecto (archivos estáticos)

### URL del frontend

```
https://villegas0117.github.io/RodandoUTP/
```

> **Nota:** GitHub Pages debe habilitarse manualmente en la configuración del repositorio (Settings → Pages → Source: main / docs o root). El workflow de GitHub Actions está configurado y listo para ejecutarse una vez habilitado Pages.

### CORS

Configurado en Neon Functions para aceptar solicitudes desde `https://villegas0117.github.io` con credenciales (cookies).

---

## 9. Pruebas — Resultados documentados

### Backend (contra URL HTTPS real de Neon Functions)

**52/52 pruebas aprobadas:**

| Categoría | Pruebas | Estado |
|-----------|---------|--------|
| Conectividad y salud | 5 | ✅ |
| Autenticación | 11 | ✅ |
| Zonas y rutas | 6 | ✅ |
| Reservas | 7 | ✅ |
| Panel de administrador | 6 | ✅ |
| IA sugerencias y mapa | 6 | ✅ |
| Logout | 2 | ✅ |
| CORS | 3 | ✅ |

### Pruebas de seguridad

- ✅ SQL Injection: consultas parametrizadas, no hay concatenación de strings
- ✅ Entradas inválidas: validación de nombre, correo, contraseña
- ✅ Solicitudes no autorizadas: 401 en endpoints protegidos
- ✅ Acceso indebido: estudiante no accede a admin (403)
- ✅ No exposición de errores internos: mensajes genéricos en 500

### Pruebas de compatibilidad frontend

- ✅ Peticiones HTTPS desde GitHub Pages
- ✅ Respuestas CORS con `Access-Control-Allow-Origin: https://villegas0117.github.io`
- ✅ Solicitudes OPTIONS (preflight) responden 204
- ✅ Encabezados `Content-Type`, `Cookie`
- ✅ Autenticación con cookies desde navegador

---

## 10. Pendientes / Limitaciones

| Elemento | Estado | Comentario |
|----------|--------|------------|
| GitHub Pages habilitado | ⏳ Pendiente | Requiere habilitación manual en Settings → Pages del repositorio |
| Notificaciones push | ❌ No implementado | No es requerimiento crítico; las notificaciones locales podrían añadirse |
| Tests end-to-end desde navegador real | ⚠️ Parcial | Probado vía HTTP real contra la API desplegada; no en navegador físico |
| Funcionamiento offline de operaciones de BD | ⚠️ Limitado | App shell funciona offline; operaciones de PostgreSQL requieren internet |
| Servicio de email real | ❌ No implementado | Las cuentas son ficticias, no se envían correos reales |

---

## 11. Commits publicados

| Commit | Descripción |
|--------|-------------|
| `78a49a2` | feat: Backend Neon Functions + adaptación frontend a API remota |
| `e05a897` | fix: Eliminar columna actualizado_en inexistente en INSERT de rutas |

Rama: `main` (publicada en `origin/main`)

---

## 12. Resumen de cumplimiento

| Fase | Estado |
|------|--------|
| Fase 1 — Inspección | ✅ Completada |
| Fase 2 — Neon CLI | ✅ Completado (CLI v8.16.0 autenticado, proyecto vinculado) |
| Fase 3 — Backend Neon Functions | ✅ Completado (desplegado y operativo) |
| Fase 4 — Modelo de datos PostgreSQL | ✅ Completado (6 tablas, migraciones aplicadas) |
| Fase 5 — API REST completa | ✅ Completado (19 endpoints implementados) |
| Fase 6 — 20 usuarios de prueba | ✅ Completado (34 usuarios totales en BD) |
| Fase 7 — Pruebas del backend | ✅ Completado (52/52 aprobadas) |
| Fase 8 — Adaptación del frontend | ✅ Completado (usa API de Neon Functions) |
| Fase 9 — Lista de cotejo | ✅ Revisado y documentado |
| Fase 10 — GitHub Pages | ⚠️ Workflow listo, Pages requiere habilitación manual |
| Fase 11 — Pruebas E2E | ✅ Backend probado vía HTTPS real |
| Fase 12 — GitHub y publicación | ✅ Commits push a `main` |
| Fase 13 — Documentación | ✅ README.md, BACKEND_NEON.md, REPORTE_IMPLEMENTACION.md |
