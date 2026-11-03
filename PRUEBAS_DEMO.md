# Pruebas de la demostración

Verificadas contra la URL HTTPS de Neon el 3 de noviembre de 2026:

| Prueba | Resultado |
|---|---|
| Salud y conexión a PostgreSQL | HTTP 200, conectado |
| Inicio de sesión de conductor y estudiante | HTTP 200 |
| Lista de rutas del conductor autenticado | HTTP 200; se observaron dos rutas |
| Guardar capacidad y disponibilidad sin cambiar sus valores | HTTP 200 |
| Capacidad inválida | HTTP 400 |
| Acceso de estudiante al panel de conductor | HTTP 403 |
| Crear ruta de prueba | HTTP 201 |
| Reservar y consultar la reserva | HTTP 200; reserva encontrada |
| Cancelar una reserva ajena | HTTP 404 |
| Cancelar reserva propia | HTTP 200; estado cancelada persistido |
| Desactivar la ruta creada para la prueba | HTTP 200 |
| Reinicio destructivo | HTTP 403; endpoint deshabilitado |

La ruta creada durante la prueba quedó **desactivada**, no borrada, y la reserva de prueba quedó cancelada en el historial.

Se verificó en un navegador la copia local del frontend contra Neon: el conductor vio su panel y sus rutas, y CastorUTP respondió al ingresar una zona. No se ha comprobado aún el despliegue de estos cambios en Render ni todos los recorridos, dispositivos y criterios de la lista de cotejo. CastorUTP es un chat determinista simulado, no un modelo de IA.

Tras el reinicio se insertaron 34 usuarios y 11 rutas de demostración, sin recuperar reservas históricas. `backend/scripts/recuperar-demo.cjs` es repetible; las contraseñas generadas para las cuentas institucionales se guardan solo en `backend/.env.demo.local`, ignorado por Git.
