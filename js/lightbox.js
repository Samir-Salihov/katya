// ═══ LIGHTBOX ═══
const gis = document.querySelectorAll('.gi');
let cur = 0;
const lb = document.getElementById('lb');
const lbc = document.getElementById('lbCnt');
gis.forEach((gi, i) => gi.addEventListener('click', () => olb(i)));
function olb(i) { cur = i; lbc.textContent = (i+1)+' / '+gis.length; lb.classList.add('on'); document.body.style.overflow = 'hidden'; }
function clb() { lb.classList.remove('on'); document.body.style.overflow = ''; }
function nlb(d) { cur = (cur+d+gis.length)%gis.length; lbc.textContent = (cur+1)+' / '+gis.length; }
if (lb) {
  lb.addEventListener('click', e => { if (e.target === lb) clb(); });
  document.addEventListener('keydown', e => {
    if (!lb.classList.contains('on')) return;
    if (e.key === 'Escape') clb();
    if (e.key === 'ArrowLeft') nlb(-1);
    if (e.key === 'ArrowRight') nlb(1);
  });
}
