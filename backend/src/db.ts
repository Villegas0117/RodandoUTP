/**
 * Pool de conexiones PostgreSQL reutilizable.
 * Usa DATABASE_URL y es compatible con SSL de Neon.
 */
import { Pool, QueryResult } from 'pg';
import { config } from './config';

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('connect', () => {
  // eslint-disable-next-line no-console
  console.log('[pg] Nueva conexión establecida');
});

pool.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('[pg] Error inesperado en el pool:', err.message);
});

/**
 * Ejecuta una consulta parametrizada y libera el cliente al pool.
 */
export async function query<T = any>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const client = await pool.connect();
  try {
    const result: QueryResult = await client.query(text, params);
    return result.rows as unknown as T[];
  } finally {
    client.release();
  }
}

/**
 * Verifica que la base de datos esté disponible.
 */
export async function checkConnection(): Promise<boolean> {
  try {
    const rows = await query<{ now: Date }>('SELECT NOW() as now');
    return rows.length > 0 && !!rows[0].now;
  } catch {
    return false;
  }
}

/**
 * Cierra el pool (útil en tests y apagado ordenado).
 */
export async function closePool(): Promise<void> {
  await pool.end();
}
