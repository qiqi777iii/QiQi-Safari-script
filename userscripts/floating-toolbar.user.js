// ==UserScript==
// @name         悬浮工具栏
// @namespace    https://github.com/qiqi777iii/Scripts
// @version      1.6.1
// @updateURL    https://raw.githubusercontent.com/qiqi777iii/Scripts/main/userscripts/floating-toolbar.user.js
// @downloadURL  https://raw.githubusercontent.com/qiqi777iii/Scripts/main/userscripts/floating-toolbar.user.js
// @description  提供关闭当前标签页、新建 Safari 起始页及可拖动的悬浮工具栏。
// @author       Scripting Agent
// @match        http://*/*
// @match        https://*/*
// @run-at       document-start
// @grant        GM.log
// @grant        GM.closeTab
// @grant        GM.openInTab
// @grant        Scripting.tabs
// ==/UserScript==

(() => {
  "use strict";

  // 保留旧 DOM ID，确保“新标签页打开”和 TabsSaver 的组合定位继续兼容。
  const TOOLBAR_ID = "universal-pagination-floating-menu";
  const STYLE_ID = `${TOOLBAR_ID}-style`;
  const GROUP_DRAG_EVENT = "floating-toolbar-group-drag";
  const BOUND_LINK_ID = "__tb__";
  const BOOKMARK_TOOLBAR_ID = "tab-save-toolbar";
  const PAGE_NAVIGATION_ID = "floating-page-navigation";
  const ITEM_SIZE = 35;
  const BOUND_CONTROL_SIZE = 35;
  const CONNECT_OVERLAP = 1;
  const PAGE_NAVIGATION_WIDTH = 70;
  const VIDEO_FULLSCREEN_WIDTH = 35;
  const PAGE_NAVIGATION_RIGHT_GAP = 16;
  const SAFE_BOTTOM_GAP = 40;
  const DEFAULT_BOTTOM_GAP = 28;
  const DEFAULT_RIGHT_GAP = 60;

  const state = {
    initialized: false,
    navigating: false,
    dragging: false,
    dragMoved: false,
    suppressClickUntil: 0,
    savedPosition: null,
    observer: null,
  };

  const $ = (selector, root = document) => root.querySelector(selector);

  function log(...args) {
    try {
      if (typeof GM !== "undefined" && GM.log) GM.log("[悬浮工具栏]", ...args);
      else console.log("[悬浮工具栏]", ...args);
    } catch (_) {}
  }

  function absorbEvent(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  function isolateToolbar(root) {
    ["pointerdown", "pointerup", "pointercancel", "touchstart", "touchend", "mousedown", "mouseup", "click"].forEach((type) => {
      root.addEventListener(type, absorbEvent, { passive: false });
    });
  }

  function viewportBox() {
    const viewport = window.visualViewport;
    const layoutWidth = document.documentElement.clientWidth || innerWidth || 0;
    const layoutHeight = document.documentElement.clientHeight || innerHeight || 0;
    return {
      width: Math.max(1, Math.floor(viewport?.width || 0), Math.floor(layoutWidth), Math.floor(innerWidth || 0)),
      height: Math.max(1, Math.floor(viewport?.height || 0), Math.floor(layoutHeight), Math.floor(innerHeight || 0)),
    };
  }

  function controlIsVisible(control) {
    if (!control?.isConnected) return false;
    const style = getComputedStyle(control);
    const rect = control.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
  }

  function rightAccessoryWidth() {
    // 翻页组件存在时，始终再为最右侧全屏按钮预留一个按钮宽度；按钮显隐时
    // 不移动前六个按钮，同时避免页面出现预览视频后全屏按钮伸出可视区域。
    return document.getElementById(PAGE_NAVIGATION_ID)
      ? PAGE_NAVIGATION_WIDTH + VIDEO_FULLSCREEN_WIDTH
      : 0;
  }

  function defaultRightGap() {
    return Math.max(DEFAULT_RIGHT_GAP, rightAccessoryWidth() + PAGE_NAVIGATION_RIGHT_GAP);
  }

  function clampPosition(left, top, toolbar) {
    const viewport = viewportBox();
    const width = Math.max(toolbar?.offsetWidth || 0, ITEM_SIZE * 2);
    const height = Math.max(toolbar?.offsetHeight || 0, ITEM_SIZE);
    const maxLeft = Math.max(0, viewport.width - width - rightAccessoryWidth());
    const minLeft = document.getElementById(BOUND_LINK_ID) ? Math.min(BOUND_CONTROL_SIZE, maxLeft) : 0;
    return {
      left: Math.max(minLeft, Math.min(left, maxLeft)),
      top: Math.max(0, Math.min(top, viewport.height - height - SAFE_BOTTOM_GAP)),
    };
  }

  function controlsAreAdjacent(leftControl, rightControl) {
    if (!leftControl?.isConnected || !rightControl?.isConnected) return false;
    const leftRect = leftControl.getBoundingClientRect();
    const rightRect = rightControl.getBoundingClientRect();
    return leftRect.width > 0 && leftRect.height > 0 && rightRect.width > 0 && rightRect.height > 0 &&
      Math.abs(leftRect.right - rightRect.left) <= 1.5 && Math.abs(leftRect.top - rightRect.top) <= 1.5;
  }

  function refreshConnectedVisual(toolbar) {
    if (!toolbar?.isConnected) return;
    const linkToolbar = document.getElementById(BOUND_LINK_ID);
    const bookmarkToolbar = document.getElementById(BOOKMARK_TOOLBAR_ID);
    const connectedToLink = controlsAreAdjacent(linkToolbar, toolbar);
    const connectedToBookmark = !connectedToLink && controlsAreAdjacent(bookmarkToolbar, toolbar);
    const connected = connectedToLink || connectedToBookmark;
    toolbar.dataset.connectedLeft = connected ? "true" : "false";
    const pageNavigation = document.getElementById(PAGE_NAVIGATION_ID);
    const connectedRight = controlsAreAdjacent(toolbar, pageNavigation);
    toolbar.dataset.connectedRight = connectedRight ? "true" : "false";
    if (pageNavigation) {
      pageNavigation.dataset.connectedLeft = connectedRight ? "true" : "false";
    }
    const linkButton = document.getElementById("__tb_btn__");
    if (linkButton) linkButton.dataset.connectedRight = connectedToLink ? "true" : "false";
    const bookmarkButton = document.getElementById("tab-save-button");
    if (bookmarkButton && !linkToolbar) bookmarkButton.dataset.connectedRight = connectedToBookmark ? "true" : "false";
  }

  function positionBoundControl(toolbar) {
    if (!toolbar?.isConnected) return;
    const control = document.getElementById(BOUND_LINK_ID);
    if (!control) {
      refreshConnectedVisual(toolbar);
      return;
    }
    const rect = toolbar.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return;
    control.style.left = `${Math.max(0, rect.left - BOUND_CONTROL_SIZE + CONNECT_OVERLAP)}px`;
    control.style.right = "auto";
    const usesBottom = toolbar.style.bottom && toolbar.style.bottom !== "auto" && (!toolbar.style.top || toolbar.style.top === "auto");
    if (usesBottom) {
      control.style.bottom = toolbar.style.bottom;
      control.style.top = "auto";
    } else {
      control.style.top = `${rect.top}px`;
      control.style.bottom = "auto";
    }
    control.style.transform = "translate3d(0,0,0)";
    refreshConnectedVisual(toolbar);
  }

  function applyDefaultPosition(toolbar) {
    toolbar.style.right = `${defaultRightGap()}px`;
    toolbar.style.bottom = `${DEFAULT_BOTTOM_GAP}px`;
    toolbar.style.left = "auto";
    toolbar.style.top = "auto";
    positionBoundControl(toolbar);
  }

  function applySavedPosition(toolbar) {
    if (!state.savedPosition) return false;
    const position = clampPosition(state.savedPosition.left, state.savedPosition.top, toolbar);
    state.savedPosition = position;
    toolbar.style.left = `${position.left}px`;
    toolbar.style.top = `${position.top}px`;
    toolbar.style.right = "auto";
    toolbar.style.bottom = "auto";
    positionBoundControl(toolbar);
    return true;
  }

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${TOOLBAR_ID} {
        --qft-text: rgba(28,28,30,.82);
        --qft-bg: rgba(242,242,247,.92);
        --qft-separator: rgba(60,60,67,.16);
        box-sizing: border-box;
        position: fixed;
        right: ${DEFAULT_RIGHT_GAP}px;
        bottom: ${DEFAULT_BOTTOM_GAP}px;
        z-index: 2147483647;
        width: ${ITEM_SIZE * 2}px;
        height: ${ITEM_SIZE}px;
        display: flex;
        align-items: center;
        color: var(--qft-text);
        background: var(--qft-bg);
        border: 0;
        border-radius: 999px;
        box-shadow: inset 0 0 0 .5px var(--qft-separator);
        backdrop-filter: blur(10px) saturate(140%);
        -webkit-backdrop-filter: blur(10px) saturate(140%);
        overflow: hidden;
        user-select: none;
        touch-action: none;
      }
      #${TOOLBAR_ID}[data-connected-left="true"] { border-radius: 0 999px 999px 0; box-shadow: inset -.5px 0 0 var(--qft-separator), inset 0 .5px 0 var(--qft-separator), inset 0 -.5px 0 var(--qft-separator); }
      #${TOOLBAR_ID}[data-connected-right="true"] { border-radius: 999px 0 0 999px; box-shadow: inset .5px 0 0 var(--qft-separator), inset 0 .5px 0 var(--qft-separator), inset 0 -.5px 0 var(--qft-separator); }
      #${TOOLBAR_ID}[data-connected-left="true"][data-connected-right="true"] { border-radius: 0; box-shadow: inset 0 .5px 0 var(--qft-separator), inset 0 -.5px 0 var(--qft-separator); }
      #${TOOLBAR_ID}[data-connected-left="true"]::before { content: ""; position: absolute; z-index: 2; left: 0; top: 50%; width: 1px; height: 16px; background: var(--qft-separator); transform: translateY(-50%); pointer-events: none; }
      @media (prefers-color-scheme: dark) {
        #${TOOLBAR_ID} {
          --qft-text: rgba(255,255,255,.94);
          --qft-bg: rgba(44,44,46,.82);
          --qft-separator: rgba(255,255,255,.16);
        }
      }
      #${TOOLBAR_ID} button {
        box-sizing: border-box;
        position: relative;
        width: ${ITEM_SIZE}px;
        min-width: ${ITEM_SIZE}px;
        height: ${ITEM_SIZE}px;
        margin: 0;
        padding: 0;
        border: 0;
        color: inherit;
        background: transparent;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
      }
      #${TOOLBAR_ID} button + button::before {
        content: "";
        position: absolute;
        left: 0;
        top: 7px;
        bottom: 7px;
        width: 1px;
        background: var(--qft-separator);
        pointer-events: none;
      }
      #${TOOLBAR_ID} button svg {
        width: 20px;
        height: 20px;
        display: block;
        pointer-events: none;
      }
      #${TOOLBAR_ID} .new-tab svg {
        stroke: currentColor;
        stroke-width: 2.4;
        stroke-linecap: round;
        fill: none;
      }
      #${TOOLBAR_ID} .close-tab { color: #ff3b30; }
      @media (prefers-color-scheme: dark) {
        #${TOOLBAR_ID} .close-tab { color: #ff453a; }
      }
    `;
    document.documentElement.appendChild(style);
  }

  async function closeCurrentTab() {
    if (state.navigating) return;
    state.navigating = true;
    try {
      const current = await Scripting.tabs.getCurrent();
      if (!Number.isInteger(current?.id)) throw new Error("无法获取当前标签页 ID");
      await GM.closeTab(current.id);
    } catch (error) {
      state.navigating = false;
      log("关闭当前标签页失败", error);
    }
  }

  async function openStartPage() {
    try {
      await GM.openInTab(undefined, { active: true });
    } catch (error) {
      log("新建 Safari 起始页失败", error);
    }
  }

  function bindAction(button, action) {
    let lastRun = 0;
    const run = (event) => {
      if (state.dragMoved || Date.now() < state.suppressClickUntil) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      const now = Date.now();
      if (now - lastRun < 450) return;
      lastRun = now;
      void action();
    };
    button.addEventListener("pointerup", run, { passive: false });
    button.addEventListener("touchend", run, { passive: false });
    button.addEventListener("click", run, { passive: false });
  }

  function setupDrag(toolbar) {
    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    const move = (clientX, clientY) => {
      const position = clampPosition(startLeft + clientX - startX, startTop + clientY - startY, toolbar);
      toolbar.style.left = `${position.left}px`;
      toolbar.style.top = `${position.top}px`;
      toolbar.style.right = "auto";
      toolbar.style.bottom = "auto";
      positionBoundControl(toolbar);
    };

    toolbar.addEventListener("pointerdown", (event) => {
      if (event.button != null && event.button !== 0) return;
      pointerId = event.pointerId;
      state.dragMoved = false;
      startX = event.clientX;
      startY = event.clientY;
      const rect = toolbar.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
    });

    toolbar.addEventListener("pointermove", (event) => {
      if (pointerId !== event.pointerId) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (!state.dragMoved && Math.abs(dx) <= 6 && Math.abs(dy) <= 6) return;
      event.preventDefault();
      event.stopPropagation();
      if (!state.dragMoved) {
        state.dragMoved = true;
        state.dragging = true;
        try { toolbar.setPointerCapture(pointerId); } catch (_) {}
      }
      move(event.clientX, event.clientY);
    });

    const finish = (event) => {
      if (pointerId !== event.pointerId) return;
      const moved = state.dragMoved;
      try { toolbar.releasePointerCapture(pointerId); } catch (_) {}
      pointerId = null;
      state.dragging = false;
      if (moved) {
        event.preventDefault();
        event.stopPropagation();
        const rect = toolbar.getBoundingClientRect();
        state.savedPosition = clampPosition(rect.left, rect.top, toolbar);
        state.suppressClickUntil = Date.now() + 500;
        positionBoundControl(toolbar);
      }
      setTimeout(() => { state.dragMoved = false; }, 0);
    };

    toolbar.addEventListener("pointerup", finish);
    toolbar.addEventListener("pointercancel", finish);
  }

  function createToolbar() {
    addStyles();
    const existing = document.getElementById(TOOLBAR_ID);
    if (existing) return existing;

    const toolbar = document.createElement("div");
    toolbar.id = TOOLBAR_ID;
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "悬浮工具栏");
    toolbar.innerHTML = `
      <button class="new-tab" type="button" title="新建 Safari 起始页" aria-label="新建 Safari 起始页">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14"></path></svg>
      </button>
      <button class="close-tab" type="button" title="关闭当前标签页" aria-label="关闭当前标签页">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18"></path></svg>
      </button>
    `;
    isolateToolbar(toolbar);
    document.documentElement.appendChild(toolbar);
    bindAction(toolbar.querySelector(".new-tab"), openStartPage);
    bindAction(toolbar.querySelector(".close-tab"), closeCurrentTab);
    setupDrag(toolbar);

    toolbar.addEventListener(GROUP_DRAG_EVENT, (event) => {
      const left = Number(event.detail?.left);
      const top = Number(event.detail?.top);
      if (!Number.isFinite(left) || !Number.isFinite(top)) return;
      const position = clampPosition(left, top, toolbar);
      toolbar.style.left = `${position.left}px`;
      toolbar.style.top = `${position.top}px`;
      toolbar.style.right = "auto";
      toolbar.style.bottom = "auto";
      state.savedPosition = position;
      const finished = event.detail?.phase === "end" || event.detail?.phase === "cancel";
      state.dragging = !finished;
      positionBoundControl(toolbar);
    });

    if (!applySavedPosition(toolbar)) applyDefaultPosition(toolbar);
    return toolbar;
  }

  function stabilizePosition() {
    const toolbar = document.getElementById(TOOLBAR_ID);
    if (!toolbar || state.dragging) return;
    if (!applySavedPosition(toolbar)) applyDefaultPosition(toolbar);
  }

  function ensureToolbar() {
    const toolbar = createToolbar();
    requestAnimationFrame(() => {
      if (!state.dragging) positionBoundControl(toolbar);
    });
  }

  function init() {
    if (state.initialized) return;
    const root = document.documentElement || document.body;
    if (!root) {
      setTimeout(init, 80);
      return;
    }
    state.initialized = true;
    ensureToolbar();

    state.observer = new MutationObserver((mutations) => {
      const toolbarMissing = !document.getElementById(TOOLBAR_ID);
      const styleMissing = !document.getElementById(STYLE_ID);
      const boundControlChanged = mutations.some((mutation) => [...mutation.addedNodes, ...mutation.removedNodes].some((node) => node instanceof Element && ([BOUND_LINK_ID, BOOKMARK_TOOLBAR_ID, PAGE_NAVIGATION_ID].includes(node.id) || node.querySelector?.(`#${BOUND_LINK_ID}, #${BOOKMARK_TOOLBAR_ID}, #${PAGE_NAVIGATION_ID}`))));
      if (toolbarMissing || styleMissing) ensureToolbar();
      else if (boundControlChanged) stabilizePosition();
    });
    state.observer.observe(root, { subtree: true, childList: true });

    let resizeTimer = null;
    const scheduleStabilize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(stabilizePosition, 120);
    };
    window.addEventListener("floating-accessories-change", stabilizePosition);
    window.addEventListener("resize", scheduleStabilize);
    window.addEventListener("scroll", scheduleStabilize, { passive: true });
    window.visualViewport?.addEventListener("resize", scheduleStabilize);
    window.visualViewport?.addEventListener("scroll", scheduleStabilize);
    window.addEventListener("pageshow", () => {
      state.navigating = false;
      ensureToolbar();
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        state.navigating = false;
        ensureToolbar();
      }
    });

    log("已加载");
  }

  init();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  }
})();
