/* Small helpers for the admin pages: weekly hours editor, specific dates, form niceties. */
(function () {
  'use strict';
  const DAYS = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']];

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    for (const k in attrs || {}) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), attrs[k]);
      else node.setAttribute(k, attrs[k]);
    }
    for (const c of children || []) node.appendChild(c);
    return node;
  }

  // --- A list of time ranges (shared by the weekly editor and specific dates) ---
  function rangesEditor(initial, onChange, emptyText) {
    const wrap = el('div', { class: 'ranges' });
    let ranges = (initial || []).map((r) => ({ start: r.start, end: r.end }));

    function render() {
      wrap.innerHTML = '';
      if (!ranges.length) wrap.appendChild(el('div', { class: 'off', text: emptyText }));
      ranges.forEach((r, i) => {
        const start = el('input', { type: 'time', value: r.start, step: '300' });
        const end = el('input', { type: 'time', value: r.end, step: '300' });
        start.addEventListener('change', () => { r.start = start.value; onChange(); });
        end.addEventListener('change', () => { r.end = end.value; onChange(); });
        const remove = el('button', { type: 'button', class: 'remove', title: 'Remove', text: '×', onclick: () => { ranges.splice(i, 1); render(); onChange(); } });
        wrap.appendChild(el('div', { class: 'range' }, [start, el('span', { class: 'to', text: 'to' }), end, remove]));
      });
      const last = ranges[ranges.length - 1];
      wrap.appendChild(el('button', { type: 'button', class: 'add-link', text: ranges.length ? '+ Add another range' : '+ Add hours', onclick: () => {
        ranges.push(last ? { start: last.end, end: addHour(last.end) } : { start: '09:00', end: '17:00' });
        render(); onChange();
      } }));
    }
    function addHour(hm) {
      const [h, m] = hm.split(':').map(Number);
      const t = Math.min(23 * 60 + 55, h * 60 + m + 60);
      return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
    }
    render();
    return { node: wrap, get: () => ranges.filter((r) => r.start && r.end), set: (list) => { ranges = list; render(); } };
  }

  // --- Weekly hours editor ---
  document.querySelectorAll('[data-hours-editor]').forEach((root) => {
    const hidden = root.querySelector('input[type=hidden]');
    let hours = {};
    try { hours = JSON.parse(root.dataset.hours || '{}'); } catch (e) { hours = {}; }
    const editors = {};
    const sync = () => {
      const out = {};
      DAYS.forEach(([k]) => { out[k] = editors[k].enabled.checked ? editors[k].ranges.get() : []; });
      hidden.value = JSON.stringify(out);
    };
    DAYS.forEach(([key, label]) => {
      const list = hours[key] || [];
      const enabled = el('input', { type: 'checkbox' });
      enabled.checked = list.length > 0;
      const ranges = rangesEditor(list, sync, 'Unavailable');
      enabled.addEventListener('change', () => {
        if (enabled.checked && !ranges.get().length) ranges.set([{ start: '09:00', end: '17:00' }]);
        if (!enabled.checked) ranges.set([]);
        ranges.node.classList.toggle('hidden', !enabled.checked);
        sync();
      });
      ranges.node.classList.toggle('hidden', !enabled.checked);
      const off = el('div', { class: 'off' + (enabled.checked ? ' hidden' : ''), text: 'Unavailable' });
      const row = el('div', { class: 'day' }, [
        el('label', { class: 'day-name' }, [enabled, el('span', { text: label })]),
        el('div', {}, [ranges.node, off]),
      ]);
      enabled.addEventListener('change', () => off.classList.toggle('hidden', enabled.checked));
      editors[key] = { enabled, ranges };
      root.appendChild(row);
    });
    sync();
  });

  // --- Specific dates editor ---
  document.querySelectorAll('[data-date-rules]').forEach((root) => {
    const hidden = root.querySelector('input[type=hidden]');
    let rules = [];
    try { rules = JSON.parse(root.dataset.rules || '[]'); } catch (e) { rules = []; }
    const list = el('div');
    const items = [];
    const sync = () => { hidden.value = JSON.stringify(items.map((it) => ({ date: it.date.value, windows: it.ranges.get() }))); };
    function addRule(rule) {
      const date = el('input', { type: 'date', value: rule.date || '' });
      date.addEventListener('change', sync);
      const ranges = rangesEditor(rule.windows || [], sync, 'No hours (blocked)');
      const item = { date, ranges };
      const row = el('div', { class: 'date-rule' }, [date, ranges.node, el('button', { type: 'button', class: 'remove', title: 'Remove date', text: '×', onclick: () => { items.splice(items.indexOf(item), 1); row.remove(); sync(); } })]);
      items.push(item);
      list.appendChild(row);
      sync();
    }
    rules.forEach(addRule);
    root.appendChild(list);
    root.appendChild(el('button', { type: 'button', class: 'add-link', text: '+ Add a date', onclick: () => addRule({ date: '', windows: [{ start: '09:00', end: '17:00' }] }) }));
    sync();
  });

  // --- Link form behaviour ---
  const modeRadios = document.querySelectorAll('[data-mode]');
  if (modeRadios.length) {
    const section = document.querySelector('[data-link-hours]');
    const title = document.querySelector('[data-hours-title]');
    const help = document.querySelector('[data-rules-help]');
    const update = () => {
      const mode = document.querySelector('[data-mode]:checked').value;
      section.classList.toggle('hidden', mode === 'default');
      title.textContent = mode === 'custom' ? 'Hours for this link' : 'Extra hours for this link';
      help.textContent = mode === 'custom'
        ? 'On these dates, the hours you set here replace the weekly hours above. Add a date with no hours to block it off.'
        : 'Extra hours on particular dates, added on top of everything above.';
    };
    modeRadios.forEach((r) => r.addEventListener('change', update));
  }

  const duration = document.querySelector('[data-duration]');
  if (duration) {
    const custom = document.querySelector('[data-duration-custom]');
    duration.addEventListener('change', () => custom.classList.toggle('hidden', duration.value !== 'custom'));
  }
  const location = document.querySelector('[data-location]');
  if (location) {
    const detail = document.querySelector('[data-location-detail]');
    const placeholders = { phone: 'Your phone number, or "I will call you"', in_person: 'Address', custom: 'Instructions for the guest' };
    const update = () => { detail.classList.toggle('hidden', location.value === 'meet'); detail.placeholder = placeholders[location.value] || ''; };
    location.addEventListener('change', update); update();
  }
  const slugSource = document.querySelector('[data-slug-source]');
  const slugTarget = document.querySelector('[data-slug-target]');
  if (slugSource && slugTarget) {
    let touched = slugTarget.value.length > 0;
    slugTarget.addEventListener('input', () => { touched = slugTarget.value.length > 0; });
    slugSource.addEventListener('input', () => {
      if (touched) return;
      slugTarget.value = slugSource.value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    });
  }

  // --- Copy buttons ---
  document.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(btn.dataset.copy); btn.textContent = 'Copied!'; }
      catch (e) { window.prompt('Copy this link:', btn.dataset.copy); }
      setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
    });
  });
})();
