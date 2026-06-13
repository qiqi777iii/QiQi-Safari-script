// ==UserScript==
// @name         新标签页打开
// @version      1.0.31
// @updateURL    https://raw.githubusercontent.com/qiqi777iii/QiQi-Safari-script/main/new-tab-opener.user.js
// @downloadURL  https://raw.githubusercontent.com/qiqi777iii/QiQi-Safari-script/main/new-tab-opener.user.js
// @description  🔗 单按钮浮动工具，柔和小玻璃底 + SVG 链接图标：开启=绿色，关闭=红色描边，一键切换新标签页开关。v1.0.31 将按钮贴近悬浮翻页左侧。
// @match        *://*/*
// @grant        GM.registerMenuCommand
// @run-at       document-start
// @exclude      https://accounts.google.com/*
// @exclude      https://accounts.google.com.hk/*
// ==/UserScript==

(function () {
    'use strict';

    const KEY = '__tb_';
    const BTN_SIZE = 35;
    const BOTTOM_GAP = 0;
    const LINK_PAGER_GAP = 4;
    const PAGER_RIGHT_GAP = 16;
    const PAGER_HEIGHT = 35;
    const DEFAULT_BOTTOM = BOTTOM_GAP + (PAGER_HEIGHT - BTN_SIZE) / 2;
    const FALLBACK_PAGER_WIDTH = 148;
    const DEFAULT_RIGHT = PAGER_RIGHT_GAP + FALLBACK_PAGER_WIDTH + LINK_PAGER_GAP;
    const CURRENT_LAYOUT_VERSION = '1.0.31';

    const COLOR_ON = '#34C759';
    const COLOR_OFF = '#FF453A';

    let enabled = getVal('newTabEnabled', false);
    let toolbar, linkBtn, observer, bodyObserver, toolbarEnsureTimer;
    let menuRegistered = false;
    let listenersInstalled = false;
    let historyHooked = false;
    let lastHref = location.href;
    let urlRefreshTimer = null;
    let savedPosition = null;
    let dragging = false;
    let moved = false;
    let startX = 0, startY = 0, startLeft = 0, startTop = 0;
    let lastOpenedHref = '';
    let lastOpenedAt = 0;

    function getVal(key, def) {
        try {
            const v = localStorage.getItem(KEY + key);
            if (v === null) return def;
            if (v === 'true') return true;
            if (v === 'false') return false;
            const n = Number(v);
            return Number.isNaN(n) ? v : n;
        } catch (_) { return def; }
    }

    function setVal(key, val) {
        try { localStorage.setItem(KEY + key, String(val)); } catch (_) {}
    }

    function removeVal(key) {
        try { localStorage.removeItem(KEY + key); } catch (_) {}
    }

    function isolateFloatingUi(root) {
        function absorb(e) {
            e.preventDefault();
            e.stopPropagation();
        }
        ['pointerdown', 'pointerup', 'pointercancel', 'touchstart', 'touchend', 'mousedown', 'mouseup', 'click'].forEach(function (type) {
            root.addEventListener(type, absorb, { passive: false });
        });
    }

    function scanLinks() {
        document.querySelectorAll('a[href]').forEach(function (a) {
            const href = a.getAttribute('href') || '';
            const isHttp = a.href.slice(0, 4) === 'http';
            const keepSelf = !isHttp || href[0] === '#' || isPmvHavenVideoLink(a) || isMissAvNavLink(a) || isMissAvPreviewLink(a);
            a.target = keepSelf || !enabled ? '_self' : '_blank';
            if (enabled && !keepSelf) a.rel = 'noopener';
        });
    }

    function refresh() {
        setVal('newTabEnabled', enabled);
        if (enabled) startObserver();
        else if (observer) {
            observer.disconnect();
            observer = null;
        }
        scanLinks();
        updateBtn();
    }

    // 空闲调度：让出首屏渲染，Safari 无 requestIdleCallback 时回退到 setTimeout。
    function runWhenIdle(fn, timeout) {
        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(fn, { timeout: timeout || 800 });
        } else {
            setTimeout(fn, 1);
        }
    }

    function nextFrame(fn) {
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fn);
        else setTimeout(fn, 16);
    }

    var scanScheduled = false;
    function scheduleScan() {
        if (!enabled || scanScheduled) return;
        scanScheduled = true;
        runWhenIdle(function () {
            scanScheduled = false;
            if (enabled) scanLinks();
        }, 500);
    }

    // 在一组延迟时刻分别调度同一回调（兜底节奏：保留全部时机）。
    function runAtDelays(delays, fn) {
        delays.forEach(function (ms) { setTimeout(fn, ms); });
    }

    // 健康检查 + 默认队形同步（多处兜底共用）。
    function ensureToolbarAndSync() {
        const wasHealthy = isToolbarHealthy();
        ensureToolbar();
        if (!wasHealthy || !savedPosition) syncDefaultPosition();
    }

    function scheduleScanBurst() {
        if (!enabled) return;
        runAtDelays([0, 80, 220, 600, 1200], scheduleScan);
    }

    function scheduleVisualBurst() {
        runAtDelays([0, 40, 120, 300, 700, 1500, 3000, 6000], ensureToolbarAndSync);
    }

    function startObserver() {
        if (observer) return;
        // 回调防抖 + 空闲执行：高频 DOM 变化时不再每次同步全页 scanLinks。
        observer = new MutationObserver(function () {
            if (enabled) scheduleScan();
        });
        observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
    }

    function findLinkTarget(target) {
        return target?.closest?.('a[href], area[href]');
    }

    function isPmvHavenVideoLink(link) {
        // PMVHaven 视频卡片：hover/pointer 后动态插入 preview.mp4。
        // 链接自身保持 _self；非预览区点击仍由脚本捕获后 window.open(_blank)。
        if (!link) return false;
        if (!/(^|\.)pmvhaven\.com$/i.test(location.hostname)) return false;
        let url;
        try { url = new URL(link.href, location.href); } catch (_) { return false; }
        if (!/(^|\.)pmvhaven\.com$/i.test(url.hostname)) return false;
        return /^\/video\//i.test(url.pathname) || Boolean(link.dataset?.videoId);
    }

    function isPmvHavenPreviewTap(e, link) {
        if (!e || !isPmvHavenVideoLink(link)) return false;
        const point = getEventPoint(e);
        const media = link.querySelector?.('video, img, .aspect-video, [class*=aspect-video], [class*=thumbnail], [class*=poster], [class*=image]');
        if (media) {
            const rect = media.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) return isInRect(point, rect, 8);
        }
        // 兜底：PMVHaven 卡片顶部约 58% 是封面/预览区域；下方标题、标签仍新标签页打开。
        const rect = link.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) return point.y <= rect.top + rect.height * 0.58;
        return false;
    }

    let pmvHavenArmedHref = '';
    let pmvHavenArmedAt = 0;
    let pmvHavenLastInteractHref = '';
    let pmvHavenLastInteractAt = 0;
    const PMVHAVEN_REARM_MS = 4000;
    const PMVHAVEN_DEBOUNCE_MS = 600;
    const PMVHAVEN_MOVE_TOLERANCE = 12;
    let pmvHavenPointerDownX = 0;
    let pmvHavenPointerDownY = 0;
    let pmvHavenPointerDownHref = '';

    function handlePmvHavenPreviewInteract(e, link) {
        const href = link.href || '';
        if (!href) return;
        const now = Date.now();

        // PMVHaven 原生两段式主要由 click 触发；pointerup/touchend 只用来拦截通用新标签逻辑，
        // 不计入「第几次点击」，避免一次 tap 的多事件被误判为二次点击而自动播放/打开。
        if (e.type !== 'click') {
            return;
        }

        // 滑动列表后的 click 不算一次封面点击，避免滚动时误触预览/打开。
        if (pmvHavenPointerDownHref === href) {
            const p = getEventPoint(e);
            if (Math.abs(p.x - pmvHavenPointerDownX) > PMVHAVEN_MOVE_TOLERANCE || Math.abs(p.y - pmvHavenPointerDownY) > PMVHAVEN_MOVE_TOLERANCE) {
                return;
            }
        }

        // click 级去抖，避免站点或浏览器重复派发 click。
        if (href === pmvHavenLastInteractHref && now - pmvHavenLastInteractAt < PMVHAVEN_DEBOUNCE_MS) {
            e.preventDefault();
            return;
        }
        pmvHavenLastInteractHref = href;
        pmvHavenLastInteractAt = now;

        // 第二次点同一封面：新标签页打开。
        if (href === pmvHavenArmedHref && now - pmvHavenArmedAt < PMVHAVEN_REARM_MS) {
            pmvHavenArmedHref = '';
            pmvHavenArmedAt = 0;
            e.preventDefault();
            e.stopImmediatePropagation();
            window.open(href, '_blank');
            return;
        }

        // 第一次点封面：只阻止链接默认跳转，不停止站点自己的 click 处理。
        // 这样保留 PMVHaven 原生「首次点播放预览、再次点打开」逻辑，且不会因脚本主动触发而误自动播放。
        pmvHavenArmedHref = href;
        pmvHavenArmedAt = now;
        e.preventDefault();
    }

    function isMissAvPreviewPage() {
        if (!/(^|\.)missav\.ai$/i.test(location.hostname)) return false;
        // 列表类页面（原有路径正则）
        if (/\/(dm\d+\/)?(?:[a-z]{2}\/)?(?:actresses?|genres?|makers?|tags?|search|new|today|weekly|monthly|uncensored|chinese-subtitle)(\/|$)/i.test(location.pathname)) return true;
        // 影片详情页等：只要页面存在封面预览视频（推荐区卡片）也算预览页
        return Boolean(document.querySelector('video.preview, video[class*="preview"]'));
    }

    function isEpornerThumb(link) {
        // eporner.com 缩略图：站点自带触摸预览引擎（EPimagePreviewStart 等）。
        // 采用两段式：首次点击放行给站点（启动预览），同一缩略图再次点击才新标签页打开。
        if (!link) return false;
        if (!/(^|\.)eporner\.com$/i.test(location.hostname)) return false;
        if (link.querySelector?.('img[data-st]')) return true;
        const card = link.closest?.('.mb, .mbcontent, [class*=mbcontent]');
        return Boolean(card?.querySelector?.('img[data-st]'));
    }

    function isMissAvNavLink(link) {
        // MissAV 站内导航：排序/过滤菜单项、分页（下一页/页码）——应在当前页跳转，不要新标签页打开
        if (!link) return false;
        if (!/(^|\.)missav\.ai$/i.test(location.hostname)) return false;
        const href = link.getAttribute('href') || '';
        // 纯 JS 菜单触发（href="#" 或空）
        if (href === '' || href[0] === '#') return true;
        // 带查询参数的站内导航：?page= / ?sort= / ?filters=
        let url;
        try { url = new URL(link.href, location.href); } catch (_) { return false; }
        if (!/(^|\.)missav\.ai$/i.test(url.hostname)) return false;
        return /[?&](page|sort|filters)=/.test(url.search);
    }

    function isMissAvPreviewLink(link) {
        if (!isMissAvPreviewPage() || !link) return false;

        const mediaSelector = 'video, canvas, picture, img, .thumbnail, .cover, .preview, [class*=preview], [class*=thumbnail], [class*=cover], [class*=image], [class*=poster]';
        if (link.querySelector?.(mediaSelector)) return true;

        const card = link.closest?.('.thumbnail, .cover, .preview, [class*=thumbnail], [class*=cover], [class*=preview], [class*=movie], [class*=video], [class*=item]');
        return Boolean(card?.querySelector?.(mediaSelector));
    }

    function getEventPoint(e) {
        const p = e.changedTouches?.[0] || e.touches?.[0] || e;
        return { x: p.clientX || 0, y: p.clientY || 0 };
    }

    function isInRect(point, rect, gap = 0) {
        return point.x >= rect.left - gap && point.x <= rect.right + gap && point.y >= rect.top - gap && point.y <= rect.bottom + gap;
    }

    function isMissAvPreviewTap(e, link) {
        if (!e || !link || !isMissAvPreviewLink(link)) return false;

        const point = getEventPoint(e);
        const card = link.closest?.('.thumbnail, .cover, .preview, [class*=thumbnail], [class*=cover], [class*=preview], [class*=movie], [class*=video], [class*=item]') || link;
        const media = card.querySelector?.('video, canvas, picture, img, .cover, .preview, [class*=preview], [class*=cover], [class*=image], [class*=poster]');

        if (media) {
            const rect = media.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) return isInRect(point, rect, 8);
        }

        const linkRect = link.getBoundingClientRect();
        if (linkRect.width > 0 && linkRect.height > 0) {
            const imageBottom = linkRect.top + linkRect.height * 0.72;
            return point.y <= imageBottom;
        }

        return false;
    }

    // eporner 两段式预览：记录已触发过预览的缩略图 href + 时间戳
    let epornerArmedHref = '';
    let epornerArmedAt = 0;
    let epornerLastInteractHref = '';
    let epornerLastInteractAt = 0;
    let epornerJustOpenedHref = '';
    const EPORNER_REARM_MS = 4000;
    const EPORNER_DEBOUNCE_MS = 600;

    // 处理 eporner 缩略图两段式（在 pointerup / touchend / click 任一阶段被调用）。
    // 真机上站点预览引擎可能在 touchend 调 preventDefault 抑制后续 click，导致第二次
    // 收不到 click，所以状态机以「同一缩略图 href 在时间窗内的第二次交互」为准，
    // 不依赖具体事件类型，只用一个去抖锁避免同一次 tap 的多事件被重复计数。
    function handleEpornerThumbInteract(e, a) {
        const href = a.href || '';
        if (!href) return;
        const now = Date.now();

        // 去抖：同一次 tap 会派发 pointerup→touchend→click，间隔很短，视为一次交互
        if (href === epornerLastInteractHref && now - epornerLastInteractAt < EPORNER_DEBOUNCE_MS) {
            // 同一次 tap 的后续事件：首次(armed)或刚开过新标签页(justOpened)都要继续吞掉默认跳转
            if (epornerArmedHref === href || epornerJustOpenedHref === href) {
                e.preventDefault();
                e.stopImmediatePropagation();
            }
            return;
        }
        epornerLastInteractHref = href;
        epornerLastInteractAt = now;
        epornerJustOpenedHref = '';

        // 同一缩略图时间窗内的「第二次 tap」：新标签页打开
        if (href === epornerArmedHref && now - epornerArmedAt < EPORNER_REARM_MS) {
            epornerArmedHref = '';
            epornerArmedAt = 0;
            epornerJustOpenedHref = href;
            e.preventDefault();
            e.stopImmediatePropagation();
            window.open(href, '_blank');
            return;
        }

        // 首次 tap：阻止跳转、放行给站点预览引擎（预览靠 touch 不靠 click），记录 armed
        epornerArmedHref = href;
        epornerArmedAt = now;
        e.preventDefault();
    }

    function handlePmvHavenPointerDown(e) {
        const a = findLinkTarget(e.target);
        if (!enabled || !a || !isPmvHavenPreviewTap(e, a)) return;
        const p = getEventPoint(e);
        pmvHavenPointerDownX = p.x;
        pmvHavenPointerDownY = p.y;
        pmvHavenPointerDownHref = a.href || '';
    }

    function shouldOpenNewTab(a, e) {
        if (!enabled || !a) return false;
        if (isMissAvPreviewTap(e, a)) return false;
        if (isMissAvNavLink(a)) return false;
        const href = a.getAttribute('href') || '';
        return a.href.slice(0, 4) === 'http' && href[0] !== '#';
    }

    function handleLinkOpen(e) {
        if (toolbar?.contains(e.target)) return;
        const a = findLinkTarget(e.target);
        // PMVHaven 视频卡片封面区：首次 tap 交给站点原生预览，二次 tap 新标签页打开
        if (enabled && a && isPmvHavenPreviewTap(e, a)) {
            handlePmvHavenPreviewInteract(e, a);
            return;
        }
        // eporner 缩略图两段式：pointerup/touchend/click 都进同一去抖状态机
        // （真机预览引擎可能在 touchend preventDefault 抑制 click，故不能只靠 click）
        if (enabled && a && isEpornerThumb(a)) {
            handleEpornerThumbInteract(e, a);
            return;
        }
        if (!shouldOpenNewTab(a, e)) return;

        const now = Date.now();
        if (a.href === lastOpenedHref && now - lastOpenedAt < 700) {
            e.preventDefault();
            e.stopImmediatePropagation();
            return;
        }
        lastOpenedHref = a.href;
        lastOpenedAt = now;

        e.preventDefault();
        e.stopImmediatePropagation();
        window.open(a.href, '_blank');
    }

    function injectCSS() {
        if (document.getElementById('__tb_style__')) return;
        const style = document.createElement('style');
        style.id = '__tb_style__';
        style.textContent = `
#__tb__{position:fixed;z-index:2147483647;width:${BTN_SIZE}px;height:${BTN_SIZE}px;box-sizing:border-box;touch-action:none;-webkit-touch-callout:none;user-select:none;-webkit-user-select:none;transform:translate3d(0,0,0);will-change:left,top,right,bottom,transform;}
#__tb_btn__{width:${BTN_SIZE}px;height:${BTN_SIZE}px;box-sizing:border-box;border-radius:50%;background:rgba(255,255,255,.64);-webkit-backdrop-filter:blur(14px) saturate(145%);backdrop-filter:blur(14px) saturate(145%);border:1px solid rgba(60,60,67,.16);box-shadow:0 1px 6px rgba(0,0,0,.10);filter:none;display:flex;align-items:center;justify-content:center;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:transform .12s ease,opacity .2s,background .2s,border-color .2s,box-shadow .2s;}
#__tb_btn__ svg{pointer-events:none;}
#__tb_btn__:active{transform:scale(.92);opacity:.88;background:rgba(255,255,255,.76);}
@media (prefers-color-scheme: dark){#__tb_btn__{background:rgba(28,28,30,.50);border-color:rgba(255,255,255,.12);box-shadow:0 1px 6px rgba(0,0,0,.14);}}`;
        const parent = document.head || document.documentElement || document.body;
        if (parent) parent.appendChild(style);
    }

    // SVG 链接图标：开启=绿色实心填充，关闭=灰色描边（feather link 图标）
    function linkSVG(on) {
        const color = on ? COLOR_ON : COLOR_OFF;
        const fill = on ? color : 'none';
        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="' + fill + '" stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" fill="none"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" fill="none"></path></svg>';
    }

    function updateBtn() {
        if (!linkBtn) return;
        linkBtn.innerHTML = linkSVG(enabled);
        linkBtn.style.opacity = '1';
        linkBtn.title = enabled ? '新标签页打开：开' : '新标签页打开：关';
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

    // 纯 fixed：clamp 到视口内，不叠加 visualViewport offset，避免页面滑动时漂移。
    function clampPos(left, top) {
        const viewport = getViewportBox();
        return {
            left: Math.max(0, Math.min(left, viewport.width - BTN_SIZE)),
            top: Math.max(0, Math.min(top, viewport.height - BTN_SIZE - BOTTOM_GAP)),
        };
    }

    function applySavedPosition() {
        if (!toolbar || !savedPosition) return false;
        const pos = clampPos(savedPosition.left, savedPosition.top);
        savedPosition = pos;
        // 纯 fixed：直接用 left/top，不叠加 offset。
        toolbar.style.left = pos.left + 'px';
        toolbar.style.top = pos.top + 'px';
        toolbar.style.right = 'auto';
        toolbar.style.bottom = 'auto';
        return true;
    }

    // 悬浮翻页胶囊 id（由「悬浮翻页」脚本创建）。
    const PAGER_ID = 'universal-pagination-floating-menu';

    // 默认位置：横向优先读取悬浮翻页胶囊的实时 rect，把按钮排在其左侧；
    // 纵向始终使用 fixed bottom，不读取 rect.top，避免 iOS 过度滑动/地址栏伸缩时被临时 top 值带偏。
    // 若悬浮翻页尚未创建，则使用保守 right/bottom 兜底，避免压到胶囊。
    function applyDefaultPosition() {
        if (!toolbar) return;
        const pager = document.getElementById(PAGER_ID);
        if (pager) {
            const rect = pager.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                const pos = clampPos(rect.left - LINK_PAGER_GAP - BTN_SIZE, 0);
                toolbar.style.left = pos.left + 'px';
                toolbar.style.top = 'auto';
                toolbar.style.right = 'auto';
                toolbar.style.bottom = DEFAULT_BOTTOM + 'px';
                return;
            }
        }
        toolbar.style.left = 'auto';
        toolbar.style.top = 'auto';
        toolbar.style.right = DEFAULT_RIGHT + 'px';
        toolbar.style.bottom = DEFAULT_BOTTOM + 'px';
    }

    function syncDefaultPosition() {
        if (!toolbar || savedPosition || dragging) return;
        applyDefaultPosition();
    }

    // 纯 fixed 定位：拖动后保存自定义位置；未拖动时横向贴在悬浮翻页左侧，纵向固定 bottom 防止过度滑动错位。

    function resetPosition() {
        savedPosition = null;
        removeVal('tbLeft');
        removeVal('tbTop');
        applyDefaultPosition();

        linkBtn.style.opacity = '0.3';
        setTimeout(function () { linkBtn.style.opacity = '1'; }, 250);
    }

    function migrateDefaultPosition() {
        if (getVal('layoutVersion', '') === CURRENT_LAYOUT_VERSION) return;
        removeVal('tbLeft');
        removeVal('tbTop');
        setVal('layoutVersion', CURRENT_LAYOUT_VERSION);
    }

    function buildToolbar() {
        injectCSS();

        const parent = document.body || document.documentElement;
        if (!parent) return false;

        const oldToolbar = document.getElementById('__tb__');
        if (oldToolbar) oldToolbar.remove();

        toolbar = document.createElement('div');
        toolbar.id = '__tb__';

        linkBtn = document.createElement('div');
        linkBtn.id = '__tb_btn__';
        linkBtn.innerHTML = linkSVG(enabled);
        toolbar.appendChild(linkBtn);
        isolateFloatingUi(toolbar);
        parent.appendChild(toolbar);

        const savedLeft = getVal('tbLeft', null);
        const savedTop = getVal('tbTop', null);
        if (savedLeft !== null && savedTop !== null) {
            savedPosition = clampPos(savedLeft, savedTop);
            applySavedPosition();
        } else {
            savedPosition = null;
            applyDefaultPosition();
        }

        updateBtn();
        linkBtn.addEventListener('pointerdown', onPointerDown);
        linkBtn.addEventListener('pointermove', onPointerMove);
        linkBtn.addEventListener('pointerup', onPointerUp);
        linkBtn.addEventListener('pointercancel', onPointerUp);
        return true;
    }

    function onPointerDown(e) {
        e.preventDefault();
        e.stopPropagation();
        dragging = true;
        moved = false;
        startX = e.clientX;
        startY = e.clientY;
        const rect = toolbar.getBoundingClientRect();
        startLeft = rect.left;
        startTop = rect.top;
        // 纯 fixed：直接用 rect，不加 offset。
        toolbar.style.left = rect.left + 'px';
        toolbar.style.top = rect.top + 'px';
        toolbar.style.right = 'auto';
        toolbar.style.bottom = 'auto';
        linkBtn.setPointerCapture?.(e.pointerId);
    }

    function onPointerMove(e) {
        if (!dragging) return;
        e.preventDefault();
        e.stopPropagation();
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (!moved && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
        moved = true;

        // 纯 fixed：不叠加 offset。
        const pos = clampPos(startLeft + dx, startTop + dy);
        toolbar.style.left = pos.left + 'px';
        toolbar.style.top = pos.top + 'px';
    }

    function onPointerUp(e) {
        if (!dragging) return;
        e.preventDefault();
        e.stopPropagation();
        dragging = false;
        linkBtn.releasePointerCapture?.(e.pointerId);

        if (moved) {
            // 纯 fixed：保存值直接用 style.left/top，不减 offset。
            savedPosition = clampPos(parseInt(toolbar.style.left, 10) || 0, parseInt(toolbar.style.top, 10) || 0);
            setVal('tbLeft', savedPosition.left);
            setVal('tbTop', savedPosition.top);
        } else {
            enabled = !enabled;
            refresh();
        }
    }

    function isToolbarHealthy() {
        const existingToolbar = document.getElementById('__tb__');
        const existingBtn = document.getElementById('__tb_btn__');
        const existingStyle = document.getElementById('__tb_style__');
        return Boolean(existingToolbar && existingBtn && existingStyle && existingToolbar.contains(existingBtn) && document.documentElement.contains(existingToolbar));
    }

    function ensureToolbar() {
        const existing = document.getElementById('__tb__');
        const btn = document.getElementById('__tb_btn__');
        const body = document.body;
        if (isToolbarHealthy() && existing && btn && toolbar === existing && linkBtn === btn) {
            // document-start 时可能先挂到 <html>；body 出现后立刻挪进去，避免部分站点重写根节点导致按钮丢失。
            if (body && existing.parentNode !== body) body.appendChild(existing);
            return true;
        }
        return buildToolbar();
    }

    function scheduleEnsureToolbar(delay) {
        if (toolbarEnsureTimer) return;
        toolbarEnsureTimer = setTimeout(function () {
            toolbarEnsureTimer = null;
            nextFrame(ensureToolbarAndSync);
        }, delay == null ? 30 : delay);
    }

    function startBodyGuard() {
        const parent = document.documentElement || document.body;
        if (!parent || bodyObserver) return;
        bodyObserver = new MutationObserver(function () {
            // 只调度一次轻量健康检查，不在高频 DOM 变化里等待 idle，避免繁忙页面上按钮补挂被长期推迟。
            scheduleEnsureToolbar(30);
        });
        // 关注 body/head 等根级重建即可；全站 subtree 变化由链接扫描 observer 处理，避免首屏加载被拖慢。
        bodyObserver.observe(parent, { childList: true });
    }

    let positionSyncScheduled = false;

    function schedulePositionStabilize() {
        if (positionSyncScheduled) return;
        positionSyncScheduled = true;
        nextFrame(function () {
            positionSyncScheduled = false;
            if (!toolbar || dragging) return;
            if (savedPosition) applySavedPosition();
            else applyDefaultPosition();
            // iOS Safari 偶发 fixed 图层滚动后不重绘；重写 transform 触发合成层刷新。
            toolbar.style.transform = 'translate3d(0,0,0)';
        });
    }

    function installPositionListenersOnce() {
        if (listenersInstalled) return;
        listenersInstalled = true;
        const stabilizePosition = schedulePositionStabilize;
        window.addEventListener('resize', stabilizePosition);
        window.addEventListener('scroll', stabilizePosition, { passive: true });
        window.visualViewport?.addEventListener('resize', stabilizePosition);
        window.visualViewport?.addEventListener('scroll', stabilizePosition);
        hookHistoryForUrlChange();
        window.addEventListener('pageshow', function () { init(); scheduleVisualBurst(); scheduleScanBurst(); });
        document.addEventListener('visibilitychange', function () { if (!document.hidden) { init(); scheduleVisualBurst(); scheduleScanBurst(); } });
        window.addEventListener('focus', function () { init(); scheduleVisualBurst(); scheduleScanBurst(); });
    }

    function scheduleUrlRefresh() {
        if (location.href === lastHref) return;
        lastHref = location.href;
        if (urlRefreshTimer) clearTimeout(urlRefreshTimer);
        urlRefreshTimer = setTimeout(function () {
            urlRefreshTimer = null;
            init();
            scheduleVisualBurst();
            scheduleScanBurst();
        }, 80);
    }

    function hookHistoryForUrlChange() {
        if (historyHooked) return;
        historyHooked = true;
        ['pushState', 'replaceState'].forEach(function (name) {
            const original = history[name];
            if (typeof original !== 'function') return;
            history[name] = function () {
                const result = original.apply(this, arguments);
                scheduleUrlRefresh();
                return result;
            };
        });
        window.addEventListener('popstate', scheduleUrlRefresh);
    }

    function init() {
        migrateDefaultPosition();
        if (!ensureToolbar()) return;
        if (enabled) {
            scheduleScanBurst();
            startObserver();
        }
        startBodyGuard();
        installPositionListenersOnce();
        // 扩展菜单「📍 重置链接按钮位置」：清掉拖动记忆，恢复默认。
        if (!menuRegistered && typeof GM !== 'undefined' && GM.registerMenuCommand) {
            menuRegistered = true;
            GM.registerMenuCommand('📍 重置链接按钮位置', function () {
                resetPosition();
            });
        }
        // 悬浮翻页按钮稍晚创建时，由 body guard / pageshow / focus 事件驱动同步位置。
        scheduleVisualBurst();
    }

    function bootstrap() {
        // 启动只做一次主初始化；耗时的链接扫描仍按 enabled 状态走 idle 调度。
        init();
        nextFrame(scheduleVisualBurst);
        runWhenIdle(function () { if (enabled) scheduleScanBurst(); }, 800);
    }

    document.addEventListener('pointerdown', handlePmvHavenPointerDown, true);
    document.addEventListener('touchstart', handlePmvHavenPointerDown, { capture: true, passive: true });
    document.addEventListener('touchend', handleLinkOpen, { capture: true, passive: false });
    document.addEventListener('pointerup', handleLinkOpen, true);
    document.addEventListener('click', handleLinkOpen, true);

    // 初始化：立即执行一次，并保留 idle / timeout / DOM 变化兜底，避免 iOS Safari 偶发不触发 idle 或 body 被站点重建导致按钮不显示。
    if (document.body || document.documentElement) bootstrap();
    else {
        bootstrap();
        document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
    }
})();
