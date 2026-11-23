// Small UI helpers: DOM builder, toasts, modals.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function toast(msg, type = '') {
  const el = h('div', { class: `toast ${type}` }, msg);
  $('#toasts').append(el);
  setTimeout(() => el.remove(), type === 'error' ? 5000 : 2600);
}

export function openModal(content, { dismissable = true } = {}) {
  const back = $('#modal');
  const body = $('#modalBody');
  body.innerHTML = '';
  if (typeof content === 'string') body.innerHTML = content;
  else body.append(content);
  back.classList.remove('hidden');
  back.onclick = (e) => { if (dismissable && e.target === back) closeModal(); };
  return body;
}
export function closeModal() {
  $('#modal').classList.add('hidden');
  $('#modalBody').innerHTML = '';
}

export function confirmDialog(title, message, okLabel = 'OK') {
  return new Promise((resolve) => {
    const body = openModal(
      h('div', {},
        h('h2', {}, title),
        h('p', { class: 'muted' }, message),
        h('div', { class: 'actions' },
          h('button', { class: 'btn', onclick: () => { closeModal(); resolve(false); } }, 'Cancel'),
          h('button', { class: 'btn accent', onclick: () => { closeModal(); resolve(true); } }, okLabel)
        )
      )
    );
    body.querySelector('.accent').focus();
  });
}

export function pickFiles(accept, multiple = true) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, multiple });
    input.onchange = () => resolve([...input.files]);
    input.click();
  });
}

export function download(blob, filename) {
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
