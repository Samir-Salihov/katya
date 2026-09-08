// ═══ HAPTICS ═══
// Лёгкий вибро-отклик там, где поддерживается (Android/Chrome).
// iOS Safari не поддерживает navigator.vibrate — тихо игнорируем.
window.buzz = function (pattern) {
  try {
    if (window.navigator && typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern);
    }
  } catch (e) {}
};
