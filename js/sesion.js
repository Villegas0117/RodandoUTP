/* =============================================================
   Rodando UTP - Gestion de sesion (cliente)
   ============================================================= */

const API = '/api';

/** Consulta la sesion actual en el servidor. */
async function obtenerSesion() {
  try {
    const respuesta = await fetch(`${API}/sesion`, { credentials: 'same-origin' });
    if (!respuesta.ok) return { autenticado: false, usuario: null };
    const datos = await respuesta.json();
    return datos;
  } catch {
    // Sin servidor: la app sigue funcionando con el JSON estatico.
    return { autenticado: false, usuario: null, sinServidor: true };
  }
}

/** Envoltura de fetch con mensajes de error legibles. */
async function api(ruta, opciones = {}) {
  const respuesta = await fetch(`${API}${ruta}`, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(opciones.headers || {}) },
    ...opciones,
    body: opciones.cuerpo ? JSON.stringify(opciones.cuerpo) : undefined,
  });

  let datos = null;
  try { datos = await respuesta.json(); } catch { datos = null; }

  if (!respuesta.ok) {
    const error = new Error(datos?.error || `Error ${respuesta.status}`);
    error.estado = respuesta.status;
    throw error;
  }
  return datos;
}

/**
 * Refleja el estado de la sesion en la navegacion.
 * @param {object|null} usuario Usuario autenticado, o null si no hay sesion.
 */
function pintarSesion(usuario) {
  const cajaSesion = document.querySelector('#sessionBox');
  const enlaceLogin = document.querySelector('#loginLink');
  const enlaceAdmin = document.querySelector('#adminLink');
  const botonSalir = document.querySelector('#logoutBtn');

  // Bloque del mapa inteligente: solo visible con sesion iniciada.
  const seccionMapa = document.querySelector('#mapa-ia');
  const avisoMapa = document.querySelector('#mapaGuest');
  const contenidoMapa = document.querySelector('#mapaContenido');

  const activo = Boolean(usuario);

  if (cajaSesion) {
    cajaSesion.hidden = !activo;
    if (activo) {
      const iniciales = usuario.nombre.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
      const avatar = cajaSesion.querySelector('.session-avatar');
      const nombre = cajaSesion.querySelector('.session-name');
      const rol = cajaSesion.querySelector('.session-role');
      if (avatar) avatar.textContent = iniciales;
      if (nombre) nombre.textContent = usuario.nombre;
      if (rol) rol.textContent = usuario.rol === 'admin'
        ? 'Administrador'
        : `Estudiante · ${usuario.zona || 'sin zona'}`;
    }
  }

  if (botonSalir) botonSalir.hidden = !activo;
  if (enlaceLogin) enlaceLogin.hidden = activo;
  if (enlaceAdmin) enlaceAdmin.hidden = !(activo && usuario.es_admin);

  if (seccionMapa) seccionMapa.hidden = !activo;
  if (avisoMapa) avisoMapa.hidden = activo;
  if (contenidoMapa) contenidoMapa.hidden = !activo;

  document.body.dataset.autenticado = String(activo);
}

/** Muestra un aviso temporal usando el toast de la pagina. */
function notificar(mensaje) {
  const caja = document.querySelector('#toast');
  if (!caja) return;
  caja.textContent = mensaje;
  caja.classList.add('show');
  setTimeout(() => caja.classList.remove('show'), 2800);
}

/** Cierra la sesion y regresa al inicio. */
async function cerrarSesion() {
  try {
    await api('/logout', { method: 'POST' });
  } catch { /* se ignora: la cookie se limpia igual */ }
  window.location.href = 'index.html';
}
