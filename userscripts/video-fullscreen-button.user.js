// ==UserScript==
// @name         视频全屏按钮
// @namespace    https://github.com/qiqi777iii/Scripts
// @version      1.2.0
// @description  检测网页视频，点击按钮后自动播放并切换为全屏。
// @author       Scripting Agent
// @match        http://*/*
// @match        https://*/*
// @run-at       document-end
// @grant        GM.log
// ==/UserScript==

(() => {
  "use strict";

  const SCRIPT_ID = "video-fullscreen";
  const STYLE_ID = `${SCRIPT_ID}-style`;
  const BASE_TOOLBAR_ID = "universal-pagination-floating-menu";
  const PAGE_NAVIGATION_ID = "floating-page-navigation";
  const ACCESSORIES_CHANGE_EVENT = "floating-accessories-change";
  const USER_PLAYBACK_ATTRIBUTE = "data-user-playback-until";
  const COVER_PREVIEW_ACTIVE_CLASS = "__mobile_preview_active__";
  const COVER_PREVIEW_VIDEO_CLASS = "__mobile_preview__";
  const ITEM_SIZE = 35;
  const CONNECT_OVERLAP = 1;
  const DEFAULT_RIGHT_GAP = 86;
  const DEFAULT_BOTTOM_GAP = 28;
  const state = {
    activeVideo: null,
    visible: false,
    initialized: false,
    observer: null,
    baseObserver: null,
    navObserver: null,
    resizeObserver: null,
    updateTimer: null,
    positionScheduled: false,
  };

  function log(...args) {
    try {
      if (typeof GM !== "undefined" && GM.log) GM.log("[视频全屏]", ...args);
      else console.log("[视频全屏]", ...args);
    } catch (_) {}
  }

  function elementVisible(element) {
    if (!element?.isConnected) return false;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1;
  }

  function isCoverPreviewVideo(video) {
    if (!(video instanceof HTMLVideoElement)) return false;
    if (video.classList.contains(COVER_PREVIEW_VIDEO_CLASS)) return true;
    if (video.closest?.(`.${COVER_PREVIEW_ACTIVE_CLASS}`)) return true;

    // MissAV 使用站点原生 video.preview 播放封面，封面预览脚本不会给卡片
    // 添加通用 active class；仅在该站点且视频位于封面链接内时排除。
    return /(^|\.)missav\.[a-z0-9-]+$/i.test(location.hostname) &&
      video.matches("video.preview") &&
      Boolean(video.closest?.("a[href], .thumbnail"));
  }

  function videoScore(video) {
    if (!(video instanceof HTMLVideoElement) || !elementVisible(video) || isCoverPreviewVideo(video)) return -1;
    const rect = video.getBoundingClientRect();
    let score = rect.width * rect.height;
    const previewContainer = video.closest?.('a[href], [class*="preview" i], [class*="thumb" i], [class*="card" i], [class*="related" i], [class*="recommend" i]');
    if (previewContainer) score *= 0.05;
    const mainPlayerContainer = video.closest?.('[class*="player" i], [id*="player" i], .video-js, .plyr');
    if (mainPlayerContainer && !previewContainer) score *= 4;
    return score;
  }

  function findSitePrimaryVideo() {
    const hostname = location.hostname;
    const selectors = [];
    if (/(^|\.)xhamster\.[a-z0-9.-]+$/i.test(hostname)) selectors.push("video#xplayer__video");
    selectors.push(
      'video[data-main-video="true"]',
      '[data-role="video-player"] video',
      'main [class*="player" i] video',
      'article [class*="player" i] video'
    );
    for (const selector of selectors) {
      const video = document.querySelector(selector);
      if (video instanceof HTMLVideoElement && elementVisible(video) && !isCoverPreviewVideo(video)) return video;
    }
    return null;
  }

  function findActiveVideo() {
    const primary = findSitePrimaryVideo();
    if (primary) return primary;
    let best = null;
    let bestScore = -1;
    for (const video of document.querySelectorAll("video")) {
      const score = videoScore(video);
      if (score > bestScore) {
        best = video;
        bestScore = score;
      }
    }
    return best;
  }

  function controlsAreAdjacent(leftControl, rightControl) {
    if (!elementVisible(leftControl) || !elementVisible(rightControl)) return false;
    const leftRect = leftControl.getBoundingClientRect();
    const rightRect = rightControl.getBoundingClientRect();
    return Math.abs(leftRect.right - rightRect.left) <= 1.5 && Math.abs(leftRect.top - rightRect.top) <= 1.5;
  }

  function refreshConnectedVisual(button) {
    const base = document.getElementById(BASE_TOOLBAR_ID);
    const navigation = document.getElementById(PAGE_NAVIGATION_ID);
    const leftControl = elementVisible(navigation) ? navigation : base;
    const connectedLeft = controlsAreAdjacent(leftControl, button);
    button.dataset.connectedLeft = connectedLeft ? "true" : "false";
    button.dataset.connectedRight = "false";
    if (base && !elementVisible(navigation)) base.dataset.connectedRight = connectedLeft ? "true" : "false";
    if (navigation) navigation.dataset.connectedRight = connectedLeft && leftControl === navigation ? "true" : "false";
  }

  function observeAnchor(anchor, key) {
    const observerKey = key === "base" ? "baseObserver" : "navObserver";
    const markerKey = key === "base" ? "observedBase" : "observedNav";
    if (state[markerKey] === anchor) return;
    state[observerKey]?.disconnect();
    state[markerKey] = anchor || null;
    state[observerKey] = null;
    if (!anchor) return;
    state[observerKey] = new MutationObserver(schedulePosition);
    state[observerKey].observe(anchor, { attributes: true, attributeFilter: ["style", "class", "hidden"] });
  }

  function applyPosition(button) {
    if (!button?.isConnected || !state.visible) return;
    const base = document.getElementById(BASE_TOOLBAR_ID);
    const navigation = document.getElementById(PAGE_NAVIGATION_ID);
    observeAnchor(base, "base");
    observeAnchor(navigation, "nav");

    if (elementVisible(navigation)) {
      const rect = navigation.getBoundingClientRect();
      button.style.left = `${rect.right - CONNECT_OVERLAP}px`;
      button.style.right = "auto";
      const usesBottom = navigation.style.bottom && navigation.style.bottom !== "auto" && (!navigation.style.top || navigation.style.top === "auto");
      if (usesBottom) {
        button.style.bottom = navigation.style.bottom;
        button.style.top = "auto";
      } else {
        button.style.top = `${rect.top}px`;
        button.style.bottom = "auto";
      }
    } else if (elementVisible(base)) {
      const rect = base.getBoundingClientRect();
      button.style.left = `${rect.right - CONNECT_OVERLAP}px`;
      button.style.right = "auto";
      const usesBottom = base.style.bottom && base.style.bottom !== "auto" && (!base.style.top || base.style.top === "auto");
      if (usesBottom) {
        button.style.bottom = base.style.bottom;
        button.style.top = "auto";
      } else {
        button.style.top = `${rect.top}px`;
        button.style.bottom = "auto";
      }
    } else {
      button.style.right = `${DEFAULT_RIGHT_GAP}px`;
      button.style.bottom = `${DEFAULT_BOTTOM_GAP}px`;
      button.style.left = "auto";
      button.style.top = "auto";
    }
    refreshConnectedVisual(button);
  }

  function schedulePosition() {
    if (state.positionScheduled) return;
    state.positionScheduled = true;
    requestAnimationFrame(() => {
      state.positionScheduled = false;
      applyPosition(document.getElementById(SCRIPT_ID));
    });
  }

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${SCRIPT_ID} {
        --qvf-text: rgba(28,28,30,.82);
        --qvf-bg: rgba(242,242,247,.92);
        --qvf-separator: rgba(60,60,67,.16);
        box-sizing: border-box;
        position: fixed;
        right: ${DEFAULT_RIGHT_GAP}px;
        bottom: ${DEFAULT_BOTTOM_GAP}px;
        z-index: 2147483647;
        width: ${ITEM_SIZE}px;
        min-width: ${ITEM_SIZE}px;
        height: ${ITEM_SIZE}px;
        margin: 0;
        padding: 0;
        border: 0;
        border-radius: 999px;
        color: var(--qvf-text);
        background: var(--qvf-bg);
        box-shadow: inset 0 0 0 .5px var(--qvf-separator);
        -webkit-backdrop-filter: blur(10px) saturate(140%);
        backdrop-filter: blur(10px) saturate(140%);
        align-items: center;
        justify-content: center;
        cursor: pointer;
        user-select: none;
        -webkit-user-select: none;
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
        transform: translate3d(0,0,0);
      }
      #${SCRIPT_ID}[data-connected-left="true"] { border-radius: 0 999px 999px 0; box-shadow: inset -.5px 0 0 var(--qvf-separator), inset 0 .5px 0 var(--qvf-separator), inset 0 -.5px 0 var(--qvf-separator); }
      #${SCRIPT_ID}[data-connected-right="true"] { border-radius: 999px 0 0 999px; box-shadow: inset .5px 0 0 var(--qvf-separator), inset 0 .5px 0 var(--qvf-separator), inset 0 -.5px 0 var(--qvf-separator); }
      #${SCRIPT_ID}[data-connected-left="true"][data-connected-right="true"] { border-radius: 0; box-shadow: inset 0 .5px 0 var(--qvf-separator), inset 0 -.5px 0 var(--qvf-separator); }
      #${SCRIPT_ID}[data-connected-left="true"]::before { content: ""; position: absolute; z-index: 2; left: 0; top: 50%; width: 1px; height: 16px; background: var(--qvf-separator); transform: translateY(-50%); pointer-events: none; }
      #${SCRIPT_ID}:active { background: rgba(118,118,128,.12); }
      #${SCRIPT_ID} svg { width: 20px; height: 20px; display: block; pointer-events: none; }
      @media (prefers-color-scheme: dark) {
        #${SCRIPT_ID} {
          --qvf-text: rgba(255,255,255,.94);
          --qvf-bg: rgba(44,44,46,.82);
          --qvf-separator: rgba(255,255,255,.16);
        }
      }
    `;
    document.documentElement.appendChild(style);
  }

  function absorbEvent(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  function isolateUi(button) {
    ["pointerdown", "pointerup", "pointercancel", "touchstart", "touchend", "mousedown", "mouseup", "click"].forEach((type) => {
      button.addEventListener(type, absorbEvent, { passive: false });
    });
  }

  function playerContainer(video) {
    return video.closest?.('.plyr, .video-player, .video-container, [class*="player" i], [id*="player" i]') || video;
  }

  function isXHamster() {
    return /(^|\.)xhamster\.[a-z0-9.-]+$/i.test(location.hostname);
  }

  function prepareXHamsterHighestQuality(video) {
    if (!isXHamster()) return;
    // 先允许这次用户主动播放，避免最高画质脚本的防自动播放逻辑把视频暂停。
    const playbackAllowedUntil = String(Date.now() + 5000);
    video.setAttribute(USER_PLAYBACK_ATTRIBUTE, playbackAllowedUntil);
    document.documentElement?.setAttribute(USER_PLAYBACK_ATTRIBUTE, playbackAllowedUntil);
    const choices = Array.from(document.querySelectorAll(".xplayer-settings-menu-new__option.quality"))
      .filter((item) => item.getAttribute("aria-disabled") !== "true")
      .map((item) => {
        const match = (item.textContent || "").match(/(?:^|\s)(\d{3,4})\s*p\b/i);
        return { item, quality: match ? Number(match[1]) : 0 };
      })
      .filter(({ quality }) => quality > 0)
      .sort((a, b) => b.quality - a.quality);
    const highest = choices[0]?.item;
    if (highest && !highest.classList.contains("selected")) highest.click();
  }

  function startXHamsterNativePlayer(video) {
    if (!isXHamster()) return false;
    const player = document.querySelector("[data-role='xplayer'], #video_box");
    if (!player?.contains(video)) return false;

    // xHamster 首次播放必须经过播放器自己的入口才能清除 no-user-action。
    // 同时临时关闭 playsinline，让 iPhone 在开始播放时直接进入原生全屏。
    const hadPlaysInline = video.hasAttribute("playsinline");
    const hadWebkitPlaysInline = video.hasAttribute("webkit-playsinline");
    video.playsInline = false;
    video.removeAttribute("playsinline");
    video.removeAttribute("webkit-playsinline");

    let restored = false;
    const restoreInlineMode = () => {
      if (restored) return;
      restored = true;
      if (hadPlaysInline) video.setAttribute("playsinline", "");
      if (hadWebkitPlaysInline) video.setAttribute("webkit-playsinline", "");
      video.playsInline = hadPlaysInline;
    };
    video.addEventListener("webkitendfullscreen", restoreInlineMode, { once: true });
    setTimeout(() => {
      if (video.paused) restoreInlineMode();
    }, 3000);

    if (video.ended) {
      try { video.currentTime = 0; } catch (_) {}
    }
    const nativePlayTarget = player.querySelector(".xp-preload-image, .xplayer-start-button") || player;
    nativePlayTarget.click();
    if (video.paused) {
      const playPromise = video.play();
      if (playPromise?.catch) playPromise.catch((error) => log("原生播放器启动失败", error));
    }
    return true;
  }

  async function enterFullscreen() {
    const video = state.activeVideo && videoScore(state.activeVideo) >= 0 ? state.activeVideo : findActiveVideo();
    if (!video) {
      scheduleUpdate(0);
      return;
    }
    try {
      prepareXHamsterHighestQuality(video);

      if (startXHamsterNativePlayer(video)) {
        // 已通过站点原生播放入口启动；支持时再立即请求一次原生全屏作为保险。
        if (typeof video.webkitEnterFullscreen === "function") {
          try { video.webkitEnterFullscreen(); } catch (error) { log("等待 iPhone 自动进入全屏", error); }
        }
        return;
      }

      // 其他站点仍由同一次用户点击直接触发播放和全屏。
      if (video.ended) {
        try { video.currentTime = 0; } catch (_) {}
      }
      const playPromise = video.play();
      if (playPromise?.catch) playPromise.catch((error) => log("自动播放失败", error));

      if (typeof video.webkitEnterFullscreen === "function") {
        video.webkitEnterFullscreen();
        return;
      }
      if (typeof video.requestFullscreen === "function") {
        await video.requestFullscreen();
        return;
      }
      const container = playerContainer(video);
      if (container !== video && typeof container.requestFullscreen === "function") {
        await container.requestFullscreen();
        return;
      }
      const nativeButton = container.querySelector?.('[data-plyr="fullscreen"], [aria-label*="full screen" i], [aria-label*="fullscreen" i], [title*="full screen" i], [title*="fullscreen" i], .fullscreen, [class*="fullscreen" i]');
      if (nativeButton) {
        nativeButton.click();
        return;
      }
      log("当前播放器不支持网页全屏 API");
    } catch (error) {
      log("进入全屏失败", error);
    }
  }

  function bindAction(button) {
    let lastRun = 0;
    const run = (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      const now = Date.now();
      if (now - lastRun < 450) return;
      lastRun = now;
      void enterFullscreen();
    };
    button.addEventListener("pointerup", run, { passive: false });
    button.addEventListener("touchend", run, { passive: false });
    button.addEventListener("click", run, { passive: false });
  }

  function createButton() {
    addStyles();
    let button = document.getElementById(SCRIPT_ID);
    if (button) return button;
    button = document.createElement("button");
    button.id = SCRIPT_ID;
    button.type = "button";
    button.title = "视频全屏";
    button.setAttribute("aria-label", "视频全屏");
    button.dataset.connectedLeft = "false";
    button.dataset.connectedRight = "false";
    button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"></path></svg>';
    isolateUi(button);
    bindAction(button);
    document.documentElement.appendChild(button);
    return button;
  }

  function notifyAccessoriesChanged() {
    window.dispatchEvent(new CustomEvent(ACCESSORIES_CHANGE_EVENT, { detail: { id: SCRIPT_ID, visible: state.visible } }));
  }

  function updateButton() {
    state.updateTimer = null;
    const activeVideo = findActiveVideo();
    const visible = Boolean(activeVideo);
    state.activeVideo = activeVideo;
    const button = createButton();
    button.style.display = visible ? "flex" : "none";
    button.setAttribute("aria-hidden", visible ? "false" : "true");
    refreshConnectedVisual(button);
    if (visible !== state.visible) {
      state.visible = visible;
      notifyAccessoriesChanged();
    }
    if (visible) schedulePosition();
  }

  function scheduleUpdate(delay = 80) {
    clearTimeout(state.updateTimer);
    state.updateTimer = setTimeout(updateButton, delay);
  }

  function mutationTouchesVideoOrToolbar(mutation) {
    const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
    return nodes.some((node) => node instanceof Element && (
      node.matches?.(`video, #${BASE_TOOLBAR_ID}, #${PAGE_NAVIGATION_ID}`) ||
      node.querySelector?.(`video, #${BASE_TOOLBAR_ID}, #${PAGE_NAVIGATION_ID}`)
    ));
  }

  function init() {
    if (state.initialized) return;
    const root = document.documentElement || document.body;
    if (!root) {
      setTimeout(init, 80);
      return;
    }
    state.initialized = true;
    createButton();
    scheduleUpdate(0);

    ["play", "playing", "pause", "ended", "emptied", "loadedmetadata", "abort", "error"].forEach((type) => {
      document.addEventListener(type, () => scheduleUpdate(type === "play" || type === "playing" ? 0 : 80), true);
    });

    state.observer = new MutationObserver((mutations) => {
      if (!document.getElementById(SCRIPT_ID) || !document.getElementById(STYLE_ID)) {
        createButton();
        scheduleUpdate(0);
      } else if (mutations.some(mutationTouchesVideoOrToolbar)) {
        scheduleUpdate(80);
        schedulePosition();
      }
    });
    state.observer.observe(root, { subtree: true, childList: true });

    if (typeof ResizeObserver === "function") {
      state.resizeObserver = new ResizeObserver(schedulePosition);
      state.resizeObserver.observe(document.documentElement);
    }
    window.addEventListener("resize", schedulePosition);
    window.addEventListener("scroll", schedulePosition, { passive: true });
    window.visualViewport?.addEventListener("resize", schedulePosition);
    window.visualViewport?.addEventListener("scroll", schedulePosition);
    window.addEventListener("pageshow", () => scheduleUpdate(0));
    window.addEventListener("scripts:urlchange", () => scheduleUpdate(80));
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) scheduleUpdate(0);
    });
    log("已加载");
  }

  init();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
})();
