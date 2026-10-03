/* The public booking page: month picker, live slots, booking form. */
(function () {
  'use strict';
  const root = document.querySelector('[data-book]');
  if (!root) return;
  const slug = root.dataset.slug;
  const duration = parseInt(root.dataset.duration, 10);

  const $ = (sel) => root.querySelector(sel);
  const grid = $('[data-grid]');
  const monthLabel = $('[data-month-label]');
  const dayLabel = $('[data-day-label]');
  const slotList = $('[data-slot-list]');
  const tzSelect = $('[data-tz]');
  const tzLabel = $('[data-tz-label]');
  const loading = $('[data-loading]');
  const loadError = $('[data-load-error]');
  const stepPick = $('[data-step="pick"]');
  const stepForm = $('[data-step="form"]');
  const summary = $('[data-summary]');
  const form = $('[data-form]');
  const formError = $('[data-form-error]');
  const submitBtn = $('[data-submit]');

  let tz = Intl.DateTimeFormat().resolvedOptions().timeZone || root.dataset.hostTz || 'UTC';
  const today = new Date();
  let view = { y: today.getFullYear(), m: today.getMonth() }; // month being shown (in guest's zone)
  let slots = [];            // ms timestamps for the loaded range
  let byDate = new Map();    // 'YYYY-MM-DD' (guest tz) -> [ms]
  let selectedDate = null;
  let selectedSlot = null;
  let requestId = 0;

  // ---- time zone helpers (guest side) ----
  const pad = (n) => String(n).padStart(2, '0');
  function partsIn(ms, zone) {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    const p = {};
    for (const { type, value } of f.formatToParts(new Date(ms))) p[type] = value;
    return { y: +p.year, m: +p.month, d: +p.day, h: (+p.hour) % 24, mi: +p.minute };
  }
  function dateKey(ms, zone) { const p = partsIn(ms, zone); return `${p.y}-${pad(p.m)}-${pad(p.d)}`; }
  function fmtTime(ms) { return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(ms)); }
  function fmtLong(ms) { return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(ms)); }
  function todayKey() { return dateKey(Date.now(), tz); }

  // ---- time zone picker ----
  (function fillTz() {
    let zones = [];
    try { zones = Intl.supportedValuesOf('timeZone'); } catch (e) { zones = [tz]; }
    if (!zones.includes(tz)) zones.unshift(tz);
    for (const z of zones) {
      const o = document.createElement('option');
      o.value = z; o.textContent = z.replace(/_/g, ' ');
      if (z === tz) o.selected = true;
      tzSelect.appendChild(o);
    }
    tzLabel.textContent = `Times shown in ${tz.replace(/_/g, ' ')}`;
  })();
  tzSelect.addEventListener('change', () => {
    tz = tzSelect.value;
    tzLabel.textContent = `Times shown in ${tz.replace(/_/g, ' ')}`;
    regroup();
    renderGrid();
    renderSlots();
  });

  // ---- loading availability ----
  async function load() {
    const id = ++requestId;
    loading.classList.remove('hidden');
    loadError.classList.add('hidden');
    // Ask for a generous window around the visible month so every zone is covered.
    const from = new Date(Date.UTC(view.y, view.m, 1) - 2 * 86400000);
    const to = new Date(Date.UTC(view.y, view.m + 1, 1) + 2 * 86400000);
    try {
      const res = await fetch(`/api/book/${encodeURIComponent(slug)}/slots?from=${from.toISOString()}&to=${to.toISOString()}`, { cache: 'no-store' });
      const data = await res.json();
      if (id !== requestId) return;
      if (!res.ok) throw new Error(data.error || 'Could not load availability.');
      slots = data.slots || [];
      regroup();
      renderGrid();
      if (selectedDate && !byDate.has(selectedDate)) { selectedDate = null; selectedSlot = null; }
      if (!selectedDate) {
        const first = [...byDate.keys()].sort().find((k) => k.slice(0, 7) === `${view.y}-${pad(view.m + 1)}`);
        if (first) selectedDate = first;
      }
      renderGrid();
      renderSlots();
    } catch (e) {
      if (id !== requestId) return;
      loadError.textContent = e.message;
      loadError.classList.remove('hidden');
    } finally {
      if (id === requestId) loading.classList.add('hidden');
    }
  }

  function regroup() {
    byDate = new Map();
    for (const ms of slots) {
      const k = dateKey(ms, tz);
      if (!byDate.has(k)) byDate.set(k, []);
      byDate.get(k).push(ms);
    }
  }

  // ---- rendering ----
  function renderGrid() {
    monthLabel.textContent = new Date(view.y, view.m, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    grid.innerHTML = '';
    for (const wd of ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']) {
      const h = document.createElement('div'); h.className = 'wd'; h.textContent = wd; grid.appendChild(h);
    }
    const firstDow = new Date(view.y, view.m, 1).getDay();
    const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
    for (let i = 0; i < firstDow; i++) grid.appendChild(document.createElement('div'));
    const tk = todayKey();
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${view.y}-${pad(view.m + 1)}-${pad(d)}`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'day';
      btn.textContent = d;
      if (key === tk) btn.classList.add('today');
      if (byDate.has(key)) {
        btn.classList.add('avail');
        if (key === selectedDate) btn.classList.add('selected');
        btn.addEventListener('click', () => { selectedDate = key; selectedSlot = null; renderGrid(); renderSlots(); });
      } else {
        btn.disabled = true;
      }
      grid.appendChild(btn);
    }
    const now = new Date();
    $('[data-prev]').disabled = view.y < now.getFullYear() || (view.y === now.getFullYear() && view.m <= now.getMonth());
  }

  function renderSlots() {
    slotList.innerHTML = '';
    if (!selectedDate) {
      dayLabel.textContent = byDate.size ? 'Select a day' : '';
      if (!byDate.size && loading.classList.contains('hidden')) {
        const e = document.createElement('div'); e.className = 'empty'; e.textContent = 'No times this month. Try the next one.'; slotList.appendChild(e);
      }
      return;
    }
    const list = byDate.get(selectedDate) || [];
    dayLabel.textContent = list.length ? fmtLong(list[0]) : '';
    for (const ms of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'slot' + (ms === selectedSlot ? ' selected' : '');
      b.textContent = fmtTime(ms);
      b.addEventListener('click', () => openForm(ms));
      slotList.appendChild(b);
    }
  }

  function openForm(ms) {
    selectedSlot = ms;
    summary.textContent = `${fmtLong(ms)}, ${fmtTime(ms)} – ${fmtTime(ms + duration * 60000)}`;
    formError.classList.add('hidden');
    stepPick.classList.add('hidden');
    stepForm.classList.remove('hidden');
    $('#name').focus();
  }

  $('[data-back]').addEventListener('click', () => {
    stepForm.classList.add('hidden');
    stepPick.classList.remove('hidden');
    renderSlots();
  });

  $('[data-prev]').addEventListener('click', () => { view.m -= 1; if (view.m < 0) { view.m = 11; view.y -= 1; } selectedDate = null; selectedSlot = null; load(); });
  $('[data-next]').addEventListener('click', () => { view.m += 1; if (view.m > 11) { view.m = 0; view.y += 1; } selectedDate = null; selectedSlot = null; load(); });

  // ---- booking ----
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!selectedSlot) return;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Booking…';
    formError.classList.add('hidden');
    try {
      const res = await fetch(`/api/book/${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start: new Date(selectedSlot).toISOString(),
          name: $('#name').value,
          email: $('#email').value,
          notes: $('#notes').value,
          timezone: tz,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong.'), { status: res.status });
      window.location.href = data.redirect;
    } catch (e) {
      formError.textContent = e.message;
      formError.classList.remove('hidden');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Confirm booking';
      if (e.status === 409) {
        // Someone took the slot; go back to the picker with fresh data.
        setTimeout(() => { stepForm.classList.add('hidden'); stepPick.classList.remove('hidden'); selectedSlot = null; load(); }, 1800);
      }
    }
  });

  // Keep availability fresh while the page is open.
  setInterval(() => { if (!stepPick.classList.contains('hidden')) load(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !stepPick.classList.contains('hidden')) load(); });

  renderGrid();
  load();
})();
