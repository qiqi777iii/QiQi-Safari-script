// ==UserScript==
// @name Senplayer播放
// @namespace    https://github.com/qiqi777iii/Scripts
// @version 1.0.1
// @updateURL    https://raw.githubusercontent.com/qiqi777iii/Scripts/main/userscripts/senplayer-video-button.user.js
// @downloadURL  https://raw.githubusercontent.com/qiqi777iii/Scripts/main/userscripts/senplayer-video-button.user.js
// @description 捕获当前网页视频地址，可一键复制地址或通过 SenPlayer 播放。
// @match http://*/*
// @match https://*/*
// @exclude https://missav.ai/*
// @exclude https://*.missav.ai/*
// @exclude https://missav.live/*
// @exclude https://*.missav.live/*
// @exclude https://missav.ws/*
// @exclude https://*.missav.ws/*
// @run-at document-start
// @grant GM.registerMenuCommand
// @grant GM.setClipboard
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT = 'SenPlayer';
  const WRAP_ID = '__qiqi_senplayer_button__';
  const PANEL_ID = '__qiqi_senplayer_panel__';
  const POS_KEY = 'qiqi_senplayer_pos_v7';
  const SENPLAYER_SCHEME = 'senplayer://x-callback-url/play?url={url}';
  const BTN_SIZE = 35;
  const SIDE_GAP = 6;
  const DEFAULT_RIGHT = 14;
  const DEFAULT_BOTTOM = 75;
  const DETECTED = new Map();
  const VIDEO_EXT_RE = /(?:\.(m3u8|mp4|mov|m4v|webm|mkv)(?:[?#]|$)|\/hls[0-9a-z]*\/|media=hls|type=video)/i;
  const VIDEO_HINT_RE = /(m3u8|mp4|video|playlist|master|stream|media|hls)/i;
  const MIN_MAIN_VIDEO_W = 180;
  const MIN_MAIN_VIDEO_H = 120;
  const MIN_MAIN_VIDEO_AREA_RATIO = 0.12;
  const MIN_MAIN_VIDEO_AREA_ABS = 42000;

  let wrap = null;
  let button = null;
  let badge = null;
  let status = null;
  let currentUrl = '';
  let dragging = false;
  let pointerStart = null;
  let observedUrl = location.href;
  let routeGeneration = 0;
  let routeScanTimer = 0;
  let pendingFullScan = false;
  let scanBatchDepth = 0;
  let scanBatchChanged = false;

  function log(...args) {
    try { console.log(`[${SCRIPT}]`, ...args); } catch (_) {}
  }

  function absUrl(input) {
    if (!input || typeof input !== 'string') return '';
    const raw = input.trim();
    if (!raw || raw.startsWith('blob:') || raw.startsWith('data:')) return '';
    try { return new URL(raw, location.href).href; } catch (_) { return ''; }
  }

  function looksLikeVideo(url) {
    if (!url) return false;
    return VIDEO_EXT_RE.test(url) || VIDEO_HINT_RE.test(url);
  }

  function collectVideos() {
    const list = [];
    const pushFrom = (doc) => {
      try { doc.querySelectorAll('video').forEach((v) => list.push(v)); } catch (_) {}
    };
    pushFrom(document);
    try {
      document.querySelectorAll('iframe').forEach((frame) => {
        try { if (frame.contentDocument) pushFrom(frame.contentDocument); } catch (_) {}
      });
    } catch (_) {}
    return list;
  }

  function visibleArea(el) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return 0;
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    const x1 = Math.max(0, r.left);
    const y1 = Math.max(0, r.top);
    const x2 = Math.min(vw, r.right);
    const y2 = Math.min(vh, r.bottom);
    return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
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

  function hasSource(v) {
    if (!v) return false;
    if (v.currentSrc || v.src) return true;
    if (v.querySelector && v.querySelector('source[src]')) return true;
    if (typeof v.readyState === 'number' && v.readyState > 0) return true;
    return false;
  }

  function mediaElementScore(v) {
    if (!v) return -9999;
    let score = visibleArea(v);
    try {
      if (!v.paused && !v.ended) score += getViewportArea() * 2;
      if (typeof v.currentTime === 'number' && v.currentTime > 0) score += getViewportArea();
      if (v.readyState >= 2) score += 5000;
      if (document.fullscreenElement && (document.fullscreenElement === v || document.fullscreenElement.contains(v))) score += getViewportArea() * 3;
    } catch (_) {}
    return score;
  }

  function findCurrentVideo() {
    const videos = collectVideos();
    if (!videos.length) return null;
    videos.sort((a, b) => {
      const sb = mediaElementScore(b);
      const sa = mediaElementScore(a);
      if (sb !== sa) return sb - sa;
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return (rb.width * rb.height) - (ra.width * ra.height);
    });
    return videos[0];
  }

  function findLargeCurrentVideo() {
    const videos = collectVideos().filter((v) => isLargeMediaElement(v) && hasSource(v));
    if (!videos.length) return null;
    videos.sort((a, b) => mediaElementScore(b) - mediaElementScore(a));
    return videos[0];
  }

  function videoSourceUrl(video) {
    if (!video) return '';
    const direct = absUrl(video.currentSrc || video.src || '');
    if (direct) return direct;
    try {
      const sources = Array.from(video.querySelectorAll('source[src]'))
        .map((s) => absUrl(s.getAttribute('src') || s.src || ''))
        .filter(Boolean);
      const best = sources.sort((a, b) => scoreUrl(b, 'source') - scoreUrl(a, 'source'))[0];
      if (best) return best;
    } catch (_) {}
    return '';
  }

  function getCurrentPageVideoUrl(record) {
    const video = findLargeCurrentVideo() || findCurrentVideo();
    const url = videoSourceUrl(video);
    if (url && looksLikeVideo(url)) {
      if (record !== false) addCandidate(url, 'current-video');
      return url;
    }
    return '';
  }

  function getBestDetectedUrl() {
    const list = Array.from(DETECTED.values()).sort((a, b) => b.score - a.score || b.time - a.time);
    return list[0] ? list[0].url : '';
  }

  function resolveAutoVideoUrl() {
    const pageVideoUrl = getCurrentPageVideoUrl();
    const best = pageVideoUrl || currentUrl || getBestDetectedUrl();
    if (best) currentUrl = best;
    return best;
  }

  function hasVideoOnPage() {
    try {
      const videos = collectVideos();
      for (const v of videos) {
        if (isLargeMediaElement(v)) return true;
      }
      const playerSelectors = [
        '#kt_player', '#player', '#playerContainer', '#videoContainer', '#video_player', '#videoplayer-v3', '#mediaplayer_wrapper', '#EPvideo', '#my-video',
        '.video-js', '.jwplayer', '.plyr', '.dplayer', '.xgplayer', '.fp-player', '.rmp-player', '.video-player', '.main_video_player', '.video-container', '[class*="tube-player-v3"]'
      ];
      for (const sel of playerSelectors) {
        const node = Array.from(document.querySelectorAll(sel)).find(isLargeMediaElement);
        if (node) return true;
      }
    } catch (_) {}
    return false;
  }

  function scoreUrl(url, source) {
    let score = 0;
    if (/\.m3u8(?:[?#]|$)/i.test(url)) score += 100;
    if (/\.mp4(?:[?#]|$)/i.test(url)) score += 80;
    if (/\.m4v|\.mov|\.webm/i.test(url)) score += 60;
    if (/master|playlist|index/i.test(url)) score += 18;
    if (/video|stream|media|hls/i.test(url)) score += 10;
    if (source === 'current-video') score += 120;
    if (source === 'video') score += 25;
    if (source === 'network') score += 18;
    if (source === 'source') score += 20;
    if (url.includes('blob:') || url.includes('data:')) score -= 999;
    return score;
  }

  function beginScanBatch() { scanBatchDepth += 1; }

  function endScanBatch() {
    if (scanBatchDepth > 0) scanBatchDepth -= 1;
    if (scanBatchDepth || !scanBatchChanged) return;
    scanBatchChanged = false;
    chooseBest();
  }

  function addCandidate(input, source) {
    const url = absUrl(input);
    if (!url || !looksLikeVideo(url)) return false;
    const old = DETECTED.get(url);
    const score = scoreUrl(url, source);
    if (!old || score > old.score) {
      DETECTED.set(url, { url, source, score, time: Date.now() });
      if (scanBatchDepth) scanBatchChanged = true;
      else chooseBest();
    }
    return true;
  }

  function chooseBest() {
    const list = Array.from(DETECTED.values()).sort((a, b) => b.score - a.score || b.time - a.time);
    const best = list[0];
    currentUrl = best ? best.url : '';
    if (!document.hidden) updateButton();
  }

  function scanElement(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return;
    const tag = el.tagName.toLowerCase();
    if (tag === 'video' || tag === 'audio') {
      addCandidate(el.currentSrc || el.src, 'video');
      ['src', 'data-src', 'poster'].forEach((name) => addCandidate(el.getAttribute(name), 'video'));
    } else if (tag === 'source') {
      addCandidate(el.getAttribute('src') || el.getAttribute('data-src'), 'source');
    } else if (tag === 'a' || tag === 'link') {
      addCandidate(el.getAttribute('href'), tag);
    }
  }

  function scanTree(root) {
    if (!root || document.hidden) return;
    const selector = 'video, audio, source[src], source[data-src], a[href], link[href]';
    beginScanBatch();
    try {
      if (root.nodeType === Node.ELEMENT_NODE && root.matches(selector)) scanElement(root);
      root.querySelectorAll?.(selector).forEach(scanElement);
    } catch (e) { log('scanTree failed', e); }
    finally { endScanBatch(); }
  }

  function extractHtmlCandidates(html, source = 'html') {
    if (!html) return;
    const re = /https?:\\?\/\\?\/[^\s"'<>\\]+?(?:\.m3u8|\.mp4|\.m4v|\.mov|\.webm|\/hls[0-9a-z]*\/|media=hls|type=video)(?:[^\s"'<>\\]*)?/ig;
    let m;
    let count = 0;
    while ((m = re.exec(html)) && count < 60) {
      addCandidate(m[0].replace(/\\\//g, '/').replace(/&amp;/g, '&'), source);
      count += 1;
    }
  }

  function extractConfigCandidates(html) {
    if (!html) return;
    const cfgRe = /(?:hlsAuto|hls|source|src|url)["'\s:=>=]+(https?:\\?\/\\?\/[^"'<>\s\\]+(?:\/hls[0-9a-z]*\/|media=hls|\.m3u8|\.mp4)[^"'<>\s\\]*)/ig;
    let m;
    let count = 0;
    while ((m = cfgRe.exec(html)) && count < 40) {
      addCandidate(m[1].replace(/\\\//g, '/').replace(/&amp;/g, '&'), 'html-config');
      count += 1;
    }
  }

  function scanFullPage() {
    if (document.hidden) { pendingFullScan = true; return; }
    beginScanBatch();
    try {
      scanTree(document);
      const html = document.documentElement?.innerHTML || '';
      extractHtmlCandidates(html);
      extractConfigCandidates(html);
    } finally { endScanBatch(); }
    pendingFullScan = false;
    updateButton();
  }

  function checkRoute() {
    if (location.href === observedUrl) return false;
    observedUrl = location.href;
    routeGeneration += 1;
    DETECTED.clear();
    currentUrl = '';
    document.getElementById(PANEL_ID)?.remove();
    if (wrap) {
      wrap.style.opacity = '0';
      wrap.style.visibility = 'hidden';
      wrap.style.pointerEvents = 'none';
    }
    pendingFullScan = true;
    clearTimeout(routeScanTimer);
    if (!document.hidden) routeScanTimer = setTimeout(scanFullPage, 250);
    return true;
  }

  function hookNetwork() {
    try {
      const rawFetch = window.fetch;
      if (typeof rawFetch === 'function') {
        window.fetch = function (...args) {
          const generation = routeGeneration;
          try {
            const u = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url);
            if (generation === routeGeneration) addCandidate(u, 'network');
          } catch (_) {}
          return rawFetch.apply(this, args).then((res) => {
            try { if (generation === routeGeneration) addCandidate(res && res.url, 'network'); } catch (_) {}
            return res;
          });
        };
      }
    } catch (e) { log('fetch hook failed', e); }

    try {
      const rawOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        const generation = routeGeneration;
        try { if (generation === routeGeneration) addCandidate(url, 'network'); } catch (_) {}
        this.addEventListener('load', function () {
          try { if (generation === routeGeneration) addCandidate(this.responseURL, 'network'); } catch (_) {}
        }, { once: true });
        return rawOpen.call(this, method, url, ...rest);
      };
    } catch (e) { log('xhr hook failed', e); }
  }

  async function copyText(text) {
    try {
      if (typeof GM !== 'undefined' && GM.setClipboard) {
        await GM.setClipboard(text, 'text');
        return true;
      }
    } catch (_) {}
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) {}
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (_) { return false; }
  }

  function makeOpenUrl(url) {
    return SENPLAYER_SCHEME.replace('{url}', encodeURIComponent(url)).replace('{raw}', url);
  }

  async function playUrl(targetUrl) {
    if (!targetUrl) {
      toast('未发现当前页视频地址');
      return;
    }
    currentUrl = targetUrl;
    await copyText(targetUrl);
    toast('已自动选择视频地址，正在打开 SenPlayer');
    setTimeout(() => {
      try { location.href = makeOpenUrl(targetUrl); } catch (_) {}
    }, 80);
  }

  async function playCurrent() {
    await playUrl(resolveAutoVideoUrl());
  }

  function toast(text) {
    if (!status) return;
    status.textContent = text;
    status.style.opacity = '1';
    clearTimeout(status._timer);
    status._timer = setTimeout(() => { status.style.opacity = '0'; }, 2200);
  }

  function updateButton() {
    if (!wrap || !button || !badge) return;
    const hasVideo = hasVideoOnPage();
    if (!hasVideo) currentUrl = '';
    badge.style.display = 'none';
    wrap.style.opacity = hasVideo ? '1' : '0';
    wrap.style.visibility = hasVideo ? 'visible' : 'hidden';
    wrap.style.pointerEvents = hasVideo ? 'auto' : 'none';
    button.style.opacity = hasVideo ? '1' : '.78';
    button.title = currentUrl || '用 SenPlayer 播放当前页视频';
  }

  function createButton() {
    if (!document.body || document.getElementById(WRAP_ID)) return;
    wrap = document.createElement('div');
    wrap.id = WRAP_ID;
    wrap.style.cssText = `position:fixed;right:${DEFAULT_RIGHT}px;bottom:${DEFAULT_BOTTOM}px;z-index:2147483647;width:${BTN_SIZE}px;height:${BTN_SIZE}px;touch-action:none;user-select:none;-webkit-user-select:none;opacity:0;visibility:hidden;pointer-events:none;transition:opacity .2s ease, visibility .2s ease;`;

    button = document.createElement('button');
    button.type = 'button';
    button.innerHTML = '<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true"><path fill="currentColor" d="M8.2 5.35c0-.78.86-1.25 1.52-.83l9.05 5.68a.98.98 0 0 1 0 1.66l-9.05 5.68a.98.98 0 0 1-1.52-.83V5.35Z"/></svg>';
    button.setAttribute('aria-label', '用 SenPlayer 播放');
    const dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    button.style.cssText = `width:${BTN_SIZE}px;height:${BTN_SIZE}px;box-sizing:border-box;border-radius:999px;border:0;background:${dark ? 'rgba(44,44,46,.82)' : 'rgba(242,242,247,.92)'};color:${dark ? 'rgba(255,255,255,.94)' : 'rgba(28,28,30,.82)'};box-shadow:inset 0 0 0 .5px ${dark ? 'rgba(255,255,255,.16)' : 'rgba(60,60,67,.16)'};backdrop-filter:blur(10px) saturate(140%);-webkit-backdrop-filter:blur(10px) saturate(140%);filter:none;padding:0;margin:0;display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent;transition:transform .12s ease, opacity .2s, background .2s, border-color .2s, box-shadow .2s;`;

    badge = document.createElement('span');
    badge.style.cssText = 'position:absolute;right:-5px;top:-6px;min-width:16px;height:16px;padding:0 3px;border-radius:8px;background:#111;color:#fff;border:1px solid rgba(255,255,255,.35);font-size:10px;align-items:center;justify-content:center;display:none;box-sizing:border-box;';

    status = document.createElement('div');
    status.style.cssText = 'position:absolute;right:0;bottom:40px;max-width:250px;padding:7px 10px;border-radius:12px;background:rgba(20,20,22,.88);color:white;font-size:12px;line-height:1.35;opacity:0;transition:opacity .18s;pointer-events:none;box-shadow:0 6px 20px rgba(0,0,0,.28);white-space:nowrap;';

    wrap.appendChild(button);
    wrap.appendChild(badge);
    wrap.appendChild(status);
    document.body.appendChild(wrap);
    restorePosition();
    applyNeighborPosition();
    bindDrag();
    updateButton();
  }

  function bindDrag() {
    let longTimer = 0;
    let longPressFired = false;

    function clearGestureTimer() {
      clearTimeout(longTimer);
      longTimer = 0;
    }

    function finishGesture(e, cancelled) {
      clearGestureTimer();
      try { button.releasePointerCapture(e.pointerId); } catch (_) {}
      const wasDragging = dragging;
      const wasLongPress = longPressFired;
      pointerStart = null;
      dragging = false;
      longPressFired = false;
      if (cancelled) return;
      if (wasDragging) savePosition();
      else if (!wasLongPress) playCurrent().catch((error) => log('play failed', error));
    }

    button.addEventListener('pointerdown', (e) => {
      clearGestureTimer();
      pointerStart = { x: e.clientX, y: e.clientY, left: wrap.offsetLeft, top: wrap.offsetTop, t: Date.now() };
      dragging = false;
      longPressFired = false;
      try { button.setPointerCapture(e.pointerId); } catch (_) {}
      longTimer = setTimeout(() => {
        longTimer = 0;
        if (!pointerStart || dragging) return;
        longPressFired = true;
        showPanel();
      }, 650);
    });
    button.addEventListener('pointermove', (e) => {
      if (!pointerStart) return;
      const dx = e.clientX - pointerStart.x;
      const dy = e.clientY - pointerStart.y;
      if (Math.abs(dx) + Math.abs(dy) > 8) {
        dragging = true;
        clearGestureTimer();
        setPosition(pointerStart.left + dx, pointerStart.top + dy);
      }
    });
    button.addEventListener('pointerup', (e) => finishGesture(e, false));
    button.addEventListener('pointercancel', (e) => finishGesture(e, true));
  }

  function setPosition(left, top) {
    const w = BTN_SIZE;
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const x = Math.max(4, Math.min(vw - w - 4, left));
    const y = Math.max(30, Math.min(vh - w - 4, top));
    wrap.style.left = `${x}px`;
    wrap.style.top = `${y}px`;
    wrap.style.right = 'auto';
    wrap.style.bottom = 'auto';
  }

  function applyNeighborPosition() {
    if (!wrap) return;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null'); } catch (_) {}
    if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) return;
    const neighbor = document.getElementById('videoplay-fab');
    if (neighbor) {
      const r = neighbor.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        const left = Math.max(4, Math.floor(r.left - BTN_SIZE - SIDE_GAP));
        wrap.style.left = `${left}px`;
        wrap.style.top = 'auto';
        wrap.style.right = 'auto';
        wrap.style.bottom = `${Math.max(0, Math.floor((window.innerHeight || document.documentElement.clientHeight || 0) - r.bottom))}px`;
        return;
      }
    }
    wrap.style.left = '';
    wrap.style.top = 'auto';
    wrap.style.right = `${DEFAULT_RIGHT}px`;
    wrap.style.bottom = `${DEFAULT_BOTTOM}px`;
  }

  function savePosition() {
    try { localStorage.setItem(POS_KEY, JSON.stringify({ left: wrap.offsetLeft, top: wrap.offsetTop })); } catch (_) {}
  }

  function restorePosition() {
    try {
      const pos = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
      if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) setPosition(pos.left, pos.top);
    } catch (_) {}
  }

  function showPanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) { panel.remove(); return; }
    panel = document.createElement('div');
    panel.id = PANEL_ID;
    const list = Array.from(DETECTED.values()).sort((a, b) => b.score - a.score || b.time - a.time).slice(0, 8);
    panel.style.cssText = 'position:fixed;left:10px;right:10px;bottom:20px;z-index:2147483647;background:rgba(28,28,30,.96);color:#fff;border:1px solid rgba(255,255,255,.16);border-radius:18px;padding:12px;box-shadow:0 10px 36px rgba(0,0,0,.45);font:13px -apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif;';
    const rows = list.length ? list.map((item, idx) => `<button data-url="${escapeAttr(item.url)}" style="display:block;width:100%;text-align:left;margin:6px 0;padding:8px;border:0;border-radius:10px;background:${idx === 0 ? 'rgba(231,85,133,.25)' : 'rgba(255,255,255,.08)'};color:white;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${idx + 1}. ${escapeHtml(item.url)}</button>`).join('') : '<div style="opacity:.7;padding:8px 0;">还没有发现视频地址。先播放一下网页视频再试。</div>';
    panel.innerHTML = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><strong style="font-size:15px;">SenPlayer 视频地址</strong><button data-close="1" style="margin-left:auto;border:0;border-radius:999px;background:rgba(255,255,255,.12);color:white;padding:5px 10px;">关闭</button></div>${rows}<div style="margin-top:8px;opacity:.72;font-size:12px;">点击条目会复制并用 SenPlayer 打开。</div>`;
    document.body.appendChild(panel);
    panel.addEventListener('click', async (e) => {
      const target = e.target.closest('button');
      if (!target) return;
      if (target.dataset.close) { panel.remove(); return; }
      if (target.dataset.url) {
        currentUrl = target.dataset.url;
        panel.remove();
        await playUrl(currentUrl);
      }
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s).replace(/`/g, '&#96;'); }

  function registerMenus() {
    try {
      if (typeof GM === 'undefined' || !GM.registerMenuCommand) return;
      GM.registerMenuCommand('▶ 用 SenPlayer 播放当前视频', playCurrent);
      GM.registerMenuCommand('📋 复制当前视频地址', async () => {
        const url = resolveAutoVideoUrl();
        if (!url) return toast('未发现视频地址');
        await copyText(url);
        toast('已复制视频地址');
      });
      GM.registerMenuCommand('📍 重置 SenPlayer 按钮位置', () => {
        try { localStorage.removeItem(POS_KEY); } catch (_) {}
        if (wrap) { wrap.style.left = ''; wrap.style.top = 'auto'; wrap.style.right = `${DEFAULT_RIGHT}px`; wrap.style.bottom = `${DEFAULT_BOTTOM}px`; applyNeighborPosition(); }
      });
    } catch (e) { log('menu failed', e); }
  }

  function observe() {
    try {
      new MutationObserver((records) => {
        if (checkRoute()) return;
        if (document.hidden) {
          pendingFullScan = true;
          return;
        }
        let refresh = false;
        beginScanBatch();
        try {
          records.forEach((record) => {
            if (record.type === 'attributes') {
              scanElement(record.target);
              refresh ||= /^(VIDEO|AUDIO|SOURCE)$/.test(record.target?.tagName || '');
              return;
            }
            record.addedNodes.forEach((node) => {
              scanTree(node);
              if (node.nodeType === Node.TEXT_NODE && node.parentElement?.matches('script')) {
                const text = node.nodeValue || '';
                extractHtmlCandidates(text, 'html-config');
                extractConfigCandidates(text);
                return;
              }
              if (node.nodeType === Node.ELEMENT_NODE) {
                if (node.matches('script') || node.querySelector?.('script')) {
                  const html = (node.outerHTML || '').slice(0, 1000000);
                  extractHtmlCandidates(html, 'html-config');
                  extractConfigCandidates(html);
                }
                refresh ||= node.matches('video, audio, [class*="tube-player-v3"]') || Boolean(node.querySelector?.('video, audio, [class*="tube-player-v3"]'));
                if (node.id === 'videoplay-fab' || node.querySelector?.('#videoplay-fab')) applyNeighborPosition();
              }
            });
          });
        } finally { endScanBatch(); }
        if (refresh) updateButton();
      }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'href', 'data-src', 'poster'] });
    } catch (e) { log('observer failed', e); }

    try {
      ['pushState', 'replaceState'].forEach((method) => {
        const raw = history[method];
        history[method] = function (...args) {
          const result = raw.apply(this, args);
          checkRoute();
          return result;
        };
      });
    } catch (_) {}
    window.addEventListener('popstate', checkRoute);
    window.addEventListener('hashchange', checkRoute);
    window.addEventListener('pageshow', () => { checkRoute(); if (!document.hidden) { createButton(); if (pendingFullScan) scanFullPage(); applyNeighborPosition(); } });
    window.addEventListener('focus', () => { checkRoute(); if (!document.hidden) { createButton(); if (pendingFullScan) scanFullPage(); applyNeighborPosition(); } });
    window.addEventListener('resize', () => { if (!document.hidden) applyNeighborPosition(); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { clearTimeout(routeScanTimer); return; }
      checkRoute();
      createButton();
      if (pendingFullScan) scanFullPage();
      else updateButton();
      applyNeighborPosition();
    });
  }

  function init() {
    try { localStorage.removeItem('qiqi_senplayer_scheme_template_v1'); } catch (_) {}
    hookNetwork();
    registerMenus();
    const ready = () => {
      observe();
      if (document.hidden) { pendingFullScan = true; return; }
      createButton();
      scanFullPage();
    };
    if (document.body) ready();
    else document.addEventListener('DOMContentLoaded', ready, { once: true });
  }

  init();
})();
