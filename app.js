// REEMPLAZA ESTA URL CON TU URL REAL DE GOOGLE APPS SCRIPT
const GAS_ENDPOINT = 'https://script.google.com/macros/s/TU_SCRIPT_ID_AQUI/exec';

document.addEventListener('DOMContentLoaded', () => {
  initApp();
  setupEventListeners();
});

async function initApp() {
  registerServiceWorker();
  updateOnlineStatus();
  await loadDropdowns();
  await refreshRecordsList();
  syncMasterData(); // Intento silencioso de actualizar maestros al iniciar
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .catch(err => console.error('Error al registrar SW:', err));
  }
}

// Interfaz y Navegación
function setupEventListeners() {
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);

  // Navegación Tabs
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      
      const target = e.currentTarget;
      target.classList.add('active');
      document.getElementById(target.dataset.view).classList.add('active');
    });
  });

  // Lógica Formulario - Autocompletado de Ruta
  const placaSelect = document.getElementById('placa');
  placaSelect.addEventListener('change', async (e) => {
    const ruta = await DB.getRutaByPlaca(e.target.value);
    document.getElementById('ruta').value = ruta;
  });

  // Lógica Formulario - Búsqueda por DNI
  const dniInput = document.getElementById('dni');
  dniInput.addEventListener('input', async (e) => {
    const dni = e.target.value.trim();
    const alertEl = document.getElementById('dni-alert');
    const nombreEl = document.getElementById('nombre');

    if (dni.length === 8) {
      const persona = await DB.getPersonalByDNI(dni);
      if (persona) {
        nombreEl.value = persona.nombre;
        alertEl.textContent = '';
      } else {
        nombreEl.value = '';
        alertEl.textContent = 'DNI no encontrado en el padrón local.';
      }
    } else {
      nombreEl.value = '';
      alertEl.textContent = '';
    }
  });

  // Lógica condicional: Motivo -> Observaciones
  const motivoSelect = document.getElementById('motivo');
  const obsGroup = document.getElementById('group-observaciones');
  const obsInput = document.getElementById('observaciones');
  const motivosObligatorios = ['Transporte', 'Otro trabajo', 'Renuncia', 'Problemas con el caporal', 'No desea continuar'];

  motivoSelect.addEventListener('change', (e) => {
    if (motivosObligatorios.includes(e.target.value)) {
      obsGroup.style.display = 'block';
      obsInput.required = true;
    } else {
      obsGroup.style.display = 'block'; // Permanece opcional
      obsInput.required = false;
    }
  });

  // Lógica condicional: ¿Vas a regresar? -> Mostrar / Ocultar campo Retorno
  const vasARegresarSelect = document.getElementById('vasARegresar');
  const retornoGroup = document.getElementById('group-retorno');
  const retornoSelect = document.getElementById('tipoRetorno');
  const retornoFechaGroup = document.getElementById('group-fechaRetorno');

  function toggleRetornoVisibility() {
    const valor = vasARegresarSelect.value;
    if (valor === 'NO') {
      retornoGroup.style.display = 'none';
      retornoFechaGroup.style.display = 'none';
    } else {
      retornoGroup.style.display = 'block';
      retornoFechaGroup.style.display = retornoSelect.value === 'Específica' ? 'block' : 'none';
    }
  }

  vasARegresarSelect.addEventListener('change', toggleRetornoVisibility);

  retornoSelect.addEventListener('change', (e) => {
    if (vasARegresarSelect.value !== 'NO') {
      retornoFechaGroup.style.display = e.target.value === 'Específica' ? 'block' : 'none';
    }
  });

  toggleRetornoVisibility();

  // Submit Formulario
  document.getElementById('ausentismo-form').addEventListener('submit', handleFormSubmit);

  // Botón Sincronización Manual
  document.getElementById('btn-sync').addEventListener('click', triggerSync);
}

// Sincronización Network Status
function updateOnlineStatus() {
  const banner = document.getElementById('network-banner');
  if (navigator.onLine) {
    banner.textContent = 'En línea - Listo para sincronizar';
    banner.className = 'online';
    triggerSync(); // Auto-sync al reconectar
  } else {
    banner.textContent = 'Modo Offline - Datos guardados localmente';
    banner.className = 'offline';
  }
}

async function loadDropdowns() {
  const placas = await DB.getAllPlacas();
  const select = document.getElementById('placa');
  select.innerHTML = '<option value="">Seleccione Placa...</option>';
  placas.forEach(p => {
    select.innerHTML += `<option value="${p}">${p}</option>`;
  });
  
  // Establecer fecha por defecto (Hoy)
  document.getElementById('fechaFalta').valueToDate = new Date();
  document.getElementById('fechaFalta').value = new Date().toISOString().split('T')[0];
}

async function handleFormSubmit(e) {
  e.preventDefault();

  const id = 'REG-' + crypto.randomUUID();
  const vasARegresar = document.getElementById('vasARegresar').value;
  const tipoRetorno = document.getElementById('tipoRetorno').value;
  const fechaRetornoVal = document.getElementById('fechaRetorno').value;

  let fechaRetornoFinal = '';
  if (vasARegresar !== 'NO') {
    fechaRetornoFinal = tipoRetorno === 'Inmediato' ? 'Inmediato' : fechaRetornoVal;
  } else {
    fechaRetornoFinal = 'No aplica';
  }

  const record = {
    id: id,
    fechaRegistro: new Date().toISOString(),
    placa: document.getElementById('placa').value,
    ruta: document.getElementById('ruta').value,
    dni: document.getElementById('dni').value,
    nombre: document.getElementById('nombre').value,
    fechaFalta: document.getElementById('fechaFalta').value,
    motivo: document.getElementById('motivo').value,
    observaciones: document.getElementById('observaciones').value,
    vasARegresar: vasARegresar,
    fechaRetorno: fechaRetornoFinal,
    estado: 'PENDIENTE',
    errorDetail: ''
  };

  await DB.saveAusentismo(record);
  alert('Registro guardado localmente exitosamente.');
  e.target.reset();
  await loadDropdowns();
  
  document.getElementById('vasARegresar').dispatchEvent(new Event('change'));
  await refreshRecordsList();

  if (navigator.onLine) triggerSync();
}

// Sync de Negocio (GAS Engine)
async function triggerSync() {
  if (!navigator.onLine) return;
  if (GAS_ENDPOINT.includes('TU_SCRIPT_ID_AQUI')) {
    console.warn('Debes colocar tu ID de Google Apps Script en GAS_ENDPOINT');
    return;
  }
  
  const banner = document.getElementById('network-banner');
  banner.textContent = 'Sincronizando registros...';
  banner.className = 'syncing';

  const pending = await DB.getPendingRecords();

  if (pending.length > 0) {
    try {
      const response = await fetch(GAS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'SYNC_AUSENTISMOS', records: pending }),
        redirect: 'follow'
      });
      
      const res = await response.json();
      if (res.status === 'SUCCESS') {
        for (const item of pending) {
          await DB.updateRecordStatus(item.id, 'SINCRONIZADO');
        }
      } else {
        console.error('Error reportado por el servidor:', res);
      }
    } catch (err) {
      console.error('Error al sincronizar con Google Sheets:', err);
      banner.textContent = 'Error al conectar con Google Sheets';
      banner.className = 'offline';
      return;
    }
  }

  banner.textContent = 'En línea - Sincronizado';
  banner.className = 'online';
  await refreshRecordsList();
}

async function syncMasterData() {
  if (!navigator.onLine || GAS_ENDPOINT.includes('TU_SCRIPT_ID_AQUI')) return;
  try {
    const res = await fetch(`${GAS_ENDPOINT}?action=GET_MASTERS`, { redirect: 'follow' });
    const data = await res.json();
    if (data.maestros) await DB.setMaestros(data.maestros);
    if (data.personal) await DB.setPersonal(data.personal);
    await loadDropdowns();
  } catch (err) {
    console.warn('Error obteniendo maestros actualizados:', err);
  }
}

async function refreshRecordsList() {
  const records = await DB.getAllRecords();
  const container = document.getElementById('records-list');
  container.innerHTML = '';

  if(records.length === 0) {
    container.innerHTML = '<p style="text-align:center; color: #757575;">No hay registros locales.</p>';
    return;
  }

  records.forEach(r => {
    container.innerHTML += `
      <div class="record-item">
        <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
          <strong>${r.nombre || 'DNI: ' + r.dni}</strong>
          <span class="badge ${r.estado}">${r.estado}</span>
        </div>
        <div style="font-size:0.85rem; color: var(--text-secondary);">
          Placa: ${r.placa} | Motivo: ${r.motivo}<br>
          Falta: ${r.fechaFalta}
        </div>
      </div>
    `;
  });
}
