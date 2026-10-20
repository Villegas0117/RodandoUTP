/* =============================================================
   Rodando UTP - Panel de administrador (admin.js)
   ============================================================= */

const usersBody = document.querySelector('#usersBody');
const statGrid = document.querySelector('#statGrid');
const logList = document.querySelector('#logList');
const searchInput = document.querySelector('#searchUsers');
const roleFilter = document.querySelector('#filterRole');
const confirmModal = document.querySelector('#confirmModal');
const toast = document.querySelector('#toast');

let usuarios = [];
let usuarioActual = null;
let idPendiente = null;

const escapar = (valor) => String(valor ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

function mostrarToast(mensaje) {
  toast.textContent = mensaje;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2800);
}

const iniciales = (nombre) => String(nombre).split(' ').map(p => p[0])
  .join('').slice(0, 2).toUpperCase();

const fechaCorta = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: '2-digit' });
};

/* ------------------------------------------------------------- pintado */

function pintarEstadisticas(resumen) {
  const tarjetas = [
    { valor: resumen.total, texto: 'Usuarios totales' },
    { valor: resumen.conductores, texto: 'Conductores' },
    { valor: resumen.estudiantes, texto: 'Estudiantes' },
    { valor: resumen.administradores, texto: 'Administradores' },
    { valor: resumen.activos, texto: 'Cuentas activas', peligro: true },
  ];
  statGrid.innerHTML = tarjetas.map(t => `
    <div class="stat-card${t.peligro ? ' danger' : ''}">
      <strong>${t.valor}</strong><span>${t.texto}</span>
    </div>`).join('');
}

function pintarUsuarios() {
  const texto = (searchInput?.value || '').toLowerCase().trim();
  const rol = roleFilter?.value || '';

  const filtrados = usuarios.filter((u) => {
    const coincideTexto = !texto ||
      u.nombre.toLowerCase().includes(texto) ||
      u.correo.toLowerCase().includes(texto);
    const coincideRol = !rol || u.rol === rol;
    return coincideTexto && coincideRol;
  });

  if (!filtrados.length) {
    usersBody.innerHTML = '<tr><td colspan="7" class="table-empty">No hay usuarios que coincidan.</td></tr>';
    return;
  }

  usersBody.innerHTML = filtrados.map((u) => {
    const esYo = usuarioActual && u.id === usuarioActual.id;
    return `
      <tr data-id="${u.id}">
        <td>${u.id}</td>
        <td>
          <div class="user-cell">
            <span class="avatar-sm">${escapar(iniciales(u.nombre))}</span>
            <div>
              <strong>${escapar(u.nombre)}</strong>
              <small>${escapar(u.correo)}</small>
            </div>
          </div>
        </td>
        <td><span class="role-tag role-${escapar(u.rol)}">${escapar(u.rol)}</span></td>
        <td>${escapar(u.zona || '—')}</td>
        <td>${escapar(u.matricula || '—')}</td>
        <td>${fechaCorta(u.creado_en)}</td>
        <td class="col-acciones">
          ${esYo
            ? '<button class="btn-mini" disabled title="No puedes eliminar tu propia cuenta">Tú</button>'
            : `<button class="btn-mini" data-delete="${u.id}" data-nombre="${escapar(u.nombre)}">Eliminar</button>`}
        </td>
      </tr>`;
  }).join('');

  usersBody.querySelectorAll('[data-delete]').forEach((boton) => {
    boton.addEventListener('click', () => {
      idPendiente = Number(boton.dataset.delete);
      document.querySelector('#confirmTitle').textContent = `Eliminar a ${boton.dataset.nombre}`;
      document.querySelector('#confirmText').textContent =
        'Se borrará la cuenta y, en cascada, sus rutas publicadas y reservas. Esta acción no se puede deshacer.';
      confirmModal.showModal();
    });
  });
}

function pintarBitacora(entradas) {
  if (!entradas?.length) {
    logList.innerHTML = '<li class="table-empty">Sin movimientos registrados.</li>';
    return;
  }
  logList.innerHTML = entradas.map((e) => `
    <li>
      <span class="log-time">${escapar((e.creado_en || '').replace('T', ' ').slice(0, 16))}</span>
      <span class="log-actor">${escapar(e.actor || 'sistema')}</span>
      <span class="log-detail"><em class="log-accion">${escapar(e.accion)}</em>${escapar(e.detalle || '')}</span>
    </li>`).join('');
}

/* ---------------------------------------------------------- peticiones */

async function cargarUsuarios() {
  const datos = await api('/admin/usuarios');
  usuarios = datos.usuarios;
  usuarioActual = { id: datos.usuario_actual };
  pintarEstadisticas(datos.resumen);
  pintarUsuarios();
}

async function cargarBitacora() {
  try {
    const datos = await api('/admin/bitacora?limite=40');
    pintarBitacora(datos.bitacora);
  } catch { /* la bitácora es informativa */ }
}

/** Pide confirmacion al servidor y luego ejecuta el borrado. */
async function eliminarUsuario(id) {
  try {
    // Primera llamada: el servidor responde qué se va a borrar.
    const previo = await api(`/admin/usuarios?id=${id}`, { method: 'DELETE' });
    if (previo.requiere_confirmacion) {
      // Segunda llamada: confirmed = elimina de verdad.
      const resultado = await api(`/admin/usuarios?id=${id}&force=1`, { method: 'DELETE' });
      mostrarToast(resultado.mensaje);
    }
    await Promise.all([cargarUsuarios(), cargarBitacora()]);
  } catch (error) {
    mostrarToast(error.message);
  }
}

/* --------------------------------------------------------- caché de la API */

async function cargarCache() {
  try {
    const datos = await api('/admin/cache');
    const e = datos.estadisticas;
    const tarjetas = [
      { valor: e.entradas, texto: 'Entradas en caché' },
      { valor: `${e.tasa_aciertos}%`, texto: 'Tasa de aciertos' },
      { valor: e.aciertos, texto: 'Aciertos' },
      { valor: e.fallos, texto: 'Fallos' },
      { valor: e.respuestas_304, texto: 'Respuestas 304' },
      { valor: e.invalidaciones, texto: 'Invalidaciones' },
    ];
    const caja = document.querySelector('#cacheStats');
    if (caja) {
      caja.innerHTML = tarjetas.map(t => `
        <div class="stat-card">
          <strong>${t.valor}</strong><span>${t.texto}</span>
        </div>`).join('');
    }
  } catch { /* el panel de caché es informativo */ }
}

/** Demuestra en vivo el MISS -> HIT y la revalidación 304. */
document.querySelector('#cacheDemo')?.addEventListener('click', async () => {
  const salida = document.querySelector('#cacheDemoOut');
  const linea = [];

  for (let i = 1; i <= 2; i++) {
    const respuesta = await fetch('/api/rutas', { credentials: 'same-origin' });
    const estado = respuesta.headers.get('X-Cache') || '(sin cabecera)';
    const etag = respuesta.headers.get('ETag') || '-';
    const bytes = (await respuesta.arrayBuffer()).byteLength;
    linea.push(`Petición ${i}: X-Cache: ${estado}  |  ETag: ${etag}  |  ${bytes} bytes`);
  }

  // Tercera llamada: revalidación condicional con el ETag ya conocido.
  const conEtag = await fetch('/api/rutas', { credentials: 'same-origin' });
  const etag = conEtag.headers.get('ETag');
  const revalidada = await fetch('/api/rutas', {
    credentials: 'same-origin',
    headers: { 'If-None-Match': etag },
  });
  const bytes304 = (await revalidada.arrayBuffer()).byteLength;
  linea.push(`Revalidación (If-None-Match): HTTP ${revalidada.status}  |  ${bytes304} bytes de cuerpo`);

  if (salida) salida.textContent = linea.join('\n');
});

document.querySelector('#cacheClear')?.addEventListener('click', async () => {
  try {
    const datos = await api('/admin/cache?limpiar=1', { method: 'POST' });
    mostrarToast(datos.mensaje);
    await cargarCache();
  } catch (error) {
    mostrarToast(error.message);
  }
});

/* --------------------------------------------------------- eventos */

document.querySelector('#confirmDelete')?.addEventListener('click', async () => {
  const id = idPendiente;
  confirmModal.close();
  if (id) await eliminarUsuario(id);
  idPendiente = null;
});

document.querySelector('#cancelDelete')?.addEventListener('click', () => {
  confirmModal.close();
  idPendiente = null;
});

document.querySelector('#closeConfirm')?.addEventListener('click', () => confirmModal.close());

document.querySelector('#adminLogout')?.addEventListener('click', () => cerrarSesion());

document.querySelector('#resetBtn')?.addEventListener('click', async () => {
  const ok = window.confirm(
    'Se eliminará la base de datos y se restaurarán los datos de demostración.\n\n¿Continuar?'
  );
  if (!ok) return;
  try {
    const datos = await api('/admin/reset?confirmar=1', { method: 'POST' });
    mostrarToast(datos.mensaje);
    setTimeout(() => { window.location.href = 'login.html'; }, 1200);
  } catch (error) {
    mostrarToast(error.message);
  }
});

searchInput?.addEventListener('input', pintarUsuarios);
roleFilter?.addEventListener('change', pintarUsuarios);

/* ---------------------------------------------------------- arranque */

async function iniciar() {
  const sesion = await obtenerSesion();

  if (!sesion.autenticado) {
    window.location.replace('login.html');
    return;
  }
  if (!sesion.usuario.es_admin) {
    document.body.innerHTML = `
      <div class="auth-body">
        <div class="empty-state" style="max-width:460px;margin:auto">
          <strong>Acceso restringido</strong><br>
          Esta zona es solo para administradores.<br>
          <a class="btn btn-primary" href="index.html" style="margin-top:16px">Volver al inicio</a>
        </div>
      </div>`;
    return;
  }

  document.querySelector('#adminName').textContent = sesion.usuario.nombre;

  try {
    await Promise.all([cargarUsuarios(), cargarBitacora(), cargarCache()]);
  } catch (error) {
    usersBody.innerHTML = `<tr><td colspan="7" class="table-empty">${escapar(error.message)}</td></tr>`;
  }
}

iniciar();
