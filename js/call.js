// ═══ ЗВОНОК (Jitsi Meet, встроенный) ═══
// Фаза 1: приватная комната на meet.jit.si, оформленная под сайт.
// Оба заходят в одну комнату по кнопке «Позвонить». TURN и надёжность — на стороне Jitsi.
(function () {
  const DOMAIN = 'meet.jit.si';
  // Длинное непубличное имя комнаты — чтобы посторонний не зашёл случайно.
  const ROOM = 'dlya-tebya-s-k-7q3z9x2m8t4v';
  const WHO_KEY = 'katya-who';

  const openBtn = document.getElementById('callBtn');
  const overlay = document.getElementById('callOverlay');
  const closeBtn = document.getElementById('callClose');
  const stage = document.getElementById('jitsi');
  const loading = document.getElementById('callLoading');
  const whoPrompt = document.getElementById('whoPrompt');
  const whoBtns = document.querySelectorAll('.who-b');

  let api = null;
  let scriptPromise = null;

  function loadApi() {
    if (window.JitsiMeetExternalAPI) return Promise.resolve();
    if (scriptPromise) return scriptPromise;
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://' + DOMAIN + '/external_api.js';
      s.async = true;
      s.onload = resolve;
      s.onerror = () => { scriptPromise = null; reject(new Error('load-failed')); };
      document.head.appendChild(s);
    });
    return scriptPromise;
  }

  function showLoading(text) {
    if (!loading) return;
    loading.style.display = 'flex';
    loading.textContent = text;
  }

  function startCall(name) {
    if (whoPrompt) whoPrompt.classList.remove('show');
    showLoading('Соединяем…');

    loadApi().then(() => {
      api = new window.JitsiMeetExternalAPI(DOMAIN, {
        roomName: ROOM,
        parentNode: stage,
        width: '100%',
        height: '100%',
        userInfo: { displayName: name },
        configOverwrite: {
          prejoinPageEnabled: false,
          disableDeepLinking: true,
          startWithAudioMuted: false,
          startWithVideoMuted: false,
          defaultLanguage: 'ru',
          disableProfile: true,
          enableClosePage: false
        },
        interfaceConfigOverwrite: {
          MOBILE_APP_PROMO: false,
          SHOW_JITSI_WATERMARK: false,
          SHOW_WATERMARK_FOR_GUESTS: false,
          DISABLE_DEEP_LINKING: true,
          TOOLBAR_BUTTONS: ['microphone', 'camera', 'hangup', 'chat', 'tileview', 'fullscreen', 'settings', 'select-background']
        }
      });

      api.addEventListener('videoConferenceJoined', () => {
        if (loading) loading.style.display = 'none';
        window.buzz && window.buzz(20);
      });
      api.addEventListener('readyToClose', endCall);
    }).catch(() => {
      showLoading('Не удалось загрузить звонок. Проверь интернет и попробуй ещё раз ♥');
    });
  }

  function beginFlow() {
    if (!overlay) return;
    overlay.classList.add('on');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    let who = null;
    try { who = localStorage.getItem(WHO_KEY); } catch (e) {}

    if (who) {
      startCall(who);
    } else if (whoPrompt) {
      if (loading) loading.style.display = 'none';
      whoPrompt.classList.add('show');
    } else {
      startCall('Гость');
    }
  }

  function endCall() {
    if (api) { try { api.dispose(); } catch (e) {} api = null; }
    if (overlay) {
      overlay.classList.remove('on');
      overlay.setAttribute('aria-hidden', 'true');
    }
    document.body.style.overflow = '';
    if (whoPrompt) whoPrompt.classList.remove('show');
    showLoading('Загружаем звонок…');
    if (loading) loading.style.display = 'flex';
  }

  openBtn && openBtn.addEventListener('click', beginFlow);
  closeBtn && closeBtn.addEventListener('click', endCall);

  whoBtns.forEach((b) => {
    b.addEventListener('click', () => {
      const name = b.dataset.who || 'Гость';
      try { localStorage.setItem(WHO_KEY, name); } catch (e) {}
      startCall(name);
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay && overlay.classList.contains('on')) endCall();
  });
})();
