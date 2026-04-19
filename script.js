/* ============================================================
   GYM PROGRAM BUILDER — script.js
   Sections:
     1.  Configuration & State
     2.  API Module (fetch wrapper)
     3.  State Helpers
     4.  Exercise & Day Operations
     5.  UI Rendering
     6.  Event Handling
     7.  Programs Drawer
     8.  Name Modal
     9.  Loading & Status UI
     10. Preview Modal
     11. PDF Generation
     12. Utilities & Init
   ============================================================ */

'use strict';

/* ============================================================
   1. CONFIGURATION & STATE
   ============================================================ */

// Base URL for the PHP API. Adjust if your server path differs.
// With .htaccess: /api/programs
// Without .htaccess: /api/programs.php
const API_BASE = '/api/programs';

const STORAGE_KEY = 'gym_program_v1';

function createDefaultState() {
  const names = ['Push', 'Pull', 'Legs', 'Upper', 'Lower', 'Full Body', 'Rest'];
  return {
    currentProgramId:   null,   // integer when loaded from DB
    currentProgramName: null,   // string when loaded from DB
    isDirty:            false,  // true when local changes exceed last DB save
    days: names.map(name => ({ id: uid(), name, exercises: [] })),
  };
}

let state = hydrate();

function hydrate() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.days) && parsed.days.length === 7) {
        return parsed;
      }
    }
  } catch (_) {}
  return createDefaultState();
}

// Persist draft to localStorage (survives refresh without DB)
function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (_) {}
}

// Mark state as having unsaved changes and refresh UI cues
function markDirty() {
  if (state.isDirty) return;
  state.isDirty = true;
  updateStatusBar();
  updateSaveButton();
}

/* ============================================================
   2. API MODULE
   ============================================================ */

const API = {

  async request(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    };
    if (body !== undefined) opts.body = JSON.stringify(body);

    const res  = await fetch(API_BASE + path, opts);
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.error || `Server error (HTTP ${res.status})`);
    }
    return data;
  },

  list()              { return this.request('GET',    '');        },
  get(id)             { return this.request('GET',    `/${id}`);  },
  create(payload)     { return this.request('POST',   '', payload);       },
  update(id, payload) { return this.request('PUT',    `/${id}`, payload); },
  remove(id)          { return this.request('DELETE', `/${id}`);  },
};

// Build the JSON payload the API expects from current state
function buildPayload(name) {
  return {
    name: name || state.currentProgramName || 'My Program',
    days: state.days.map(day => ({
      name: day.name,
      exercises: day.exercises.map(ex => ({
        name: ex.name,
        sets: ex.sets,
        reps: ex.reps,
        rir:  ex.rir,
        note: ex.note,
      })),
    })),
  };
}

/* ============================================================
   3. STATE HELPERS
   ============================================================ */

// Apply a full program object from the API into local state
function applyProgramToState(program) {
  state.currentProgramId   = program.id;
  state.currentProgramName = program.name;
  state.isDirty            = false;

  // Map API days (by order_index) into the 7-slot state array
  state.days = Array.from({ length: 7 }, (_, i) => {
    const apiDay = (program.days || []).find(d => d.order_index === i + 1);
    return {
      id: uid(),
      name: apiDay ? apiDay.name : `Day ${i + 1}`,
      exercises: apiDay
        ? apiDay.exercises.map(ex => ({
            id:   uid(),
            name: ex.name,
            sets: ex.sets,
            reps: ex.reps,
            rir:  ex.rir,
            note: ex.note,
          }))
        : [],
    };
  });

  persist();
  renderAll();
  updateStatusBar();
  updateSaveButton();
}

/* ============================================================
   4. EXERCISE & DAY OPERATIONS
   ============================================================ */

function createExercise() {
  return { id: uid(), name: '', sets: 3, reps: 10, rir: 2, note: '' };
}

function addExercise(dayIndex) {
  state.days[dayIndex].exercises.push(createExercise());
  markDirty();
  persist();
  renderDay(dayIndex);
  requestAnimationFrame(() => {
    const section = getDayEl(dayIndex);
    const inputs  = section.querySelectorAll('.ex-name');
    const last    = inputs[inputs.length - 1];
    if (last) last.focus();
  });
}

function removeExercise(dayIndex, exerciseId) {
  state.days[dayIndex].exercises = state.days[dayIndex].exercises.filter(
    e => e.id !== exerciseId
  );
  markDirty();
  persist();
  renderDay(dayIndex);
}

function duplicateExercise(dayIndex, exerciseId) {
  const list = state.days[dayIndex].exercises;
  const idx  = list.findIndex(e => e.id === exerciseId);
  if (idx === -1) return;
  list.splice(idx + 1, 0, { ...list[idx], id: uid() });
  markDirty();
  persist();
  renderDay(dayIndex);
}

function duplicateDay(srcIndex) {
  if (srcIndex >= 6) {
    showToast('Day 7 is the last day — cannot duplicate forward');
    return;
  }
  const target  = state.days[srcIndex + 1];
  const hasData = target.exercises.length > 0;

  if (hasData && !confirm(`Day ${srcIndex + 2} already has exercises. Overwrite with Day ${srcIndex + 1}?`)) {
    return;
  }

  const src = state.days[srcIndex];
  state.days[srcIndex + 1] = {
    id:        target.id,
    name:      src.name,
    exercises: src.exercises.map(e => ({ ...e, id: uid() })),
  };
  markDirty();
  persist();
  renderDay(srcIndex + 1);
  showToast(`Day ${srcIndex + 1} copied to Day ${srcIndex + 2}`);
}

function updateDayName(dayIndex, value) {
  state.days[dayIndex].name = value;
  markDirty();
  persist();
  updateExerciseCount(dayIndex);
}

function updateExerciseField(dayIndex, exerciseId, field, value) {
  const ex = state.days[dayIndex].exercises.find(e => e.id === exerciseId);
  if (!ex) return;
  ex[field] = (field === 'name' || field === 'note') ? value : Number(value);
  markDirty();
  persist();
}

function resetProgram() {
  if (!confirm('Reset all 7 days? This will clear all exercises and day names.')) return;
  state = createDefaultState();
  persist();
  renderAll();
  updateStatusBar();
  updateSaveButton();
  showToast('Program has been reset');
}

/* ============================================================
   5. UI RENDERING
   ============================================================ */

function renderAll() {
  const container = document.getElementById('days-container');
  container.innerHTML = '';
  state.days.forEach((_, i) => container.appendChild(buildDayElement(i)));
}

function renderDay(dayIndex) {
  const container = document.getElementById('days-container');
  const existing  = getDayEl(dayIndex);
  const fresh     = buildDayElement(dayIndex);
  if (existing) container.replaceChild(fresh, existing);
  else          container.appendChild(fresh);
}

function getDayEl(dayIndex) {
  return document.querySelector(`[data-day-index="${dayIndex}"]`);
}

function updateExerciseCount(dayIndex) {
  const el   = getDayEl(dayIndex);
  const meta = el?.querySelector('.day-meta');
  if (!meta) return;
  const count = state.days[dayIndex].exercises.length;
  meta.textContent = count === 0 ? 'No exercises' : `${count} exercise${count !== 1 ? 's' : ''}`;
}

function buildDayElement(dayIndex) {
  const day     = state.days[dayIndex];
  const exCount = day.exercises.length;

  const section = document.createElement('section');
  section.className     = 'day-card';
  section.dataset.dayIndex = dayIndex;

  // Header
  const header = document.createElement('div');
  header.className = 'day-header';
  header.innerHTML = `
    <span class="day-badge">Day ${dayIndex + 1}</span>
    <input
      type="text"
      class="day-name-input"
      value="${esc(day.name)}"
      placeholder="Name this day (Push, Pull, Rest…)"
      data-day="${dayIndex}"
      aria-label="Day ${dayIndex + 1} name"
    >
    <span class="day-meta">${exCount === 0 ? 'No exercises' : `${exCount} exercise${exCount !== 1 ? 's' : ''}`}</span>
    <div class="day-actions">
      <button class="btn btn-sm btn-ghost btn-dup-day" data-day="${dayIndex}" title="Copy to next day">
        ⊕ Duplicate Day
      </button>
    </div>
  `;
  section.appendChild(header);

  // Column labels
  if (exCount > 0) {
    const colHeader = document.createElement('div');
    colHeader.className = 'exercises-header';
    colHeader.innerHTML = `
      <span></span>
      <span>Exercise</span>
      <span>Sets</span>
      <span>Reps</span>
      <span>RIR</span>
      <span>Note</span>
      <span class="col-actions"></span>
    `;
    section.appendChild(colHeader);
  }

  // Exercise list
  const list = document.createElement('div');
  list.className = 'exercises-list';

  if (exCount === 0) {
    list.innerHTML = '<p class="empty-state">No exercises yet — add one below</p>';
  } else {
    day.exercises.forEach((ex, j) => list.appendChild(buildExerciseRow(dayIndex, ex, j)));
  }
  section.appendChild(list);

  // Footer
  const footer = document.createElement('div');
  footer.className = 'day-footer';
  footer.innerHTML = `
    <button class="btn-add-exercise" data-day="${dayIndex}" aria-label="Add exercise to day ${dayIndex + 1}">
      + Add Exercise
    </button>
  `;
  section.appendChild(footer);

  return section;
}

function buildExerciseRow(dayIndex, exercise, exIdx) {
  const row = document.createElement('div');
  row.className     = 'exercise-row';
  row.dataset.exId  = exercise.id;

  row.innerHTML = `
    <span class="ex-index">${exIdx + 1}</span>
    <input
      type="text" class="ex-name" placeholder="Exercise name"
      value="${esc(exercise.name)}"
      data-day="${dayIndex}" data-id="${exercise.id}" data-field="name"
      aria-label="Exercise name"
    >
    ${buildSelect('sets', dayIndex, exercise.id, exercise.sets, 1, 6)}
    ${buildSelect('reps', dayIndex, exercise.id, exercise.reps, 1, 25)}
    ${buildSelect('rir',  dayIndex, exercise.id, exercise.rir,  0, 5)}
    <input
      type="text" class="ex-note" placeholder="Note…"
      value="${esc(exercise.note)}"
      data-day="${dayIndex}" data-id="${exercise.id}" data-field="note"
      aria-label="Exercise note"
    >
    <div class="ex-actions">
      <button class="btn-icon btn-duplicate-ex"
        data-day="${dayIndex}" data-id="${exercise.id}"
        title="Duplicate exercise" aria-label="Duplicate exercise">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
          <rect x="9" y="9" width="13" height="13" rx="2"/>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
      </button>
      <button class="btn-icon btn-delete-ex"
        data-day="${dayIndex}" data-id="${exercise.id}"
        title="Remove exercise" aria-label="Remove exercise">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6l-1 14H6L5 6"/>
          <path d="M10 11v6M14 11v6"/>
          <path d="M9 6V4h6v2"/>
        </svg>
      </button>
    </div>
  `;
  return row;
}

function buildSelect(field, dayIndex, exerciseId, selected, min, max) {
  const label   = field.charAt(0).toUpperCase() + field.slice(1);
  const options = [];
  for (let v = min; v <= max; v++) {
    options.push(`<option value="${v}"${selected === v ? ' selected' : ''}>${v}</option>`);
  }
  return `
    <select class="ex-select"
      data-day="${dayIndex}" data-id="${exerciseId}" data-field="${field}"
      aria-label="${label}"
    >${options.join('')}</select>
  `;
}

/* ============================================================
   6. EVENT HANDLING (delegation)
   ============================================================ */

function initEvents() {
  const container = document.getElementById('days-container');

  // Day/exercise interactions
  container.addEventListener('click', e => {
    const t = e.target.closest('[data-day]');
    if (!t) return;
    const dayIndex = Number(t.dataset.day);
    if      (t.classList.contains('btn-add-exercise'))  addExercise(dayIndex);
    else if (t.classList.contains('btn-dup-day'))        duplicateDay(dayIndex);
    else if (t.classList.contains('btn-duplicate-ex'))   duplicateExercise(dayIndex, t.dataset.id);
    else if (t.classList.contains('btn-delete-ex'))      removeExercise(dayIndex, t.dataset.id);
  });

  container.addEventListener('input', e => {
    const t = e.target;
    if      (t.classList.contains('day-name-input'))  updateDayName(Number(t.dataset.day), t.value);
    else if (t.classList.contains('ex-name') || t.classList.contains('ex-note'))
      updateExerciseField(Number(t.dataset.day), t.dataset.id, t.dataset.field, t.value);
  });

  container.addEventListener('change', e => {
    const t = e.target;
    if (t.classList.contains('ex-select')) {
      updateExerciseField(Number(t.dataset.day), t.dataset.id, t.dataset.field, t.value);
      focusNextInRow(t);
    }
  });

  container.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.classList.contains('ex-name')) {
      e.preventDefault();
      focusNextInRow(e.target);
    }
  });

  // Header buttons
  document.getElementById('btn-programs').addEventListener('click', openProgramsPanel);
  document.getElementById('btn-save').addEventListener('click', handleSaveClick);
  document.getElementById('btn-reset').addEventListener('click', resetProgram);
  document.getElementById('btn-preview').addEventListener('click', showPreview);
  document.getElementById('btn-pdf').addEventListener('click', generatePDF);
  document.getElementById('modal-pdf-btn').addEventListener('click', generatePDF);

  // Status bar
  document.getElementById('btn-new-program').addEventListener('click', startNewProgram);

  // Preview modal close
  document.querySelector('.preview-backdrop').addEventListener('click', closePreview);
  document.querySelector('.modal-close').addEventListener('click', closePreview);
  document.querySelector('.modal-close-btn').addEventListener('click', closePreview);

  // Programs panel
  document.getElementById('btn-close-panel').addEventListener('click', closeProgramsPanel);
  document.getElementById('panel-backdrop').addEventListener('click', closeProgramsPanel);
  document.getElementById('btn-save-new').addEventListener('click', () => {
    showNameModal('Save as New Program', '', name => saveAsNewProgram(name));
  });
  document.getElementById('programs-list').addEventListener('click', handleProgramsListClick);

  // Name modal close
  document.querySelectorAll('.name-modal-close, .name-backdrop').forEach(el => {
    el.addEventListener('click', closeNameModal);
  });

  // Global keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closePreview();
      closeNameModal();
      closeProgramsPanel();
    }
  });
}

function focusNextInRow(el) {
  const row      = el.closest('.exercise-row');
  if (!row) return;
  const focusable = [...row.querySelectorAll('input:not([type=hidden]), select')];
  const idx       = focusable.indexOf(el);
  if (idx !== -1 && idx < focusable.length - 1) focusable[idx + 1].focus();
}

/* ============================================================
   7. PROGRAMS DRAWER
   ============================================================ */

async function openProgramsPanel() {
  const panel = document.getElementById('programs-panel');
  const backdrop = document.getElementById('panel-backdrop');

  panel.classList.remove('hidden');
  backdrop.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  // Trigger CSS transition (needs one frame to register display change)
  requestAnimationFrame(() => panel.classList.add('open'));

  await refreshProgramsList();
}

function closeProgramsPanel() {
  const panel    = document.getElementById('programs-panel');
  const backdrop = document.getElementById('panel-backdrop');

  panel.classList.remove('open');
  backdrop.classList.add('hidden');
  document.body.style.overflow = '';

  // Hide after transition completes
  setTimeout(() => panel.classList.add('hidden'), 290);
}

async function refreshProgramsList() {
  const listEl = document.getElementById('programs-list');
  listEl.innerHTML = '<p class="panel-hint">Loading…</p>';

  try {
    const programs = await API.list();
    renderProgramsList(programs);
  } catch (e) {
    listEl.innerHTML = `<p class="panel-error">Could not load programs: ${esc(e.message)}</p>`;
  }
}

function renderProgramsList(programs) {
  const listEl = document.getElementById('programs-list');

  if (programs.length === 0) {
    listEl.innerHTML = `
      <p class="panel-hint">No saved programs yet.<br>Build your program above and save it.</p>
    `;
    return;
  }

  listEl.innerHTML = programs.map(p => `
    <div class="program-item ${p.id === state.currentProgramId ? 'active' : ''}" data-pid="${p.id}">
      <div class="program-item-info">
        <strong class="program-item-name">${esc(p.name)}</strong>
        <span class="program-item-date">${formatDate(p.updated_at)}</span>
      </div>
      <div class="program-item-actions">
        <button class="btn btn-sm btn-secondary btn-load-program" data-pid="${p.id}">
          Load
        </button>
        <button class="btn-icon btn-delete-program" data-pid="${p.id}" title="Delete program">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14H6L5 6"/>
            <path d="M10 11v6M14 11v6"/>
            <path d="M9 6V4h6v2"/>
          </svg>
        </button>
      </div>
    </div>
  `).join('');
}

function handleProgramsListClick(e) {
  const loadBtn   = e.target.closest('.btn-load-program');
  const deleteBtn = e.target.closest('.btn-delete-program');

  if (loadBtn)   loadProgram(Number(loadBtn.dataset.pid));
  if (deleteBtn) deleteSavedProgram(Number(deleteBtn.dataset.pid));
}

async function loadProgram(id) {
  if (state.isDirty) {
    if (!confirm('You have unsaved changes. Load this program and discard them?')) return;
  }

  setLoading(true);
  try {
    const program = await API.get(id);
    applyProgramToState(program);
    closeProgramsPanel();
    showToast(`Loaded: ${program.name}`);
  } catch (e) {
    showToast(`Load failed: ${e.message}`, 4000);
  } finally {
    setLoading(false);
  }
}

async function saveAsNewProgram(name) {
  setLoading(true);
  try {
    const result = await API.create(buildPayload(name));
    state.currentProgramId   = result.id;
    state.currentProgramName = result.name;
    state.isDirty            = false;
    persist();
    updateStatusBar();
    updateSaveButton();
    await refreshProgramsList();
    showToast(`Saved: "${result.name}"`);
  } catch (e) {
    showToast(`Save failed: ${e.message}`, 4000);
  } finally {
    setLoading(false);
  }
}

async function saveChangesToDB() {
  if (!state.currentProgramId) return;
  setLoading(true);
  try {
    await API.update(state.currentProgramId, buildPayload(state.currentProgramName));
    state.isDirty = false;
    persist();
    updateStatusBar();
    updateSaveButton();
    showToast('Changes saved');
  } catch (e) {
    showToast(`Save failed: ${e.message}`, 4000);
  } finally {
    setLoading(false);
  }
}

async function deleteSavedProgram(id) {
  if (!confirm('Delete this program permanently?')) return;
  setLoading(true);
  try {
    await API.remove(id);

    // If we deleted the currently loaded program, reset context
    if (state.currentProgramId === id) {
      state.currentProgramId   = null;
      state.currentProgramName = null;
      state.isDirty            = false;
      persist();
      updateStatusBar();
      updateSaveButton();
    }

    await refreshProgramsList();
    showToast('Program deleted');
  } catch (e) {
    showToast(`Delete failed: ${e.message}`, 4000);
  } finally {
    setLoading(false);
  }
}

// "Save Program" header button logic
function handleSaveClick() {
  if (state.currentProgramId === null) {
    // First save — prompt for name
    showNameModal('Save Program', '', name => saveAsNewProgram(name));
  } else if (state.isDirty) {
    // Already saved before — update in place
    saveChangesToDB();
  }
  // If clean (already saved), button is disabled — nothing to do
}

function startNewProgram() {
  if (state.isDirty && !confirm('Discard unsaved changes and start a new program?')) return;
  state = createDefaultState();
  persist();
  renderAll();
  updateStatusBar();
  updateSaveButton();
  showToast('Started new program');
}

/* ============================================================
   8. NAME MODAL
   ============================================================ */

function showNameModal(title, defaultValue, onConfirm) {
  const modal = document.getElementById('name-modal');
  const input = document.getElementById('program-name-input');

  document.getElementById('name-modal-title').textContent = title;
  input.value = defaultValue || '';
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => input.focus());

  const confirmBtn = document.getElementById('name-modal-confirm');

  // Replace handler each time (avoid stacking listeners)
  confirmBtn.onclick = () => {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    closeNameModal();
    onConfirm(name);
  };

  input.onkeydown = e => {
    if (e.key === 'Enter') confirmBtn.click();
  };
}

function closeNameModal() {
  document.getElementById('name-modal').classList.add('hidden');
  document.body.style.overflow = '';
}

/* ============================================================
   9. LOADING & STATUS UI
   ============================================================ */

function setLoading(on) {
  document.getElementById('loading-overlay').classList.toggle('hidden', !on);
}

function updateStatusBar() {
  const bar   = document.getElementById('program-status');
  const name  = document.getElementById('status-name');
  const dirty = document.getElementById('status-dirty');

  if (state.currentProgramId !== null) {
    bar.classList.remove('hidden');
    name.textContent = state.currentProgramName || '';
    dirty.classList.toggle('hidden', !state.isDirty);
  } else {
    bar.classList.add('hidden');
  }
}

function updateSaveButton() {
  const btn = document.getElementById('btn-save');
  if (state.currentProgramId === null) {
    // No program saved yet
    btn.textContent  = 'Save Program';
    btn.disabled     = false;
    btn.dataset.state = '';
    btn.className    = 'btn btn-secondary';
    // Re-add the icon
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15">
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
        <polyline points="17 21 17 13 7 13 7 21"/>
        <polyline points="7 3 7 8 15 8"/>
      </svg>
      Save Program`;
  } else if (state.isDirty) {
    btn.textContent  = 'Save Changes';
    btn.disabled     = false;
    btn.dataset.state = '';
    btn.className    = 'btn btn-secondary';
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15">
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
        <polyline points="17 21 17 13 7 13 7 21"/>
        <polyline points="7 3 7 8 15 8"/>
      </svg>
      Save Changes`;
  } else {
    btn.textContent  = 'Saved ✓';
    btn.disabled     = true;
    btn.dataset.state = 'saved';
    btn.className    = 'btn btn-ghost';
    btn.innerHTML    = 'Saved ✓';
  }
}

/* ============================================================
   10. PREVIEW MODAL
   ============================================================ */

function showPreview() {
  document.getElementById('preview-content').innerHTML = buildPreviewHTML();
  document.getElementById('preview-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closePreview() {
  document.getElementById('preview-modal').classList.add('hidden');
  document.body.style.overflow = '';
}

function buildPreviewHTML() {
  return state.days.map((day, i) => {
    const title = `Day ${i + 1} — ${esc(day.name)}`;
    if (day.exercises.length === 0) {
      return `
        <div class="preview-day">
          <h3 class="preview-day-title">${title}</h3>
          <p class="preview-empty">Rest day / No exercises</p>
        </div>`;
    }
    const rows = day.exercises.map((ex, j) => `
      <tr>
        <td>${j + 1}</td>
        <td><strong>${esc(ex.name) || '<em>Unnamed</em>'}</strong></td>
        <td>${ex.sets}</td><td>${ex.reps}</td><td>${ex.rir}</td>
        <td>${esc(ex.note) || '—'}</td>
      </tr>`).join('');

    return `
      <div class="preview-day">
        <h3 class="preview-day-title">${title}</h3>
        <table class="preview-table">
          <thead>
            <tr><th>#</th><th>Exercise</th><th>Sets</th><th>Reps</th><th>RIR</th><th>Note</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }).join('');
}

/* ============================================================
   11. PDF GENERATION
   ============================================================ */

function generatePDF() {
  if (typeof window.jspdf === 'undefined') {
    showToast('PDF library not loaded — check your internet connection', 4000);
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc  = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const PW   = doc.internal.pageSize.getWidth();
  const PH   = doc.internal.pageSize.getHeight();
  const M    = 14;
  const CW   = PW - M * 2;
  const FOOT = 12;
  const COL  = { num: M, name: M+6, sets: M+92, reps: M+110, rir: M+128, note: M+146 };
  let y      = 0;

  const programTitle = state.currentProgramName || '7-Day Training Program';

  function addPageHeader() {
    doc.setFillColor(30, 64, 175);
    doc.rect(0, 0, PW, 26, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(255, 255, 255);
    doc.text(programTitle, PW / 2, 16, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(180, 200, 255);
    doc.text(
      `Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
      PW / 2, 22, { align: 'center' }
    );
    y = 32;
  }

  function checkPageBreak(needed) {
    if (y + needed > PH - FOOT) { doc.addPage(); y = M; }
  }

  function drawTableHeader() {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 100, 100);
    ['#', 'EXERCISE', 'SETS', 'REPS', 'RIR', 'NOTE'].forEach((label, i) => {
      const x = [COL.num, COL.name, COL.sets, COL.reps, COL.rir, COL.note][i];
      doc.text(label, x, y);
    });
    doc.setDrawColor(200, 200, 200);
    doc.line(M, y + 1.5, M + CW, y + 1.5);
    y += 5;
  }

  function drawExerciseRow(ex, rowIdx) {
    checkPageBreak(8);
    if (rowIdx % 2 === 1) {
      doc.setFillColor(248, 249, 252);
      doc.rect(M, y - 3.5, CW, 7, 'F');
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(30, 30, 30);
    doc.text(String(rowIdx + 1), COL.num, y);
    doc.text(ex.name || '—', COL.name, y, { maxWidth: 82 });
    doc.text(String(ex.sets), COL.sets, y);
    doc.text(String(ex.reps), COL.reps, y);
    doc.text(String(ex.rir),  COL.rir,  y);
    doc.text(ex.note || '—', COL.note, y, { maxWidth: 44 });
    doc.setDrawColor(235, 235, 235);
    doc.line(M, y + 3, M + CW, y + 3);
    y += 7;
  }

  addPageHeader();

  state.days.forEach((day, i) => {
    const rowCount    = day.exercises.length;
    const estimatedH  = 18 + (rowCount === 0 ? 10 : rowCount * 7 + 6);
    checkPageBreak(estimatedH);

    doc.setFillColor(239, 246, 255);
    doc.rect(M, y, CW, 11, 'F');
    doc.setDrawColor(191, 219, 254);
    doc.rect(M, y, CW, 11, 'S');
    doc.setFillColor(37, 99, 235);
    doc.rect(M, y, 3, 11, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(30, 64, 175);
    doc.text(`Day ${i + 1}`, M + 6, y + 7.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(50, 50, 50);
    doc.text(`— ${day.name}`, M + 20, y + 7.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(
      rowCount === 0 ? 'Rest / No exercises' : `${rowCount} exercise${rowCount !== 1 ? 's' : ''}`,
      M + CW - 2, y + 7.5, { align: 'right' }
    );
    y += 13;

    if (rowCount === 0) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(9);
      doc.setTextColor(150, 150, 150);
      doc.text('Rest day — no exercises scheduled', COL.name, y);
      y += 8;
    } else {
      drawTableHeader();
      day.exercises.forEach((ex, j) => drawExerciseRow(ex, j));
    }
    y += 6;
  });

  const totalPages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(170, 170, 170);
    doc.text(`Page ${p} of ${totalPages}`, PW / 2, PH - 6, { align: 'center' });
    doc.line(M, PH - FOOT + 2, M + CW, PH - FOOT + 2);
  }

  const filename = (state.currentProgramName || 'training-program')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.pdf';
  doc.save(filename);

  closePreview();
  showToast('PDF downloaded — ready to print');
}

/* ============================================================
   12. UTILITIES & INIT
   ============================================================ */

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  } catch (_) { return iso; }
}

let _toastTimer = null;
function showToast(msg, duration = 2800) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('visible');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => toast.classList.remove('visible'), duration);
}

function init() {
  renderAll();
  initEvents();
  updateStatusBar();
  updateSaveButton();
}

document.addEventListener('DOMContentLoaded', init);
