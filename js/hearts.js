// ═══ HEARTS GAME ═══
let hc = 0;
const hnum = document.getElementById('hnum');
const hbtn = document.getElementById('hbtn');
const hcanvas = document.getElementById('hcanvas');
const hemoji = ['♥','❤','💕','💗','💖','💘','♡'];
if (hbtn && hnum && hcanvas) {
  hbtn.addEventListener('click', () => {
    hc++;
    hnum.textContent = hc;
    window.buzz && window.buzz(12);
    hnum.style.transform = 'scale(1.15)';
    setTimeout(() => hnum.style.transform = 'scale(1)', 150);
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        const h = document.createElement('div');
        h.className = 'tap-h';
        h.textContent = hemoji[Math.floor(Math.random()*hemoji.length)];
        const r = hbtn.getBoundingClientRect();
        const s = hcanvas.getBoundingClientRect();
        h.style.left = (r.left-s.left+r.width/2+(Math.random()-0.5)*80)+'px';
        h.style.top = (r.top-s.top)+'px';
        h.style.fontSize = (1+Math.random())+'rem';
        hcanvas.appendChild(h);
        setTimeout(() => h.remove(), 1400);
      }, i*100);
    }
  });
}
