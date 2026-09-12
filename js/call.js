// ═══ ЗВОНОК ═══
// Экран звонка целиком свой: ни одного чужого элемента управления.
// Логика разделена на два слоя:
//   TRANSPORT — кто везёт медиа (Trystero: P2P через публичные Nostr-релеи);
//   UI        — состояния экрана, кнопки, таймер, звук.
// Менять сервис = переписать только TRANSPORT.
(function () {
  'use strict';

  var WHO_KEY = 'katya-who';
  var TOTAL_KEY = 'katya-call-total';   // сколько всего наговорили, секунд
  var LOG_KEY = 'katya-call-log';       // история звонков

  function load(key, def) {
    try { var v = localStorage.getItem(key); return v === null ? def : v; }
    catch (e) { return def; }
  }
  function save(key, val) {
    try { localStorage.setItem(key, val); } catch (e) {}
  }

  // ─────────────────────────────────────────────────────────────
  // TRANSPORT — единственное место, которое знает про медиасервис.
  // Trystero: бессерверный WebRTC. Знакомство браузеров (обмен SDP) едет
  // через публичные Nostr-релеи, а дальше видео идёт напрямую, мимо чужих
  // серверов. Ни аккаунта, ни ключа, ни карты — за это он и выбран взамен
  // Daily, который теперь требует привязать карту.
  //
  // Комната открывается сразу после разблокировки сайта и держится открытой
  // всё время, пока открыта страница, — но почти всегда пустая: по ней ходят
  // только короткие сообщения. Камера включается на время разговора и гаснет
  // сразу после. Из этого получаются две вещи, которых иначе быть не может:
  // видно, что второй сейчас на сайте, и ему можно позвонить по-настоящему,
  // с гудком на той стороне.
  //
  // Комната своя: ROOM_ID задаёт пространство, PASSWORD шифрует сигналинг,
  // поэтому релей не видит содержимого, а посторонний не войдёт, даже
  // случайно угадав имя комнаты.
  // Менять сервис = переписать только этот объект.
  // ─────────────────────────────────────────────────────────────
  var APP_ID = 'katera-49ad0271';
  var ROOM_ID = 'katera-a9eb7b98bf3d3e22';
  var PASSWORD = 'xDF3HSXNePB2fp5UjZLsK2QCkLqGzurM';

  // Библиотека лежит своя, в репозитории: звонок не должен зависеть от
  // чужого CDN. Путь считаем от страницы, а не от скрипта — так одинаково
  // работает и с корня сайта, и из установленного PWA.
  var LIB_URL = new URL('js/vendor/trystero.mjs', document.baseURI).href;

  // ── Что просим у камеры и микрофона ──
  // Просим 1080p: на новых айфонах она есть, а если камера столько не умеет,
  // браузер сам отдаст что может — ideal не отказ, а пожелание.
  function videoFor(facing) {
    return {
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30 },
      facingMode: facing
    };
  }

  // Речевой режим: эхоподавление и шумодав вычищают всё, что не похоже
  // на голос. Для разговора это правильно — и ровно поэтому музыка,
  // гитара и пение через него не проходят.
  var SPEECH = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  // Музыкальный: обработку снимаем целиком. Моно — стерео вдвое дороже
  // по трафику, а разницы на телефоне в кармане не слышно.
  var MUSIC = {
    echoCancellation: false, noiseSuppression: false, autoGainControl: false,
    channelCount: 1, sampleRate: 48000
  };

  function audioFor(music) { return music ? MUSIC : SPEECH; }

  function mediaFor(facing, music) {
    return { audio: audioFor(music), video: videoFor(facing) };
  }

  // ── Ступени качества ──
  // Роняем разрешение, а не частоту кадров: дёрганое лицо читается хуже,
  // чем мягкое. За это же отвечает degradationPreference ниже.
  var TIERS = [
    { video: 2500000, scale: 1,   name: 'полное' },
    { video: 1100000, scale: 1.6, name: 'среднее' },
    { video: 500000,  scale: 2.5, name: 'экономное' }
  ];
  var AUDIO_BPS = { speech: 40000, music: 128000 };

  var Transport = {
    room: null,
    local: null,          // свой поток — только на время разговора
    sharing: false,       // отдаём ли поток в комнату прямо сейчас
    myName: null,         // кем представляемся второму
    facing: 'user',       // какая камера снимает
    music: false,         // музыкальный режим микрофона
    camTrack: null,       // настоящая дорожка камеры, пока поверх неё эффект
    tier: 0,              // ступень качества: 0 — полное, дальше экономнее
    peers: [],            // кто сейчас в комнате, кроме нас
    partner: null,        // с кем именно идёт этот звонок
    names: {},            // id пира → его имя

    // ── события наружу ──
    onPeerHere: null,     // (name, id) второй появился в комнате или вернулся
    onPeerGone: null,     // (id) второй закрыл страницу или пропал из сети
    onRemote: null,       // (MediaStream) — видео собеседника
    onRemoteAudio: null,  // (MediaStream) — звук отдельно: так надо для iOS
    onRing: null,         // (name) нам звонят
    onRingCancel: null,   // () передумали звонить
    onAnswer: null,       // (ok) ответ на наш звонок: взяли трубку или нет
    onBye: null,          // () собеседник положил трубку
    onHeart: null,        // ({x,y}) сердечко от собеседника
    onShot: null,         // () собеседник сохранил кадр
    onSticker: null,      // ({emoji,x,y,sticky}) стикер от собеседника
    onFail: null,

    _lib: null,
    _acts: null,
    _joining: null,

    _loadLib: function () {
      if (Transport._lib) return Transport._lib;
      // Динамический import() внутри обычного скрипта: модулем становится
      // только сама библиотека. Общая глобальная область и inline-обработчики
      // в разметке не трогаются.
      Transport._lib = import(LIB_URL).catch(function (e) {
        Transport._lib = null;   // дать следующей попытке шанс
        throw e;
      });
      return Transport._lib;
    },

    // Собеседник шлёт один поток. Видео и звук разводим по разным элементам:
    // на iOS перекрытое <video> может не проигрывать аудио.
    _pushRemote: function (stream) {
      var v = stream.getVideoTracks();
      var a = stream.getAudioTracks();
      if (v.length && Transport.onRemote) Transport.onRemote(new MediaStream(v));
      if (a.length && Transport.onRemoteAudio) Transport.onRemoteAudio(new MediaStream(a));
    },

    // Широковещательно шлём только «привет» и стук: кто именно за дверью,
    // мы ещё не знаем. Всё остальное — строго собеседнику.
    _send: function (id, data, target) {
      try {
        if (!Transport._acts || !Transport._acts[id]) return;
        if (target) Transport._acts[id].send(data, { target: target });
        else Transport._acts[id].send(data);
      } catch (e) {}
    },

    _toPartner: function (id, data) {
      if (Transport.partner) Transport._send(id, data, Transport.partner);
    },

    // Войти в комнату. Медиа здесь нет — это присутствие, оно живёт всё
    // время, пока открыта страница. Повторный вызов возвращает ту же комнату.
    join: function () {
      if (Transport._joining) return Transport._joining;

      Transport._joining = Transport._loadLib().then(function (lib) {
        var room = lib.joinRoom(
          {
            appId: APP_ID,
            password: PASSWORD,
            // По умолчанию Trystero держит связь всего с пятью релеями из 28.
            // Публичные релеи то и дело перестают передавать события, не
            // закрывая при этом соединение, — и тогда двое просто не находят
            // друг друга. Больше релеев = меньше шансов, что замолчат все сразу.
            relayConfig: { redundancy: 12 }
          },
          ROOM_ID,
          {
            onJoinError: function (d) {
              Transport.onFail && Transport.onFail(d && d.error);
            }
          }
        );
        Transport.room = room;

        var acts = {
          hi: room.makeAction('hi'),       // «я тут, меня зовут так-то»
          ring: room.makeAction('ring'),   // стук в дверь и отмена стука
          pick: room.makeAction('pick'),   // взяли трубку или отказались
          bye: room.makeAction('bye'),     // положили трубку
          heart: room.makeAction('heart'), // сердечко по кадру
          shot: room.makeAction('shot'),   // «я сохранил этот кадр»
          stick: room.makeAction('stick')  // стикер: летящий или липкий
        };
        Transport._acts = acts;

        room.onPeerStream = function (s) { Transport._pushRemote(s); };

        room.onPeerJoin = function (id) {
          if (Transport.peers.indexOf(id) < 0) Transport.peers.push(id);
          // Представляемся сразу: имя нужно, чтобы отличить второго от своей
          // же второй вкладки и подписать, кто именно сейчас на сайте.
          acts.hi.send({ name: Transport.myName }, { target: id });
          // Разговор идёт, а собеседник переподключился — вернуть ему поток.
          // Отправляем адресно и только отсюда: тех, кто уже был в комнате,
          // Trystero прогоняет через этот же обработчик сразу при назначении,
          // так что широковещательный addStream дублировал бы отправку.
          if (Transport.sharing && Transport.local && Transport.partner === id) {
            // Собеседник вернулся после обрыва — отдаём поток заново.
            room.addStream(Transport.local, { target: id });
            setTimeout(Transport.applyQuality, 300);
          } else if (!Transport.sharing) {
            // Мы не в разговоре. Сказать об этом важно: если он как раз ждёт,
            // что связь вот-вот вернётся, ждать ему больше нечего — он
            // перезагрузил страницу, и прежнего разговора уже не существует.
            acts.bye.send({}, { target: id });
          }
          Transport.onPeerHere && Transport.onPeerHere(Transport.names[id] || null, id);
        };

        room.onPeerLeave = function (id) {
          Transport.peers = Transport.peers.filter(function (p) { return p !== id; });
          delete Transport.names[id];
          // Ушёл кто-то посторонний (например, брошенная вкладка) —
          // разговор это не касается.
          Transport.onPeerGone && Transport.onPeerGone(id, Transport.partner === id);
        };

        acts.hi.onMessage = function (d, meta) {
          Transport.names[meta.peerId] = (d && d.name) || null;
          Transport.onPeerHere && Transport.onPeerHere(Transport.names[meta.peerId], meta.peerId);
        };

        // Свой ли это звонок — решаем по partner. Иначе брошенная вкладка,
        // ещё числящаяся в комнате, может уронить живой разговор.
        function mine(meta) {
          return !Transport.partner || Transport.partner === meta.peerId;
        }

        acts.ring.onMessage = function (d, meta) {
          if (d && d.cancel) {
            if (!mine(meta)) return;
            Transport.partner = null;
            Transport.onRingCancel && Transport.onRingCancel();
            return;
          }
          if (Transport.partner) return;            // уже заняты
          Transport.partner = meta.peerId;          // вот кто звонит
          Transport.onRing && Transport.onRing((d && d.name) || null);
        };

        acts.pick.onMessage = function (d, meta) {
          if (Transport.partner && Transport.partner !== meta.peerId) return;
          var ok = !!(d && d.ok);
          // Трубку взяли — с этого мгновения собеседник определён.
          Transport.partner = ok ? meta.peerId : null;
          Transport.onAnswer && Transport.onAnswer(ok);
        };

        acts.bye.onMessage = function (d, meta) {
          if (!mine(meta)) return;
          Transport.partner = null;
          Transport.onBye && Transport.onBye();
        };

        acts.heart.onMessage = function (d, meta) {
          if (!mine(meta)) return;
          Transport.onHeart && Transport.onHeart(d || {});
        };

        acts.shot.onMessage = function (d, meta) {
          if (!mine(meta)) return;
          Transport.onShot && Transport.onShot();
        };

        acts.stick.onMessage = function (d, meta) {
          if (!mine(meta)) return;
          Transport.onSticker && Transport.onSticker(d || {});
        };

        return room;
      }).catch(function (e) {
        Transport._joining = null;   // дать следующей попытке шанс
        throw e;
      });

      return Transport._joining;
    },

    hasPeer: function () { return Transport.peers.length > 0; },

    peerName: function () {
      for (var i = 0; i < Transport.peers.length; i++) {
        if (Transport.names[Transport.peers[i]]) return Transport.names[Transport.peers[i]];
      }
      return null;
    },

    // Заново представиться всем — когда узнали, кто мы (выбор «кто звонит»).
    announce: function () { Transport._send('hi', { name: Transport.myName }); },

    // ── медиа ──
    // Включить камеру, но никому её не отдавать: пока трубку не взяли,
    // второй не должен нас ни видеть, ни слышать.
    openCamera: function () {
      if (Transport.local) return Promise.resolve(Transport.local);
      return navigator.mediaDevices.getUserMedia(mediaFor(Transport.facing, Transport.music))
        .then(function (s) { Transport.local = s; return s; });
    },

    // Отдать поток в комнату — вот теперь разговор.
    // Поток уходит только собеседнику. Никаким другим участникам комнаты
    // нас не видно и не слышно — это не оптимизация, а то же обещание,
    // что и «пока трубку не взяли, камера никуда не идёт».
    share: function () {
      if (!Transport.local || !Transport.room || Transport.sharing) return;
      Transport.sharing = true;
      if (Transport.partner) Transport.room.addStream(Transport.local, { target: Transport.partner });
      else Transport.room.addStream(Transport.local);
      // Дорожки появляются в соединении не мгновенно — настройки кодека
      // ложатся на них следующим тиком.
      setTimeout(Transport.applyQuality, 300);
    },

    closeCamera: function () {
      // Сначала конвейер: он держит ссылку на дорожку камеры.
      if (window.katyaMask) window.katyaMask.stop();
      if (Transport.camTrack) { Transport.camTrack.stop(); Transport.camTrack = null; }
      var s = Transport.local;
      Transport.local = null;
      if (!s) { Transport.sharing = false; return; }
      if (Transport.room && Transport.sharing) {
        try { Transport.room.removeStream(s); } catch (e) {}
      }
      Transport.sharing = false;
      Transport.partner = null;
      Transport._lastLoss = null;
      Transport.tier = 0;
      Transport.music = false;
      // Остановить дорожки обязательно — иначе лампочка камеры горит дальше.
      s.getTracks().forEach(function (t) { t.stop(); });
    },

    // ── сигналы разговора ──
    // Стук — всем: какая из вкладок собеседника живая, заранее не известно.
    // Кто откликнулся, тот и становится partner.
    callPeer: function () {
      Transport.partner = null;
      Transport._send('ring', { name: Transport.myName });
    },
    cancelCall: function () {
      if (Transport.partner) Transport._toPartner('ring', { cancel: true });
      else Transport._send('ring', { cancel: true });
      Transport.partner = null;
    },
    answer: function (ok) {
      Transport._toPartner('pick', { ok: !!ok });
      if (!ok) Transport.partner = null;
    },
    hangup: function () {
      Transport._toPartner('bye', {});
      Transport.partner = null;
    },
    sendHeart: function (x, y) { Transport._toPartner('heart', { x: x, y: y }); },
    sendShot: function () { Transport._toPartner('shot', {}); },
    sendSticker: function (emoji, x, y, sticky) {
      Transport._toPartner('stick', { emoji: emoji, x: x, y: y, sticky: !!sticky });
    },

    // ── управление ──
    // Дорожки не снимаем, а глушим: пересогласование потока ради выключенного
    // микрофона — лишний повод уронить соединение посреди разговора.
    setAudio: function (on) {
      if (!Transport.local) return;
      Transport.local.getAudioTracks().forEach(function (t) { t.enabled = on; });
    },

    setVideo: function (on) {
      if (!Transport.local) return;
      Transport.local.getVideoTracks().forEach(function (t) { t.enabled = on; });
    },

    // ── Управление кодеком ──
    // Битрейт задаём через setParameters, а не правкой SDP: SDP-хаки
    // ломаются от версии к версии браузера, а этот путь штатный.
    _senders: function (kind) {
      if (!Transport.room || !Transport.room.getPeers) return [];
      var pcs = Transport.room.getPeers();
      var out = [];
      Object.keys(pcs).forEach(function (id) {
        var pc = pcs[id];
        if (!pc || !pc.getSenders) return;
        pc.getSenders().forEach(function (snd) {
          if (snd.track && snd.track.kind === kind) out.push(snd);
        });
      });
      return out;
    },

    _tune: function (snd, patch) {
      if (!snd.getParameters || !snd.setParameters) return;
      var prm;
      try { prm = snd.getParameters(); } catch (e) { return; }
      // Safari отдаёт параметры без encodings, пока дорожка не поехала.
      if (!prm.encodings || !prm.encodings.length) prm.encodings = [{}];
      Object.keys(patch).forEach(function (k) {
        if (k === 'degradationPreference') prm.degradationPreference = patch[k];
        else prm.encodings[0][k] = patch[k];
      });
      try { snd.setParameters(prm); } catch (e) {}
    },

    // Применить текущие настройки ко всем исходящим дорожкам. Зовётся после
    // share(), при смене ступени и при подключении нового собеседника —
    // у свежего соединения параметры свои, по умолчанию.
    applyQuality: function () {
      var t = TIERS[Transport.tier] || TIERS[0];
      Transport._senders('video').forEach(function (snd) {
        Transport._tune(snd, {
          maxBitrate: t.video,
          scaleResolutionDownBy: t.scale,
          // «Держать частоту кадров» = ронять разрешение первым.
          degradationPreference: 'maintain-framerate'
        });
      });
      Transport._senders('audio').forEach(function (snd) {
        Transport._tune(snd, {
          maxBitrate: Transport.music ? AUDIO_BPS.music : AUDIO_BPS.speech
        });
      });
    },

    setTier: function (n) {
      n = Math.max(0, Math.min(TIERS.length - 1, n));
      if (n === Transport.tier) return false;
      Transport.tier = n;
      Transport.applyQuality();
      return true;
    },

    tierName: function () { return (TIERS[Transport.tier] || TIERS[0]).name; },

    // Музыкальный режим: обработку с микрофона снимаем совсем и поднимаем
    // битрейт. Дорожку подменяем на лету — разговор не прерывается.
    setMusic: function (on) {
      on = !!on;
      if (!Transport.local) { Transport.music = on; return Promise.resolve(true); }
      var old = Transport.local.getAudioTracks()[0];
      if (!old) { Transport.music = on; return Promise.resolve(true); }

      return navigator.mediaDevices.getUserMedia({ audio: audioFor(on), video: false })
        .then(function (s) {
          var next = s.getAudioTracks()[0];
          if (!next) return false;
          if (Transport.room && Transport.sharing) {
            try { Transport.room.replaceTrack(old, next); } catch (e) {}
          }
          Transport.local.removeTrack(old);
          Transport.local.addTrack(next);
          next.enabled = old.enabled;   // микрофон был выключен — пусть и остаётся
          old.stop();
          Transport.music = on;
          Transport.applyQuality();
          return true;
        })
        .catch(function () { return false; });
    },

    // ── Маски, фоны, фильтры ──
    // Считает их js/mask.js, здесь только подмена дорожки. Наружу уходит
    // холст, а не камера, поэтому собеседник видит то же, что и мы.
    //
    // Владение дорожками:
    //   camTrack — настоящая камера. Пока включён эффект, она не в потоке,
    //              а кормит конвейер, и останавливать её нельзя;
    //   дорожку холста заводит и гасит сам mask.js.
    // Поэтому _swapVideo не останавливает ничего — за это отвечают
    // clearEffects и closeCamera.
    _swapVideo: function (next) {
      if (!next || !Transport.local) return;
      var shown = Transport.local.getVideoTracks()[0];
      if (!shown || shown === next) return;
      if (Transport.room && Transport.sharing) {
        try { Transport.room.replaceTrack(shown, next); } catch (e) {}
      }
      Transport.local.removeTrack(shown);
      Transport.local.addTrack(next);
      next.enabled = shown.enabled;   // была выключена — пусть и остаётся
      Transport.applyQuality();       // у новой дорожки параметры свои
    },

    setEffect: function (kind, id) {
      if (!window.katyaMask || !Transport.local) return Promise.resolve(false);
      var cam = Transport.camTrack || Transport.local.getVideoTracks()[0];
      if (!cam) return Promise.resolve(false);

      return window.katyaMask.start(new MediaStream([cam]))
        .then(function (processed) {
          return window.katyaMask.set(kind, id).then(function (ok) {
            if (!ok) return false;
            Transport.camTrack = cam;           // теперь она кормит конвейер
            Transport._swapVideo(processed.getVideoTracks()[0]);
            return true;
          });
        })
        .catch(function () { return false; });
    },

    // Вернуть чистую камеру.
    clearEffects: function () {
      if (!window.katyaMask) return;
      if (Transport.camTrack && Transport.local) Transport._swapVideo(Transport.camTrack);
      window.katyaMask.stop();               // он же остановит дорожку холста
      Transport.camTrack = null;
    },

    // Перевернуть камеру: фронтальная ↔ тыловая. replaceTrack подменяет
    // дорожку в уже собранном соединении, поэтому пересогласования нет
    // и картинка у собеседника не моргает.
    switchCamera: function () {
      if (!Transport.local || !Transport.room) return Promise.resolve(false);
      var want = Transport.facing === 'user' ? 'environment' : 'user';
      var effectOn = !!Transport.camTrack;
      var old = effectOn ? Transport.camTrack : Transport.local.getVideoTracks()[0];
      if (!old) return Promise.resolve(false);

      return navigator.mediaDevices.getUserMedia({ audio: false, video: videoFor(want) })
        .then(function (s) {
          var next = s.getVideoTracks()[0];
          if (!next) return false;
          next.enabled = old.enabled;
          if (effectOn) {
            // Поток наружу не трогаем — меняем то, что видит конвейер.
            Transport.camTrack = next;
            old.stop();
            return window.katyaMask.start(new MediaStream([next])).then(function () {
              Transport.facing = want;
              return true;
            });
          }
          Transport._swapVideo(next);
          old.stop();
          Transport.facing = want;
          return true;
        })
        .catch(function () { return false; });   // одна камера — молча остаёмся
    },

    // Сколько камер у устройства. Кнопку переворота показываем только тем,
    // кому есть что переворачивать.
    countCameras: function () {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        return Promise.resolve(1);
      }
      return navigator.mediaDevices.enumerateDevices().then(function (list) {
        return list.filter(function (d) { return d.kind === 'videoinput'; }).length;
      }).catch(function () { return 1; });
    },

    // Качество связи: задержка до собеседника и доля потерянных пакетов.
    // Потери считаем приращением между замерами — абсолютные счётчики
    // растут с начала разговора и о текущем состоянии не говорят ничего.
    _lastLoss: null,
    quality: function () {
      var id = Transport.peers[0];
      if (!id || !Transport.room) return Promise.resolve(null);

      var ping = Transport.room.ping(id).catch(function () { return null; });
      var pcs = Transport.room.getPeers ? Transport.room.getPeers() : null;
      var pc = pcs && pcs[id];
      var stats = (pc && pc.getStats)
        ? pc.getStats().then(function (report) {
            var got = 0, lost = 0;
            report.forEach(function (r) {
              if (r.type === 'inbound-rtp' && !r.isRemote) {
                got += r.packetsReceived || 0;
                lost += r.packetsLost || 0;
              }
            });
            var prev = Transport._lastLoss;
            Transport._lastLoss = { got: got, lost: lost };
            if (!prev) return null;
            var dg = got - prev.got, dl = lost - prev.lost;
            if (dg + dl <= 0) return null;
            return dl / (dg + dl);
          }).catch(function () { return null; })
        : Promise.resolve(null);

      return Promise.all([ping, stats]).then(function (r) {
        return { ping: r[0], loss: r[1] };
      });
    },

    // Уйти из комнаты совсем. Нужно только при закрытии страницы: во время
    // обычного отбоя комната остаётся открытой, иначе пропадёт присутствие.
    leave: function () {
      Transport.closeCamera();
      if (Transport.room) {
        try { Transport.room.leave(); } catch (e) {}
      }
      Transport.room = null;
      Transport._acts = null;
      Transport._joining = null;
      Transport.peers = [];
      Transport.names = {};
    }
  };

  // ─────────────────────────────────────────────────────────────
  // ЗВУК ВЫЗОВА — синтезируем, чтобы не тащить mp3 в прекэш.
  // ─────────────────────────────────────────────────────────────
  var Ring = (function () {
    var ctx = null, timer = null;

    function beep() {
      if (!ctx) return;
      // Два мягких тона подряд — узнаваемый гудок, но без резкости.
      [0, 0.42].forEach(function (offset) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        var t = ctx.currentTime + offset;
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, t);   // до
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.12, t + 0.06);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(t); osc.stop(t + 0.36);
      });
    }

    return {
      start: function () {
        try {
          ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
          if (ctx.state === 'suspended') ctx.resume();
        } catch (e) { return; }
        beep();
        timer = setInterval(beep, 3000);
      },
      stop: function () {
        if (timer) { clearInterval(timer); timer = null; }
      }
    };
  })();

  // ─────────────────────────────────────────────────────────────
  // UI
  // ─────────────────────────────────────────────────────────────
  var overlay = document.getElementById('callOverlay');
  if (!overlay) return;

  var openBtn = document.getElementById('callBtn');
  var titleEl = document.getElementById('cvStateTitle');
  var subEl = document.getElementById('cvStateSub');
  var inviteBtn = document.getElementById('cvInvite');
  var whoPrompt = document.getElementById('whoPrompt');
  var whoBtns = document.querySelectorAll('.who-b');
  var selfBox = document.getElementById('cvSelf');
  var selfVideo = document.getElementById('cvSelfVideo');
  var remoteVideo = document.getElementById('cvRemote');
  var peerEl = document.getElementById('cvPeer');
  var timerEl = document.getElementById('cvTimer');
  var voiceName = document.getElementById('cvVoiceName');
  var voiceRing = document.getElementById('cvVoiceRing');

  var micBtn = document.getElementById('cvMic');
  var camBtn = document.getElementById('cvCam');
  var hangBtn = document.getElementById('cvHang');
  var voiceBtn = document.getElementById('cvVoiceBtn');
  var pipBtn = document.getElementById('cvPip');

  var flipBtn = document.getElementById('cvFlip');
  var stage = document.getElementById('cvStage');
  var heartLayer = document.getElementById('cvHearts');
  var musicBtn = document.getElementById('cvMusic');
  var fxBtn = document.getElementById('cvFxBtn');
  var fxPanel = document.getElementById('cvFx');
  var stickBtn = document.getElementById('cvStickBtn');
  var stickPanel = document.getElementById('cvSticks');
  var stickLayer = document.getElementById('cvStickLayer');
  var shotBtn = document.getElementById('cvShot');
  var sleepBtn = document.getElementById('cvSleep');
  var skyEl = document.getElementById('cvSky');
  var toastEl = document.getElementById('cvToast');
  var qualityEl = document.getElementById('cvQuality');
  var answerBox = document.getElementById('cvAnswer');
  var pickBtn = document.getElementById('cvPick');
  var denyBtn = document.getElementById('cvDeny');
  var lostEl = document.getElementById('cvLost');
  var liveEl = document.getElementById('callLive');
  var liveText = document.getElementById('callLiveText');

  var startedAt = 0, tick = null, meter = null, audioCtx = null;
  var ringTimer = null;      // сколько ждём ответа
  var lostTimer = null;      // сколько ждём переподключения
  var closeTimer = null;     // отложенное закрытие экрана после отказа
  var pending = null;        // поток собеседника, пришедший до «разговора»
  var pageTitle = document.title;

  var NO_ANSWER_MS = 45000;  // столько звоним, прежде чем сдаться
  var LOST_MS = 20000;       // столько ждём, что связь вернётся

  function setState(cls) {
    overlay.classList.remove('asking', 'calling', 'incoming', 'talking');
    if (cls) overlay.classList.add(cls);
  }

  function is(cls) { return overlay.classList.contains(cls); }

  function fmt(sec) {
    var m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  // Нас двое, поэтому второй — всегда «не я».
  function otherOf(name) { return name === 'Катя' ? 'Самир' : 'Катя'; }

  function myName() { return load(WHO_KEY, null); }

  // ── Кто сейчас на сайте: живой огонёк на карточке секции ──
  function updatePresence() {
    if (!liveEl) return;
    if (!Transport.hasPeer()) { liveEl.hidden = true; return; }

    var who = myName();
    var peer = Transport.peerName();
    var text;
    if (peer && who && peer === who) {
      // Та же страница открыта где-то ещё — это не второй человек.
      text = 'Сайт открыт ещё в одном окне';
    } else if (peer) {
      text = peer + ' сейчас на сайте ♥';
    } else if (who) {
      text = otherOf(who) + ' сейчас на сайте ♥';
    } else {
      text = 'Кто-то из нас сейчас на сайте ♥';
    }
    if (liveText) liveText.textContent = text;
    liveEl.hidden = false;
  }

  // ── Пульсация круга в аудиорежиме от громкости ──
  function startMeter(stream) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      var src = audioCtx.createMediaStreamSource(stream);
      var an = audioCtx.createAnalyser();
      an.fftSize = 256;
      src.connect(an);
      var buf = new Uint8Array(an.frequencyBinCount);
      (function loop() {
        meter = requestAnimationFrame(loop);
        an.getByteFrequencyData(buf);
        var sum = 0;
        for (var i = 0; i < buf.length; i++) sum += buf[i];
        var level = Math.min(1, (sum / buf.length) / 90);
        if (voiceRing) {
          voiceRing.style.transform = 'scale(' + (1 + level * 0.09).toFixed(3) + ')';
          voiceRing.style.boxShadow = '0 0 ' + (30 + level * 70).toFixed(0) + 'px rgba(255,107,107,' +
            (0.25 + level * 0.45).toFixed(2) + ')';
        }
      })();
    } catch (e) {}
  }

  function stopMeter() {
    if (meter) { cancelAnimationFrame(meter); meter = null; }
    if (voiceRing) { voiceRing.style.transform = ''; voiceRing.style.boxShadow = ''; }
  }

  // ── Сердечки по кадру ──
  // Координаты шлём долями, а не пикселями: экраны у нас разные,
  // а сердце должно всплыть примерно там же, куда ткнули пальцем.
  var HEART_CHARS = ['\u2665', '\u2764', '\ud83d\udc95', '\ud83d\udc97', '\u2661'];

  function popHeart(x, y, mine) {
    if (!heartLayer) return;
    var h = document.createElement('div');
    h.className = 'cv-heart' + (mine ? ' mine' : '');
    h.textContent = HEART_CHARS[Math.floor(Math.random() * HEART_CHARS.length)];
    h.style.left = (x * 100).toFixed(2) + '%';
    h.style.top = (y * 100).toFixed(2) + '%';
    h.style.setProperty('--dx', ((Math.random() - 0.5) * 60).toFixed(0) + 'px');
    h.style.fontSize = (1.1 + Math.random() * 0.9).toFixed(2) + 'rem';
    heartLayer.appendChild(h);
    setTimeout(function () { h.remove(); }, 1700);
  }

  // ── Короткие сообщения и всплывающие подписи ──
  var toastTimer = null;

  function toast(text) {
    if (!toastEl) return;
    toastEl.textContent = text;
    toastEl.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 2600);
  }

  // ── Панель эффектов ──
  // Строится из каталога в mask.js, чтобы список жил в одном месте.
  var fxBuilt = false;

  function buildFx() {
    if (fxBuilt || !fxPanel || !window.katyaMask) return;
    fxBuilt = true;

    function ряд(title, kind, items, label) {
      var row = document.createElement('div');
      row.className = 'cv-fx-row';
      var h = document.createElement('div');
      h.className = 'cv-fx-title';
      h.textContent = title;
      row.appendChild(h);

      var wrap = document.createElement('div');
      wrap.className = 'cv-fx-items';

      var off = document.createElement('button');
      off.type = 'button';
      off.className = 'cv-fx-b on';
      off.textContent = 'Без';
      off.dataset.kind = kind;
      off.dataset.id = '';
      wrap.appendChild(off);

      items.forEach(function (it) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'cv-fx-b';
        b.textContent = label(it);
        b.dataset.kind = kind;
        b.dataset.id = it.id;
        wrap.appendChild(b);
      });

      row.appendChild(wrap);
      fxPanel.appendChild(row);
    }

    ряд('Фильтр', 'filter', window.katyaMask.FILTERS, function (f) { return f.name; });
    ряд('Фон', 'back', window.katyaMask.BACKS, function (b) { return b.name; });
    ряд('Маска', 'face', window.katyaMask.MASKS, function (m) {
      return (m.emoji ? m.emoji + ' ' : '') + m.name;
    });

    fxPanel.addEventListener('click', function (e) {
      var b = e.target.closest('.cv-fx-b');
      if (!b || b.disabled) return;
      var kind = b.dataset.kind, id = b.dataset.id || null;
      var group = b.parentNode;

      // Фон и маска требуют модели: скажем об этом честно, а не молча подвиснем.
      var тяжёлый = (kind === 'back' || kind === 'face') && id;
      if (тяжёлый) {
        var l = window.katyaMask.loaded();
        if (!(kind === 'back' ? l.seg : l.face)) toast('Загружаю… несколько секунд');
      }

      group.querySelectorAll('.cv-fx-b').forEach(function (x) { x.disabled = true; });

      var p = id ? Transport.setEffect(kind, id) : Transport.setEffect(kind, null);
      p.then(function (ok) {
        group.querySelectorAll('.cv-fx-b').forEach(function (x) {
          x.disabled = false;
          x.classList.toggle('on', x === b && ok);
        });
        if (!ok && id) {
          toast('Без интернета маски не работают');
          group.querySelector('.cv-fx-b').classList.add('on');
          return;
        }
        // Ни одного эффекта не осталось — гасим конвейер, чтобы не жечь батарею.
        if (window.katyaMask.anyOn && !window.katyaMask.anyOn()) Transport.clearEffects();
        window.buzz && window.buzz(10);
      });
    });
  }

  function toggleFx(on) {
    if (!fxPanel) return;
    buildFx();
    fxPanel.hidden = !on;
    if (fxBtn) fxBtn.classList.toggle('lit', !!on);
    if (on && stickPanel) stickPanel.hidden = true;
  }

  // ── Стикеры ──
  // Летящие тают сами, липкие остаются, пока не смахнёшь.
  var FLY = ['\u2764\ufe0f', '\ud83d\udc95', '\ud83e\udd70', '\ud83d\ude18', '\u2728', '\ud83c\udf1f', '\ud83d\udc4b', '\ud83e\udd17'];
  var STICK = ['\ud83d\udc90', '\ud83e\uddf8', '\ud83c\udf19', '\u2615', '\ud83c\udf70', '\ud83c\udf85', '\ud83d\udc8d', '\ud83c\udfb5'];

  function flyIn(emoji, x, y, mine) {
    if (!stickLayer) return;
    var el = document.createElement('div');
    el.className = 'cv-fly' + (mine ? ' mine' : '');
    el.textContent = emoji;
    el.style.left = (x * 100).toFixed(2) + '%';
    el.style.top = (y * 100).toFixed(2) + '%';
    el.style.setProperty('--dx', ((Math.random() - 0.5) * 80).toFixed(0) + 'px');
    stickLayer.appendChild(el);
    setTimeout(function () { el.remove(); }, 2300);
  }

  function stickOn(emoji, x, y) {
    if (!stickLayer) return;
    var el = document.createElement('div');
    el.className = 'cv-stick';
    el.textContent = emoji;
    el.style.left = (x * 100).toFixed(2) + '%';
    el.style.top = (y * 100).toFixed(2) + '%';
    el.style.setProperty('--tilt', ((Math.random() - 0.5) * 24).toFixed(0) + 'deg');
    // Смахнуть можно и пальцем, и мышью — один обработчик на оба.
    var x0 = 0, tracking = false;
    el.addEventListener('pointerdown', function (e) {
      tracking = true; x0 = e.clientX;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', function (e) {
      if (!tracking) return;
      var d = e.clientX - x0;
      el.style.transform = 'translate(-50%,-50%) rotate(var(--tilt)) translateX(' + d + 'px)';
      el.style.opacity = Math.max(0, 1 - Math.abs(d) / 160);
    });
    el.addEventListener('pointerup', function (e) {
      if (!tracking) return;
      tracking = false;
      if (Math.abs(e.clientX - x0) > 70) {
        el.classList.add('gone');
        setTimeout(function () { el.remove(); }, 260);
        window.buzz && window.buzz(8);
      } else {
        el.style.transform = '';
        el.style.opacity = '';
      }
    });
    stickLayer.appendChild(el);
  }

  var stickBuilt = false;

  function buildSticks() {
    if (stickBuilt || !stickPanel) return;
    stickBuilt = true;

    function ряд(title, list, sticky) {
      var row = document.createElement('div');
      row.className = 'cv-fx-row';
      var h = document.createElement('div');
      h.className = 'cv-fx-title';
      h.textContent = title;
      row.appendChild(h);
      var wrap = document.createElement('div');
      wrap.className = 'cv-st-items';
      list.forEach(function (e) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'cv-st-b';
        b.textContent = e;
        b.dataset.sticky = sticky ? '1' : '';
        wrap.appendChild(b);
      });
      row.appendChild(wrap);
      stickPanel.appendChild(row);
    }

    ряд('Прилетит и растает', FLY, false);
    ряд('Останется, пока не смахнёшь', STICK, true);

    stickPanel.addEventListener('click', function (e) {
      var b = e.target.closest('.cv-st-b');
      if (!b) return;
      var sticky = b.dataset.sticky === '1';
      var emoji = b.textContent;
      // Место выбираем сами: случайное в середине кадра — так стикеры
      // не слипаются в одну точку.
      var x = 0.25 + Math.random() * 0.5;
      var y = 0.3 + Math.random() * 0.4;
      if (sticky) stickOn(emoji, x, y); else flyIn(emoji, x, y, true);
      Transport.sendSticker(emoji, x, y, sticky);
      window.buzz && window.buzz(10);
      if (!sticky) return;
      toggleSticks(false);
    });
  }

  function toggleSticks(on) {
    if (!stickPanel) return;
    buildSticks();
    stickPanel.hidden = !on;
    if (stickBtn) stickBtn.classList.toggle('lit', !!on);
    if (on && fxPanel) { fxPanel.hidden = true; if (fxBtn) fxBtn.classList.remove('lit'); }
  }

  // ── Кадр на память ──
  // Снимаем именно собеседника: свой вид и так каждый день в зеркале.
  function snapshot() {
    var v = (remoteVideo && remoteVideo.srcObject && remoteVideo.videoWidth) ? remoteVideo : selfVideo;
    if (!v || !v.videoWidth) { toast('Кадра ещё нет'); return; }

    var c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    var g = c.getContext('2d');
    g.drawImage(v, 0, 0, c.width, c.height);

    // Подпись снизу — через год будет непонятно, что это был за день.
    var d = new Date();
    var stamp = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) +
      ', ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    var pad = Math.round(c.height * 0.035);
    g.font = Math.round(c.height * 0.038) + 'px sans-serif';
    g.textBaseline = 'bottom';
    g.shadowColor = 'rgba(0,0,0,0.65)';
    g.shadowBlur = Math.round(c.height * 0.02);
    g.fillStyle = 'rgba(255,240,225,0.95)';
    g.fillText(stamp + '  \u2665', pad, c.height - pad);

    c.toBlob(function (blob) {
      if (!blob) { toast('Не получилось сохранить'); return; }
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'katera-' + d.toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.jpg';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      // Честно предупреждаем вторую сторону: кадр с ней сохранён.
      Transport.sendShot();
      toast('Кадр сохранён ♥');
      window.buzz && window.buzz([12, 40, 12]);
    }, 'image/jpeg', 0.92);
  }

  // ── «Засыпаем вместе» ──
  // Видео гаснет, голос остаётся, экран уходит в звёздное небо и темнеет.
  // Экран при этом держим включённым: заснувший телефон на iOS обрывает
  // разговор, а смысл режима — чтобы он длился.
  var SLEEP_MAX_MS = 8 * 3600 * 1000;   // забытый под утро звонок всё же прервём
  var sleepGuard = null;
  var dimTimer = null;

  function buildSky() {
    if (!skyEl || skyEl.childElementCount) return;
    for (var i = 0; i < 70; i++) {
      var st = document.createElement('i');
      st.className = 'cv-star';
      st.style.left = (Math.random() * 100).toFixed(2) + '%';
      st.style.top = (Math.random() * 100).toFixed(2) + '%';
      st.style.opacity = (0.25 + Math.random() * 0.6).toFixed(2);
      st.style.width = st.style.height = (1 + Math.random() * 1.8).toFixed(1) + 'px';
      st.style.animationDelay = (Math.random() * 4).toFixed(2) + 's';
      st.style.animationDuration = (2.6 + Math.random() * 3).toFixed(2) + 's';
      skyEl.appendChild(st);
    }
  }

  function wakeUpDim() {
    overlay.classList.remove('dim');
    if (dimTimer) clearTimeout(dimTimer);
    if (!overlay.classList.contains('sleep')) return;
    dimTimer = setTimeout(function () { overlay.classList.add('dim'); }, 6000);
  }

  function setSleep(on) {
    overlay.classList.toggle('sleep', !!on);
    if (on) {
      buildSky();
      setVoice(true);          // камера гаснет физически, слышно по-прежнему
      wakeUpDim();
      if (sleepGuard) clearTimeout(sleepGuard);
      sleepGuard = setTimeout(function () { endCall(); }, SLEEP_MAX_MS);
      toast('Спокойной ночи \u2665');
    } else {
      if (sleepGuard) { clearTimeout(sleepGuard); sleepGuard = null; }
      if (dimTimer) { clearTimeout(dimTimer); dimTimer = null; }
      overlay.classList.remove('dim');
      setVoice(false);
    }
  }

  // ── Экран не должен тухнуть посреди разговора ──
  var wakeLock = null;

  function keepAwake() {
    if (!navigator.wakeLock) return;
    navigator.wakeLock.request('screen').then(function (l) {
      wakeLock = l;
      l.addEventListener('release', function () { wakeLock = null; });
    }).catch(function () {});
  }

  function letSleep() {
    if (!wakeLock) return;
    try { wakeLock.release(); } catch (e) {}
    wakeLock = null;
  }

  // Систему не переспорить: когда вкладка уходит из виду, блокировка
  // снимается сама. Вернулись — просим заново.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && is('talking') && !wakeLock) keepAwake();
  });

  // ── Качество связи ──
  // Считаем не ради красивой цифры, а чтобы вовремя предложить голос:
  // на слабой сети разговор без видео проходит там, где с видео рассыпается.
  var qualityTimer = null;
  var goodRun = 0;      // сколько замеров подряд связь держится хорошо

  function stopQuality() {
    if (qualityTimer) { clearInterval(qualityTimer); qualityTimer = null; }
    if (qualityEl) qualityEl.hidden = true;
    goodRun = 0;
  }

  function startQuality() {
    stopQuality();
    qualityTimer = setInterval(function () {
      Transport.quality().then(function (q) {
        if (!q || !is('talking')) return;

        var loss = q.loss;
        var ping = q.ping;
        var плохо = (loss !== null && loss > 0.06) || (ping !== null && ping > 700);
        var хорошо = (loss === null || loss < 0.015) && (ping === null || ping < 350);

        if (плохо) {
          goodRun = 0;
          // Ступень вниз: картинка мельчает, но перестаёт сыпаться.
          if (Transport.setTier(Transport.tier + 1)) {
            toast('Связь слабая — качество ' + Transport.tierName());
          } else if (qualityEl && !overlay.classList.contains('voice')) {
            // Ниже падать некуда. Вот теперь честно предлагаем голос.
            qualityEl.textContent = 'Видео не проходит — перейти на голос?';
            qualityEl.hidden = false;
          }
        } else if (хорошо) {
          goodRun++;
          // Вверх поднимаемся неспешно: дёргать качество туда-сюда хуже,
          // чем минуту посидеть на сниженном.
          if (goodRun >= 4 && Transport.setTier(Transport.tier - 1)) {
            goodRun = 0;
            if (qualityEl) qualityEl.hidden = true;
          }
        } else {
          goodRun = 0;
        }
      });
    }, 5000);
  }

  // Аудиорежим вызывается из двух мест — кнопкой и подсказкой о слабой связи.
  function setVoice(voice) {
    overlay.classList.toggle('voice', !!voice);
    // В аудиорежиме камера гасится физически, а не только визуально.
    Transport.setVideo(!voice);
    if (camBtn) camBtn.dataset.on = voice ? '0' : '1';
    if (selfBox) selfBox.classList.toggle('cam-off', !!voice);
    if (voice && qualityEl) qualityEl.hidden = true;
    window.buzz && window.buzz(12);
  }

  function showSelf(stream) {
    if (!stream || !selfVideo) return;
    selfVideo.srcObject = stream;
    selfVideo.play().catch(function () {});
    startMeter(stream);
  }

  // Поток собеседника может прийти на мгновение раньше, чем экран станет
  // «разговором», — придерживаем и вешаем, когда состояние сойдётся.
  function attachRemote() {
    if (!pending) return;
    if (pending.video && remoteVideo) {
      remoteVideo.srcObject = pending.video;
      remoteVideo.play().catch(function () {});
    }
    if (pending.audio) {
      var a = document.getElementById('cvRemoteAudio');
      if (a) { a.srcObject = pending.audio; a.play().catch(function () {}); }
    }
  }

  function openOverlay() {
    overlay.classList.add('on');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function clearTimers() {
    if (ringTimer) { clearTimeout(ringTimer); ringTimer = null; }
    if (lostTimer) { clearTimeout(lostTimer); lostTimer = null; }
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
  }

  // ── Разговор пошёл ──
  function goTalking() {
    if (is('talking')) return;   // событие может прийти дважды
    Ring.stop();
    clearTimers();
    document.title = pageTitle;
    if (inviteBtn) inviteBtn.hidden = true;
    if (answerBox) answerBox.hidden = true;
    setState('talking');
    attachRemote();
    keepAwake();
    startQuality();
    // Кнопка переворота нужна только тем, у кого есть вторая камера.
    if (flipBtn) {
      Transport.countCameras().then(function (n) { flipBtn.hidden = n < 2; });
    }
    window.buzz && window.buzz([18, 60, 18]);
    startedAt = Date.now();
    tick = setInterval(function () {
      timerEl.textContent = fmt(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
  }

  // ── Завершение. Комнату не покидаем: она и есть присутствие ──
  function endCall(silent) {
    Ring.stop();
    stopMeter();
    stopQuality();
    letSleep();
    clearTimers();
    if (tick) { clearInterval(tick); tick = null; }
    document.title = pageTitle;

    if (!silent) {
      if (is('talking')) Transport.hangup();
      else if (is('calling')) Transport.cancelCall();
      else if (is('incoming')) Transport.answer(false);
    }

    if (startedAt) {
      var secs = Math.floor((Date.now() - startedAt) / 1000);
      if (secs > 2) {
        var total = parseInt(load(TOTAL_KEY, '0'), 10) || 0;
        save(TOTAL_KEY, total + secs);
        try {
          var log = JSON.parse(load(LOG_KEY, '[]'));
          log.unshift({ at: Date.now(), sec: secs });
          save(LOG_KEY, JSON.stringify(log.slice(0, 50)));
        } catch (e) {}
      }
      startedAt = 0;
    }

    Transport.closeCamera();
    pending = null;
    if (selfVideo) selfVideo.srcObject = null;
    if (remoteVideo) remoteVideo.srcObject = null;
    var ra = document.getElementById('cvRemoteAudio');
    if (ra) ra.srcObject = null;
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(function () {});
    }

    if (sleepGuard) { clearTimeout(sleepGuard); sleepGuard = null; }
    if (dimTimer) { clearTimeout(dimTimer); dimTimer = null; }
    overlay.classList.remove('on', 'voice', 'lost', 'sleep', 'dim');
    overlay.setAttribute('aria-hidden', 'true');
    document.dispatchEvent(new Event('katya:call-ended'));
    document.body.style.overflow = '';
    setState(null);
    timerEl.textContent = '00:00';
    if (whoPrompt) whoPrompt.classList.remove('show');
    if (answerBox) answerBox.hidden = true;
    if (lostEl) lostEl.hidden = true;
    if (micBtn) micBtn.dataset.on = '1';
    if (camBtn) camBtn.dataset.on = '1';
    if (flipBtn) flipBtn.hidden = true;
    if (musicBtn) { musicBtn.dataset.on = '0'; musicBtn.classList.remove('lit'); }
    if (toastEl) toastEl.hidden = true;
    if (heartLayer) heartLayer.innerHTML = '';
    if (stickLayer) stickLayer.innerHTML = '';
    toggleFx(false);
    toggleSticks(false);
    Transport.clearEffects();
    if (fxPanel) {
      fxPanel.querySelectorAll('.cv-fx-b').forEach(function (b, i) {
        b.disabled = false;
        b.classList.toggle('on', !b.dataset.id);
      });
    }
    if (selfBox) selfBox.classList.remove('cam-off');
    updatePresence();
  }

  // ── Ошибки камеры и комнаты — одним местом ──
  function showError(err) {
    Ring.stop();
    clearTimers();
    // Причину полезно видеть в консоли — без неё «не удалось соединиться»
    // ничего не объясняет ни тебе, ни мне.
    try { console.warn('[звонок]', err && (err.message || err)); } catch (e) {}
    window.__callErr = err && (err.message || String(err));
    var n = err && err.name;
    if (n === 'NotAllowedError' || n === 'NotFoundError') {
      titleEl.textContent = 'Нет доступа к камере';
      subEl.textContent = n === 'NotAllowedError'
        ? 'Разреши камеру и микрофон в настройках браузера'
        : 'Камера или микрофон не найдены';
    } else {
      titleEl.textContent = 'Не удалось соединиться';
      subEl.textContent = 'Проверь интернет и попробуй ещё раз ♥';
    }
  }

  // ── Исходящий звонок ──
  function startCall(name) {
    Transport.myName = name;
    if (whoPrompt) whoPrompt.classList.remove('show');

    var peer = otherOf(name);
    setState('calling');
    titleEl.textContent = 'Звоним ' + (peer === 'Катя' ? 'Кате' : 'Самиру') + '…';
    subEl.textContent = 'ждём, пока возьмут трубку';
    peerEl.textContent = peer + ' ♥';
    if (voiceName) voiceName.textContent = peer;
    if (inviteBtn) inviteBtn.hidden = true;

    Transport.join().then(function () {
      Transport.announce();

      if (!Transport.hasPeer()) {
        // Звонить некому: страница у второго закрыта. Камеру даже не трогаем.
        titleEl.textContent = peer + ' сейчас не на сайте';
        subEl.textContent = 'позови в мессенджере — и я соединю вас';
        if (inviteBtn) inviteBtn.hidden = false;
        return null;
      }

      Ring.start();
      window.buzz && window.buzz(20);
      Transport.callPeer();
      ringTimer = setTimeout(function () {
        Ring.stop();
        Transport.cancelCall();
        titleEl.textContent = 'Не ответили';
        subEl.textContent = 'позови в мессенджере — и попробуем снова';
        if (inviteBtn) inviteBtn.hidden = false;
      }, NO_ANSWER_MS);

      // Камеру включаем сразу, чтобы было видно себя, пока идут гудки,
      // но в комнату поток уходит только после того, как трубку взяли.
      return Transport.openCamera().then(showSelf);
    }).catch(showError);
  }

  function beginFlow() {
    openOverlay();
    var who = myName();
    if (who) {
      startCall(who);
    } else {
      setState('asking');
      if (whoPrompt) whoPrompt.classList.add('show');
    }
  }

  // ── Входящий звонок ──
  function showIncoming(fromName) {
    if (is('talking') || is('calling')) return;   // уже заняты
    var who = myName();
    var peer = fromName || (who ? otherOf(who) : null);

    openOverlay();
    setState('incoming');
    titleEl.textContent = (peer || 'Кто-то') + ' звонит';
    subEl.textContent = 'возьми трубку ♥';
    peerEl.textContent = (peer || 'Наш звонок') + ' ♥';
    if (voiceName) voiceName.textContent = peer || 'Наш звонок';
    if (answerBox) answerBox.hidden = false;
    if (inviteBtn) inviteBtn.hidden = true;

    Ring.start();
    window.buzz && window.buzz([30, 120, 30, 120, 30]);
    // Вкладка может быть не на виду — подписываем заголовок.
    document.title = (peer || 'Кто-то') + ' звонит…';

    clearTimers();
    ringTimer = setTimeout(function () { endCall(true); }, NO_ANSWER_MS + 5000);
  }

  function acceptIncoming() {
    var who = myName();
    if (who) Transport.myName = who;
    Ring.stop();
    clearTimers();
    document.title = pageTitle;
    if (answerBox) answerBox.hidden = true;
    subEl.textContent = 'соединяем…';

    Transport.openCamera().then(function (stream) {
      showSelf(stream);
      Transport.share();
      Transport.answer(true);
      goTalking();
    }).catch(function (err) {
      Transport.answer(false);
      showError(err);
    });
  }

  function declineIncoming() {
    Transport.answer(false);
    endCall(true);
  }

  // ── Потеря связи: не кладём трубку сразу, даём вернуться ──
  function setLost(on) {
    overlay.classList.toggle('lost', !!on);
    if (lostEl) lostEl.hidden = !on;
  }

  // ─────────────────────────────────────────────────────────────
  // Транспорт → UI
  // ─────────────────────────────────────────────────────────────
  Transport.onRemote = function (stream) {
    pending = pending || {};
    pending.video = stream;
    if (is('talking')) attachRemote();
  };

  Transport.onRemoteAudio = function (stream) {
    pending = pending || {};
    pending.audio = stream;
    if (is('talking')) attachRemote();
  };

  Transport.onRing = function (name) { showIncoming(name); };

  Transport.onRingCancel = function () {
    if (is('incoming')) endCall(true);
  };

  Transport.onAnswer = function (ok) {
    if (!is('calling')) return;
    if (ok) {
      // Трубку взяли — вот теперь отдаём свой поток.
      Transport.share();
      goTalking();
    } else {
      Ring.stop();
      clearTimers();
      titleEl.textContent = 'Сейчас не может';
      subEl.textContent = 'перезвони попозже ♥';
      closeTimer = setTimeout(function () { endCall(true); }, 2600);
    }
  };

  Transport.onBye = function () {
    // Прощание от того, кто просто открыл страницу, не должно ничего ронять.
    if (overlay.classList.contains('on')) endCall(true);
  };

  Transport.onPeerHere = function () {
    if (lostTimer) {
      // Вернулся: поток он отдаст сам, обработчик onPeerJoin уже отправил ему наш.
      clearTimeout(lostTimer); lostTimer = null;
      setLost(false);
    }
    updatePresence();
  };

  Transport.onPeerGone = function (id, свой) {
    updatePresence();
    // Пока никто не ответил, собеседник ещё не назначен: тогда «наш» уход —
    // это уход последнего, кто вообще был в комнате. Иначе звонок продолжал бы
    // звонить в пустоту, когда вторая сторона просто закрыла сайт.
    if (!свой && !Transport.hasPeer() && (is('calling') || is('incoming'))) свой = true;
    // Ушла чужая вкладка — нас это не касается.
    if (!свой && (is('talking') || is('calling') || is('incoming'))) return;
    if (is('talking')) {
      // Мобильная сеть теряет соединение на переходе между вышками —
      // класть трубку сразу означало бы обрывать разговор на ровном месте.
      setLost(true);
      if (lostTimer) clearTimeout(lostTimer);
      lostTimer = setTimeout(function () { endCall(true); }, LOST_MS);
    } else if (is('calling') || is('incoming')) {
      endCall(true);
    }
  };

  Transport.onHeart = function (d) {
    if (!is('talking')) return;
    popHeart(typeof d.x === 'number' ? d.x : 0.5, typeof d.y === 'number' ? d.y : 0.5, false);
    window.buzz && window.buzz(8);
  };

  Transport.onSticker = function (d) {
    if (!is('talking')) return;
    var x = typeof d.x === 'number' ? d.x : 0.5;
    var y = typeof d.y === 'number' ? d.y : 0.5;
    if (d.sticky) stickOn(d.emoji || '\u2764\ufe0f', x, y);
    else flyIn(d.emoji || '\u2764\ufe0f', x, y, false);
    window.buzz && window.buzz(10);
  };

  Transport.onShot = function () {
    if (!is('talking')) return;
    var who = myName();
    toast((who ? otherOf(who) : 'Собеседник') + ' сохранил этот кадр \u2665');
  };

  Transport.onFail = function () {
    // Пока идёт разговор или дозвон, эта ошибка почти всегда про постороннего
    // участника комнаты, с которым соединиться не вышло. Рушить из-за него
    // живой экран нельзя.
    if (is('talking') || is('calling') || is('incoming')) return;
    Ring.stop();
    titleEl.textContent = 'Связь оборвалась';
    subEl.textContent = 'Попробуй позвонить ещё раз ♥';
  };

  // ─────────────────────────────────────────────────────────────
  // Кнопки
  // ─────────────────────────────────────────────────────────────
  function toggle(btn, fn) {
    var on = btn.dataset.on === '1';
    btn.dataset.on = on ? '0' : '1';
    fn(!on);
    window.buzz && window.buzz(10);
  }

  micBtn && micBtn.addEventListener('click', function () {
    toggle(micBtn, Transport.setAudio);
  });

  camBtn && camBtn.addEventListener('click', function () {
    toggle(camBtn, function (on) {
      Transport.setVideo(on);
      selfBox && selfBox.classList.toggle('cam-off', !on);
    });
  });

  voiceBtn && voiceBtn.addEventListener('click', function () {
    setVoice(!overlay.classList.contains('voice'));
  });

  qualityEl && qualityEl.addEventListener('click', function () { setVoice(true); });

  flipBtn && flipBtn.addEventListener('click', function () {
    flipBtn.disabled = true;
    Transport.switchCamera().then(function (ok) {
      flipBtn.disabled = false;
      if (ok) {
        // Дорожка в потоке поменялась — пересадим его в элемент заново,
        // иначе часть браузеров продолжает показывать замерший кадр.
        if (selfVideo && Transport.local) {
          selfVideo.srcObject = Transport.local;
          selfVideo.play().catch(function () {});
        }
        window.buzz && window.buzz(10);
      }
    });
  });

  pipBtn && pipBtn.addEventListener('click', function () {
    // Уголок работает только с настоящим видео собеседника —
    // из чужого iframe этого сделать нельзя, поэтому и свой рендер.
    var v = remoteVideo && remoteVideo.srcObject ? remoteVideo : selfVideo;
    if (!v || !document.pictureInPictureEnabled) {
      subEl.textContent = 'Этот браузер не умеет «в уголок»';
      return;
    }
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(function () {});
    } else {
      v.requestPictureInPicture().catch(function () {});
    }
  });

  // Тап по кадру — сердечко у обоих. Только в разговоре: в остальных
  // состояниях сверху лежит экран состояния, и тыкать не во что.
  stage && stage.addEventListener('click', function (e) {
    if (!is('talking')) return;
    var r = stage.getBoundingClientRect();
    var x = (e.clientX - r.left) / r.width;
    var y = (e.clientY - r.top) / r.height;
    popHeart(x, y, true);
    Transport.sendHeart(x, y);
    window.buzz && window.buzz(8);
  });

  // Музыкальный режим: без шумодава и эхоподавления, битрейт выше.
  // Нужен, когда важно не «что сказали», а «как звучит».
  musicBtn && musicBtn.addEventListener('click', function () {
    var on = musicBtn.dataset.on !== '1';
    musicBtn.disabled = true;
    Transport.setMusic(on).then(function (ok) {
      musicBtn.disabled = false;
      if (!ok) { toast('Не вышло переключить микрофон'); return; }
      musicBtn.dataset.on = on ? '1' : '0';
      musicBtn.classList.toggle('lit', on);
      toast(on ? 'Музыкальный звук \u266a' : 'Обычный разговор');
      window.buzz && window.buzz(12);
    });
  });

  fxBtn && fxBtn.addEventListener('click', function () {
    toggleFx(fxPanel && fxPanel.hidden);
  });

  stickBtn && stickBtn.addEventListener('click', function () {
    toggleSticks(stickPanel && stickPanel.hidden);
  });

  shotBtn && shotBtn.addEventListener('click', snapshot);

  sleepBtn && sleepBtn.addEventListener('click', function () {
    setSleep(!overlay.classList.contains('sleep'));
    window.buzz && window.buzz(14);
  });

  // В ночном режиме любое касание ненадолго возвращает яркость.
  overlay.addEventListener('pointerdown', function () {
    if (overlay.classList.contains('sleep')) wakeUpDim();
  });

  hangBtn && hangBtn.addEventListener('click', function () { endCall(); });
  openBtn && openBtn.addEventListener('click', beginFlow);
  pickBtn && pickBtn.addEventListener('click', acceptIncoming);
  denyBtn && denyBtn.addEventListener('click', declineIncoming);

  whoBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      var name = b.dataset.who || 'Гость';
      save(WHO_KEY, name);
      Transport.myName = name;
      Transport.announce();
      startCall(name);
    });
  });

  inviteBtn && inviteBtn.addEventListener('click', function () {
    // Пуша, когда сайт закрыт, быть не может без сервера — зовём через
    // мессенджер: открываем шаринг с готовым текстом и ссылкой на сайт.
    var text = 'Я жду тебя в нашей комнате ♥ ' + location.origin;
    if (navigator.share) {
      navigator.share({ text: text }).catch(function () {});
    } else {
      window.open('https://t.me/share/url?url=' + encodeURIComponent(location.origin) +
        '&text=' + encodeURIComponent('Я жду тебя в нашей комнате ♥'), '_blank');
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && overlay.classList.contains('on')) endCall();
  });

  // Закрывают страницу — выходим из комнаты честно, чтобы у второго
  // огонёк погас сразу, а не по таймауту.
  window.addEventListener('pagehide', function () { Transport.leave(); });

  // ─────────────────────────────────────────────────────────────
  // Комната открывается сразу после разблокировки сайта: без неё нельзя
  // ни увидеть, что второй в сети, ни получить от него звонок.
  // Событие может прийти раньше, чем мы подпишемся, — отсюда защёлка.
  // ─────────────────────────────────────────────────────────────
  function goOnline() {
    Transport.myName = myName();
    Transport.join().catch(function (e) {
      try { console.warn('[звонок] комната не открылась', e && (e.message || e)); } catch (x) {}
    });
  }

  if (window.__katyaUnlocked) goOnline();
  else document.addEventListener('katya:unlocked', goOnline, { once: true });

  // Наружу — для секции статистики и соседних модулей.
  window.katyaCall = {
    totalSeconds: function () { return parseInt(load(TOTAL_KEY, '0'), 10) || 0; },
    history: function () { try { return JSON.parse(load(LOG_KEY, '[]')); } catch (e) { return []; } },
    open: beginFlow,
    online: function () { return Transport.hasPeer(); },
    // Диагностика наружу: если однажды «а почему рвётся» или «почему мыльно» —
    // в консоли видно задержку, потери и что реально стоит на дорожках.
    quality: function () { return Transport.quality(); },
    stats: function () {
      var enc = function (kind) {
        return Transport._senders(kind).map(function (snd) {
          var p = {};
          try { p = snd.getParameters() || {}; } catch (e) {}
          var e0 = (p.encodings && p.encodings[0]) || {};
          return {
            maxBitrate: e0.maxBitrate,
            scaleResolutionDownBy: e0.scaleResolutionDownBy,
            degradationPreference: p.degradationPreference
          };
        });
      };
      return {
        ступень: Transport.tier,
        качество: Transport.tierName(),
        музыкальныйРежим: Transport.music,
        видео: enc('video'),
        звук: enc('audio')
      };
    }
  };
})();

// ═══ ИСТОРИЯ РАЗГОВОРОВ И КОПИЛКА ЧАСОВ ═══
// Всё живёт в localStorage: сервер для этого не нужен, а данные
// у каждого свои — это личная память устройства, а не общая база.
(function () {
  var noteEl = document.getElementById('callTotal');
  var logEl = document.getElementById('callLog');
  var listEl = document.getElementById('callLogList');
  if (!window.katyaCall) return;

  function human(sec) {
    if (sec < 60) return sec + ' сек';
    var h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    if (h > 0) return m > 0 ? h + ' ч ' + m + ' мин' : h + ' ч';
    return Math.max(1, Math.floor(sec / 60)) + ' мин';
  }

  function when(ts) {
    var d = new Date(ts);
    var today = new Date();
    var sameDay = d.toDateString() === today.toDateString();
    var time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    if (sameDay) return 'Сегодня, ' + time;
    var yest = new Date(today.getTime() - 864e5);
    if (d.toDateString() === yest.toDateString()) return 'Вчера, ' + time;
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) + ', ' + time;
  }

  // Сколько дней подряд созванивались. Считаем назад от сегодня; если
  // сегодня ещё не говорили, цепочка может начинаться со вчера — иначе
  // серия обрывалась бы каждое утро.
  function streak(log) {
    var days = {};
    log.forEach(function (item) { days[new Date(item.at).toDateString()] = true; });
    var day = new Date();
    if (!days[day.toDateString()]) day = new Date(day.getTime() - 864e5);
    var n = 0;
    while (days[day.toDateString()]) {
      n++;
      day = new Date(day.getTime() - 864e5);
    }
    return n;
  }

  function plural(n, one, few, many) {
    var a = n % 10, b = n % 100;
    if (a === 1 && b !== 11) return one;
    if (a >= 2 && a <= 4 && (b < 10 || b >= 20)) return few;
    return many;
  }

  function renderStats(log) {
    var box = document.getElementById('callStats');
    if (!box) return;
    var chips = [];

    var longest = log.reduce(function (m, i) { return i.sec > m ? i.sec : m; }, 0);
    if (longest >= 60) chips.push('Самый длинный — ' + human(longest));

    var n = streak(log);
    if (n >= 2) chips.push(n + ' ' + plural(n, 'день', 'дня', 'дней') + ' подряд');

    if (log.length >= 5) {
      chips.push(log.length + ' ' + plural(log.length, 'звонок', 'звонка', 'звонков'));
    }

    box.innerHTML = '';
    chips.forEach(function (t) {
      var el = document.createElement('span');
      el.className = 'call-chip';
      el.textContent = t;
      box.appendChild(el);
    });
    box.hidden = !chips.length;
  }

  function render() {
    var total = window.katyaCall.totalSeconds();
    if (noteEl && total >= 60) {
      noteEl.textContent = 'Мы уже наговорили ' + human(total) + ' ♥';
    }

    var log = window.katyaCall.history();
    if (!logEl || !listEl || !log.length) return;
    renderStats(log);

    listEl.innerHTML = '';
    log.slice(0, 8).forEach(function (item) {
      var li = document.createElement('li');
      var w = document.createElement('span');
      w.className = 'call-log-when';
      w.textContent = when(item.at);
      var l = document.createElement('span');
      l.className = 'call-log-len';
      l.textContent = human(item.sec);
      li.appendChild(w); li.appendChild(l);
      listEl.appendChild(li);
    });

    if (log.length > 8) {
      var more = logEl.querySelector('.call-log-more');
      if (!more) {
        more = document.createElement('div');
        more.className = 'call-log-more';
        logEl.appendChild(more);
      }
      more.textContent = 'и ещё ' + (log.length - 8);
    }
    logEl.hidden = false;
  }

  render();
  // после звонка список должен обновиться без перезагрузки
  document.addEventListener('katya:call-ended', render);
})();
