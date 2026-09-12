// ═══ КОРИДОР ВОСПОМИНАНИЙ ═══
// Два ряда карточек летят из глубины на зрителя. Перспектива делает всю
// работу: с ростом z карточка одновременно растёт и уезжает от центра,
// потому что проекция масштабирует и размер, и положение одним множителем.
//
// Три вещи задают форму, каждая лечит свой артефакт:
//  1) Глубина задана как ВИДИМЫЙ размер, геометрически — каждая карточка
//     во столько же раз больше предыдущей. Ровный шаг по z рвёт ленту
//     у ближнего края, где проекция раздувается.
//  2) Рельсы резко расходятся в начале и дальше держат (fan > 1). Это гасит
//     ещё медленный рост в глубине: лента выходит из центра плоской полосой,
//     один раз изгибается и лишь потом уходит по диагонали.
//  3) Ни один конец цикла не виден. Карточка умирает, уйдя за край, и
//     рождается ПОПЕРЁК оси (railBirth отрицательный) — новая появляется
//     с другой стороны и проходит сквозь уже закрывшие её карточки,
//     поэтому ей не нужно проявление. Иначе в центре раз в цикл мигает дыра.
//
// Все длины в cqw — процент ширины контейнера, поэтому пропорции коридора
// не зависят от размера экрана.
(function () {
  'use strict';

  var PATH = {
    perspective: 30,   // сила проекции: меньше — шире угол, резче налёт
    cardWidth: 18,
    cardHeight: 25,
    cardRadius: 0.9,   // чуть мягче исходного — под общий стиль сайта
    birthHeight: 3,    // видимая высота в точке рождения
    exitHeight: 104,   // видимая высота на выходе из кадра
    railBirth: -11,    // смещение вбок при рождении (минус — через ось)
    railExit: 46,
    fan: 3.3,          // насколько рано расходятся рельсы
    turnBirth: 6,
    turnExit: 28,
    stops: 24          // число ключевых кадров, которыми обводится кривая
  };

  // Обводим траекторию ключевыми кадрами — CSS повторит настоящую кривую.
  function keyframes(dir, name, p) {
    var steps = [];
    for (var s = 0; s <= p.stops; s++) {
      var u = s / p.stops;
      // Геометрия по видимому размеру: соседние карточки держат постоянное
      // отношение, лента остаётся сплошной на обоих концах.
      var scale = (p.birthHeight / p.cardHeight) *
                  Math.pow(p.exitHeight / p.birthHeight, u);
      var z = p.perspective * (1 - 1 / scale);
      var rail = p.railExit - (p.railExit - p.railBirth) * Math.pow(1 - u, p.fan);
      var turn = p.turnBirth + (p.turnExit - p.turnBirth) * u;
      steps.push((u * 100).toFixed(2) + '%{transform:translate3d(' +
        (dir * rail).toFixed(2) + 'cqw,0,' + z.toFixed(2) + 'cqw) rotateY(' +
        (-dir * turn).toFixed(2) + 'deg)}');
    }
    return '@keyframes ' + name + '{' + steps.join('') + '}';
  }

  // Пока настоящих фото нет — блоки-заглушки в закатных тонах.
  // Как появятся файлы, достаточно заполнить IMAGES путями.
  var IMAGES = [];
  var FALLBACK = [
    'linear-gradient(145deg,#FF6B6B,#7A3B5C)',
    'linear-gradient(145deg,#FFC24A,#FF6B6B)',
    'linear-gradient(145deg,#FF9E6D,#A84A5A)',
    'linear-gradient(145deg,#FFD3C2,#FF9E6D)',
    'linear-gradient(145deg,#7A3B5C,#2E1526)',
    'linear-gradient(145deg,#FF6B6B,#FFC24A)',
    'linear-gradient(145deg,#C4707E,#3A1F42)',
    'linear-gradient(145deg,#FFB07C,#C25E5E)',
    'linear-gradient(145deg,#5C2A47,#FF9E6D)'
  ];

  var CARDS = 11;    // карточек на каждом рельсе одновременно
  var SPEED = 18;    // секунд на весь путь коридора
  var AXIS = 50;     // высота оси коридора, % от высоты контейнера

  function build(host) {
    if (!host || host.dataset.built === '1') return;
    host.dataset.built = '1';

    var uid = 'ks' + Math.random().toString(36).slice(2, 8);
    var right = uid + 'r', left = uid + 'l';

    var style = document.createElement('style');
    style.textContent = keyframes(1, right, PATH) + keyframes(-1, left, PATH) +
      // Пауза, а не отключение: каждая карточка уже брошена в середину пути
      // отрицательной задержкой, поэтому замирает готовым кадром,
      // а не схлопывается на оси.
      '@media(prefers-reduced-motion:reduce){.ks-card{animation-play-state:paused}}';
    host.appendChild(style);

    var stage = document.createElement('div');
    stage.className = 'ks-stage';
    stage.setAttribute('aria-hidden', 'true');
    stage.style.perspective = PATH.perspective + 'cqw';
    stage.style.perspectiveOrigin = '50% ' + AXIS + '%';

    var world = document.createElement('div');
    world.className = 'ks-world';

    [right, left].forEach(function (name) {
      for (var i = 0; i < CARDS; i++) {
        var card = document.createElement('div');
        card.className = 'ks-card';
        card.style.top = AXIS + '%';
        card.style.width = PATH.cardWidth + 'cqw';
        card.style.height = PATH.cardHeight + 'cqw';
        card.style.marginLeft = (-PATH.cardWidth / 2) + 'cqw';
        card.style.marginTop = (-PATH.cardHeight / 2) + 'cqw';
        card.style.borderRadius = PATH.cardRadius + 'cqw';
        card.style.animation = name + ' ' + SPEED + 's linear infinite';
        // Отрицательная задержка бросает карточку в середину пути —
        // коридор заполнен уже на первом кадре.
        card.style.animationDelay = (-(i * SPEED) / CARDS) + 's';

        var src = IMAGES.length ? IMAGES[i % IMAGES.length] : null;
        if (src) {
          var img = document.createElement('img');
          img.src = src;
          img.alt = '';
          img.loading = 'lazy';
          img.decoding = 'async';
          img.draggable = false;
          card.appendChild(img);
        } else {
          card.style.background = FALLBACK[i % FALLBACK.length];
        }
        world.appendChild(card);
      }
    });

    stage.appendChild(world);
    host.appendChild(stage);
  }

  window.katyaStream = { build: build };
})();
