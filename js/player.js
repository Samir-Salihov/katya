// ═══ MUSIC PLAYER ═══
const playlist = [
  { title: 'Карма', artist: 'Егор Крид', file: 'audio/01-karma.mp3' },
  { title: 'Я люблю тебя одну', artist: 'Rauf', file: 'audio/02-ya-lyublyu.mp3' },
  { title: 'Не по пути', artist: 'Pharaoh', file: 'audio/03-ne-po-puti.mp3' },
  { title: 'Him & I', artist: 'G-Eazy, Halsey', file: 'audio/04-him-and-i.mp3' },
  { title: 'Стань', artist: 'Макс Корж', file: 'audio/05-stan.mp3' },
  { title: 'Say Yes to Heaven', artist: 'Lana Del Rey', file: 'audio/06-say-yes.mp3' },
  { title: 'I Know', artist: 'Irma', file: 'audio/07-i-know.mp3' },
  { title: 'Shape of My Heart', artist: 'Sting', file: 'audio/08-shape.mp3' },
];

let currentTrack = 0;
let isPlaying = false;
const audio = new Audio();
audio.volume = 0.4;

audio.addEventListener('ended', () => nextTrack());
audio.addEventListener('error', () => {
  document.getElementById('pSong').textContent = playlist[currentTrack].title;
  document.getElementById('pArtist').textContent = playlist[currentTrack].artist + ' (добавь MP3)';
});

function updateUI() {
  const t = playlist[currentTrack];
  document.getElementById('pSong').textContent = t.title;
  document.getElementById('pArtist').textContent = t.artist;
  const icon = document.getElementById('playIcon');
  if (isPlaying) {
    icon.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
    document.getElementById('pBars').classList.remove('paused');
  } else {
    icon.innerHTML = '<polygon points="6,3 20,12 6,21"/>';
    document.getElementById('pBars').classList.add('paused');
  }
}

function togglePlay() {
  if (isPlaying) {
    audio.pause();
    isPlaying = false;
  } else {
    audio.src = playlist[currentTrack].file;
    audio.play().catch(() => {});
    isPlaying = true;
  }
  updateUI();
}

function nextTrack() {
  currentTrack = (currentTrack + 1) % playlist.length;
  if (isPlaying) {
    audio.src = playlist[currentTrack].file;
    audio.play().catch(() => {});
  }
  updateUI();
}

function prevTrack() {
  currentTrack = (currentTrack - 1 + playlist.length) % playlist.length;
  if (isPlaying) {
    audio.src = playlist[currentTrack].file;
    audio.play().catch(() => {});
  }
  updateUI();
}
