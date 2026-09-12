// ═══ ИНТРО: SPLASH → КОНВЕРТ (перетягивание) → ПАРОЛЬ ═══
const PWD = '080308';
const UNLOCK_KEY = 'katya-unlocked';

(function () {
  const splash = document.getElementById('splash');
  const overlay = document.getElementById('envOverlay');
  const sideNav = document.getElementById('sideNav');
  const SPLASH_MS = 1600;

  function revealSite() {
    if (sideNav) sideNav.classList.add('show');
    document.dispatchEvent(new Event('katya:unlocked'));
  }

  function hideSplash() {
    if (!splash) return;
    splash.classList.add('gone');
    setTimeout(() => splash.remove(), 700);
  }

  // Уже разблокировали раньше — короткий splash и сразу сайт, без конверта
  const alreadyUnlocked = (() => {
    try { return localStorage.getItem(UNLOCK_KEY) === '1'; } catch (e) { return false; }
  })();

  if (alreadyUnlocked) {
    setTimeout(() => {
      hideSplash();
      if (overlay) overlay.remove();
      revealSite();
    }, SPLASH_MS);
    return;
  }

  // Первый заход: splash уходит → показываем конверт с подсказкой
  const envelope = document.getElementById('envelope');
  const envHint = document.getElementById('envHint');
  const pwdArea = document.getElementById('pwdArea');
  const stage = document.querySelector('.env-stage');
  const streamHost = document.getElementById('streamHost');
  const digits = document.querySelectorAll('.pwd-digit');
  const pwdError = document.getElementById('pwdError');
  const pwdInputs = document.getElementById('pwdInputs');

  setTimeout(() => {
    hideSplash();
    if (envHint) envHint.classList.add('show');
  }, SPLASH_MS);

  // ── Перетягивание клапана ──
  const MAX = 150;              // пикселей до полного раскрытия
  const THRESHOLD = 0.42;       // доля, после которой конверт «раскрывается сам»
  let dragging = false;
  let opened = false;
  let startY = 0;
  let moved = 0;

  let crack = 0;   // насколько раскололась печать: 0 → 1, обратно не отыгрывает

  function setOpen(v) {
    if (!envelope) return;
    envelope.style.setProperty('--open', v);

    // Сургуч ломается в первые мгновения вытягивания и уже не срастается,
    // даже если конверт отпустить — поэтому только максимум, без возврата.
    const c = Math.min(1, v * 6);
    if (c > crack) {
      if (crack === 0) window.buzz && window.buzz(14);   // щелчок скола
      crack = c;
      envelope.style.setProperty('--crack', crack);
    }

    // За 90° клапан уходит за плоскость конверта — там ему место под письмом
    envelope.classList.toggle('flap-open', v > 0.5);
  }

  function onDown(e) {
    if (opened) return;
    dragging = true;
    moved = 0;
    startY = (e.touches ? e.touches[0].clientY : e.clientY);
    envelope.classList.add('dragging');
    if (envHint) envHint.classList.remove('show');
  }

  function onMove(e) {
    if (!dragging || opened) return;
    const y = (e.touches ? e.touches[0].clientY : e.clientY);
    const dy = startY - y;              // вверх → положительно
    moved = Math.abs(dy);
    const p = Math.max(0, Math.min(1, dy / MAX));
    setOpen(p);
    if (e.cancelable) e.preventDefault();
  }

  function onUp() {
    if (!dragging || opened) return;
    dragging = false;
    envelope.classList.remove('dragging');
    const p = parseFloat(getComputedStyle(envelope).getPropertyValue('--open')) || 0;
    // короткий тап (без ощутимого движения) тоже открывает — так дружелюбнее
    if (p >= THRESHOLD || moved < 8) {
      openEnvelope();
    } else {
      setOpen(0);
      if (envHint) envHint.classList.add('show');
    }
  }

  if (envelope) {
    envelope.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    // запасной путь для очень старых браузеров без Pointer Events
    if (!window.PointerEvent) {
      envelope.addEventListener('touchstart', onDown, { passive: true });
      window.addEventListener('touchmove', onMove, { passive: false });
      window.addEventListener('touchend', onUp);
    }
  }

  // ── Открытие: конверт раскрывается, письмо уносит нас внутрь ──
  // Сцена в три такта, чтобы переход читался как один жест, а не как
  // три отдельные анимации: раскрытие → налёт камеры → коридор с паролем.
  function openEnvelope() {
    if (opened) return;
    opened = true;
    setOpen(1);
    window.buzz && window.buzz(30);
    if (envHint) envHint.classList.remove('show');

    // Такт 1 — даём клапану договорить и письму выехать.
    setTimeout(() => {
      // Такт 2 — «влетаем» в письмо: конверт разгоняется на зрителя и тает.
      if (stage) stage.classList.add('dive');
      window.buzz && window.buzz(18);

      // Коридор строим заранее, но показываем в момент, когда конверт уже
      // перекрыл кадр — переход получается без стыка.
      if (streamHost && window.katyaStream) {
        window.katyaStream.build(streamHost);
        setTimeout(() => streamHost.classList.add('on'), 260);
      }
      if (overlay) overlay.classList.add('in-stream');

      // Такт 3 — пароль поверх летящих воспоминаний.
      setTimeout(() => {
        if (stage) stage.style.display = 'none';
        if (pwdArea) {
          pwdArea.classList.add('show');
          if (digits.length) digits[0].focus();
        }
      }, 900);
    }, 900);
  }

  // ── Пароль ──
  if (digits.length) {
    digits.forEach((inp, i) => {
      inp.addEventListener('input', () => {
        inp.value = inp.value.replace(/\D/g, '');
        if (inp.value) {
          inp.classList.add('filled');
          if (i < digits.length - 1) digits[i + 1].focus();
          else checkPassword();
        }
      });
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !inp.value && i > 0) {
          digits[i - 1].focus();
          digits[i - 1].value = '';
          digits[i - 1].classList.remove('filled');
        }
      });
    });
  }

  function checkPassword() {
    const entered = Array.from(digits).map(d => d.value).join('');
    if (entered.length < 6) return;
    if (entered === PWD) {
      try { localStorage.setItem(UNLOCK_KEY, '1'); } catch (e) {}
      window.buzz && window.buzz([20, 40, 20]);
      pwdError.classList.remove('show');
      pwdArea.style.opacity = '0';
      setTimeout(() => {
        overlay.classList.add('gone');
        revealSite();
        setTimeout(() => overlay.remove(), 800);
      }, 400);
    } else {
      window.buzz && window.buzz([40, 30, 40]);
      pwdError.classList.add('show');
      pwdInputs.classList.add('pwd-shake');
      digits.forEach(d => { d.value = ''; d.classList.remove('filled'); d.style.borderColor = '#E74C3C'; });
      setTimeout(() => {
        pwdInputs.classList.remove('pwd-shake');
        digits.forEach(d => d.style.borderColor = '');
        digits[0].focus();
      }, 600);
    }
  }
})();
