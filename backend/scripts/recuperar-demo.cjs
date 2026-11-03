// Recuperación no destructiva: inserta únicamente cuentas y rutas ausentes.
// Ejecutar con: node --env-file=.env.local scripts/recuperar-demo.cjs
const { Pool } = require('pg');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL');
const root = path.resolve(__dirname, '../..');
const seed = JSON.parse(execFileSync('python3', ['-c', 'import json,database; print(json.dumps([database.USUARIOS_SEMILLA,database.RUTAS_SEMILLA]))'], { cwd: root, encoding: 'utf8' }));
const credentialsFile = path.join(__dirname, '..', '.env.demo.local');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

async function main() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const demo = [...seed[0]];
    const generated = [];
    for (let i = 1; i <= 20; i++) {
      const correo = `utp${String(i).padStart(4, '0')}@alumno.utpuebla.edu.mx`;
      const exists = await c.query('SELECT 1 FROM usuarios WHERE correo=$1', [correo]);
      if (!exists.rowCount) {
        const password = crypto.randomBytes(18).toString('base64url');
        generated.push({ correo, password });
        demo.push([`Usuario Prueba ${i}`, correo, password, i % 3 === 0 ? 'conductor' : 'estudiante', 'Centro', null, false]);
      }
    }
    if (generated.length && fs.existsSync(credentialsFile)) throw new Error('Ya existe .env.demo.local; consérvalo y mueve el archivo antes de generar cuentas adicionales.');
    for (const [nombre, correo, password, rol, zona, matricula, verificado] of demo) {
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.pbkdf2Sync(password, Buffer.from(salt, 'hex'), 120000, 64, 'sha256').toString('hex');
      await c.query('INSERT INTO usuarios(nombre,correo,password_hash,salt,rol,zona,matricula,verificado) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(correo) DO NOTHING', [nombre, correo, hash, salt, rol, zona, matricula, Boolean(verificado)]);
    }
    for (const [correo, origen, punto, salida, llegada, lugares, aportacion, calificacion, dias] of seed[1]) {
      await c.query(`INSERT INTO rutas(conductor_id,origen,punto_encuentro,salida,llegada,lugares,aportacion,calificacion,dias)
        SELECT u.id,$2::varchar,$3::varchar,$4::time,$5::time,$6,$7,$8,$9 FROM usuarios u WHERE u.correo=$1 AND NOT EXISTS
        (SELECT 1 FROM rutas r WHERE r.conductor_id=u.id AND r.origen=$2::varchar AND r.punto_encuentro=$3::varchar AND r.salida=$4::time)`, [correo, origen, punto, salida, llegada, lugares, aportacion, calificacion, dias]);
    }
    if (generated.length) fs.writeFileSync(credentialsFile, JSON.stringify(generated, null, 2), { mode: 0o600, flag: 'wx' });
    await c.query('COMMIT');
    for (const table of ['usuarios', 'rutas', 'reservas', 'zonas']) {
      const r = await c.query(`SELECT count(*)::int AS total FROM ${table}`);
      console.log(`${table}: ${r.rows[0].total}`);
    }
  } catch (e) { await c.query('ROLLBACK'); throw e; }
  finally { c.release(); await pool.end(); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
