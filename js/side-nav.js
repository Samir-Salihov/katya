// ═══ SIDE NAV ═══
const navDots = document.querySelectorAll('.nav-dot');
const navSections = [];
navDots.forEach(dot => {
  const id = dot.dataset.target;
  const el = document.getElementById(id);
  if (el) navSections.push({ dot, el });
  dot.addEventListener('click', () => {
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  });
});

function updateNav() {
  const scrollY = window.scrollY + window.innerHeight / 3;
  let active = navSections[0];
  for (const s of navSections) {
    if (s.el.offsetTop <= scrollY) active = s;
  }
  navDots.forEach(d => d.classList.remove('active'));
  if (active) active.dot.classList.add('active');
}

window.addEventListener('scroll', updateNav, { passive: true });
updateNav();
