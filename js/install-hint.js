// ═══ INSTALL HINT: подсказка «добавить на экран Домой» ═══
(function () {
  const DISMISS_KEY = 'katya-install-dismissed';
  const hint = document.getElementById('installHint');
  const btn = document.getElementById('installBtn');
  const closeBtn = document.getElementById('installClose');
  const textEl = document.getElementById('installText');
  if (!hint) return;

  // Уже установлено (запущено с экрана Домой) — ничего не показываем
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
  if (isStandalone) return;

  // Пользователь уже закрывал подсказку
  try { if (localStorage.getItem(DISMISS_KEY) === '1') return; } catch (e) {}

  const ua = navigator.userAgent || '';
  const isIOS = /iphone|ipad|ipod/i.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  let deferredPrompt = null;

  function dismiss() {
    hint.classList.remove('show');
    hint.setAttribute('aria-hidden', 'true');
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch (e) {}
  }

  function show() {
    hint.classList.add('show');
    hint.setAttribute('aria-hidden', 'false');
  }

  closeBtn && closeBtn.addEventListener('click', dismiss);

  // Android / Chrome / Edge: есть нативное приглашение установки
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (textEl) textEl.textContent = 'Открывать как приложение, даже без сети';
    if (btn) btn.style.display = '';
    afterUnlock(show);
  });

  window.addEventListener('appinstalled', dismiss);

  if (btn) {
    btn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      try { await deferredPrompt.userChoice; } catch (e) {}
      deferredPrompt = null;
      dismiss();
    });
  }

  // iOS Safari: нет beforeinstallprompt — показываем инструкцию
  if (isIOS && !window.navigator.standalone) {
    if (btn) btn.style.display = 'none';
    if (textEl) textEl.innerHTML = 'Нажми «Поделиться» и выбери «На экран «Домой»';
    afterUnlock(() => setTimeout(show, 800));
  }

  // Показываем подсказку только после того, как открыли сайт (не поверх конверта)
  function afterUnlock(fn) {
    if (window.__katyaUnlocked) { fn(); return; }
    document.addEventListener('katya:unlocked', () => fn(), { once: true });
  }
})();

// отмечаем факт разблокировки, чтобы подсказка сработала даже если событие было раньше
document.addEventListener('katya:unlocked', () => { window.__katyaUnlocked = true; }, { once: true });
