// ═══ SAMIR LETTER ═══
function openSamirLetter() {
  document.getElementById('slClosed').style.display = 'none';
  document.getElementById('slParchment').classList.add('show');
  document.getElementById('slClose').style.display = '';
}
function closeSamirLetter() {
  document.getElementById('slClosed').style.display = '';
  document.getElementById('slParchment').classList.remove('show');
  document.getElementById('slClose').style.display = 'none';
}
