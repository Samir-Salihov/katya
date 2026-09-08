// ═══ REVEAL ON SCROLL ═══
const obs = new IntersectionObserver(es => {
  es.forEach(e => { if (e.isIntersecting) e.target.classList.add('vis'); });
}, { threshold: 0.12, rootMargin: '0px 0px -30px 0px' });
document.querySelectorAll('.rv,.tli').forEach(el => obs.observe(el));

const lobs = new IntersectionObserver(es => {
  es.forEach(e => {
    if (e.isIntersecting) e.target.querySelectorAll('p').forEach((p, i) => setTimeout(() => p.classList.add('vis'), i * 300));
  });
}, { threshold: 0.3 });
document.querySelectorAll('.letter').forEach(el => lobs.observe(el));
