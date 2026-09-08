// ═══ CURSOR HEARTS ═══
let lht = 0;
document.addEventListener('mousemove', e => {
  const now = Date.now();
  if (now-lht < 200 || Math.random() > 0.3) return;
  lht = now;
  const h = document.createElement('div');
  h.className = 'ch';
  h.textContent = '♡';
  h.style.left = e.clientX+'px';
  h.style.top = e.clientY+'px';
  h.style.setProperty('--dx', (Math.random()-0.5)*40+'px');
  h.style.color = Math.random()>0.5?'var(--rose)':'var(--blush)';
  document.body.appendChild(h);
  setTimeout(() => h.remove(), 1200);
});
