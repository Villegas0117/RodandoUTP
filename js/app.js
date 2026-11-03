const routesGrid = document.querySelector('#routesGrid');
const resultText = document.querySelector('#resultText');
const originFilter = document.querySelector('#originFilter');
const timeFilter = document.querySelector('#timeFilter');
const seatFilter = document.querySelector('#seatFilter');
const routeSearch = document.querySelector('#routeSearch');
const clearFilters = document.querySelector('#clearFilters');
const publishModal = document.querySelector('#publishModal');
const publishForm = document.querySelector('#publishForm');
const toast = document.querySelector('#toast');
const networkBadge = document.querySelector('#networkBadge');
const installBtn = document.querySelector('#installBtn');
let routes = [];
let deferredInstallPrompt = null;

const escapeHTML = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const initials = (name) => name.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase();

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2600);
}

function getShift(time) {
  const hour = Number(time.split(':')[0]);
  return hour < 12 ? 'morning' : 'afternoon';
}

function routeCard(route) {
  return `
    <article class="route-card">
      <div class="route-top">
        <div class="driver">
          <span class="avatar">${escapeHTML(initials(route.driver))}</span>
          <div><strong>${escapeHTML(route.driver)}</strong><small>${route.verified ? '✓ Estudiante verificado' : 'Estudiante'}</small></div>
        </div>
        <span class="rating">★ ${Number(route.rating || 5).toFixed(1)}</span>
      </div>
      <div class="route-line">
        <div class="route-point"><small>Punto de encuentro · ${escapeHTML(route.origin)}</small><strong>${escapeHTML(route.meetingPoint)}</strong></div>
        <div class="route-point destination"><small>Destino</small><strong>Universidad Tecnológica de Puebla</strong></div>
      </div>
      <div class="route-info">
        <div><small>Salida</small><strong>${escapeHTML(route.departure)}</strong></div>
        <div><small>Lugares</small><strong>${escapeHTML(route.seats)} libres</strong></div>
        <div><small>Días</small><strong>${escapeHTML((route.days || ['Hoy']).slice(0,2).join(' · '))}</strong></div>
      </div>
      <div class="route-bottom">
        <div class="price"><strong>$${escapeHTML(route.contribution)}</strong><small>aportación / viaje</small></div>
        <button class="btn btn-primary reserve-btn" data-reserve="${escapeHTML(route.id)}">Reservar lugar</button>
      </div>
    </article>`;
}

function renderRoutes(list) {
  resultText.textContent = `${list.length} ${list.length === 1 ? 'ruta encontrada' : 'rutas encontradas'} hacia la UTP`;
  routesGrid.innerHTML = list.length ? list.map(routeCard).join('') : '<div class="empty-state"><strong>No encontramos rutas con esos filtros.</strong><br>Prueba otra zona, horario o cantidad de lugares.</div>';
}

function filterRoutes() {
  const origin = originFilter.value;
  const shift = timeFilter.value;
  const seats = Number(seatFilter.value || 1);
  const filtered = routes.filter(route =>
    (!origin || route.origin === origin) &&
    (!shift || getShift(route.departure) === shift) &&
    Number(route.seats) >= seats
  );
  renderRoutes(filtered);
}

async function loadRoutes() {
  // 1) Se intenta el backend (PostgreSQL via Neon Functions).
  // 2) Si el servidor no responde se cae al JSON estatico para que la PWA
  //    siga funcionando igual que antes.
  try {
    const data = await api('/rutas');
    // La API usa 'rutas' y el JSON estatico usa 'routes'.
    const lista = data.rutas || data.routes || [];
    routes = lista;
    renderRoutes(routes);
    return;
  } catch {
    routes = [];
    routesGrid.innerHTML = '<div class="empty-state">No se pueden consultar las rutas. Comprueba tu conexión e inténtalo de nuevo.</div>';
    resultText.textContent = 'Rutas no disponibles';
  }
}

function updateNetworkStatus() {
  const online = navigator.onLine;
  networkBadge.textContent = online ? '● En línea' : '● Modo sin conexión';
  networkBadge.classList.toggle('offline', !online);
}

routeSearch.addEventListener('submit', (event) => { event.preventDefault(); filterRoutes(); });
clearFilters.addEventListener('click', () => {
  originFilter.value = '';
  timeFilter.value = '';
  seatFilter.value = '1';
  renderRoutes(routes);
});

document.querySelector('#openPublish').addEventListener('click', () => publishModal.showModal());
document.querySelector('#closePublish').addEventListener('click', () => publishModal.close());

document.addEventListener('click', async (event) => {
  const reserveButton = event.target.closest('[data-reserve]');
  if (!reserveButton) return;
  const route = routes.find(item => String(item.id) === reserveButton.dataset.reserve);
  if (!route) return;
  if (route.seats <= 0) return showToast('Esta ruta ya no tiene lugares disponibles.');

  // La reserva solo se confirma cuando el servidor la acepta.
  try {
    const data = await api('/reservas', {
      method: 'POST',
      cuerpo: { id: route.id },
    });

    if (!data.ok) return showToast(data.error || 'No fue posible reservar.');
    if (data.ruta) Object.assign(route, data.ruta);
    await Promise.all([loadRoutes(), cargarReservas()]);
    filterRoutes();
    return showToast(data.mensaje || `Lugar reservado con ${route.driver}.`);
  } catch (error) {
    if (error.estado === 401) return showToast('Inicia sesión para reservar.');
    showToast(error.message || 'No se pudo reservar. Comprueba tu conexión.');
  }
});

publishForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const datos = {
    driver: document.querySelector('#driverName').value.trim(),
    origin: document.querySelector('#publishOrigin').value,
    meetingPoint: document.querySelector('#publishMeeting').value.trim(),
    departure: document.querySelector('#publishTime').value,
    seats: Number(document.querySelector('#publishSeats').value),
    contribution: Number(document.querySelector('#publishPrice').value),
  };

  let nuevaRuta = null;

  // Se intenta guardar en PostgreSQL (queda visible para toda la comunidad).
  try {
    const data = await api('/rutas', {
      method: 'POST',
      cuerpo: datos,
    });
    nuevaRuta = data.ruta;
    showToast('Ruta publicada y guardada en la base de datos.');
  } catch (error) {
    showToast(error.estado === 401 ? 'Inicia sesión para publicar una ruta.' : (error.message || 'No se pudo publicar la ruta.'));
    return;
  }

  routes.unshift(nuevaRuta);
  renderRoutes(routes);
  publishForm.reset();
  publishModal.close();
});

const navToggle = document.querySelector('#navToggle');
const navLinks = document.querySelector('#navLinks');
navToggle.addEventListener('click', () => {
  const open = navLinks.classList.toggle('open');
  navToggle.setAttribute('aria-expanded', String(open));
});
navLinks.addEventListener('click', (event) => {
  if (event.target.matches('a')) {
    navLinks.classList.remove('open');
    navToggle.setAttribute('aria-expanded', 'false');
  }
});

window.addEventListener('online', () => { updateNetworkStatus(); loadRoutes(); if (getSessionToken()) cargarReservas(); });
window.addEventListener('offline', updateNetworkStatus);
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installBtn.hidden = false;
});
installBtn.addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  installBtn.hidden = true;
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js')
      .catch(error => console.warn('Service Worker no registrado:', error));
  });
}

document.querySelector('#logoutBtn')?.addEventListener('click', () => cerrarSesion());

/** Refleja el estado de la sesion en la navegacion y arranca el mapa si aplica. */
async function iniciarSesionUI() {
  try {
    const sesion = await obtenerSesion();
    pintarSesion(sesion.usuario);
    document.querySelector('#mis-reservas').hidden = !sesion.autenticado;
    document.querySelector('#reservasLink').hidden = !sesion.autenticado;
    if (sesion.autenticado) await cargarReservas();
    if (sesion.autenticado && typeof iniciarMapa === 'function') {
      await iniciarMapa();
    }
  } catch { /* sin servidor la app sigue con el JSON estatico */ }
}

async function cargarReservas() {
  const grid = document.querySelector('#reservasGrid');
  grid.textContent = 'Cargando reservas…';
  try {
    const data = await api('/mis-reservas');
    grid.innerHTML = data.reservas.length ? data.reservas.map(r =>
      `<article class="route-card"><h3>${escapeHTML(r.origen)} → UTP</h3><p>Conductor: ${escapeHTML(r.conductor)}</p><p>Encuentro: ${escapeHTML(r.punto_encuentro)}</p><p>Salida: ${escapeHTML(r.salida)} · $${escapeHTML(r.aportacion)}</p><p>Estado: ${escapeHTML(r.estado)}</p></article>`
    ).join('') : '<div class="empty-state">Aún no tienes reservas.</div>';
  } catch (error) {
    grid.textContent = error.message || 'No se pudieron cargar las reservas. Comprueba tu conexión.';
  }
}
document.querySelector('#refreshReservas').addEventListener('click', cargarReservas);

updateNetworkStatus();
loadRoutes();
iniciarSesionUI();
