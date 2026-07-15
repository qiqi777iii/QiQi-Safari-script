// ==UserScript==
// @name         播放当前页视频
// @namespace    https://github.com/qiqi777iii/Scripts
// @version      1.0.1
// @updateURL    https://raw.githubusercontent.com/qiqi777iii/Scripts/main/userscripts/video-player.user.js
// @downloadURL  https://raw.githubusercontent.com/qiqi777iii/Scripts/main/userscripts/video-player.user.js
// @description  检测并控制当前网页视频，支持播放、暂停、快进、后退和全屏。
// @match        *://*/*
// @run-at       document-start
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.registerMenuCommand
// ==/UserScript==

(async function () {
  "use strict";

  const POS_KEY = "videoplay-fab-pos";
  const Z = "2147483646";
  const BTN_SIZE = 35;
  const BOTTOM_GAP = 28;
  const STACK_GAP = 12;
  const INNER_GAP = 8;
  const TOOLBAR_W = BTN_SIZE * 7 + INNER_GAP * 6;
  const PAGER_RIGHT_GAP = 16;
  const PAGER_HEIGHT = 35;
  const DEFAULT_RIGHT = PAGER_RIGHT_GAP;
  const DEFAULT_BOTTOM = BOTTOM_GAP + PAGER_HEIGHT + STACK_GAP;
  const CURRENT_LAYOUT_VERSION = '1.0.44';
  const MIN_MAIN_VIDEO_W = 180;
  const MIN_MAIN_VIDEO_H = 120;
  const MIN_MAIN_VIDEO_AREA_RATIO = 0.12;
  const MIN_MAIN_VIDEO_AREA_ABS = 42000;

  function isolateFloatingUi(root) {
    function absorb(e) {
      e.preventDefault();
      e.stopPropagation();
    }
    ['pointerdown', 'pointerup', 'pointercancel', 'touchstart', 'touchend', 'mousedown', 'mouseup', 'click'].forEach(function (type) {
      root.addEventListener(type, absorb, { passive: false });
    });
  }

  // ---------- 播放逻辑 ----------

  // 收集所有可访问的 <video>（含同源 iframe）
  function collectVideos() {
    const list = [];
    const pushFrom = (doc) => {
      try {
        doc.querySelectorAll("video").forEach((v) => list.push(v));
      } catch (e) { /* ignore */ }
    };
    pushFrom(document);
    // 同源 iframe
    try {
      document.querySelectorAll("iframe").forEach((f) => {
        try {
          const d = f.contentDocument;
          if (d) pushFrom(d);
        } catch (e) { /* 跨域 iframe 不可访问，忽略 */ }
      });
    } catch (e) { /* ignore */ }
    return list;
  }

  // 计算可见面积（在视口内的矩形面积），用于挑选「当前」视频
  function visibleArea(el) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return 0;
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const x1 = Math.max(0, r.left);
    const y1 = Math.max(0, r.top);
    const x2 = Math.min(vw, r.right);
    const y2 = Math.min(vh, r.bottom);
    const w = Math.max(0, x2 - x1);
    const h = Math.max(0, y2 - y1);
    return w * h;
  }

  // 挑选「当前」视频：按可见面积降序，可见的优先；都不可见则按原始面积
  function findCurrentVideo() {
    const videos = collectVideos();
    if (videos.length === 0) return null;
    videos.sort((a, b) => {
      const va = visibleArea(a), vb = visibleArea(b);
      if (vb !== va) return vb - va;
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return (rb.width * rb.height) - (ra.width * ra.height);
    });
    return videos[0];
  }

  function getViewportArea() {
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    return Math.max(1, vw * vh);
  }

  function isLargeMediaElement(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width < MIN_MAIN_VIDEO_W || r.height < MIN_MAIN_VIDEO_H) return false;
    const area = visibleArea(el);
    if (area <= 0) return false;
    const minArea = Math.min(MIN_MAIN_VIDEO_AREA_ABS, getViewportArea() * MIN_MAIN_VIDEO_AREA_RATIO);
    return area >= minArea;
  }

  function findLargeCurrentVideo() {
    const videos = collectVideos().filter(isLargeMediaElement);
    if (videos.length === 0) return null;
    videos.sort((a, b) => visibleArea(b) - visibleArea(a));
    return videos[0];
  }

  function isVideoPlaying(v) {
    return !!(v && !v.paused && !v.ended && v.readyState > 1);
  }

  // 当前是否有视频正在播放：播放后即使滚动到视口外，也要保持按钮显示，方便随时暂停/切换。
  function isAnyPlaying() {
    if (isRule34VideoPage()) return isRule34MainVideoPlaying();
    return collectVideos().some(isVideoPlaying);
  }

  function isRule34VideoPage() {
    const host = location.hostname.replace(/^www\./, '').toLowerCase();
    return /(^|\.)rule34video\.com$/.test(host) && /^\/video\/\d+\//i.test(location.pathname);
  }

  function getRule34PlayerRoot() {
    if (!isRule34VideoPage()) return null;
    return document.getElementById('kt_player') || document.querySelector('.player-holder');
  }

  function getRule34Videos() {
    const root = getRule34PlayerRoot();
    if (!root) return [];
    try {
      return Array.from(root.querySelectorAll('video')).sort((a, b) => visibleArea(b) - visibleArea(a));
    } catch (e) {
      return [];
    }
  }

  function isRule34MainVideo(v) {
    if (!v) return false;
    const src = v.currentSrc || v.src || '';
    if (/rule34video\.com\/get_file\//i.test(src) || /\/get_file\/\d+\//i.test(src)) return true;
    const duration = Number.isFinite(v.duration) ? v.duration : 0;
    if (duration >= 45 && isLargeMediaElement(v)) return true;
    return false;
  }

  function getRule34MainVideo() {
    const videos = getRule34Videos();
    return videos.find(isRule34MainVideo) || videos.find((v) => hasSource(v) && isLargeMediaElement(v)) || videos[0] || null;
  }

  function isRule34MainVideoPlaying() {
    return getRule34Videos().some((v) => isRule34MainVideo(v) && isVideoPlaying(v));
  }

  // 静音守护（一次性、极短时窗）：不少播放器（如 kt_player）会在初始化/播放瞄那一下把 muted
  // 改回 false。脚本只需把「站点初始自发解除静音」的那一两下压回，然后立即彻底退出，
  // 把播放器完全还给用户——之后的「点暂停 / 手动解除静音 / 拖进度」都不受脚本干扰。
  // 关键：不用 setInterval 轮询（那会持续干扰控制）；只挂一个 volumechange 监听，到点自动拆除。
  const _mutedGuards = new WeakSet();   // 已挂守护的 video
  function enforceMute(v, durationMs) {
    if (!v) return;
    // 立即压一次
    v.muted = true; v.defaultMuted = true;
    try { v.volume = 0; } catch (e) {}
    if (_mutedGuards.has(v)) return;
    _mutedGuards.add(v);

    const WINDOW = durationMs || 1200;   // 只守护初始化窗口（1.2s）
    const start = Date.now();
    let released = false;

    const cleanup = () => {
      if (released) return;
      released = true;
      v.removeEventListener("volumechange", onVol);
      v.removeEventListener("click", onUser, true);
      v.removeEventListener("touchend", onUser, true);
      v.removeEventListener("keydown", onUser, true);
      _mutedGuards.delete(v);
    };

    // 用户主动手势 → 立即彻底放手，不再压回（你手动解除静音/暂停不会被干扰）
    const onUser = () => cleanup();

    // 站点在初始化窗口内解除静音 → 压回；过了窗口就放行并拆除监听
    const onVol = () => {
      if (Date.now() - start > WINDOW) { cleanup(); return; }
      if (!v.muted || v.volume > 0) {
        v.muted = true; v.defaultMuted = true;
        try { v.volume = 0; } catch (e) {}
      }
    };

    v.addEventListener("volumechange", onVol);
    v.addEventListener("click", onUser, true);
    v.addEventListener("touchend", onUser, true);
    v.addEventListener("keydown", onUser, true);
    // 到点兑底拆除（即使期间没发生 volumechange）
    setTimeout(cleanup, WINDOW + 100);
  }

  // 有声守护（与 enforceMute 对称）：有些站点视频默认带 muted 属性，或在初始化/播放瞬间
  // 把视频压回静音，导致「正常播放」其实没声音。这里在短时窗内只要发现被站点静音就解回，
  // 用户一旦主动操作（点击/触摸/按键）就立即放手，不再干扰。
  const _soundGuards = new WeakSet();
  function enforceSound(v, durationMs) {
    if (!v) return;
    // 立即解一次静音
    v.muted = false; v.defaultMuted = false;
    v.removeAttribute("muted");
    try { if (v.volume === 0) v.volume = 1; } catch (e) {}
    if (_soundGuards.has(v)) return;
    _soundGuards.add(v);

    const WINDOW = durationMs || 1500;
    const start = Date.now();
    let released = false;

    const cleanup = () => {
      if (released) return;
      released = true;
      v.removeEventListener("volumechange", onVol);
      v.removeEventListener("click", onUser, true);
      v.removeEventListener("touchend", onUser, true);
      v.removeEventListener("keydown", onUser, true);
      _soundGuards.delete(v);
    };

    // 用户主动手势 → 立即彻底放手（你想静音/调音量不会被干扰）
    const onUser = () => cleanup();

    // 站点在初始化窗口内把视频静音 → 解回；过了窗口就放行并拆除监听
    const onVol = () => {
      if (Date.now() - start > WINDOW) { cleanup(); return; }
      if (v.muted || v.volume === 0) {
        v.muted = false; v.defaultMuted = false;
        try { if (v.volume === 0) v.volume = 1; } catch (e) {}
      }
    };

    v.addEventListener("volumechange", onVol);
    v.addEventListener("click", onUser, true);
    v.addEventListener("touchend", onUser, true);
    v.addEventListener("keydown", onUser, true);
    setTimeout(cleanup, WINDOW + 100);
  }

  // 尝试播放单个 video（muted=true 静音守护 / muted=false 有声守护）
  async function playVideo(v, muted) {
    try {
      if (muted) {
        enforceMute(v, 1200);
        v.setAttribute("muted", "");
      } else {
        // 正常播放：带声音，并在初始化窗口内盯防站点把它压回静音
        enforceSound(v, 1500);
      }
      v.setAttribute("playsinline", "");
      v.playsInline = true;
      const p = v.play();
      if (p && typeof p.then === "function") {
        await p;
      }
      return !v.paused;
    } catch (e) {
      return false;
    }
  }

  // 判断 video 当前是否已经有可播放的源
  function hasSource(v) {
    if (!v) return false;
    if (v.currentSrc || v.src) return true;
    if (v.querySelector && v.querySelector("source[src]")) return true;
    if (typeof v.readyState === "number" && v.readyState > 0) return true;
    return false;
  }

  // 等待 video 拿到源（懒加载播放器点击后是异步的）
  function waitForSource(v, timeout) {
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        if (hasSource(v)) return resolve(true);
        if (Date.now() - start > timeout) return resolve(false);
        setTimeout(tick, 150);
      };
      tick();
    });
  }

  // 找到「播放器容器/中央播放键」并模拟点击（覆盖懒加载播放器：kt_player / RMP / flowplayer 等）
  // near: 可选，传入目标 video，优先点它附近的播放器容器
  function isBadOverlayCandidate(el) {
    if (!el) return true;
    const raw = [
      el.id, el.className, el.getAttribute?.('aria-label'), el.getAttribute?.('title'),
      el.getAttribute?.('data-title'), el.getAttribute?.('data-action'), el.getAttribute?.('href'),
      (el.textContent || '').slice(0, 80)
    ].join(' ').toLowerCase();

    // Pornhub 等站点的「Add to playlist / favorite / save」也会命中 aria-label*="play"。
    // 这些不是播放器播放键，必须排除，避免点击脚本按钮时弹出收藏/列表面板。
    if (/playlist|play-list|favorite|favourite|bookmark|collection|watch\s*later|save|share|download|report|flag|comment|subscribe|like|dislike|收藏|列表|播放列表|稍后|保存|分享|下载|举报|评论|订阅|喜欢|不喜欢/.test(raw)) return true;

    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return true;
    if (r.width < 8 || r.height < 8) return true;
    return false;
  }

  function isGoodPlayLabel(el) {
    const label = [
      el.getAttribute?.('aria-label'), el.getAttribute?.('title'),
      el.getAttribute?.('data-title'), el.textContent
    ].join(' ').trim().toLowerCase();
    if (!label) return false;
    if (isBadOverlayCandidate(el)) return false;
    return /(^|\b)(play|播放|▶)(\b|$)/i.test(label);
  }

  function overlaps(a, b) {
    if (!a || !b) return false;
    return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
      Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) > 0;
  }

  function isOverlayNearTarget(el, near) {
    if (!near) return true;
    const er = el.getBoundingClientRect();
    const nr = near.getBoundingClientRect();
    if (overlaps(er, nr)) return true;

    // 允许播放器祖先上的大 overlay / 播放层，但不要放行视频下方工具条、收藏按钮。
    const ecx = er.left + er.width / 2;
    const ecy = er.top + er.height / 2;
    const ncx = nr.left + nr.width / 2;
    const ncy = nr.top + nr.height / 2;
    const dx = Math.abs(ecx - ncx);
    const dy = Math.abs(ecy - ncy);
    return dx <= Math.max(nr.width * 0.55, 120) && dy <= Math.max(nr.height * 0.55, 120);
  }

  function dispatchRealClick(el) {
    if (!el) return false;
    try {
      const r = el.getBoundingClientRect();
      const x = Math.max(1, Math.floor(r.left + r.width / 2));
      const y = Math.max(1, Math.floor(r.top + r.height / 2));
      const target = document.elementFromPoint(x, y) || el;
      const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
      try { target.dispatchEvent(new PointerEvent('pointerdown', opts)); } catch (e) {}
      try { target.dispatchEvent(new MouseEvent('mousedown', opts)); } catch (e) {}
      try { target.dispatchEvent(new PointerEvent('pointerup', opts)); } catch (e) {}
      try { target.dispatchEvent(new MouseEvent('mouseup', opts)); } catch (e) {}
      try { target.dispatchEvent(new MouseEvent('click', opts)); } catch (e) { target.click?.(); }
      return true;
    } catch (e) {
      try { el.click(); return true; } catch (_) { return false; }
    }
  }

  function clickRule34PlayerCenter() {
    const root = getRule34PlayerRoot();
    if (!root) return false;
    const candidates = [];
    const mainVideo = getRule34MainVideo();
    if (mainVideo) candidates.push(mainVideo);
    const sels = [
      '.fp-ui', '.fp-play', '.fp-player', '.fp-engine', '.fp-ratio', '.fp-controls',
      '.kt-player', '.player-holder', '#kt_player', 'video'
    ];
    for (const sel of sels) {
      try { root.querySelectorAll(sel).forEach((n) => candidates.push(n)); } catch (e) {}
    }
    candidates.push(root);
    const seen = new Set();
    for (const n of candidates.sort((a, b) => visibleArea(b) - visibleArea(a))) {
      if (!n || seen.has(n)) continue;
      seen.add(n);
      if (!isLargeMediaElement(n) && n !== root) continue;
      if (dispatchRealClick(n)) return true;
    }
    return false;
  }

  async function playRule34Video(muted) {
    if (!isRule34VideoPage()) return false;
    let target = getRule34MainVideo();
    if (target) {
      if (muted) enforceMute(target, 1800); else enforceSound(target, 1800);
      if (hasSource(target) && await playVideo(target, muted) && isRule34MainVideoPlaying()) return true;
    }
    clickRule34PlayerCenter();
    const deadline = Date.now() + 5200;
    while (Date.now() < deadline) {
      target = getRule34MainVideo();
      if (target) {
        if (muted) enforceMute(target, 900); else enforceSound(target, 900);
        if (hasSource(target) && await playVideo(target, muted) && isRule34MainVideoPlaying()) return true;
        if (isRule34MainVideoPlaying()) return true;
      }
      await new Promise((r) => setTimeout(r, 260));
    }
    return isRule34MainVideoPlaying();
  }

  function isPornhubVideoPage() {
    const host = location.hostname.replace(/^www\./, '').toLowerCase();
    return /(^|\.)pornhub\.com$/.test(host) && /\/view_video\.php$/i.test(location.pathname);
  }

  function clickPornhubPlayerCenter(near) {
    if (!isPornhubVideoPage()) return false;
    const candidates = [];
    if (near) candidates.push(near);
    const sels = [
      '#player', '#playerContainer', '#videoContainer', '#video_player',
      '.mgp_player', '.mhp1138_player', '.video-player', '.main_video_player',
      '.mgp_bigPlay', '.mgp_playIcon', '.mhp1138_playIcon', '.mhp1138_bigPlay',
      'video'
    ];
    for (const sel of sels) {
      try { document.querySelectorAll(sel).forEach((n) => candidates.push(n)); } catch (e) {}
    }
    candidates.sort((a, b) => visibleArea(b) - visibleArea(a));
    for (const n of candidates) {
      if (!isLargeMediaElement(n)) continue;
      if (dispatchRealClick(n)) return true;
    }
    return false;
  }

  function clickPlayerOverlay(near) {
    const strictSelectors = [
      // —— 懒加载封面/大播放键（点了才会去加载源）——
      "#kt_player .fp-ui", "#kt_player",   // kt_player（keekass 等）
      ".fp-player .fp-ui", ".fp-ui",       // flowplayer
      ".rmp-i-play", ".rmp-overlay",        // Radiant Media Player
      // —— 常见自定义播放器大播放键 ——
      ".vjs-big-play-button", "#EPvideo", "#EPvideo_html5_api", ".video-js", // video.js / Eporner
      ".plyr__control--overlaid",          // plyr
      '.jw-icon-display', '.jw-icon-playback', '.jw-display-icon-display', '.jwplayer', // jwplayer
      ".dplayer-play-icon",                // dplayer
      ".prism-big-play-btn",               // 阿里云
      ".xgplayer-start",                   // 西瓜
      ".ytp-large-play-button",            // youtube
      ".mgp_playIcon", ".mgp_bigPlay", ".mhp1138_playIcon", // Pornhub/MindGeek player 常见大播放键
      ".play-button", ".btn-play", ".video-play-button", "button.play",
    ];
    const labelSelectors = [
      '[aria-label*="play" i]',
      '[aria-label*="播放"]',
      '[title*="play" i]',
      '[title*="播放"]',
    ];

    // 先在 near 的播放器祖先容器内找
    const scopes = [];
    if (near) {
      let c = near;
      for (let i = 0; i < 5 && c && c.parentElement; i++) { c = c.parentElement; scopes.push(c); }
    }
    scopes.push(document);

    const tryClick = (n, requireGoodLabel) => {
      if (isBadOverlayCandidate(n)) return false;
      if (requireGoodLabel && !isGoodPlayLabel(n)) return false;
      if (!isOverlayNearTarget(n, near)) return false;
      if (/jw-|jwplayer/.test((n.className || '').toString()) || n.id === 'my-video') return dispatchRealClick(n);
      try { n.click(); return true; } catch (e) { return false; }
    };

    for (const scope of scopes) {
      for (const sel of strictSelectors) {
        let nodes;
        try { nodes = scope.querySelectorAll(sel); } catch (e) { continue; }
        for (const n of nodes) if (tryClick(n, false)) return true;
      }
      for (const sel of labelSelectors) {
        let nodes;
        try { nodes = scope.querySelectorAll(sel); } catch (e) { continue; }
        for (const n of nodes) if (tryClick(n, true)) return true;
      }
    }
    return false;
  }

  // 兼容模式主入口
  async function playCurrentPageVideo(muted) {
    if (isRule34VideoPage()) {
      if (await playRule34Video(muted)) { toast(muted ? "🔇 已静音播放" : "🔊 已正常播放"); return; }
      toast("已点播放键，若仍不动请再点一次播放器");
      return;
    }
    const videos = collectVideos();
    if (videos.length > 0) {
      // 按可见面积降序，可见的优先；都不可见则按原始面积
      videos.sort((a, b) => {
        const va = visibleArea(a), vb = visibleArea(b);
        if (vb !== va) return vb - va;
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        return (rb.width * rb.height) - (ra.width * ra.height);
      });
      const target = videos[0];

      // Pornhub/MindGeek 详情页：先像真实手指一样点播放器中心。
      // 这类播放器有时会忽略 video.play() 或普通 element.click()，必须让站点自己的播放器收到 pointer/mouse 事件。
      if (isPornhubVideoPage()) {
        if (muted) enforceMute(target, 1800); else enforceSound(target, 1800);
        clickPornhubPlayerCenter(target);
        await new Promise((r) => setTimeout(r, 260));
        for (const v of collectVideos()) {
          if (await playVideo(v, muted)) { toast(muted ? "🔇 已静音播放" : "🔊 已正常播放"); return; }
        }
      }

      // 情况 A：目标 video 已有源 → 直接静音播放
      if (hasSource(target)) {
        for (const v of videos) {
          if (await playVideo(v, muted)) { toast(muted ? "🔇 已静音播放" : "🔊 已正常播放"); return; }
        }
      }

      // 情况 B：有 video 但没源（懒加载封面态）→ 先点播放器触发加载，再播
      toast("⏳ 正在载入视频…");
      // 点击播放器前先挂上静音盯防（站点加载后会解除静音）
      if (muted) enforceMute(target, 1500);
      if (await playOhentaiWithJwplayerApi(muted)) { toast(muted ? "🔇 已静音播放" : "🔇 已静音播放"); return; }
      if (!clickOhentaiPlayerCenter() && !clickPornhubPlayerCenter(target)) clickPlayerOverlay(target);
      const got = await waitForSource(target, 4000);
      // 不管有没有等到源，都再尝试 play（站点点击后常会自动播放）
      await new Promise((r) => setTimeout(r, 300));
      for (const v of collectVideos()) {
        if (await playVideo(v, muted)) { toast(muted ? "🔇 已静音播放" : "🔊 已正常播放"); return; }
      }
      if (got) { toast("▶️ 已触发播放"); return; }
      // 源始终没出现：可能站点要求带声音手势，提示用户
      toast("已点播放键，若仍不动请再点一次播放器");
      return;
    }

    // 没有可访问的 <video>（多为跨域 iframe 播放器）→ 点通用播放键兜底
    if (await playOhentaiWithJwplayerApi(false) || clickOhentaiPlayerCenter() || clickPornhubPlayerCenter(null) || clickPlayerOverlay(null)) {
      toast("▶️ 已触发播放器播放");
      return;
    }
    toast("未找到可播放的视频（可能在跨域 iframe 内）");
  }

  // ---------- 轻提示（已禁用，不显示任何文字提示） ----------
  function toast(_msg) { /* no-op：用户要求不写提示 */ }

  // ---------- SVG 图标（深色毛玻璃底盘上用白色，对比最高） ----------
  const COLOR_ICON = "#ffffff";
  function playSVG() {
    // 实心播放三角（白色，略右偏以在圆心视觉居中）
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="' + COLOR_ICON + '" stroke="' + COLOR_ICON + '" stroke-width="1.5" stroke-linejoin="round" style="pointer-events:none;margin-left:1px"><path d="M8 6l10 6-10 6z"/></svg>';
  }

  function pauseSVG() {
    // 实心双竖条暂停（白色）
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="' + COLOR_ICON + '" stroke="' + COLOR_ICON + '" stroke-width="1" stroke-linejoin="round" style="pointer-events:none"><rect x="7" y="5" width="4" height="14" rx="1"/><rect x="13" y="5" width="4" height="14" rx="1"/></svg>';
  }

  function seekSVG(dir) {
    const arrow = dir < 0
      ? '<path d="M11 7l-5 5 5 5V7z"/><path d="M18 7l-5 5 5 5V7z"/>'
      : '<path d="M6 7l5 5-5 5V7z"/><path d="M13 7l5 5-5 5V7z"/>';
    const x = dir < 0 ? 8.5 : 6.5;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="25" height="25" fill="' + COLOR_ICON + '" style="pointer-events:none">'
      + arrow
      + '<text x="' + x + '" y="21" font-size="7" font-family="-apple-system,BlinkMacSystemFont,Arial" font-weight="700" fill="' + COLOR_ICON + '">5</text>'
      + '</svg>';
  }

  function nextPlaylistSVG() {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="' + COLOR_ICON + '" stroke="' + COLOR_ICON + '" stroke-width="1.5" stroke-linejoin="round" style="pointer-events:none">'
      + '<path d="M6 6l8 6-8 6V6z"/>'
      + '<rect x="16.5" y="6" width="2.5" height="12" rx="1"/>'
      + '</svg>';
  }

  function prevPlaylistSVG() {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="' + COLOR_ICON + '" stroke="' + COLOR_ICON + '" stroke-width="1.5" stroke-linejoin="round" style="pointer-events:none">'
      + '<rect x="5" y="6" width="2.5" height="12" rx="1"/>'
      + '<path d="M18 6l-8 6 8 6V6z"/>'
      + '</svg>';
  }

  function fullscreenSVG() {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="' + COLOR_ICON + '" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none">'
      + '<path d="M8 4H4v4"/><path d="M16 4h4v4"/><path d="M4 16v4h4"/><path d="M20 16v4h-4"/>'
      + '<path d="M9 9L4.8 4.8"/><path d="M15 9l4.2-4.2"/><path d="M9 15l-4.2 4.2"/><path d="M15 15l4.2 4.2"/>'
      + '</svg>';
  }

  // iPhone Safari 原生 video 全屏优先用 webkitEnterFullscreen；其它环境再走标准 Fullscreen API。
  function requestElementFullscreen(el) {
    if (!el) return false;
    try { if (typeof el.webkitEnterFullscreen === 'function') { el.webkitEnterFullscreen(); return true; } } catch (e) {}
    try { if (typeof el.webkitRequestFullscreen === 'function') { el.webkitRequestFullscreen(); return true; } } catch (e) {}
    try { if (typeof el.requestFullscreen === 'function') { el.requestFullscreen(); return true; } } catch (e) {}
    return false;
  }

  function getFullscreenTarget() {
    const video = getSeekTargetVideo();
    if (video) return video;
    const candidates = ['#EPvideo', '.video-js', '#player', '#video_player', '.player', '.video-player', '.jwplayer', '.plyr', '.dplayer', '.xgplayer', '#kt_player'];
    for (const sel of candidates) {
      try {
        const nodes = Array.from(document.querySelectorAll(sel)).filter(isLargeMediaElement).sort((a, b) => visibleArea(b) - visibleArea(a));
        if (nodes[0]) return nodes[0];
      } catch (e) {}
    }
    return null;
  }

  function enterFullscreenForCurrentVideo() {
    const target = getFullscreenTarget();
    if (!target) return;
    if (requestElementFullscreen(target)) return;
    const container = target.closest?.('.video-js, .jwplayer, .plyr, .dplayer, .xgplayer, #player, #video_player, .player, .video-player, #kt_player');
    requestElementFullscreen(container || target);
  }

  // 角标：🔊 带声音（绿）/ 🔇 静音（红），常驻右下角标识按钮身份
  function soundBadgeSVG() {
    return '<span style="position:absolute;right:0;bottom:0;width:15px;height:15px;border-radius:50%;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;pointer-events:none">'
      + '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="11" height="11" fill="#34d058" style="pointer-events:none"><path d="M4 9v6h4l5 5V4L8 9H4z"/><path d="M16.5 8a5.5 5.5 0 010 8" fill="none" stroke="#34d058" stroke-width="2" stroke-linecap="round"/></svg></span>';
  }
  function muteBadgeSVG() {
    return '<span style="position:absolute;right:0;bottom:0;width:15px;height:15px;border-radius:50%;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;pointer-events:none">'
      + '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="11" height="11" fill="#ff6b6b" style="pointer-events:none"><path d="M4 9v6h4l5 5V4L8 9H4z"/><line x1="16" y1="9" x2="22" y2="15" stroke="#ff6b6b" stroke-width="2" stroke-linecap="round"/><line x1="22" y1="9" x2="16" y2="15" stroke="#ff6b6b" stroke-width="2" stroke-linecap="round"/></svg></span>';
  }

  // 根据当前播放状态 + 按钮身份(sound/mute) 渲染图标
  function renderBtn(btn, mode, playing) {
    if (!btn) return;
    const want = (playing ? 'pause' : 'play') + ':' + mode;
    if (btn.dataset.icon === want) return;
    btn.dataset.icon = want;
    btn.innerHTML = (playing ? pauseSVG() : playSVG()) + (mode === 'sound' ? soundBadgeSVG() : muteBadgeSVG());
  }
  function syncIcons() {
    if (document.readyState === 'loading' && !document.querySelector('video')) {
      renderBtn(soundBtn, 'sound', false);
      renderBtn(muteBtn, 'mute', false);
      if (backBtn && backBtn.dataset.icon !== 'seek-back') { backBtn.dataset.icon = 'seek-back'; backBtn.innerHTML = seekSVG(-1); backBtn.title = '后退 5 秒'; }
      if (forwardBtn && forwardBtn.dataset.icon !== 'seek-forward') { forwardBtn.dataset.icon = 'seek-forward'; forwardBtn.innerHTML = seekSVG(1); forwardBtn.title = '前进 5 秒'; }
      if (fullscreenBtn && fullscreenBtn.dataset.icon !== 'fullscreen') { fullscreenBtn.dataset.icon = 'fullscreen'; fullscreenBtn.innerHTML = fullscreenSVG(); fullscreenBtn.title = '全屏播放'; }
      if (prevPlaylistBtn) prevPlaylistBtn.style.display = 'none';
      if (nextPlaylistBtn) nextPlaylistBtn.style.display = 'none';
      updateToolbarWidth();
      return;
    }
    const playing = isAnyPlaying();
    renderBtn(soundBtn, 'sound', playing);
    renderBtn(muteBtn, 'mute', playing);
    if (backBtn && backBtn.dataset.icon !== 'seek-back') { backBtn.dataset.icon = 'seek-back'; backBtn.innerHTML = seekSVG(-1); backBtn.title = '后退 5 秒'; }
    if (forwardBtn && forwardBtn.dataset.icon !== 'seek-forward') { forwardBtn.dataset.icon = 'seek-forward'; forwardBtn.innerHTML = seekSVG(1); forwardBtn.title = '前进 5 秒'; }
    if (fullscreenBtn && fullscreenBtn.dataset.icon !== 'fullscreen') { fullscreenBtn.dataset.icon = 'fullscreen'; fullscreenBtn.innerHTML = fullscreenSVG(); fullscreenBtn.title = '全屏播放'; }
    if (prevPlaylistBtn && prevPlaylistBtn.dataset.icon !== 'playlist-prev') { prevPlaylistBtn.dataset.icon = 'playlist-prev'; prevPlaylistBtn.innerHTML = prevPlaylistSVG(); prevPlaylistBtn.title = '播放列表上一个视频'; }
    if (nextPlaylistBtn && nextPlaylistBtn.dataset.icon !== 'playlist-next') { nextPlaylistBtn.dataset.icon = 'playlist-next'; nextPlaylistBtn.innerHTML = nextPlaylistSVG(); nextPlaylistBtn.title = '播放列表下一个视频'; }
    updatePlaylistNavVisibility();
    updateToolbarVisibility();
  }

  // ---------- 按钮（定位/拖动/点击状态机：纯 fixed，与另外三个悬浮脚本统一） ----------
  const POS_STORE_KEY = '__videoplay_';
  const POS_LEFT_KEY = 'vpLeftFixedV2';
  const POS_TOP_KEY = 'vpTopFixedV2';
  let toolbar, backBtn, soundBtn, muteBtn, forwardBtn, fullscreenBtn, prevPlaylistBtn, nextPlaylistBtn;
  let pressedBtn = null, pressMuted = true, pressAction = 'play';
  let savedPosition = null;
  let dragging = false;
  let moved = false;
  let startX = 0, startY = 0, startLeft = 0, startTop = 0;
  let busy = false;
  let toolbarVisible = true;

  function updateToolbarWidth() {
    if (!toolbar) return;
    const visibleButtons = [backBtn, soundBtn, muteBtn, forwardBtn, fullscreenBtn, prevPlaylistBtn, nextPlaylistBtn].filter((btn) => btn && btn.style.display !== 'none').length || 5;
    const nextWidth = (BTN_SIZE * visibleButtons + INNER_GAP * Math.max(0, visibleButtons - 1)) + 'px';
    if (toolbar.style.width === nextWidth) return;
    toolbar.style.width = nextWidth;
    if (!dragging) {
      requestAnimationFrame(function () {
        if (!toolbar || dragging) return;
        if (savedPosition) applySavedPosition();
        else applyDefaultPosition();
      });
    }
  }

  function isPmvHavenPlaylistPage() {
    return /(^|\.)pmvhaven\.com$/i.test(location.hostname) && /^\/playlists\/[^/?#]+/i.test(location.pathname);
  }

  function getPmvHavenPlaylistIndex() {
    const raw = new URLSearchParams(location.search).get('index');
    const n = raw == null ? 0 : parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  function getPmvHavenPlaylistItemCount() {
    if (!isPmvHavenPlaylistPage()) return 0;
    const items = Array.from(document.querySelectorAll('button')).filter((btn) => {
      const text = (btn.innerText || btn.textContent || '').trim();
      return /^\d+\s+\d{1,2}:\d{2}\b/.test(text) || /^\d+\s+\d{1,2}:\d{2}:\d{2}\b/.test(text);
    });
    if (items.length > 0) return items.length;
    const numberedTitles = Array.from(document.querySelectorAll('h4')).filter((h) => h.closest('button, a, li, [role="button"]'));
    return numberedTitles.length;
  }

  function hasPmvHavenPrevPlaylistVideo() {
    return isPmvHavenPlaylistPage() && getPmvHavenPlaylistIndex() > 0;
  }

  function hasPmvHavenNextPlaylistVideo() {
    if (!isPmvHavenPlaylistPage()) return false;
    const count = getPmvHavenPlaylistItemCount();
    if (count > 0) return getPmvHavenPlaylistIndex() + 1 < count;
    return /UP\s+NEXT/i.test(document.body?.innerText || '');
  }

  function makePmvHavenPlaylistUrl(delta) {
    const nextIndex = getPmvHavenPlaylistIndex() + delta;
    if (nextIndex < 0) return '';
    const count = getPmvHavenPlaylistItemCount();
    if (count > 0 && nextIndex >= count) return '';
    const url = new URL(location.href);
    url.searchParams.set('index', String(nextIndex));
    return url.href;
  }

  function makePmvHavenPrevPlaylistUrl() {
    if (!hasPmvHavenPrevPlaylistVideo()) return '';
    return makePmvHavenPlaylistUrl(-1);
  }

  function makePmvHavenNextPlaylistUrl() {
    if (!hasPmvHavenNextPlaylistVideo()) return '';
    return makePmvHavenPlaylistUrl(1);
  }

  function getWordPressPlaylistItems() {
    return Array.from(document.querySelectorAll('.wp-playlist-item')).filter((item) => item.querySelector('a[href*=".mp4"], .wp-playlist-caption[href*=".mp4"]'));
  }

  function isWordPressPlaylistPage() {
    return getWordPressPlaylistItems().length > 1;
  }

  function getWordPressPlaylistIndex() {
    const items = getWordPressPlaylistItems();
    if (items.length === 0) return -1;
    const playingIndex = items.findIndex((item) => item.classList.contains('wp-playlist-playing'));
    if (playingIndex >= 0) return playingIndex;
    const currentVideo = findCurrentVideo();
    const currentSrc = currentVideo ? (currentVideo.currentSrc || currentVideo.src || '') : '';
    if (!currentSrc) return -1;
    return items.findIndex((item) => {
      const link = item.querySelector('a[href*=".mp4"], .wp-playlist-caption[href*=".mp4"]');
      return !!(link && link.href && currentSrc === link.href);
    });
  }

  function hasWordPressPrevPlaylistVideo() {
    return isWordPressPlaylistPage() && getWordPressPlaylistIndex() > 0;
  }

  function hasWordPressNextPlaylistVideo() {
    const items = getWordPressPlaylistItems();
    const index = getWordPressPlaylistIndex();
    return items.length > 1 && index >= 0 && index + 1 < items.length;
  }

  function clickWordPressPlaylistVideo(delta) {
    const items = getWordPressPlaylistItems();
    const index = getWordPressPlaylistIndex();
    const target = items[index + delta];
    const link = target ? target.querySelector('a[href*=".mp4"], .wp-playlist-caption[href*=".mp4"]') : null;
    if (!link) return false;
    link.click();
    setTimeout(updatePlaylistNavVisibility, 250);
    return true;
  }

  function isElementVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < (window.innerHeight || document.documentElement.clientHeight || 0);
  }

  function getKgvidGalleryItems() {
    return Array.from(document.querySelectorAll('.kgvid_video_gallery_thumb[data-id]'));
  }

  function getActiveKgvidId() {
    const visibleModalVideo = Array.from(document.querySelectorAll('#kgvid-videomodal-container video[id^="video_kgvid_"], #kgvid-videomodal-container .kgvid_videodiv[data-id]'))
      .find(isElementVisible);
    const fromData = visibleModalVideo?.getAttribute?.('data-id');
    if (fromData) return fromData;
    const fromId = visibleModalVideo?.id?.match(/video_(kgvid_\d+)/);
    if (fromId) return fromId[1];
    const holder = Array.from(document.querySelectorAll('[id^="kgvid_popup_video_holder_kgvid_"]')).find(isElementVisible);
    const holderId = holder?.id?.match(/kgvid_popup_video_holder_(kgvid_\d+)/);
    if (holderId) return holderId[1];
    return '';
  }

  function getKgvidGalleryIndex() {
    const activeId = getActiveKgvidId();
    if (!activeId) return -1;
    return getKgvidGalleryItems().findIndex((item) => item.dataset.id === activeId);
  }

  function hasKgvidPrevGalleryVideo() {
    return getKgvidGalleryIndex() > 0;
  }

  function hasKgvidNextGalleryVideo() {
    const items = getKgvidGalleryItems();
    const index = getKgvidGalleryIndex();
    return items.length > 1 && index >= 0 && index + 1 < items.length;
  }

  function clickVisibleKgvidNavButton(delta) {
    const sel = delta < 0 ? '.kgvid_gallery_prev' : '.kgvid_gallery_next';
    const btn = Array.from(document.querySelectorAll(sel)).find(isElementVisible);
    if (!btn) return false;
    btn.click();
    setTimeout(updatePlaylistNavVisibility, 350);
    return true;
  }

  function clickKgvidGalleryVideo(delta) {
    if (clickVisibleKgvidNavButton(delta)) return true;
    const items = getKgvidGalleryItems();
    const index = getKgvidGalleryIndex();
    const target = items[index + delta];
    if (!target) return false;
    target.click();
    setTimeout(updatePlaylistNavVisibility, 350);
    return true;
  }

  function isOhentaiDetailPage() {
    return /(^|\.)ohentai\.org$/i.test(location.hostname) && /\/detail\.php$/i.test(location.pathname);
  }

  async function playOhentaiWithJwplayerApi(muted) {
    if (!isOhentaiDetailPage()) return false;
    const result = await runOhentaiMainWorldPlayer(muted);
    return !!result.ok;
  }

  function runOhentaiMainWorldPlayer(muted) {
    return new Promise((resolve) => {
      const id = 'oh-play-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      const doneType = id + ':done';
      const cleanup = () => {
        window.removeEventListener(doneType, onDone, true);
      };
      const timer = setTimeout(() => {
        cleanup();
        resolve({ ok: false, reason: 'timeout' });
      }, 6500);
      function onDone(event) {
        clearTimeout(timer);
        cleanup();
        resolve(event.detail || { ok: false, reason: 'empty-detail' });
      }
      window.addEventListener(doneType, onDone, true);
      const script = document.createElement('script');
      script.textContent = `(() => {
        const wantMuted = ${muted ? 'true' : 'false'};
        const done = (detail) => window.dispatchEvent(new CustomEvent(${JSON.stringify(doneType)}, { detail }));
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const hasSource = (video) => !!(video && (video.currentSrc || video.src || Array.from(video.querySelectorAll('source')).some((s) => s.src)));
        const visibleArea = (el) => {
          if (!el) return 0;
          const r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) return 0;
          const vw = window.innerWidth || document.documentElement.clientWidth;
          const vh = window.innerHeight || document.documentElement.clientHeight;
          const w = Math.max(0, Math.min(vw, r.right) - Math.max(0, r.left));
          const h = Math.max(0, Math.min(vh, r.bottom) - Math.max(0, r.top));
          return w * h;
        };
        const videos = () => Array.from(document.querySelectorAll('video')).sort((a, b) => visibleArea(b) - visibleArea(a));
        const videoState = (video) => video ? ({
          src: video.currentSrc || video.src || '',
          paused: video.paused,
          muted: video.muted,
          readyState: video.readyState,
          networkState: video.networkState,
          currentTime: video.currentTime,
          width: video.videoWidth,
          height: video.videoHeight
        }) : null;
        const playerState = (player) => {
          if (!player) return null;
          try {
            return {
              state: typeof player.getState === 'function' ? player.getState() : null,
              pos: typeof player.getPosition === 'function' ? player.getPosition() : null,
              dur: typeof player.getDuration === 'function' ? player.getDuration() : null,
              mute: typeof player.getMute === 'function' ? player.getMute() : null,
              vol: typeof player.getVolume === 'function' ? player.getVolume() : null
            };
          } catch (e) {
            return { error: String(e) };
          }
        };
        const applyWantedAudio = (players) => {
          const shouldMute = !!wantMuted;
          for (const player of players) {
            try { if (typeof player.setMute === 'function') player.setMute(shouldMute); } catch (e) {}
            try { if (!shouldMute && typeof player.setVolume === 'function') player.setVolume(100); } catch (e) {}
          }
          for (const video of videos()) {
            try {
              video.muted = shouldMute;
              video.defaultMuted = shouldMute;
              if (!shouldMute) video.volume = 1;
            } catch (e) {}
          }
        };
        let lastPlayError = null;
        const playVideo = async (video) => {
          if (!video) return false;
          try {
            video.muted = true;
            video.defaultMuted = true;
            video.playsInline = true;
            const ret = video.play();
            if (ret && typeof ret.then === 'function') await ret;
            return !video.paused;
          } catch (e) {
            lastPlayError = { error: String(e), state: videoState(video) };
            return false;
          }
        };
        (async () => {
          try {
            const apiFactory = window.jwplayer;
            if (typeof apiFactory !== 'function') {
              done({ ok: false, reason: 'no-jwplayer' });
              return;
            }
            const ids = ['my-video', 'player'];
            const players = [];
            for (const id of ids) {
              try {
                const player = apiFactory(id);
                if (player && !players.includes(player)) players.push(player);
              } catch (e) {}
            }
            try {
              const player = apiFactory();
              if (player && !players.includes(player)) players.push(player);
            } catch (e) {}
            if (players.length === 0) {
              done({ ok: false, reason: 'no-player', videoCount: videos().length });
              return;
            }
            for (const player of players) {
              try { if (typeof player.setMute === 'function') player.setMute(true); } catch (e) {}
              try { if (typeof player.play === 'function') player.play(true); } catch (e) {}
            }
            const startedState = { players: players.map(playerState), videos: videos().map(videoState) };
            const deadline = Date.now() + 5000;
            while (Date.now() < deadline) {
              const video = videos().find(hasSource) || videos()[0];
              const played = await playVideo(video);
              if (played) {
                applyWantedAudio(players);
                done({ ok: true, reason: 'video-play' });
                return;
              }
              await sleep(250);
            }
            for (const video of videos()) {
              const played = await playVideo(video);
              if (played) {
                applyWantedAudio(players);
                done({ ok: true, reason: 'final-video-play' });
                return;
              }
            }
            done({ ok: false, reason: 'play-failed', startedState, lastPlayError, videos: videos().map(videoState), players: players.map(playerState) });
          } catch (e) {
            done({ ok: false, reason: String(e) });
          }
        })();
      })();`;
      (document.documentElement || document.head || document.body).appendChild(script);
      script.remove();
    });
  }

  function clickOhentaiPlayerCenter() {
    if (!isOhentaiDetailPage()) return false;
    const candidates = [];
    const sels = [
      '#player', '#my-video', '.jwplayer', '.jw-wrapper', '.jw-media', '.jw-preview',
      '.jw-display', '.jw-display-container', '.jw-display-icon-container',
      '.jw-icon-display', '.jw-icon-playback', '.jw-display-icon-display',
      'video'
    ];
    for (const sel of sels) {
      try { document.querySelectorAll(sel).forEach((n) => candidates.push(n)); } catch (e) {}
    }
    candidates.sort((a, b) => visibleArea(b) - visibleArea(a));
    for (const n of candidates) {
      if (!isElementVisible(n)) continue;
      const r = n.getBoundingClientRect();
      if (r.width < 80 || r.height < 50) continue;
      const points = [
        [r.left + r.width / 2, r.top + r.height / 2],
        [r.left + r.width / 2, r.top + r.height * 0.42],
        [r.left + r.width / 2, r.top + r.height * 0.58]
      ];
      for (const point of points) {
        const x = Math.max(1, Math.min(window.innerWidth - 1, Math.floor(point[0])));
        const y = Math.max(1, Math.min(window.innerHeight - 1, Math.floor(point[1])));
        const hit = document.elementFromPoint(x, y);
        if (hit && !isBadOverlayCandidate(hit) && dispatchRealClick(hit)) return true;
      }
      if (dispatchRealClick(n)) return true;
    }
    return false;
  }

  function getOhentaiEpisodeLinks() {
    if (!isOhentaiDetailPage()) return [];
    const seen = new Set();
    return Array.from(document.querySelectorAll('a[href*="detail.php?vid="]'))
      .map((link) => {
        const text = (link.textContent || '').trim();
        const match = text.match(/^Episode\s*(\d+)$/i);
        if (!match || !link.href || seen.has(link.href)) return null;
        seen.add(link.href);
        return { link, episode: parseInt(match[1], 10), href: link.href };
      })
      .filter(Boolean)
      .sort((a, b) => a.episode - b.episode);
  }

  function getOhentaiEpisodeIndex() {
    const items = getOhentaiEpisodeLinks();
    if (items.length === 0) return -1;
    const selectedIndex = items.findIndex((item) => item.link.id === 'selected');
    if (selectedIndex >= 0) return selectedIndex;
    const currentUrl = new URL(location.href);
    const currentVid = currentUrl.searchParams.get('vid');
    if (!currentVid) return -1;
    return items.findIndex((item) => {
      try { return new URL(item.href).searchParams.get('vid') === currentVid; } catch (e) { return false; }
    });
  }

  function hasOhentaiPrevEpisode() {
    return getOhentaiEpisodeIndex() > 0;
  }

  function hasOhentaiNextEpisode() {
    const items = getOhentaiEpisodeLinks();
    const index = getOhentaiEpisodeIndex();
    return items.length > 1 && index >= 0 && index + 1 < items.length;
  }

  function openOhentaiEpisode(delta) {
    const items = getOhentaiEpisodeLinks();
    const index = getOhentaiEpisodeIndex();
    const target = items[index + delta];
    if (!target?.href) return false;
    window.location.assign(target.href);
    return true;
  }

  function hasPrevPlaylistVideo() {
    return hasPmvHavenPrevPlaylistVideo() || hasOhentaiPrevEpisode() || hasKgvidPrevGalleryVideo() || hasWordPressPrevPlaylistVideo();
  }

  function hasNextPlaylistVideo() {
    return hasPmvHavenNextPlaylistVideo() || hasOhentaiNextEpisode() || hasKgvidNextGalleryVideo() || hasWordPressNextPlaylistVideo();
  }

  function updatePlaylistNavVisibility() {
    if (prevPlaylistBtn) prevPlaylistBtn.style.display = hasPrevPlaylistVideo() ? 'flex' : 'none';
    if (nextPlaylistBtn) nextPlaylistBtn.style.display = hasNextPlaylistVideo() ? 'flex' : 'none';
    updateToolbarWidth();
  }

  function openPrevPlaylistVideo() {
    const url = makePmvHavenPrevPlaylistUrl();
    if (url) { window.location.assign(url); return; }
    if (openOhentaiEpisode(-1)) return;
    if (clickKgvidGalleryVideo(-1)) return;
    clickWordPressPlaylistVideo(-1);
  }

  function openNextPlaylistVideo() {
    const url = makePmvHavenNextPlaylistUrl();
    if (url) { window.location.assign(url); return; }
    if (openOhentaiEpisode(1)) return;
    if (clickKgvidGalleryVideo(1)) return;
    clickWordPressPlaylistVideo(1);
  }

  function setToolbarVisible(visible) {
    toolbarVisible = !!visible;
    if (!toolbar) return;
    toolbar.style.opacity = visible ? '1' : '0';
    toolbar.style.visibility = visible ? 'visible' : 'hidden';
    toolbar.style.pointerEvents = visible ? 'auto' : 'none';
    toolbar.style.transform = visible ? 'scale(1)' : 'scale(0.9)';
  }

  function hasVideoForToolbar() {
    if (isAnyPlaying()) return true;
    const videos = collectVideos();
    for (const v of videos) {
      if (isLargeMediaElement(v)) return true;
      if (hasSource(v) && visibleArea(v) > 0) return true;
    }
    if (isPornhubVideoPage() || isOhentaiDetailPage()) return true;
    const playerSelectors = [
      '#kt_player', '#player', '#playerContainer', '#videoContainer', '#video_player', '#EPvideo', '#my-video',
      '.video-js', '.jwplayer', '.plyr', '.dplayer', '.xgplayer', '.fp-player', '.rmp-player', '.video-player', '.main_video_player'
    ];
    for (const sel of playerSelectors) {
      try {
        const node = Array.from(document.querySelectorAll(sel)).find(isLargeMediaElement);
        if (node) return true;
      } catch (e) {}
    }
    return false;
  }

  function updateToolbarVisibility() {
    setToolbarVisible(hasVideoForToolbar());
  }

  function getVal(key, def) {
    try {
      const v = localStorage.getItem(POS_STORE_KEY + key);
      if (v === null) return def;
      const n = Number(v);
      return Number.isNaN(n) ? v : n;
    } catch (_) { return def; }
  }

  function setVal(key, val) {
    try { localStorage.setItem(POS_STORE_KEY + key, String(val)); } catch (_) {}
  }

  function removeVal(key) {
    try { localStorage.removeItem(POS_STORE_KEY + key); } catch (_) {}
  }

  function getViewportBox() {
    const vv = window.visualViewport;
    const layoutWidth = document.documentElement.clientWidth || innerWidth || 0;
    const layoutHeight = document.documentElement.clientHeight || innerHeight || 0;
    return {
      width: Math.max(1, Math.floor(vv?.width || 0), Math.floor(layoutWidth), Math.floor(innerWidth || 0)),
      height: Math.max(1, Math.floor(vv?.height || 0), Math.floor(layoutHeight), Math.floor(innerHeight || 0)),
    };
  }

  function currentToolbarWidth() {
    if (toolbar && toolbar.offsetWidth > 0) return toolbar.offsetWidth;
    return TOOLBAR_W;
  }

  // 纯 fixed：clamp 到视口内，不叠加 visualViewport offset，避免页面滑动/橡皮筋过度滑动时漂移。
  function clampPos(left, top) {
    const viewport = getViewportBox();
    const width = currentToolbarWidth();
    return {
      left: Math.max(0, Math.min(left, viewport.width - width)),
      top: Math.max(0, Math.min(top, viewport.height - BTN_SIZE - BOTTOM_GAP)),
    };
  }

  function applySavedPosition() {
    if (!toolbar || !savedPosition) return false;
    const pos = clampPos(savedPosition.left, savedPosition.top);
    savedPosition = pos;
    toolbar.style.left = pos.left + 'px';
    toolbar.style.top = pos.top + 'px';
    toolbar.style.right = 'auto';
    toolbar.style.bottom = 'auto';
    return true;
  }

  function migrateDefaultPosition() {
    if (getVal('layoutVersion', '') === CURRENT_LAYOUT_VERSION) return;
    removeVal(POS_LEFT_KEY);
    removeVal(POS_TOP_KEY);
    removeVal('vpLeft');
    removeVal('vpTop');
    setVal('layoutVersion', CURRENT_LAYOUT_VERSION);
  }

  function getVisualViewportRect() {
    const vv = window.visualViewport;
    return {
      left: Math.floor(vv?.offsetLeft || 0),
      top: Math.floor(vv?.offsetTop || 0),
      width: Math.floor(vv?.width || document.documentElement.clientWidth || innerWidth || 1),
      height: Math.floor(vv?.height || document.documentElement.clientHeight || innerHeight || 1),
    };
  }

  function applyDefaultPosition() {
    if (!toolbar) return;
    const vv = getVisualViewportRect();
    const width = currentToolbarWidth();
    toolbar.style.left = Math.max(0, Math.floor(vv.left + vv.width - width - DEFAULT_RIGHT)) + 'px';
    toolbar.style.top = Math.max(0, Math.floor(vv.top + vv.height - BTN_SIZE - DEFAULT_BOTTOM)) + 'px';
    toolbar.style.right = 'auto';
    toolbar.style.bottom = 'auto';
    toolbar.style.transform = toolbarVisible ? 'scale(1)' : 'scale(0.9)';
  }

  function resetPosition() {
    savedPosition = null;
    removeVal(POS_LEFT_KEY);
    removeVal(POS_TOP_KEY);
    removeVal('vpLeft');
    removeVal('vpTop');
    applyDefaultPosition();

    // 复位反馈：短暂闪烁一次（不破坏 SVG 图标）
    toolbar.style.opacity = '0.3';
    setTimeout(function () { toolbar.style.opacity = toolbarVisible ? '1' : '0'; }, 250);
  }

  function getSeekTargetVideo() {
    if (isRule34VideoPage()) return getRule34MainVideo();
    const playing = collectVideos().filter(isVideoPlaying).sort((a, b) => visibleArea(b) - visibleArea(a));
    if (playing.length > 0) return playing[0];
    return findLargeCurrentVideo() || findCurrentVideo();
  }

  function seekCurrentVideo(delta) {
    const v = getSeekTargetVideo();
    if (!v) return;
    try {
      const duration = Number.isFinite(v.duration) ? v.duration : null;
      const next = Math.max(0, duration ? Math.min(v.currentTime + delta, duration) : v.currentTime + delta);
      v.currentTime = next;
      syncIcons();
    } catch (e) {}
  }

  function triggerPlay(muted) {
    if (busy || !toolbar) return;
    busy = true;

    // 智能切换：在播 → 直接暂停（绕过站点 overlay，必定生效）；未播 → 播放
    if (isAnyPlaying()) {
      let n = 0;
      for (const v of collectVideos()) {
        if (!v.paused) { try { v.pause(); n++; } catch (e) {} }
      }
      toast(n > 0 ? '⏸ 已暂停' : '⏸ 已请求暂停');
      setTimeout(() => { syncIcons(); busy = false; }, 120);
      return;
    }

    playCurrentPageVideo(muted).finally(() => {
      // 播放可能异步起来，多采几次状态同步图标
      syncIcons();
      setTimeout(() => syncIcons(), 600);
      setTimeout(() => syncIcons(), 1500);
      setTimeout(() => { busy = false; }, 400);
    });
  }

  function isLightScheme() {
    try { return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches; }
    catch (e) { return false; }
  }

  function applyButtonScheme(btn) {
    const light = isLightScheme();
    Object.assign(btn.style, {
      background: light ? 'rgba(255,255,255,.64)' : 'rgba(28,28,30,.50)',
      WebkitBackdropFilter: 'blur(14px) saturate(145%)',
      backdropFilter: 'blur(14px) saturate(145%)',
      border: light ? '1px solid rgba(60,60,67,.16)' : '1px solid rgba(255,255,255,.12)',
      boxShadow: light ? '0 1px 6px rgba(0,0,0,.10)' : '0 1px 6px rgba(0,0,0,.14)',
      filter: 'none',
    });
  }

  function buildToolbar() {
    const old = document.getElementById('videoplay-fab');
    if (old) old.remove();
    toolbar = document.createElement('div');
    toolbar.id = 'videoplay-fab';
    Object.assign(toolbar.style, {
      position: 'fixed',
      zIndex: Z,
      width: TOOLBAR_W + 'px',
      height: BTN_SIZE + 'px',
      boxSizing: 'border-box',
      display: 'flex',
      alignItems: 'center',
      gap: INNER_GAP + 'px',
      touchAction: 'none',
      WebkitTouchCallout: 'none',
      userSelect: 'none',
      WebkitUserSelect: 'none',
    });

    const savedLeft = getVal(POS_LEFT_KEY, null);
    const savedTop = getVal(POS_TOP_KEY, null);
    if (savedLeft !== null && savedTop !== null) {
      savedPosition = clampPos(savedLeft, savedTop);
      applySavedPosition();
    } else {
      savedPosition = null;
      applyDefaultPosition();
    }

    function makeBtn(id) {
      const b = document.createElement('div');
      b.id = id;
      Object.assign(b.style, {
        position: 'relative',
        width: BTN_SIZE + 'px',
        height: BTN_SIZE + 'px',
        boxSizing: 'border-box',
        borderRadius: '50%',
        background: 'rgba(255,255,255,.64)',
        WebkitBackdropFilter: 'blur(14px) saturate(145%)',
        backdropFilter: 'blur(14px) saturate(145%)',
        border: '1px solid rgba(60,60,67,.16)',
        boxShadow: '0 1px 6px rgba(0,0,0,.10)',
        filter: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
      transition: 'transform .12s ease, opacity .2s, visibility .2s, background .2s, border-color .2s, box-shadow .2s',
      });
      applyButtonScheme(b);
      try {
        window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', function () { applyButtonScheme(b); });
      } catch (e) {}
      b.addEventListener('pointerdown', onPointerDown);
      b.addEventListener('pointermove', onPointerMove);
      b.addEventListener('pointerup', onPointerUp);
      b.addEventListener('pointercancel', onPointerUp);
      b.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
      });
      return b;
    }

    // 从左到右：后退 5 秒 / 正常播放（带声音）/ 静音播放 / 前进 5 秒 / 全屏 / 播放列表上一项 / 下一项（仅 PMVHaven 播放列表对应项存在时显示）
    backBtn = makeBtn('videoplay-fab-back');
    soundBtn = makeBtn('videoplay-fab-sound');
    muteBtn = makeBtn('videoplay-fab-mute');
    forwardBtn = makeBtn('videoplay-fab-forward');
    fullscreenBtn = makeBtn('videoplay-fab-fullscreen');
    prevPlaylistBtn = makeBtn('videoplay-fab-playlist-prev');
    nextPlaylistBtn = makeBtn('videoplay-fab-playlist-next');
    toolbar.appendChild(backBtn);
    toolbar.appendChild(soundBtn);
    toolbar.appendChild(muteBtn);
    toolbar.appendChild(forwardBtn);
    toolbar.appendChild(fullscreenBtn);
    toolbar.appendChild(prevPlaylistBtn);
    toolbar.appendChild(nextPlaylistBtn);
    isolateFloatingUi(toolbar);
    document.body.appendChild(toolbar);

    syncIcons();
  }

  function onPointerDown(e) {
    if (!toolbarVisible) return;
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    moved = false;
    pressedBtn = e.currentTarget;
    pressAction = (pressedBtn === backBtn) ? 'seekBack' : (pressedBtn === forwardBtn) ? 'seekForward' : (pressedBtn === fullscreenBtn) ? 'fullscreen' : (pressedBtn === prevPlaylistBtn) ? 'playlistPrev' : (pressedBtn === nextPlaylistBtn) ? 'playlistNext' : 'play';
    pressMuted = (e.currentTarget === muteBtn);
    pressedBtn.style.transform = 'scale(.92)';
    startX = e.clientX;
    startY = e.clientY;
    const rect = toolbar.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;
    // 未拖动时保持默认 right/bottom 锚点，不切换成 left/top；
    // 这样 iOS 过度滑动时与新标签页/标签管理/翻页脚本保持同一套 fixed 队形。
    e.currentTarget.setPointerCapture?.(e.pointerId);

    // 长按复原已移除，改为扩展菜单「📍 重置视频播放按钮位置」点击复原。
  }

  function onPointerMove(e) {
    if (!dragging) return;
    e.preventDefault();
    e.stopPropagation();
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!moved && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
    if (!moved) {
      toolbar.style.left = startLeft + 'px';
      toolbar.style.top = startTop + 'px';
      toolbar.style.right = 'auto';
      toolbar.style.bottom = 'auto';
    }
    moved = true;

    const pos = clampPos(startLeft + dx, startTop + dy);
    toolbar.style.left = pos.left + 'px';
    toolbar.style.top = pos.top + 'px';
  }

  function onPointerUp(e) {
    if (!dragging) return;
    e.preventDefault();
    e.stopPropagation();
    dragging = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);

    if (pressedBtn) pressedBtn.style.transform = '';

    if (moved) {
      savedPosition = clampPos(parseInt(toolbar.style.left, 10) || 0, parseInt(toolbar.style.top, 10) || 0);
      setVal(POS_LEFT_KEY, savedPosition.left);
      setVal(POS_TOP_KEY, savedPosition.top);
    } else {
      if (pressAction === 'seekBack') seekCurrentVideo(-5);
      else if (pressAction === 'seekForward') seekCurrentVideo(5);
      else if (pressAction === 'fullscreen') enterFullscreenForCurrentVideo();
      else if (pressAction === 'playlistPrev') openPrevPlaylistVideo();
      else if (pressAction === 'playlistNext') openNextPlaylistVideo();
      else triggerPlay(pressMuted);
    }
  }

  // ---------- 初始化 ----------
  function isToolbarHealthy() {
    const box = document.getElementById('videoplay-fab');
    return Boolean(box && document.documentElement.contains(box) && box.querySelector('#videoplay-fab-sound') && box.querySelector('#videoplay-fab-mute') && box.querySelector('#videoplay-fab-fullscreen') && box.querySelector('#videoplay-fab-playlist-prev') && box.querySelector('#videoplay-fab-playlist-next'));
  }

  function ensureToolbar() {
    if (isToolbarHealthy() && toolbar === document.getElementById('videoplay-fab')) return true;
    if (!document.body) return false;
    migrateDefaultPosition();
    buildToolbar();
    return true;
  }

  let listenersInstalled = false;
  let menuRegistered = false;
  let visibilityObserver = null;
  let visibilityRefreshTimer = null;

  function scheduleVisibilityRefresh(delay) {
    const wait = typeof delay === 'number' ? delay : 120;
    if (visibilityRefreshTimer) clearTimeout(visibilityRefreshTimer);
    visibilityRefreshTimer = setTimeout(function () {
      visibilityRefreshTimer = null;
      ensureToolbar();
      syncIcons();
      updateToolbarVisibility();
    }, wait);
  }

  const VIDEO_RELEVANT_SELECTOR = 'video, iframe, #kt_player, #player, #playerContainer, #videoContainer, #video_player, #EPvideo, #my-video, .video-js, .jwplayer, .plyr, .dplayer, .xgplayer, .fp-player, .rmp-player, .video-player, .main_video_player';

  function isInsideOwnToolbar(node) {
    if (!node) return false;
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return Boolean(element?.closest?.('#videoplay-fab'));
  }

  function nodeMatchesOrContains(node, selector) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    try { return Boolean(node.matches?.(selector) || node.querySelector?.(selector)); }
    catch (_) { return false; }
  }

  function nodeIsOrContainsToolbar(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    return node.id === 'videoplay-fab' || Boolean(node.querySelector?.('#videoplay-fab'));
  }

  function installVideoVisibilityWatcher() {
    if (visibilityObserver || !document.documentElement) return;
    visibilityObserver = new MutationObserver(function (mutations) {
      for (const m of mutations) {
        if (m.type === 'attributes') {
          if (isInsideOwnToolbar(m.target)) continue;
          scheduleVisibilityRefresh(160);
          return;
        }
        if (m.type !== 'childList' || isInsideOwnToolbar(m.target)) continue;
        for (const node of m.removedNodes) {
          if (nodeIsOrContainsToolbar(node)) {
            scheduleVisibilityRefresh(0);
            return;
          }
        }
        for (const node of m.addedNodes) {
          if (node?.id === 'videoplay-fab') continue;
          if (nodeMatchesOrContains(node, VIDEO_RELEVANT_SELECTOR)) {
            scheduleVisibilityRefresh(160);
            return;
          }
        }
        for (const node of m.removedNodes) {
          if (nodeMatchesOrContains(node, VIDEO_RELEVANT_SELECTOR)) {
            scheduleVisibilityRefresh(80);
            return;
          }
        }
      }
    });
    visibilityObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'style', 'class', 'hidden']
    });
  }

  function init() {
    if (!document.body) return false;
    if (!ensureToolbar()) return false;

    // 让按钮图标跟随「用户直接点画面」的播放/暂停/加载状态变化（只安装一次，避免重建按钮时重复监听）
    const onState = () => { syncIcons(); updateToolbarVisibility(); };
    if (!listenersInstalled) ['play', 'playing', 'pause', 'ended', 'loadedmetadata', 'loadeddata', 'canplay', 'emptied'].forEach((ev) =>
      document.addEventListener(ev, onState, true)
    );
    installVideoVisibilityWatcher();
    syncIcons();
    updateToolbarVisibility();

    const refreshVisibility = () => { updatePlaylistNavVisibility(); updateToolbarVisibility(); };
    if (!listenersInstalled) {
      window.addEventListener('pageshow', function () { ensureToolbar(); syncIcons(); refreshVisibility(); });
      document.addEventListener('visibilitychange', function () { if (!document.hidden) { ensureToolbar(); syncIcons(); refreshVisibility(); } });
    }

    const stabilizePosition = function () {
      if (!toolbar || dragging) return;
      requestAnimationFrame(function () {
        if (savedPosition) applySavedPosition();
        else applyDefaultPosition();
      });
    };
    if (!listenersInstalled) {
      window.addEventListener('resize', stabilizePosition);
      window.addEventListener('scroll', stabilizePosition, { passive: true });
      window.visualViewport?.addEventListener('resize', stabilizePosition);
      window.visualViewport?.addEventListener('scroll', stabilizePosition);
    }
    listenersInstalled = true;

    if (!menuRegistered && typeof GM !== 'undefined' && GM.registerMenuCommand) {
      menuRegistered = true;
      GM.registerMenuCommand('📍 重置视频播放按钮位置', function () {
        resetPosition();
      });
    }

    return true;
  }

  function bootstrap() {
    init();
    if (!document.body) document.addEventListener("DOMContentLoaded", init, { once: true });
  }

  if (document.body || document.documentElement) bootstrap();
  else window.addEventListener("DOMContentLoaded", bootstrap, { once: true });
})();
