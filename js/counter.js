// ═══ COUNTER ═══
const sd = new Date('2024-01-15');
function uc() {
  const d = Date.now()-sd;
  document.getElementById('cD').textContent = Math.floor(d/864e5);
  document.getElementById('cH').textContent = String(Math.floor((d%864e5)/36e5)).padStart(2,'0');
  document.getElementById('cM').textContent = String(Math.floor((d%36e5)/6e4)).padStart(2,'0');
  document.getElementById('cS').textContent = String(Math.floor((d%6e4)/1e3)).padStart(2,'0');
}
uc(); setInterval(uc, 1000);
