# Revisión de la lista de cotejo

Fuente: `Lista_de_cotejo.txt` proporcionada por el propietario. Esta matriz distingue código existente de pruebas realizadas; no sustituye las pruebas en los dispositivos indicados.

| N.º | Criterio | Estado y evidencia |
|---|---|---|
| 1 | Instalación | Manifest y botón de instalación presentes; instalación real pendiente de probar. |
| 2 | Icono | Hay iconos de 192 y 512 píxeles; apariencia instalada pendiente. |
| 3 | HTTPS | Render y Neon tienen URLs HTTPS; pruebas completas de recursos pendientes. |
| 4 | Manifest | `manifest.webmanifest` existente; validación de instalación pendiente. |
| 5 | Service Worker | Registro y caché implementados; actualización en producción pendiente de verificar. |
| 6 | Diseño responsivo | Hay estilos responsivos; comprobación en diferentes tamaños pendiente. |
| 7 | Memoria caché | App shell incluida en Service Worker; prueba offline completa pendiente. |
| 8 | Cache API | Se utilizan `caches.open` y `caches.match`; prueba offline pendiente. |
| 9 | Compatibilidad con sistemas operativos | Pendiente de probar en Windows, macOS, Android e iOS. |
| 10 | Compatibilidad multiplataforma | Pendiente de comprobar en dispositivos y navegadores reales. |
| 11 | Actualización de datos | Las reservas se consultan de la API y pueden actualizarse; flujo completo en producción pendiente. |
| 12 | Funcionamiento sin conexión | Caché de recursos y avisos de error implementados; operaciones con PostgreSQL requieren red. Prueba pendiente. |
| 13 | Persistencia de sesión y progreso | Token en `sessionStorage` durante la sesión de la pestaña; sesión sin conexión y progreso no verificados. No se afirma persistencia tras cerrar el navegador. |
| 14 | Notificaciones push | Pendiente: no hay suscripción Web Push ni servidor de envío implementados. |
| 15 | Base de datos | Existe PostgreSQL y API; lectura de reservas verificada previamente desde navegador local, escritura y persistencia integrales en producción pendientes. |
| 16 | Tecnologías utilizadas | HTML, CSS, JavaScript, TypeScript, Hono, PostgreSQL y Neon; documentadas en README. El proyecto no utiliza PHP. |
| 17 | Backend | Endpoints disponibles; validaciones, seguridad y flujos adicionales requieren auditoría y pruebas. |
| 18 | Recomendación por IA en mapa | Existe una heurística simulada; no se demuestra IA real personalizada con ubicación, historial y preferencias. Pendiente. |

## Limitaciones de seguridad

El token es accesible al JavaScript de la página y permanece durante la sesión de la pestaña: una vulnerabilidad XSS podría exponerlo. Conviene migrar a una sesión HttpOnly con una arquitectura adecuada y revisar CORS y CSRF. Las credenciales de base de datos compartidas previamente deben rotarse; las cuentas administrativas con contraseñas públicas no son aptas para datos reales.
