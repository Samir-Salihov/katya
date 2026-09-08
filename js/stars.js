// ═══ STARRY SKY ═══
const starsCanvas = document.getElementById('starsCanvas');
if (starsCanvas) {
  const sizes = ['sm','md','lg'];
  for (let i = 0; i < 160; i++) {
    const s = document.createElement('div');
    const size = sizes[Math.random() < 0.6 ? 0 : Math.random() < 0.8 ? 1 : 2];
    s.className = 'star ' + size;
    if (Math.random() > 0.5) {
      s.classList.add('twinkle');
      s.style.setProperty('--dur', (2 + Math.random() * 4) + 's');
      s.style.setProperty('--base', (0.2 + Math.random() * 0.4).toString());
      s.style.animationDelay = (Math.random() * 5) + 's';
    }
    s.style.left = Math.random() * 100 + '%';
    s.style.top = Math.random() * 100 + '%';
    starsCanvas.appendChild(s);
  }

  const shootingStar = () => {
    const ss = document.createElement('div');
    ss.className = 'shooting-star';
    ss.style.left = (10 + Math.random() * 60) + '%';
    ss.style.top = (5 + Math.random() * 40) + '%';
    starsCanvas.appendChild(ss);
    requestAnimationFrame(() => ss.classList.add('fly'));
    setTimeout(() => ss.remove(), 1300);
  };
  setInterval(shootingStar, 4000 + Math.random() * 3000);
  setTimeout(shootingStar, 2000);
}
