/**
 * UI utilities — flash messages, modal helpers, shared UI wiring.
 */
'use strict';

export function flash(msg, type = 'ok') {
  const el = document.createElement('div');
  el.className = `flash flash-${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

export function confirm(msg) {
  return window.confirm(msg);
}
