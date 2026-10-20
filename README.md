# Rodando UTP

PWA académica para compartir trayectos entre estudiantes de la Universidad
Tecnológica de Puebla.

Aplicación web progresiva con **HTML, CSS y JavaScript** en el cliente, y un
**backend en Python 3 usando solo la biblioteca estándar** (sin `pip install`
ni `npm install`).

## Puesta en marcha

```bash
python3 server.py
```

Abre <http://localhost:5500>. La base de datos SQLite se crea y se llena con
datos de demostración en el primer arranque.

Opciones disponibles:

```bash
python3 server.py --puerto 8000   # cambia el puerto
python3 server.py --host 0.0.0.0   # accesible desde la red local
python3 server.py --reset          # borra la base y vuelve a sembrarla
```

> El Service Worker requiere `localhost` o HTTPS. Abrir `index.html` con doble
> clic (`file://`) no registra el Service Worker ni la API.

## Cuentas de demostración

| Rol | Correo | Contraseña |
|---|---|---|
| Administrador | `admin@rodandoutp.mx` | `admin123` |
| Conductora · Cholula | `mariana@rodandoutp.mx` | `utp12345` |
| Conductor · Angelópolis | `diego@rodandoutp.mx` | `utp12345` |
| Estudiante · Cholula | `ana@rodandoutp.mx` | `utp12345` |

En total se siembran 14 usuarios (1 administrador, 6 conductores, 7 estudiantes),
6 zonas y 11 rutas.

## Estructura del proyecto

### Backend (Python 3 · sin dependencias)

| Archivo | Responsabilidad |
|---|---|
| `server.py` | Servidor HTTP, archivos estáticos y API JSON en `/api/*`. |
| `database.py` | Esquema SQLite, semilla de datos, contraseñas y consultas. |
| `ia_simulada.py` | Motor de sugerencias determinista (grafo de zonas). |
| `pruebas_backend.py` | 61 pruebas automáticas del backend. |

### Frontend

| Archivo | Responsabilidad |
|---|---|
| `index.html` | Portada, buscador de rutas y mapa inteligente. |
| `login.html` | Inicio de sesión y registro. |
| `admin.html` | Panel de administración de usuarios. |
| `js/sesion.js` | Estado de sesión compartido entre páginas. |
| `js/app.js` | Filtros, reservas, publicación e instalación de la PWA. |
| `js/mapa-ia.js` | Mapa por zonas y tarjetas de sugerencias. |
| `js/auth.js` / `js/admin.js` | Lógica de acceso y del panel. |
| `css/styles.css` | Diseño base verde/oscuro. |
| `css/mapa-ia.css`, `css/auth.css`, `css/admin.css` | Estilos de cada sección. |
| `data/rutas.json` | Datos de respaldo si el servidor no está disponible. |
| `manifest.webmanifest` | Metadatos de instalación de la PWA. |
| `service-worker.js` | Caché del app shell y soporte sin conexión. |

## Base de datos

SQLite con 6 tablas y claves foráneas con borrado en cascada:

- `usuarios` — nombre, correo, hash PBKDF2, rol, zona, matrícula.
- `zonas` — nombre, latitud, longitud y posición en el mapa.
- `rutas` — conductor, origen, punto, horario, lugares y aportación.
- `reservas` — un lugar por pasajero y ruta (`UNIQUE`).
- `sesiones` — tokens de sesión con caducidad de 8 horas.
- `bitacora` — registro de acciones para el panel.

Las contraseñas se guardan como hash **PBKDF2-HMAC-SHA256** con sal aleatoria
por usuario. El archivo `.db` nunca se sirve por HTTP, y el servidor bloquea
además los `.py`, los metadatos de Git y cualquier ruta fuera del proyecto.

## API

| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| `GET` | `/api/salud` | público | Estado del servicio. |
| `POST` | `/api/registro` | público | Crea una cuenta e inicia sesión. |
| `POST` | `/api/login` | público | Devuelve la cookie de sesión. |
| `POST` | `/api/logout` | público | Cierra la sesión. |
| `GET` | `/api/sesion` | público | Usuario actual o `null`. |
| `GET` | `/api/zonas` | público | Zonas, conexiones y estadísticas. |
| `GET` | `/api/rutas` | público | Rutas; admite `origen`, `turno`, `lugares`. |
| `GET` | `/api/ruta?id=N` | público | Detalle de una ruta. |
| `GET` | `/api/ia/sugerir` | **sesión** | Sugerencias ordenadas. |
| `GET` | `/api/ia/mapa` | **sesión** | Mapa completo con sugerencias. |
| `POST` | `/api/reservas` | **sesión** | Reserva un lugar. |
| `GET` | `/api/mis-reservas` | **sesión** | Historial del pasajero. |
| `POST` | `/api/rutas` | **sesión** | Publica una ruta. |
| `GET` | `/api/admin/usuarios` | **admin** | Lista usuarios y resumen. |
| `DELETE` | `/api/admin/usuarios?id=N` | **admin** | Elimina un usuario. |
| `GET` | `/api/admin/bitacora` | **admin** | Últimos movimientos. |
| `POST` | `/api/admin/reset?confirmar=1` | **admin** | Reinicia la base. |

`admin.html` está protegida en el propio servidor: sin sesión responde `401` y
con una cuenta que no sea admin responde `403`.

## Mapa inteligente (IA simulada)

> **No se conecta a ninguna API de inteligencia artificial externa.**
> Es un algoritmo determinista escrito para la demostración.

Funcionamiento en `ia_simulada.py`:

1. **Grafo de zonas.** Cada arista guarda los minutos aproximados entre dos
   zonas de la región de Puebla (UTP, Cholula, Angelópolis, Amozoc, Centro,
   La Margarita).
2. **Dijkstra.** Calcula el tiempo real de trayecto desde la zona del pasajero
   hasta la del conductor, siguiendo el camino más corto.
3. **Puntaje de 0 a 100** con cinco componentes:

   | Componente | Peso | Criterio |
   |---|---|---|
   | Cercanía | 40 | Decae lineal: 0 min = 40, 60 min = 0. |
   | Horario | 20 | Mismo turno = 20, distinto = 8. |
   | Reputación | 20 | Calificación del conductor sobre 5. |
   | Disponibilidad | 10 | Lugares libres. |
   | Peso de zona | 10 | Densidad studentil y conectividad. |

4. **Razones explicables.** Cada sugerencia incluye frases legibles que
   justifican el puntaje, útiles para la presentación del proyecto.

La sección completa y las sugerencias solo son visibles **después de iniciar
sesión**, tanto en la interfaz como en la API.

## Estrategia de caché

La aplicación separa deliberadamente lo que se puede cachear de lo que no:

| Recurso | Comportamiento | Motivo |
|---|---|---|
| `index.html`, `css/`, `js/`, `img/` | Service Worker **cache-first** + revalidación en segundo plano | Permite usar la app sin conexión. |
| Archivos estáticos servidos por HTTP | `Cache-Control: no-cache` | Se guardan, pero siempre se revalidan contra el servidor. |
| **`/api/*` (toda la API)** | **`Cache-Control: no-store`** | Son datos de sesión y mutables. Cachearlos rompería el login y el panel. |
| `/admin*` | Nunca entra a la caché del Service Worker | El panel exige sesión de administrador. |

El Service Worker ignora por completo las rutas que empiezan con `/api/` o
`/admin`, así que esas peticiones siempre llegan al servidor. En la API,
`no-store` evita que el navegador aplique heurísticas de frescura y sirva datos
obsoletos.

> **Al desarrollar:** el Service Worker sirve primero desde la caché. Si tocas un
> `.js` o un `.css` y no ves el cambio, ve a DevTools → Application → Service
> Workers y pulsa *Unregister*, o sube `CACHE_NAME` en `service-worker.js`.
> La caché de la API no interfiere con esto.

## Pruebas

Con el servidor corriendo en otra terminal:

```bash
python3 pruebas_backend.py
```

Cubre el arranque, los archivos estáticos, el bloqueo de archivos sensibles,
autenticación, control de acceso por rol, el motor de sugerencias, rutas,
reservas y el panel de administrador. El script es idempotente: se puede
ejecutar las veces que sea necesario.

## Funcionamiento sin servidor

Si el servidor no está activo, `index.html` sigue funcionando: `js/app.js`
detecta que `/api/rutas` falla y recurre a `data/rutas.json`, igual que en la
primera versión del proyecto. Lo que sí requiere sesión es el mapa inteligente
y el panel de administrador.
