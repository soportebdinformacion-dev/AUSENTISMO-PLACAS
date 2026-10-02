const GAS_ENDPOINT = 'https://script.google.com/macros/s/TU_SCRIPT_ID_AQUI/exec';
const BATCH_SIZE = 25;          // registros por envío
const SYNC_EVERY_MS = 60000;    // revisión periódica (solo envía si hay pendientes)
const MOTIVOS_CON_DETALLE = ['Transporte', 'Otro trabajo', 'Renuncia', 'Problemas con el caporal', 'No desea continuar'];

const $ = id => document.getElementById(id);
const rand = (min, max) => min + Math.random() * (max - min);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

let syncing = false, syncTimer = null;

document.addEventListener('DOMContentLoaded', initApp);

async function initApp() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.error);
  setupEvents();
  setStatus(navigator.onLine ? 'online' : 'offline');
  await loadDropdowns();
  await refreshAll();
  // Escalonar para que 160 equipos no pidan todos a la vez
  const firstRun = (await DB.countPersonal()) === 0;
  setTimeout(syncMasterData, firstRun ? 0 : rand(0, 10000));
  queueSync(rand(2000, 10000));
  setInterval(() => queueSync(rand(0, 8000)), SYNC_EVERY_MS);
}

function setStatus(kind, text) {
  const labels = { online: 'En línea', offline: 'Sin conexión', syncing: 'Sincronizando…' };
  $('status').className = 'pill ' + kind;
  $('status-text').textContent = text || labels[kind];
}

function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2600);
}

function setupEvents() {
  window.addEventListener('online', () => { setStatus('online'); queueSync(rand(1000, 12000)); });
  window.addEventListener('offline', () => setStatus('offline'));

  document.querySelectorAll('.nav-btn').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn, .view').forEach(el => el.classList.remove('active'));
    btn.classList.add('active');
    $(btn.dataset.view).classList.add('active');
    window.scrollTo(0, 0);
  }));

  $('placa').addEventListener('change', async e => { $('ruta').value = await DB.getRutaByPlaca(e.target.value); });

  $('dni').addEventListener('input', async e => {
    const dni = e.target.value = e.target.value.replace(/\D/g, '');
    const hint = $('dni-alert');
    $('nombre').value = ''; hint.textContent = ''; hint.className = 'hint';
    if (dni.length !== 8) return;
    const p = await DB.getPersonalByDNI(dni);
    if (p) { $('nombre').value = p.nombre; hint.textContent = 'Trabajador encontrado'; hint.className = 'hint good'; }
    else { hint.textContent = 'DNI no encontrado en el padrón local'; hint.className = 'hint bad'; }
  });

  $('motivo').addEventListener('change', e => {
    const req = MOTIVOS_CON_DETALLE.includes(e.target.value);
    $('observaciones').required = req;
    $('obs-req').textContent = req ? '(obligatorio para este motivo)' : '(opcional)';
    $('obs-req').className = req ? 'req' : '';
  });

  document.querySelectorAll('input[name=tipoRetorno]').forEach(r => r.addEventListener('change', () => {
    $('group-fechaRetorno').hidden = getRadio('tipoRetorno') !== 'Específica';
  }));

  $('ausentismo-form').addEventListener('submit', handleFormSubmit);
  $('btn-sync').addEventListener('click', () => { if (!navigator.onLine) return toast('Sin conexión'); triggerSync(); });
  $('btn-retry').addEventListener('click', async () => { await DB.retryErrors(); await refreshAll(); queueSync(0); });
}

const getRadio = name => document.querySelector(`input[name=${name}]:checked`).value;

async function loadDropdowns() {
  const placas = await DB.getAllPlacas();
  const sel = $('placa'), cur = sel.value;
  sel.innerHTML = '<option value="">Seleccione placa…</option>' + placas.map(p => `<option>${esc(p)}</option>`).join('');
  sel.value = cur;
  if (!$('fechaFalta').value) $('fechaFalta').value = today();
}

function validate() {
  const bad = [];
  const check = (id, ok) => { $(id).classList.toggle('invalid', !ok); if (!ok) bad.push(id); };
  check('placa', !!$('placa').value);
  check('dni', /^\d{8}$/.test($('dni').value));
  check('fechaFalta', !!$('fechaFalta').value);
  check('motivo', !!$('motivo').value);
  check('observaciones', !$('observaciones').required || !!$('observaciones').value.trim());
  if (getRadio('tipoRetorno') === 'Específica') check('fechaRetorno', !!$('fechaRetorno').value && $('fechaRetorno').value >= $('fechaFalta').value);
  if (bad.length) { $(bad[0]).focus(); toast('Revise los campos marcados'); }
  return !bad.length;
}

async function handleFormSubmit(e) {
  e.preventDefault();
  if (!validate()) return;
  const btn = $('btn-save'); btn.disabled = true;
  const record = {
    id: 'REG-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2)),
    fechaRegistro: new Date().toISOString(),
    placa: $('placa').value, ruta: $('ruta').value, dni: $('dni').value, nombre: $('nombre').value,
    fechaFalta: $('fechaFalta').value, motivo: $('motivo').value, observaciones: $('observaciones').value.trim(),
    vasARegresar: getRadio('vasARegresar'),
    fechaRetorno: getRadio('tipoRetorno') === 'Inmediato' ? 'Inmediato' : $('fechaRetorno').value,
    estado: 'PENDIENTE', errorDetail: ''
  };
  await DB.saveAusentismo(record);
  e.target.reset();
  $('nombre').value = ''; $('ruta').value = ''; $('dni-alert').textContent = ''; $('group-fechaRetorno').hidden = true;
  $('obs-req').textContent = ''; $('observaciones').required = false;
  await loadDropdowns();
  await refreshAll();
  btn.disabled = false;
  toast(navigator.onLine ? 'Guardado. Se enviará en breve' : 'Guardado sin conexión');
  queueSync(rand(3000, 9000));
}

// ===== Sincronización escalonada: cola, lotes, reintentos con espera =====
function queueSync(delay = 0) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => triggerSync(), delay);
}

async function postBatch(batch) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(GAS_ENDPOINT, {
        method: 'POST', headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'SYNC_AUSENTISMOS', records: batch })
      });
      const data = await res.json();
      if (data.status === 'SUCCESS') return data;
    } catch (err) { console.warn('Intento fallido', err); }
    await sleep(Math.min(30000, 1500 * 2 ** attempt) + rand(0, 1500)); // espera exponencial + azar
  }
  throw new Error('Servidor ocupado');
}

async function triggerSync() {
  if (!navigator.onLine || syncing) return;
  let pending = await DB.getPendingRecords();
  if (!pending.length) return await refreshAll();
  syncing = true; setStatus('syncing');
  try {
    while (pending.length) {
      const res = await postBatch(pending.slice(0, BATCH_SIZE));
      await DB.markSynced([...res.saved, ...res.duplicates]);
      for (const r of res.rejected) await DB.updateRecordStatus(r.id, 'ERROR', r.reason);
      if (!res.saved.length && !res.duplicates.length && !res.rejected.length) throw new Error('Sin progreso');
      pending = await DB.getPendingRecords();
    }
    localStorage.setItem('lastSync', Date.now());
    setStatus('online');
  } catch (err) {
    setStatus('online', 'Reintentando envío…');
    queueSync(rand(20000, 60000));
  } finally {
    syncing = false;
    await refreshAll();
  }
}

async function syncMasterData() {
  if (!navigator.onLine) return;
  try {
    const v = localStorage.getItem('mastersVersion') || '';
    const res = await fetch(`${GAS_ENDPOINT}?action=GET_MASTERS&v=${encodeURIComponent(v)}`);
    const data = await res.json();
    if (data.status !== 'OK' || data.unchanged) return;
    await DB.setMaestros(data.maestros);
    await DB.setPersonal(data.personal);
    localStorage.setItem('mastersVersion', data.version);
    await loadDropdowns();
  } catch (err) { console.warn('No se pudieron actualizar los maestros:', err); }
}

// ===== Pantallas =====
async function refreshAll() {
  const [records, c] = await Promise.all([DB.getAllRecords(), DB.counts()]);
  $('n-pend').textContent = c.pendientes; $('n-err').textContent = c.errores; $('n-ok').textContent = c.sincronizados;
  $('btn-retry').hidden = !c.errores;
  const badge = $('nav-badge'); badge.hidden = !c.pendientes; badge.textContent = c.pendientes;
  const ls = localStorage.getItem('lastSync');
  $('last-sync').textContent = ls ? 'Último envío: ' + new Date(+ls).toLocaleString('es-PE') : 'Aún no se ha enviado nada';

  $('records-list').innerHTML = records.length ? records.map(r => `
    <article class="record ${esc(r.estado)}">
      <header><span>${esc(r.nombre || 'DNI ' + r.dni)}</span><span class="chip ${esc(r.estado)}">${esc(r.estado)}</span></header>
      <p>Placa ${esc(r.placa)} · ${esc(r.motivo)}<br>Falta: ${esc(r.fechaFalta)}</p>
      ${r.errorDetail ? `<p class="err">${esc(r.errorDetail)}</p>` : ''}
    </article>`).join('') : '<p class="empty">Aún no hay registros. Los que guarde aparecerán aquí.</p>';
}
