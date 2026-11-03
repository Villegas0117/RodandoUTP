/**
 * Configuración de variables de entorno del backend.
 * Nunca expone DATABASE_URL ni credenciales al frontend.
 */
export const config = {
  databaseUrl: process.env.DATABASE_URL,
  port: Number(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  // Origen permitido para CORS (GitHub Pages). Se ajusta en despliegue.
  corsOrigin: process.env.CORS_ORIGIN || '*',
  // Sesión: cookie de sesión con expiración (8 horas, igual que el backend original)
  sessionMaxAgeMs: 8 * 60 * 60 * 1000,
  // Coste PBKDF2 para hashing de contraseñas
  pbkdf2Iterations: 120000,
};
