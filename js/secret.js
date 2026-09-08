// ═══ SECRET ═══
function openSecret() {
  document.getElementById('secretClosed').style.display = 'none';
  const o = document.getElementById('secretOpen');
  o.classList.add('show');
}
function closeSecret() {
  document.getElementById('secretClosed').style.display = '';
  document.getElementById('secretOpen').classList.remove('show');
}
