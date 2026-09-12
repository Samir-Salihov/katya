// ═══ МАСКИ И ФИЛЬТРЫ ═══
// Обрабатываем свой кадр и отдаём наружу новую видеодорожку: собеседник
// видит ровно то же, что и мы. Поэтому эффект живёт не в CSS, а в canvas —
// из CSS в поток ничего не попадает.
//
// Три вида эффектов, и они принципиально разной цены:
//   ФИЛЬТР — только canvas, ноль зависимостей, работает и без интернета;
//   ФОН    — нужна модель сегментации (~250 КБ) и wasm (~3 МБ);
//   МАСКА  — нужна модель лицевых точек (~3.6 МБ).
//
// Модели тянутся с CDN по первому включению и остаются в памяти вкладки.
// В репозиторий они не кладутся сознательно: это 7 МБ, которые нужны
// нескольким кнопкам. Плата за решение — без интернета доступны только
// фильтры, остальные кнопки гаснут. Так и задумано.
(function () {
  'use strict';

  var CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1';
  var WASM = CDN + '/wasm';
  var SEG_MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/' +
    'selfie_segmenter/float16/latest/selfie_segmenter.tflite';
  var FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/' +
    'face_landmarker/float16/latest/face_landmarker.task';

  var OUT_W = 1280, OUT_H = 720;

  // ─────────────────────────────────────────────────────────────
  // КАТАЛОГ ЭФФЕКТОВ
  // ─────────────────────────────────────────────────────────────
  // Фильтры — просто краска поверх кадра. Палитра та же, что у сайта.
  var FILTERS = [
    { id: 'sunset', name: 'Закат', css: 'saturate(1.25) contrast(1.05)', wash: 'rgba(255,140,90,0.20)' },
    { id: 'film',   name: 'Плёнка', css: 'sepia(0.45) contrast(1.12) brightness(1.03)', wash: 'rgba(255,196,150,0.10)' },
    { id: 'night',  name: 'Ночь',  css: 'brightness(0.85) saturate(0.85)', wash: 'rgba(60,40,110,0.30)' },
    { id: 'mono',   name: 'Ч/б',   css: 'grayscale(1) contrast(1.1)', wash: null }
  ];

  // Маски рисуются эмодзи: ни одного файла, и стиль тот же, что у стикеров.
  var MASKS = [
    { id: 'crown',  name: 'Корона',  emoji: '👑', anchor: 'above', scale: 1.05 },
    { id: 'ears',   name: 'Ушки',    emoji: '🐰', anchor: 'above', scale: 1.25 },
    { id: 'shades', name: 'Очки',    emoji: '🕶️', anchor: 'eyes', scale: 1.15 },
    { id: 'love',   name: 'Влюблён', anchor: 'iris', scale: 1 },
    { id: 'flower', name: 'Венок',   emoji: '🌸', anchor: 'above', scale: 0.95 }
  ];

  var BACKS = [
    { id: 'blur',   name: 'Размытие' },
    { id: 'sunset', name: 'Закат',  grad: ['#FF9A6B', '#8C2F4E', '#180F2E'] },
    { id: 'stars',  name: 'Звёзды', grad: ['#221540', '#0B0718'], stars: true }
  ];

  // ─────────────────────────────────────────────────────────────
  // ЗАГРУЗКА МОДЕЛЕЙ
  // ─────────────────────────────────────────────────────────────
  var vision = null, segmenter = null, faceLm = null;
  var loading = {};

  function loadVision() {
    if (vision) return Promise.resolve(vision);
    if (loading.vision) return loading.vision;
    loading.vision = import(CDN + '/vision_bundle.mjs').then(function (m) {
      return m.FilesetResolver.forVisionTasks(WASM).then(function (f) {
        vision = { mod: m, fileset: f };
        return vision;
      });
    }).catch(function (e) {
      loading.vision = null;
      throw e;
    });
    return loading.vision;
  }

  function loadSegmenter() {
    if (segmenter) return Promise.resolve(segmenter);
    if (loading.seg) return loading.seg;
    loading.seg = loadVision().then(function (v) {
      return v.mod.ImageSegmenter.createFromOptions(v.fileset, {
        baseOptions: { modelAssetPath: SEG_MODEL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        outputCategoryMask: true,
        outputConfidenceMasks: false
      });
    }).then(function (s) { segmenter = s; return s; })
      .catch(function (e) { loading.seg = null; throw e; });
    return loading.seg;
  }

  function loadFace() {
    if (faceLm) return Promise.resolve(faceLm);
    if (loading.face) return loading.face;
    loading.face = loadVision().then(function (v) {
      return v.mod.FaceLandmarker.createFromOptions(v.fileset, {
        baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numFaces: 1
      });
    }).then(function (f) { faceLm = f; return f; })
      .catch(function (e) { loading.face = null; throw e; });
    return loading.face;
  }

  // ─────────────────────────────────────────────────────────────
  // КОНВЕЙЕР
  // ─────────────────────────────────────────────────────────────
  var src = null;        // <video> с сырым кадром камеры
  var out = null;        // canvas, который уходит в поток
  var ctx = null;
  var cut = null, cutCtx = null;      // силуэт человека
  var maskCv = null, maskCtx = null;  // маска сегментации как альфа
  var stream = null;
  var raf = null, useVFC = false;
  var effect = { filter: null, back: null, face: null };
  var lastFace = null;   // последние точки лица: между кадрами ML не гоняем
  var faceTick = 0;

  function ready() { return !!(src && src.videoWidth); }

  function draw() {
    if (!ready()) return schedule();
    var vw = src.videoWidth, vh = src.videoHeight;

    // Кадр вписываем «по покрытию»: пропорции камеры и холста могут
    // не совпадать, а чёрные поля в звонке выглядят поломкой.
    var s = Math.max(OUT_W / vw, OUT_H / vh);
    var dw = vw * s, dh = vh * s;
    var dx = (OUT_W - dw) / 2, dy = (OUT_H - dh) / 2;

    var back = effect.back && BACKS.filter(function (b) { return b.id === effect.back; })[0];
    var filt = effect.filter && FILTERS.filter(function (f) { return f.id === effect.filter; })[0];

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, OUT_W, OUT_H);

    if (back && segmenter) {
      drawBackground(back, dx, dy, dw, dh);
    } else {
      ctx.filter = filt ? filt.css : 'none';
      ctx.drawImage(src, dx, dy, dw, dh);
      ctx.filter = 'none';
    }

    if (filt && filt.wash) {
      ctx.fillStyle = filt.wash;
      ctx.fillRect(0, 0, OUT_W, OUT_H);
    }

    if (effect.face && faceLm) drawFace(dx, dy, dw, dh, vw, vh);

    schedule();
  }

  // ── фон: размытие или картинка ──
  function drawBackground(back, dx, dy, dw, dh) {
    var mask = null;
    try {
      var res = segmenter.segmentForVideo(src, performance.now());
      mask = res && res.categoryMask;
    } catch (e) {}

    // Фон
    if (back.id === 'blur') {
      ctx.filter = 'blur(14px) brightness(0.92)';
      ctx.drawImage(src, dx, dy, dw, dh);
      ctx.filter = 'none';
    } else {
      var g = ctx.createLinearGradient(0, 0, 0, OUT_H);
      back.grad.forEach(function (c, i) { g.addColorStop(i / (back.grad.length - 1), c); });
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, OUT_W, OUT_H);
      if (back.stars) drawStars();
    }

    if (!mask) {   // модель промолчала — лучше показать себя, чем пустой фон
      ctx.drawImage(src, dx, dy, dw, dh);
      return;
    }

    // Маску переводим в альфу и ею вырезаем человека из чёткого кадра.
    var mw = mask.width, mh = mask.height;
    var data = mask.getAsUint8Array();
    if (!maskCv || maskCv.width !== mw || maskCv.height !== mh) {
      maskCv = document.createElement('canvas');
      maskCv.width = mw; maskCv.height = mh;
      maskCtx = maskCv.getContext('2d', { willReadFrequently: true });
    }
    var img = maskCtx.createImageData(mw, mh);
    var px = img.data;
    for (var i = 0, j = 0; i < data.length; i++, j += 4) {
      // 0 — человек, остальное фон: у селфи-сегментера нулевая категория наша.
      px[j + 3] = data[i] === 0 ? 255 : 0;
    }
    maskCtx.putImageData(img, 0, 0);
    try { mask.close(); } catch (e) {}

    if (!cut || cut.width !== OUT_W) {
      cut = document.createElement('canvas');
      cut.width = OUT_W; cut.height = OUT_H;
      cutCtx = cut.getContext('2d');
    }
    cutCtx.setTransform(1, 0, 0, 1, 0, 0);
    cutCtx.clearRect(0, 0, OUT_W, OUT_H);
    cutCtx.drawImage(src, dx, dy, dw, dh);
    cutCtx.globalCompositeOperation = 'destination-in';
    cutCtx.imageSmoothingEnabled = true;
    cutCtx.drawImage(maskCv, dx, dy, dw, dh);
    cutCtx.globalCompositeOperation = 'source-over';

    ctx.drawImage(cut, 0, 0);
  }

  var starField = null;
  function drawStars() {
    if (!starField) {
      starField = [];
      for (var i = 0; i < 90; i++) {
        starField.push({
          x: Math.random() * OUT_W, y: Math.random() * OUT_H * 0.8,
          r: 0.6 + Math.random() * 1.6, p: Math.random() * 6.28
        });
      }
    }
    var t = performance.now() / 900;
    ctx.fillStyle = '#FFE9D6';
    starField.forEach(function (s) {
      ctx.globalAlpha = 0.25 + 0.55 * Math.abs(Math.sin(t + s.p));
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, 6.283);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  // ── маски на лицо ──
  function drawFace(dx, dy, dw, dh, vw, vh) {
    // Точки ищем не каждый кадр: модель дорогая, а лицо за 50 мс далеко
    // не уезжает. Между замерами рисуем по последним координатам.
    var now = performance.now();
    if (now - faceTick > 55) {
      faceTick = now;
      try {
        var r = faceLm.detectForVideo(src, now);
        lastFace = (r && r.faceLandmarks && r.faceLandmarks[0]) || null;
      } catch (e) {}
    }
    if (!lastFace) return;

    var m = MASKS.filter(function (x) { return x.id === effect.face; })[0];
    if (!m) return;

    // Нормированные координаты модели → пиксели холста.
    function P(i) {
      var p = lastFace[i];
      return { x: dx + p.x * dw, y: dy + p.y * dh };
    }

    var le = P(33), re = P(263);          // внешние углы глаз
    var top = P(10), chin = P(152);       // лоб и подбородок
    var eyeW = Math.hypot(re.x - le.x, re.y - le.y);
    var ang = Math.atan2(re.y - le.y, re.x - le.x);
    var faceH = Math.hypot(chin.x - top.x, chin.y - top.y);

    ctx.save();

    if (m.anchor === 'iris') {
      // Сердечки в глазах: радужка есть в модели (точки 468 и 473).
      var irises = [468, 473];
      var size = eyeW * 0.30 * m.scale;
      var pulse = 1 + 0.12 * Math.sin(now / 220);
      ctx.font = Math.round(size * pulse) + 'px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      irises.forEach(function (i) {
        if (!lastFace[i]) return;
        var p = P(i);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(ang);
        ctx.fillText('❤️', 0, 0);
        ctx.restore();
      });
    } else if (m.anchor === 'eyes') {
      var w = eyeW * 1.9 * m.scale;
      var cx = (le.x + re.x) / 2, cy = (le.y + re.y) / 2;
      ctx.translate(cx, cy);
      ctx.rotate(ang);
      ctx.font = Math.round(w) + 'px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(m.emoji, 0, 0);
    } else {
      // Над головой: отступаем вверх по оси лица, а не по экрану, —
      // иначе при наклоне головы корона остаётся висеть прямо.
      var w2 = eyeW * 2.3 * m.scale;
      var up = faceH * 0.42;
      var cx2 = top.x - Math.sin(ang) * -up;
      var cy2 = top.y - Math.cos(ang) * up;
      ctx.translate(cx2, cy2);
      ctx.rotate(ang);
      ctx.font = Math.round(w2) + 'px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(m.emoji, 0, 0);
    }

    ctx.restore();
  }

  function schedule() {
    if (!stream) return;
    if (useVFC) raf = src.requestVideoFrameCallback(draw);
    else raf = requestAnimationFrame(draw);
  }

  // ─────────────────────────────────────────────────────────────
  // НАРУЖУ
  // ─────────────────────────────────────────────────────────────
  function start(input) {
    // Повторный вызов — это смена источника (перевернули камеру).
    // Конвейер при этом не пересобираем: дорожка наружу должна остаться той же,
    // иначе у собеседника моргнёт картинка.
    if (stream) {
      if (src && input) { src.srcObject = input; src.play().catch(function () {}); }
      return Promise.resolve(stream);
    }

    src = document.createElement('video');
    src.muted = true;
    src.playsInline = true;
    src.srcObject = input;

    out = document.createElement('canvas');
    out.width = OUT_W; out.height = OUT_H;
    ctx = out.getContext('2d');

    return src.play().then(function () {
      useVFC = typeof src.requestVideoFrameCallback === 'function';
      stream = out.captureStream(30);
      schedule();
      return stream;
    });
  }

  function stop() {
    if (raf) {
      if (useVFC && src && src.cancelVideoFrameCallback) src.cancelVideoFrameCallback(raf);
      else cancelAnimationFrame(raf);
      raf = null;
    }
    if (stream) {
      stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null;
    }
    if (src) { src.srcObject = null; src = null; }
    out = ctx = cut = cutCtx = maskCv = maskCtx = null;
    lastFace = null;
    effect = { filter: null, back: null, face: null };
  }

  // Включить эффект. Возвращает обещание: модель может ещё качаться.
  function set(kind, id) {
    if (kind === 'filter') { effect.filter = id; return Promise.resolve(true); }
    if (kind === 'back') {
      if (!id) { effect.back = null; return Promise.resolve(true); }
      return loadSegmenter().then(function () { effect.back = id; return true; })
        .catch(function () { return false; });
    }
    if (kind === 'face') {
      if (!id) { effect.face = null; return Promise.resolve(true); }
      return loadFace().then(function () { effect.face = id; return true; })
        .catch(function () { return false; });
    }
    return Promise.resolve(false);
  }

  function anyOn() { return !!(effect.filter || effect.back || effect.face); }

  window.katyaMask = {
    FILTERS: FILTERS,
    MASKS: MASKS,
    BACKS: BACKS,
    start: start,
    stop: stop,
    set: set,
    current: function () { return { filter: effect.filter, back: effect.back, face: effect.face }; },
    anyOn: anyOn,
    // Тяжёлое уже в памяти? Нужно, чтобы не обещать мгновенного включения.
    loaded: function () { return { seg: !!segmenter, face: !!faceLm }; }
  };
})();
