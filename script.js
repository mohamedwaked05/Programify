/* ============================================================
   GYM PROGRAM BUILDER — script.js
   Separation of concerns:
     1. State Management
     2. Exercise & Day Operations
     3. UI Rendering
     4. Event Handling
     5. Preview Modal
     6. PDF Generation
     7. Utilities / Init
   ============================================================ */

'use strict';

/* ============================================================
   1. STATE MANAGEMENT
   ============================================================ */

const STORAGE_KEY = 'gym_program_v1';

function createDefaultState() {
  const dayNames = ['Push', 'Pull', 'Legs', 'Upper', 'Lower', 'Full Body', 'Rest'];
  return {
    days: dayNames.map((name, i) => ({
      id: uid(),
      name: name,
      exercises: []
    }))
  };
}

let state = hydrate();

function hydrate() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Validate shape
      if (parsed && Array.isArray(parsed.days) && parsed.days.length === 7) {
        return parsed;
      }
    }
  } catch (_) {}
  return createDefaultState();
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (_) {}
}

/* ============================================================
   2. EXERCISE & DAY OPERATIONS
   ============================================================ */

function createExercise() {
  return { id: uid(), name: '', sets: 3, reps: 10, rir: 2, note: '' };
}

function addExercise(dayIndex) {
  const ex = createExercise();
  state.days[dayIndex].exercises.push(ex);
  persist();
  renderDay(dayIndex);
  // Auto-focus the new name input
  requestAnimationFrame(() => {
    const section = getDayEl(dayIndex);
    const inputs = section.querySelectorAll('.ex-name');
    const last = inputs[inputs.length - 1];
    if (last) last.focus();
  });
}

function removeExercise(dayIndex, exerciseId) {
  state.days[dayIndex].exercises = state.days[dayIndex].exercises.filter(
    e => e.id !== exerciseId
  );
  persist();
  renderDay(dayIndex);
}

function duplicateExercise(dayIndex, exerciseId) {
  const list = state.days[dayIndex].exercises;
  const idx = list.findIndex(e => e.id === exerciseId);
  if (idx === -1) return;
  const copy = { ...list[idx], id: uid() };
  list.splice(idx + 1, 0, copy);
  persist();
  renderDay(dayIndex);
}

function duplicateDay(srcIndex) {
  if (srcIndex >= 6) {
    showToast('Day 7 is the last day — cannot duplicate forward');
    return;
  }
  const target = state.days[srcIndex + 1];
  const hasData = target.exercises.length > 0;

  if (hasData && !confirm(`Day ${srcIndex + 2} already has exercises. Overwrite with Day ${srcIndex + 1}?`)) {
    return;
  }

  const src = state.days[srcIndex];
  state.days[srcIndex + 1] = {
    id: target.id,
    name: src.name,
    exercises: src.exercises.map(e => ({ ...e, id: uid() }))
  };
  persist();
  renderDay(srcIndex + 1);
  showToast(`Day ${srcIndex + 1} copied to Day ${srcIndex + 2}`);
}

function updateDayName(dayIndex, value) {
  state.days[dayIndex].name = value;
  persist();
  updateExerciseCount(dayIndex);
}

function updateExerciseField(dayIndex, exerciseId, field, value) {
  const ex = state.days[dayIndex].exercises.find(e => e.id === exerciseId);
  if (!ex) return;
  ex[field] = (field === 'name' || field === 'note') ? value : Number(value);
  persist();
}

function resetProgram() {
  if (!confirm('Reset all 7 days? This will permanently clear all exercises and day names.')) return;
  state = createDefaultState();
  persist();
  renderAll();
  showToast('Program has been reset');
}

/* ============================================================
   3. UI RENDERING
   ============================================================ */

function renderAll() {
  const container = document.getElementById('days-container');
  container.innerHTML = '';
  state.days.forEach((_, i) => container.appendChild(buildDayElement(i)));
}

function renderDay(dayIndex) {
  const container = document.getElementById('days-container');
  const existing = getDayEl(dayIndex);
  const fresh = buildDayElement(dayIndex);
  if (existing) {
    container.replaceChild(fresh, existing);
  } else {
    container.appendChild(fresh);
  }
}

function getDayEl(dayIndex) {
  return document.querySelector(`[data-day-index="${dayIndex}"]`);
}

function updateExerciseCount(dayIndex) {
  const el = getDayEl(dayIndex);
  if (!el) return;
  const meta = el.querySelector('.day-meta');
  if (meta) {
    const count = state.days[dayIndex].exercises.length;
    meta.textContent = count === 0 ? 'No exercises' : `${count} exercise${count !== 1 ? 's' : ''}`;
  }
}

function buildDayElement(dayIndex) {
  const day = state.days[dayIndex];
  const exCount = day.exercises.length;

  const section = document.createElement('section');
  section.className = 'day-card';
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
      <button class="btn btn-sm btn-ghost btn-dup-day" data-day="${dayIndex}" title="Copy this day's exercises to next day">
        ⊕ Duplicate Day
      </button>
    </div>
  `;
  section.appendChild(header);

  // Column labels (only shown when exercises exist)
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
    day.exercises.forEach((ex, exIdx) => {
      list.appendChild(buildExerciseRow(dayIndex, ex, exIdx));
    });
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
  row.className = 'exercise-row';
  row.dataset.exId = exercise.id;

  row.innerHTML = `
    <span class="ex-index">${exIdx + 1}</span>

    <input
      type="text"
      class="ex-name"
      placeholder="Exercise name"
      value="${esc(exercise.name)}"
      data-day="${dayIndex}"
      data-id="${exercise.id}"
      data-field="name"
      aria-label="Exercise name"
    >

    ${buildSelect('sets', dayIndex, exercise.id, exercise.sets, 1, 6)}
    ${buildSelect('reps', dayIndex, exercise.id, exercise.reps, 1, 25)}
    ${buildSelect('rir',  dayIndex, exercise.id, exercise.rir,  0, 5)}

    <input
      type="text"
      class="ex-note"
      placeholder="Note…"
      value="${esc(exercise.note)}"
      data-day="${dayIndex}"
      data-id="${exercise.id}"
      data-field="note"
      aria-label="Exercise note"
    >

    <div class="ex-actions">
      <button
        class="btn-icon btn-duplicate-ex"
        data-day="${dayIndex}"
        data-id="${exercise.id}"
        title="Duplicate exercise"
        aria-label="Duplicate exercise"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
          <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
      </button>
      <button
        class="btn-icon btn-delete-ex"
        data-day="${dayIndex}"
        data-id="${exercise.id}"
        title="Remove exercise"
        aria-label="Remove exercise"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
        </svg>
      </button>
    </div>
  `;

  return row;
}

function buildSelect(field, dayIndex, exerciseId, selected, min, max) {
  const label = field.charAt(0).toUpperCase() + field.slice(1);
  const options = [];
  for (let v = min; v <= max; v++) {
    options.push(`<option value="${v}"${selected === v ? ' selected' : ''}>${v}</option>`);
  }
  return `
    <select
      class="ex-select"
      data-day="${dayIndex}"
      data-id="${exerciseId}"
      data-field="${field}"
      aria-label="${label}"
    >${options.join('')}</select>
  `;
}

/* ============================================================
   4. EVENT HANDLING (delegation)
   ============================================================ */

function initEvents() {
  const container = document.getElementById('days-container');

  // Click delegation
  container.addEventListener('click', e => {
    const t = e.target.closest('[data-day]');
    if (!t) return;
    const dayIndex = Number(t.dataset.day);

    if (t.classList.contains('btn-add-exercise')) {
      addExercise(dayIndex);
    } else if (t.classList.contains('btn-dup-day')) {
      duplicateDay(dayIndex);
    } else if (t.classList.contains('btn-duplicate-ex')) {
      duplicateExercise(dayIndex, t.dataset.id);
    } else if (t.classList.contains('btn-delete-ex')) {
      removeExercise(dayIndex, t.dataset.id);
    }
  });

  // Input delegation (live sync, no re-render)
  container.addEventListener('input', e => {
    const t = e.target;
    if (t.classList.contains('day-name-input')) {
      updateDayName(Number(t.dataset.day), t.value);
    } else if (t.classList.contains('ex-name') || t.classList.contains('ex-note')) {
      updateExerciseField(Number(t.dataset.day), t.dataset.id, t.dataset.field, t.value);
    }
  });

  // Select delegation — change fires once on commit
  container.addEventListener('change', e => {
    const t = e.target;
    if (t.classList.contains('ex-select')) {
      updateExerciseField(Number(t.dataset.day), t.dataset.id, t.dataset.field, t.value);
      focusNextInRow(t);
    }
  });

  // Keyboard: Enter in exercise name moves to Sets select
  container.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.classList.contains('ex-name')) {
      e.preventDefault();
      focusNextInRow(e.target);
    }
  });

  // Header buttons
  document.getElementById('btn-reset').addEventListener('click', resetProgram);
  document.getElementById('btn-preview').addEventListener('click', showPreview);
  document.getElementById('btn-pdf').addEventListener('click', generatePDF);
  document.getElementById('modal-pdf-btn').addEventListener('click', generatePDF);

  // Modal close
  document.querySelector('.modal-backdrop').addEventListener('click', closePreview);
  document.querySelector('.modal-close').addEventListener('click', closePreview);
  document.querySelector('.modal-close-btn').addEventListener('click', closePreview);

  // Global keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closePreview();
  });
}

function focusNextInRow(el) {
  const row = el.closest('.exercise-row');
  if (!row) return;
  const focusable = [...row.querySelectorAll('input:not([type=hidden]), select')];
  const idx = focusable.indexOf(el);
  if (idx !== -1 && idx < focusable.length - 1) {
    focusable[idx + 1].focus();
  }
}

/* ============================================================
   5. PREVIEW MODAL
   ============================================================ */

function showPreview() {
  const content = document.getElementById('preview-content');
  content.innerHTML = buildPreviewHTML();
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
        </div>
      `;
    }
    const rows = day.exercises.map((ex, j) => `
      <tr>
        <td>${j + 1}</td>
        <td><strong>${esc(ex.name) || '<em>Unnamed</em>'}</strong></td>
        <td>${ex.sets}</td>
        <td>${ex.reps}</td>
        <td>${ex.rir}</td>
        <td>${esc(ex.note) || '—'}</td>
      </tr>
    `).join('');

    return `
      <div class="preview-day">
        <h3 class="preview-day-title">${title}</h3>
        <table class="preview-table">
          <thead>
            <tr><th>#</th><th>Exercise</th><th>Sets</th><th>Reps</th><th>RIR</th><th>Note</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }).join('');
}

/* ============================================================
   6. PDF GENERATION
   ============================================================ */

function generatePDF() {
  if (typeof window.jspdf === 'undefined') {
    showToast('PDF library not loaded — check your internet connection', 4000);
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const PW   = doc.internal.pageSize.getWidth();
  const PH   = doc.internal.pageSize.getHeight();
  const M    = 14;          // margin
  const CW   = PW - M * 2; // content width
  const FOOT = 12;          // footer reserved height

  // Column x positions
  const COL = {
    num:  M,
    name: M + 6,
    sets: M + 92,
    reps: M + 110,
    rir:  M + 128,
    note: M + 146,
  };

  let y = 0;

  // ── Page header helper ──────────────────────────────────────
  function addPageHeader() {
    doc.setFillColor(30, 64, 175);
    doc.rect(0, 0, PW, 26, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(255, 255, 255);
    doc.text('7-Day Training Program', PW / 2, 16, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(180, 200, 255);
    doc.text(`Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, PW / 2, 22, { align: 'center' });
    y = 32;
  }

  function checkPageBreak(needed) {
    if (y + needed > PH - FOOT) {
      doc.addPage();
      y = M;
    }
  }

  // ── Draw column headers for a day ──────────────────────────
  function drawTableHeader() {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 100, 100);
    doc.text('#',        COL.num,  y);
    doc.text('EXERCISE', COL.name, y);
    doc.text('SETS',     COL.sets, y);
    doc.text('REPS',     COL.reps, y);
    doc.text('RIR',      COL.rir,  y);
    doc.text('NOTE',     COL.note, y);
    doc.setDrawColor(200, 200, 200);
    doc.line(M, y + 1.5, M + CW, y + 1.5);
    y += 5;
  }

  // ── Draw an exercise row ────────────────────────────────────
  function drawExerciseRow(ex, rowIdx) {
    checkPageBreak(8);

    // Alternating row background
    if (rowIdx % 2 === 1) {
      doc.setFillColor(248, 249, 252);
      doc.rect(M, y - 3.5, CW, 7, 'F');
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(30, 30, 30);

    doc.text(String(rowIdx + 1),                  COL.num,  y);
    doc.text(ex.name  || '—',                     COL.name, y, { maxWidth: 82 });
    doc.text(String(ex.sets),                     COL.sets, y);
    doc.text(String(ex.reps),                     COL.reps, y);
    doc.text(String(ex.rir),                      COL.rir,  y);
    doc.text(ex.note  || '—',                     COL.note, y, { maxWidth: 44 });

    doc.setDrawColor(235, 235, 235);
    doc.line(M, y + 3, M + CW, y + 3);

    y += 7;
  }

  // ── Build document ──────────────────────────────────────────
  addPageHeader();

  state.days.forEach((day, i) => {
    const rowCount = day.exercises.length;
    const estimatedH = 18 + (rowCount === 0 ? 10 : rowCount * 7 + 6);
    checkPageBreak(estimatedH);

    // Day header band
    doc.setFillColor(239, 246, 255);
    doc.rect(M, y, CW, 11, 'F');
    doc.setDrawColor(191, 219, 254);
    doc.rect(M, y, CW, 11, 'S');

    // Day accent bar
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

    y += 6; // gap between days
  });

  // ── Footer on every page ────────────────────────────────────
  const totalPages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(170, 170, 170);
    doc.text(`Page ${p} of ${totalPages}`, PW / 2, PH - 6, { align: 'center' });
    doc.line(M, PH - FOOT + 2, M + CW, PH - FOOT + 2);
  }

  doc.save('training-program.pdf');

  closePreview();
  showToast('PDF downloaded — ready to print');
}

/* ============================================================
   7. UTILITIES & INIT
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

let _toastTimer = null;
function showToast(msg, duration = 2800) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('visible');

  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    toast.classList.remove('visible');
  }, duration);
}

function init() {
  renderAll();
  initEvents();
}

document.addEventListener('DOMContentLoaded', init);
