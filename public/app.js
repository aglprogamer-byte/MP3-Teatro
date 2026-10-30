/* ════════════════════════════════════════
   MP3 Teatro Studio – Frontend Logic
   ════════════════════════════════════════ */

// ──── State ────
let tracks = [];
let activeAudio = null;
let activeTrackId = null;
let trimStopInterval = null;
let dragSrcIndex = null;

// ──── DOM Refs ────
const youtubeUrlInput  = document.getElementById('youtubeUrl');
const btnPaste         = document.getElementById('btnPaste');
const downloadForm     = document.getElementById('downloadForm');
const btnDownload      = document.getElementById('btnDownload');
const qualitySelect    = document.getElementById('qualitySelect');

const dlStatus         = document.getElementById('dlStatus');
const dlStatusTitle    = document.getElementById('dlStatusTitle');
const dlStatusDetail   = document.getElementById('dlStatusDetail');
const dlPercent        = document.getElementById('dlPercent');
const dlBar            = document.getElementById('dlBar');

const tracksContainer  = document.getElementById('tracksContainer');
const emptyState       = document.getElementById('emptyState');
const trackCountBadge  = document.getElementById('trackCountBadge');
const btnSelectAll     = document.getElementById('btnSelectAll');
const btnDeselectAll   = document.getElementById('btnDeselectAll');
const btnClearTracks   = document.getElementById('btnClearTracks');

const selectedCountEl         = document.getElementById('selectedCount');
const totalDurationEstimateEl = document.getElementById('totalDurationEstimate');
const outputFileNameInput     = document.getElementById('outputFileName');
const crossfadeToggle         = document.getElementById('crossfadeToggle');
const crossfadeSeconds        = document.getElementById('crossfadeSeconds');
const btnMerge                = document.getElementById('btnMerge');

const mergeProgressBox   = document.getElementById('mergeProgressBox');
const mergePercent       = document.getElementById('mergePercent');
const mergeBar           = document.getElementById('mergeBar');
const mergeStatusDetail  = document.getElementById('mergeStatusDetail');

const mergeResultBox     = document.getElementById('mergeResultBox');
const resultTitle        = document.getElementById('resultTitle');
const resultMeta         = document.getElementById('resultMeta');
const resultAudioPlayer  = document.getElementById('resultAudioPlayer');
const btnDownloadMerged  = document.getElementById('btnDownloadMerged');
const btnOpenMergedFolder= document.getElementById('btnOpenMergedFolder');
const btnOpenFolder      = document.getElementById('btnOpenFolder');

const silenceSelect      = document.getElementById('silenceSelect');
const customSilenceBox   = document.getElementById('customSilenceBox');
const customSilenceInput = document.getElementById('customSilenceInput');

const toastContainer     = document.getElementById('toastContainer');
const mergedCountBadge   = document.getElementById('mergedCountBadge');
const mergedFilesList    = document.getElementById('mergedFilesList');
const emptyMergedState   = document.getElementById('emptyMergedState');

const confirmModal       = document.getElementById('confirmModal');
const modalTitle         = document.getElementById('modalTitle');
const modalDesc          = document.getElementById('modalDesc');
const modalBtnCancel     = document.getElementById('modalBtnCancel');
const modalBtnConfirm    = document.getElementById('modalBtnConfirm');
let   modalCallback      = null;

// ──── Utilities ────
function fmt(seconds) {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

function parseSecs(str) {
  if (!str) return 0;
  const p = String(str).trim().split(':').map(Number);
  if (p.some(isNaN)) return 0;
  if (p.length === 3) return p[0]*3600 + p[1]*60 + p[2];
  if (p.length === 2) return p[0]*60  + p[1];
  return p[0] || 0;
}

function globalSilence() {
  if (!silenceSelect) return 0;
  if (silenceSelect.value === 'custom') return Math.max(0, parseInt(customSilenceInput.value || '0', 10));
  return Math.max(0, parseInt(silenceSelect.value || '0', 10));
}

// ──── Toast ────
function toast(msg, type = 'info') {
  const icons = { success: '✅', error: '❌', info: '💬' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type] || '💬'}</span><span>${msg}</span>`;
  toastContainer.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(60px)';
    setTimeout(() => el.remove(), 350);
  }, 4500);
}

// ──── Modal ────
function showModal(title, desc, onConfirm) {
  modalTitle.textContent = title;
  modalDesc.textContent  = desc;
  modalCallback = onConfirm;
  confirmModal.classList.remove('hidden');
}

modalBtnCancel.addEventListener('click', () => {
  confirmModal.classList.add('hidden');
  modalCallback = null;
});

confirmModal.addEventListener('click', (e) => {
  if (e.target === confirmModal) {
    confirmModal.classList.add('hidden');
    modalCallback = null;
  }
});

modalBtnConfirm.addEventListener('click', async () => {
  if (modalCallback) {
    const cb = modalCallback;
    modalCallback = null;
    confirmModal.classList.add('hidden');
    await cb();
  } else {
    confirmModal.classList.add('hidden');
  }
});

// ──── SSE ────
function initSSE() {
  const sse = new EventSource('/api/events');

  sse.addEventListener('download_start', () => {
    dlStatus.classList.remove('hidden');
    dlStatusTitle.textContent = 'Conectando con YouTube...';
    dlStatusDetail.textContent = 'Analizando el video y preparando descarga';
    dlPercent.textContent = '0%';
    dlBar.style.width = '0%';
  });

  sse.addEventListener('download_progress', (e) => {
    const d = JSON.parse(e.data);
    dlStatus.classList.remove('hidden');
    if (d.statusText) {
      dlStatusDetail.textContent = d.statusText;
    } else {
      const pct = Math.round(d.percent || 0);
      dlPercent.textContent = `${pct}%`;
      dlBar.style.width = `${pct}%`;
      dlStatusDetail.textContent = `${d.size || ''} · ${d.speed || ''} · ETA ${d.eta || ''}`;
    }
  });

  sse.addEventListener('download_complete', (e) => {
    const d = JSON.parse(e.data);
    dlStatus.classList.add('hidden');
    btnDownload.disabled = false;
    youtubeUrlInput.value = '';
    toast(`¡Pista añadida: "${d.track.title}"!`, 'success');
    loadTracks();
  });

  sse.addEventListener('download_error', (e) => {
    const d = JSON.parse(e.data);
    dlStatus.classList.add('hidden');
    btnDownload.disabled = false;
    toast(`Error: ${d.error}`, 'error');
  });

  sse.addEventListener('merge_start', () => {
    mergeProgressBox.classList.remove('hidden');
    mergeResultBox.classList.add('hidden');
    mergePercent.textContent = '0%';
    mergeBar.style.width = '0%';
    btnMerge.disabled = true;
  });

  sse.addEventListener('merge_progress', (e) => {
    const d = JSON.parse(e.data);
    const pct = d.percent || 0;
    mergePercent.textContent = `${pct}%`;
    mergeBar.style.width = `${pct}%`;
    mergeStatusDetail.textContent = `Procesando: ${fmt(d.currentSeconds)} de ${fmt(d.totalSeconds)}`;
  });

  sse.addEventListener('merge_complete', (e) => {
    const d = JSON.parse(e.data);
    mergeProgressBox.classList.add('hidden');
    btnMerge.disabled = false;
    mergeResultBox.classList.remove('hidden');
    resultTitle.textContent = `✅ Audio "${d.title}.mp3" creado con éxito`;
    resultMeta.textContent  = `Duración: ${fmt(d.totalDuration)} · Tamaño: ${d.size || '?'} · Calidad: 320 kbps`;
    resultAudioPlayer.src   = `${d.streamUrl}?t=${Date.now()}`;
    btnDownloadMerged.href  = d.downloadUrl;
    btnDownloadMerged.setAttribute('download', d.filename);
    toast('¡Audio unido y generado con éxito!', 'success');
    mergeResultBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    loadMergedFiles();
  });

  sse.addEventListener('merge_error', (e) => {
    const d = JSON.parse(e.data);
    mergeProgressBox.classList.add('hidden');
    btnMerge.disabled = false;
    toast(`Error al mezclar: ${d.error}`, 'error');
  });

  sse.onerror = () => {
    console.warn('SSE connection lost, will auto-reconnect');
  };
}

// ──── Load Tracks ────
async function loadTracks() {
  try {
    const res = await fetch('/api/tracks');
    tracks = await res.json();
    renderTracks();
    updateSummary();
  } catch (err) {
    console.error(err);
    toast('Error al conectar con la biblioteca local', 'error');
  }
}

// ──── Render Tracks ────
function renderTracks() {
  const n = tracks.length;
  trackCountBadge.textContent = `${n} ${n === 1 ? 'pista' : 'pistas'}`;

  tracksContainer.innerHTML = '';

  if (n === 0) {
    tracksContainer.appendChild(emptyState);
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');
  const gSil = globalSilence();

  tracks.forEach((track, idx) => {
    const card = buildCard(track, idx);
    tracksContainer.appendChild(card);

    // Connector between tracks
    if (idx < tracks.length - 1 && track.selected !== false) {
      const sil = (track.silenceAfter !== undefined && track.silenceAfter >= 0) ? track.silenceAfter : gSil;
      if (sil > 0) {
        const conn = document.createElement('div');
        conn.className = 'scene-connector';
        conn.innerHTML = `<div class="scene-pill">🎭 ⏸ <strong>${sil}s de silencio</strong> — cambio de muñecos / escena</div>`;
        tracksContainer.appendChild(conn);
      }
    }
  });
}

// ──── Build Track Card ────
function buildCard(track, idx) {
  const card = document.createElement('div');
  card.className = 'track-card';
  if (activeTrackId === track.id) card.classList.add('playing');
  card.dataset.id = track.id;
  card.dataset.idx = idx;
  card.draggable = true;

  const start     = track.trimStart !== undefined ? track.trimStart : 0;
  const end       = track.trimEnd   !== undefined ? track.trimEnd   : track.duration;
  const sliceDur  = Math.max(0, end - start);
  const isChecked = track.selected !== false;
  const gSil      = globalSilence();
  const tSil      = (track.silenceAfter !== undefined && track.silenceAfter >= 0) ? track.silenceAfter : -1;

  // Thumbnail HTML
  const thumbHTML = track.thumbnail
    ? `<img class="track-thumb" src="${track.thumbnail}" alt="thumb" loading="lazy">`
    : `<div class="thumb-placeholder"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>`;

  const hlLeft  = (start / (track.duration || 1)) * 100;
  const hlWidth = (sliceDur / (track.duration || 1)) * 100;

  card.innerHTML = `
    <!-- Top row -->
    <div class="track-top">
      <div class="drag-handle" title="Arrastrar para cambiar el orden de escenas">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="9" cy="5" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="9" cy="19" r="1.2"/>
          <circle cx="15" cy="5" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="15" cy="19" r="1.2"/>
        </svg>
      </div>

      <span class="scene-num">🎭 Escena ${idx + 1}</span>

      <input type="checkbox" class="track-cb" ${isChecked ? 'checked' : ''} title="Incluir en la unión final">

      <div class="track-thumb-box">
        ${thumbHTML}
        <button class="btn-play" title="Reproducir / Pausar">
          <svg class="ic-play" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        </button>
      </div>

      <div class="track-info">
        <input type="text" class="track-title-input" value="${escHtml(track.title)}" title="Haz clic para renombrar esta escena">
        <div class="track-meta">
          <span>${escHtml(track.artist)}</span>
          <span class="dur-pill">${fmt(track.duration)}</span>
        </div>
      </div>

      <div class="track-btns">
        <button class="icon-btn btn-up" title="Subir escena" ${idx === 0 ? 'disabled' : ''}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="18 15 12 9 6 15"/></svg>
        </button>
        <button class="icon-btn btn-dn" title="Bajar escena" ${idx === tracks.length - 1 ? 'disabled' : ''}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <a href="/api/download-file/downloads/${encodeURIComponent(track.filename)}" class="icon-btn" title="Descargar MP3 individual" download="${escHtml(track.title)}.mp3">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </a>
        <button class="icon-btn danger btn-del" title="Eliminar esta pista de la lista y del disco">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>
    </div>

    <!-- Trim Panel -->
    <div class="trim-panel">
      <div class="trim-panel-head">
        <span class="trim-label">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>
          Seleccionar fragmento de esta escena
        </span>
        <span class="slice-info">Fragmento: <span class="slice-dur">${fmt(sliceDur)}</span></span>
      </div>

      <!-- Timeline -->
      <div class="timeline" title="Haz clic para saltar a ese momento">
        <div class="timeline-hl" style="left:${hlLeft}%;width:${hlWidth}%"></div>
        <div class="timeline-head" style="left:0%"></div>
      </div>

      <!-- Time controls -->
      <div class="trim-controls">
        <div class="time-cluster">
          <div class="time-box">
            <span class="time-box-label">⏵ Inicio:</span>
            <div class="time-input-row">
              <input type="text" class="time-inp inp-start" value="${fmt(start)}" placeholder="00:00">
              <button class="btn-pin pin-start" title="Fijar punto de reproducción actual como inicio">📍</button>
            </div>
          </div>
          <div class="time-box">
            <span class="time-box-label">⏹ Fin:</span>
            <div class="time-input-row">
              <input type="text" class="time-inp inp-end" value="${fmt(end)}" placeholder="00:00">
              <button class="btn-pin pin-end" title="Fijar punto de reproducción actual como fin">📍</button>
            </div>
          </div>
          <div class="silence-select-box">
            <span class="time-box-label">⏸️ Pausa tras escena:</span>
            <select class="sel sel-sm sel-sil" title="Pausa de silencio específica para esta escena">
              <option value="-1" ${tSil === -1 ? 'selected' : ''}>General (${gSil}s)</option>
              <option value="0"  ${tSil === 0  ? 'selected' : ''}>Sin pausa</option>
              <option value="2"  ${tSil === 2  ? 'selected' : ''}>2s</option>
              <option value="3"  ${tSil === 3  ? 'selected' : ''}>3s</option>
              <option value="5"  ${tSil === 5  ? 'selected' : ''}>5s — muñecos</option>
              <option value="8"  ${tSil === 8  ? 'selected' : ''}>8s</option>
              <option value="10" ${tSil === 10 ? 'selected' : ''}>10s — escenografía</option>
              <option value="15" ${tSil === 15 ? 'selected' : ''}>15s</option>
              <option value="20" ${tSil === 20 ? 'selected' : ''}>20s</option>
            </select>
          </div>
        </div>
        <div class="quick-actions">
          <button class="btn-mini btn-preview-slice" title="Escuchar solo el fragmento seleccionado">▶ Escuchar corte</button>
          <button class="btn-mini btn-reset-trim"   title="Usar la canción completa">↺ Toda la canción</button>
        </div>
      </div>
    </div>
  `;

  bindCardEvents(card, track, idx);
  return card;
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ──── Bind Card Events ────
function bindCardEvents(card, track, idx) {
  const cb           = card.querySelector('.track-cb');
  const btnPlay      = card.querySelector('.btn-play');
  const btnUp        = card.querySelector('.btn-up');
  const btnDn        = card.querySelector('.btn-dn');
  const btnDel       = card.querySelector('.btn-del');
  const timeline     = card.querySelector('.timeline');
  const hlRegion     = card.querySelector('.timeline-hl');
  const playhead     = card.querySelector('.timeline-head');
  const inpStart     = card.querySelector('.inp-start');
  const inpEnd       = card.querySelector('.inp-end');
  const pinStart     = card.querySelector('.pin-start');
  const pinEnd       = card.querySelector('.pin-end');
  const btnPreview   = card.querySelector('.btn-preview-slice');
  const btnReset     = card.querySelector('.btn-reset-trim');
  const titleInput   = card.querySelector('.track-title-input');
  const selSil       = card.querySelector('.sel-sil');
  const sliceDurEl   = card.querySelector('.slice-dur');

  function getStart() { return track.trimStart !== undefined ? track.trimStart : 0; }
  function getEnd()   { return track.trimEnd   !== undefined ? track.trimEnd   : track.duration; }

  function updateVisuals() {
    const s = getStart(), e = getEnd(), dur = track.duration || 1;
    const slice = Math.max(0, e - s);
    sliceDurEl.textContent = fmt(slice);
    hlRegion.style.left  = `${(s / dur) * 100}%`;
    hlRegion.style.width = `${(slice / dur) * 100}%`;
    updateSummary();
  }

  async function saveTrim() {
    await apiFetch('/api/tracks/update', { id: track.id, trimStart: track.trimStart, trimEnd: track.trimEnd });
  }

  // Checkbox
  cb.addEventListener('change', async () => {
    track.selected = cb.checked;
    updateSummary();
    await apiFetch('/api/tracks/update', { id: track.id, selected: track.selected });
    renderTracks();
  });

  // Play button
  btnPlay.addEventListener('click', () => toggleAudio(track, card));

  // Timeline click
  timeline.addEventListener('click', (e) => {
    const r = timeline.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const seekTo = ratio * (track.duration || 1);
    if (!activeAudio || activeTrackId !== track.id) {
      startAudio(track, card, seekTo);
    } else {
      activeAudio.currentTime = seekTo;
    }
    playhead.style.left = `${ratio * 100}%`;
  });

  // Pin start
  pinStart.addEventListener('click', () => {
    const cur = (activeAudio && activeTrackId === track.id) ? Math.floor(activeAudio.currentTime) : 0;
    track.trimStart = Math.min(cur, getEnd() - 1);
    inpStart.value  = fmt(track.trimStart);
    updateVisuals();
    saveTrim();
  });

  // Pin end
  pinEnd.addEventListener('click', () => {
    const cur = (activeAudio && activeTrackId === track.id) ? Math.ceil(activeAudio.currentTime) : track.duration;
    track.trimEnd = Math.max(cur, getStart() + 1);
    inpEnd.value  = fmt(track.trimEnd);
    updateVisuals();
    saveTrim();
  });

  // Start input change
  inpStart.addEventListener('change', () => {
    const sec = parseSecs(inpStart.value);
    track.trimStart = Math.max(0, Math.min(sec, getEnd() - 1));
    inpStart.value  = fmt(track.trimStart);
    updateVisuals();
    saveTrim();
  });

  // End input change
  inpEnd.addEventListener('change', () => {
    const sec = parseSecs(inpEnd.value);
    track.trimEnd = Math.min(track.duration, Math.max(sec, getStart() + 1));
    inpEnd.value  = fmt(track.trimEnd);
    updateVisuals();
    saveTrim();
  });

  // Reset trim
  btnReset.addEventListener('click', () => {
    track.trimStart = 0;
    track.trimEnd   = track.duration;
    inpStart.value  = fmt(0);
    inpEnd.value    = fmt(track.duration);
    updateVisuals();
    saveTrim();
    toast('Recorte restablecido: toda la canción', 'info');
  });

  // Preview slice
  btnPreview.addEventListener('click', () => {
    const s = getStart(), e = getEnd();
    startAudio(track, card, s);
    if (trimStopInterval) clearInterval(trimStopInterval);
    trimStopInterval = setInterval(() => {
      if (activeAudio && activeAudio.currentTime >= e) {
        activeAudio.pause();
        clearInterval(trimStopInterval);
        resetPlayIcons();
      }
    }, 100);
  });

  // Rename title
  titleInput.addEventListener('change', async () => {
    const val = titleInput.value.trim();
    if (val && val !== track.title) {
      track.title = val;
      await apiFetch('/api/tracks/update', { id: track.id, title: val });
      toast('Nombre de escena actualizado', 'info');
    }
  });

  // Per-track silence
  selSil.addEventListener('change', async () => {
    const val = parseInt(selSil.value, 10);
    track.silenceAfter = val === -1 ? undefined : val;
    await apiFetch('/api/tracks/update', { id: track.id, silenceAfter: val === -1 ? null : val });
    renderTracks();
    updateSummary();
  });

  // Move up / down
  btnUp.addEventListener('click', () => { if (idx > 0) swapTracks(idx, idx - 1); });
  btnDn.addEventListener('click', () => { if (idx < tracks.length - 1) swapTracks(idx, idx + 1); });

  // Delete with modal
  btnDel.addEventListener('click', () => {
    showModal(
      '¿Eliminar esta pista?',
      `Se eliminará "${track.title}" de la lista y del disco.`,
      async () => {
        stopAudioIfPlaying(track.id);
        const res = await fetch(`/api/tracks/${encodeURIComponent(track.id)}`, { method: 'DELETE' });
        if (res.ok) {
          tracks = tracks.filter(t => t.id !== track.id);
          renderTracks();
          updateSummary();
          toast(`"${track.title}" eliminado`, 'info');
        } else {
          toast('Error al eliminar la pista', 'error');
        }
      }
    );
  });

  // Drag and drop
  card.addEventListener('dragstart', (e) => {
    dragSrcIndex = idx;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('drag-over'); });
  card.addEventListener('dragleave', () => { card.classList.remove('drag-over'); });
  card.addEventListener('drop', (e) => {
    e.preventDefault();
    card.classList.remove('drag-over');
    if (dragSrcIndex !== null && dragSrcIndex !== idx) {
      const moved = tracks.splice(dragSrcIndex, 1)[0];
      tracks.splice(idx, 0, moved);
      renderTracks();
      syncOrder();
    }
    dragSrcIndex = null;
  });
  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  });
}

// ──── Audio Playback ────
function startAudio(track, card, startTime = 0) {
  stopAllAudio();

  activeAudio   = new Audio(`/media/downloads/${encodeURIComponent(track.filename)}`);
  activeTrackId = track.id;

  const playhead = card.querySelector('.timeline-head');
  const btnPlay  = card.querySelector('.btn-play');
  card.classList.add('playing');

  activeAudio.currentTime = startTime;
  activeAudio.play().catch(e => console.error('Audio play error:', e));

  setPauseIcon(btnPlay);

  activeAudio.addEventListener('timeupdate', () => {
    const pct = (activeAudio.currentTime / (track.duration || 1)) * 100;
    if (playhead) playhead.style.left = `${Math.min(100, Math.max(0, pct))}%`;
  });

  activeAudio.addEventListener('ended', () => {
    card.classList.remove('playing');
    resetPlayIcons();
    activeAudio   = null;
    activeTrackId = null;
  });
}

function toggleAudio(track, card) {
  const btnPlay = card.querySelector('.btn-play');
  if (activeAudio && activeTrackId === track.id) {
    if (activeAudio.paused) {
      activeAudio.play();
      card.classList.add('playing');
      setPauseIcon(btnPlay);
    } else {
      activeAudio.pause();
      card.classList.remove('playing');
      setPlayIcon(btnPlay);
    }
  } else {
    startAudio(track, card, track.trimStart || 0);
  }
}

function stopAllAudio() {
  if (activeAudio) { activeAudio.pause(); activeAudio = null; }
  resetPlayIcons();
  document.querySelectorAll('.track-card.playing').forEach(c => c.classList.remove('playing'));
  activeTrackId = null;
}

function stopAudioIfPlaying(id) {
  if (activeTrackId === id) stopAllAudio();
}

function resetPlayIcons() {
  document.querySelectorAll('.btn-play').forEach(b => setPlayIcon(b));
}

function setPlayIcon(btn) {
  btn.innerHTML = `<svg class="ic-play" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
}

function setPauseIcon(btn) {
  btn.innerHTML = `<svg class="ic-pause" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
}

// ──── Order sync ────
function swapTracks(i, j) {
  [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
  renderTracks();
  syncOrder();
}

async function syncOrder() {
  await apiFetch('/api/tracks/reorder', { trackIds: tracks.map(t => t.id) });
}

// ──── Merge Summary ────
function updateSummary() {
  const sel = tracks.filter(t => t.selected !== false);
  selectedCountEl.textContent = sel.length;
  btnMerge.disabled = sel.length === 0;

  const gSil = globalSilence();
  let total = 0, silTotal = 0;

  sel.forEach((t, i) => {
    const s = t.trimStart !== undefined ? t.trimStart : 0;
    const e = t.trimEnd   !== undefined ? t.trimEnd   : t.duration;
    total += Math.max(0, e - s);
    if (i < sel.length - 1) {
      const sil = (t.silenceAfter !== undefined && t.silenceAfter >= 0) ? t.silenceAfter : gSil;
      total    += sil;
      silTotal += sil;
    }
  });

  if (silTotal > 0) {
    totalDurationEstimateEl.textContent = `${fmt(total)} (incluye ${silTotal}s pausas de silencio)`;
  } else {
    totalDurationEstimateEl.textContent = fmt(total);
  }
}

// ──── API helper ────
async function apiFetch(url, body) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

// ──── Silence select ────
silenceSelect.addEventListener('change', () => {
  customSilenceBox.classList.toggle('hidden', silenceSelect.value !== 'custom');
  renderTracks();
  updateSummary();
});

customSilenceInput.addEventListener('input', () => {
  renderTracks();
  updateSummary();
});

// ──── Select All / None ────
btnSelectAll.addEventListener('click', async () => {
  tracks.forEach(t => t.selected = true);
  renderTracks();
  updateSummary();
  for (const t of tracks) await apiFetch('/api/tracks/update', { id: t.id, selected: true });
});

btnDeselectAll.addEventListener('click', async () => {
  tracks.forEach(t => t.selected = false);
  renderTracks();
  updateSummary();
  for (const t of tracks) await apiFetch('/api/tracks/update', { id: t.id, selected: false });
});

// ──── Paste ────
btnPaste.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) { youtubeUrlInput.value = text.trim(); youtubeUrlInput.focus(); }
  } catch { toast('Usa Ctrl+V para pegar', 'info'); }
});

// ──── Download submit ────
downloadForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = youtubeUrlInput.value.trim();
  if (!url) return;

  btnDownload.disabled = true;
  dlStatus.classList.remove('hidden');
  dlStatusTitle.textContent = 'Contactando con YouTube...';
  dlStatusDetail.textContent = 'Preparando descarga de audio';
  dlPercent.textContent = '0%';
  dlBar.style.width = '0%';

  try {
    const data = await (await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, customBitrate: qualitySelect.value })
    })).json();
    if (!data.success) throw new Error(data.error || 'Error al iniciar la descarga');
  } catch (err) {
    btnDownload.disabled = false;
    dlStatus.classList.add('hidden');
    toast(err.message, 'error');
  }
});

// ──── Merge submit ────
btnMerge.addEventListener('click', async () => {
  const sel = tracks.filter(t => t.selected !== false);
  if (sel.length === 0) { toast('Selecciona al menos una pista', 'error'); return; }

  const gSil = globalSilence();

  const trackConfigs = sel.map(t => ({
    id: t.id,
    trimStart:   t.trimStart !== undefined ? t.trimStart : 0,
    trimEnd:     t.trimEnd   !== undefined ? t.trimEnd   : t.duration,
    silenceAfter: (t.silenceAfter !== undefined && t.silenceAfter >= 0) ? t.silenceAfter : gSil
  }));

  btnMerge.disabled = true;
  mergeProgressBox.classList.remove('hidden');
  mergeResultBox.classList.add('hidden');
  mergePercent.textContent = '0%';
  mergeBar.style.width = '0%';

  try {
    const data = await (await fetch('/api/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trackConfigs,
        silenceDuration:   gSil,
        crossfade:         crossfadeToggle.checked,
        crossfadeDuration: parseInt(crossfadeSeconds.value, 10),
        outputName:        outputFileNameInput.value.trim() || 'Obra_Teatro_Combinada'
      })
    })).json();
    if (!data.success) throw new Error(data.error || 'Error al iniciar la mezcla');
  } catch (err) {
    btnMerge.disabled = false;
    mergeProgressBox.classList.add('hidden');
    toast(err.message, 'error');
  }
});

// ──── Folder buttons ────
btnOpenFolder.addEventListener('click', async () => {
  await apiFetch('/api/open-folder', { folder: 'downloads' });
});

btnOpenMergedFolder.addEventListener('click', async () => {
  await apiFetch('/api/open-folder', { folder: 'merged' });
});

// ──── Clear all tracks ────
btnClearTracks.addEventListener('click', () => {
  if (tracks.length === 0) return;
  showModal(
    '¿Vaciar toda la lista?',
    `Se eliminarán las ${tracks.length} pistas de la lista y sus archivos del disco.`,
    async () => {
      stopAllAudio();
      const res = await fetch('/api/tracks/clear', { method: 'POST' });
      if (res.ok) {
        tracks = [];
        renderTracks();
        updateSummary();
        toast('Lista vaciada', 'info');
      } else {
        toast('Error al vaciar la lista', 'error');
      }
    }
  );
});

// ──── Load Merged Files ────
async function loadMergedFiles() {
  try {
    const res   = await fetch('/api/merged');
    const files = await res.json();

    const n = files.length;
    mergedCountBadge.textContent = `${n} ${n === 1 ? 'audio' : 'audios'}`;

    mergedFilesList.innerHTML = '';

    if (n === 0) {
      mergedFilesList.appendChild(emptyMergedState);
      emptyMergedState.classList.remove('hidden');
      return;
    }
    emptyMergedState.classList.add('hidden');

    files.forEach(file => {
      const item = document.createElement('div');
      item.className = 'merged-item';
      const date = new Date(file.createdAt).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' });

      item.innerHTML = `
        <div class="merged-item-top">
          <div class="merged-item-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
          </div>
          <div class="merged-item-info">
            <div class="merged-item-name" title="${escHtml(file.filename)}">${escHtml(file.filename)}</div>
            <div class="merged-item-meta">
              <span>📅 ${date}</span>
              <span>💾 ${file.size}</span>
            </div>
          </div>
          <div class="merged-item-actions">
            <a href="${file.downloadUrl}" class="icon-btn" title="Descargar" download="${escHtml(file.filename)}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </a>
            <button class="icon-btn danger btn-del-merged" title="Eliminar este audio del disco">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
        <div class="merged-item-player">
          <audio controls src="${file.streamUrl}" preload="none" class="native-player"></audio>
        </div>
      `;

      // Delete merged file
      item.querySelector('.btn-del-merged').addEventListener('click', () => {
        showModal(
          '¿Eliminar audio creado?',
          `Se eliminará "${file.filename}" de tu equipo permanentemente.`,
          async () => {
            try {
              const r = await fetch(`/api/merged/${encodeURIComponent(file.filename)}`, { method: 'DELETE' });
              const body = await r.json();
              if (r.ok) {
                toast('Audio eliminado', 'info');
                loadMergedFiles();
              } else {
                toast(`Error: ${body.error || 'No se pudo eliminar'}`, 'error');
              }
            } catch (err) {
              toast('Error de conexión al eliminar', 'error');
            }
          }
        );
      });

      mergedFilesList.appendChild(item);
    });
  } catch (err) {
    console.error('Error cargando audios creados:', err);
  }
}

// ──── Init ────
window.addEventListener('DOMContentLoaded', () => {
  initSSE();
  loadTracks();
  loadMergedFiles();
});
