// ==UserScript==
// @name         新标签页打开
// @namespace    https://github.com/qiqi777iii/Scripts
// @version      2.0.3
// @updateURL    https://raw.githubusercontent.com/qiqi777iii/Scripts/main/userscripts/new-tab-opener.user.js
// @downloadURL  https://raw.githubusercontent.com/qiqi777iii/Scripts/main/userscripts/new-tab-opener.user.js
// @description  在网页显示悬浮开关，控制链接是否在 Safari 后台新标签页中打开。
// @match        *://*/*
// @grant        GM.registerMenuCommand
// @grant        GM.openInTab
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.addValueChangeListener
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const KEY = '__tb_';
    const SHARED_ENABLED_KEY_PREFIX = 'newTabEnabledBySite:';
    const BTN_SIZE = 35;
    const BOTTOM_GAP = 40;
    const LINK_PAGER_GAP = 0;
    const PAGER_RIGHT_GAP = 16;
    const PAGER_HEIGHT = 35;
    const DEFAULT_BOTTOM = BOTTOM_GAP + (PAGER_HEIGHT - BTN_SIZE) / 2;
    const FALLBACK_PAGER_WIDTH = 175;
    const DEFAULT_RIGHT = PAGER_RIGHT_GAP + FALLBACK_PAGER_WIDTH + LINK_PAGER_GAP;
    const CURRENT_LAYOUT_VERSION = '1.1.3-toolbar-v3';
    const GROUP_DRAG_EVENT = 'qiqi-floating-toolbar-group-drag';
    const SHARED_URL_CHANGE_EVENT = 'qiqi:urlchange';
    const SHARED_HISTORY_HOOK_KEY = '__qiqiSharedHistoryHookV1__';
    const GROUP_LEFT_WIDTH = 35;

    let enabled = true;
    const sharedSiteKey = getSharedSiteKey(location.hostname);
    const sharedEnabledKey = SHARED_ENABLED_KEY_PREFIX + sharedSiteKey;
    let toolbar, linkBtn, bodyObserver, toolbarEnsureTimer, neighborResizeObserver, neighborMutationObserver, observedNeighbor;
    let menuRegistered = false;
    let listenersInstalled = false;
    let lastHref = location.href;
    let urlRefreshTimer = null;
    let savedPosition = null;
    let dragging = false;
    let moved = false;
    let startX = 0, startY = 0, startLeft = 0, startTop = 0;
    let dragPager = null, startPagerLeft = 0, startPagerTop = 0;
    let backgroundToastTimer = null;
    let backgroundToastRemoveTimer = null;
    let valueChangeListenerInstalled = false;

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

    function getSharedSiteKey(hostname) {
        const host = String(hostname || '').toLowerCase().replace(/^\.+|\.+$/g, '');
        if (!host || host === 'localhost' || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(':')) return host;

        const parts = host.split('.').filter(Boolean);
        if (parts.length <= 2) return host;

        const compoundSuffixes = new Set([
            'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn',
            'co.uk', 'org.uk', 'me.uk', 'ac.uk',
            'com.au', 'net.au', 'org.au', 'edu.au',
            'co.jp', 'ne.jp', 'or.jp', 'ac.jp',
            'co.kr', 'or.kr', 'ne.kr',
            'co.nz', 'org.nz', 'net.nz',
            'com.sg', 'com.hk', 'com.tw', 'com.br', 'com.mx', 'co.in'
        ]);
        const suffix = parts.slice(-2).join('.');
        return parts.slice(compoundSuffixes.has(suffix) ? -3 : -2).join('.');
    }

    async function loadEnabledState() {
        const localValue = getVal('newTabEnabled', true);
        if (typeof GM === 'undefined' || !GM.getValue) {
            enabled = localValue;
            return;
        }

        try {
            const sharedValue = await GM.getValue(sharedEnabledKey, null);
            enabled = sharedValue === null ? localValue : Boolean(sharedValue);
            if (sharedValue === null && GM.setValue) await GM.setValue(sharedEnabledKey, enabled);
            setVal('newTabEnabled', enabled);
        } catch (_) {
            enabled = localValue;
        }
    }

    function saveEnabledState() {
        setVal('newTabEnabled', enabled);
        if (typeof GM === 'undefined' || !GM.setValue) return;
        try {
            const result = GM.setValue(sharedEnabledKey, enabled);
            if (result && typeof result.catch === 'function') result.catch(function () {});
        } catch (_) {}
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

    function isPaginationContainer(link) {
        let node = link;
        for (let depth = 0; node && depth < 7; depth++, node = node.parentElement) {
            const className = typeof node.className === 'string' ? node.className : '';
            const marker = [
                node.id || '',
                className,
                node.getAttribute?.('aria-label') || '',
                node.getAttribute?.('data-testid') || '',
            ].join(' ');
            if (/(^|[\s_-])(pagination|paginator|pager|paging|pagenavi|page-nav|page-navigation|nav-pages|page-numbers)([\s_-]|$)/i.test(marker)) return true;
            if (node.tagName === 'NAV' && /(page|pagination|pager|分页|分頁|翻页|翻頁)/i.test(marker)) return true;
        }
        return false;
    }

    function isPaginationLink(link) {
        if (!link) return false;

        let url;
        try { url = new URL(link.href, location.href); } catch (_) { return false; }
        if (!/^https?:$/i.test(url.protocol) || url.origin !== location.origin) return false;

        const rel = (link.getAttribute('rel') || '').toLowerCase().split(/\s+/);
        if (rel.includes('next') || rel.includes('prev')) return true;

        const className = typeof link.className === 'string' ? link.className : '';
        const structuralMarker = [
            link.id || '',
            className,
            link.getAttribute('data-testid') || '',
        ].join(' ');
        const marker = [
            structuralMarker,
            link.getAttribute('aria-label') || '',
            link.getAttribute('title') || '',
        ].join(' ');
        const labelCandidates = [
            link.textContent || '',
            link.getAttribute('aria-label') || '',
            link.getAttribute('title') || '',
        ].map(function (label) {
            return label.replace(/\s+/g, ' ').replace(/[<>{}\[\]()‹›«»←→]/g, '').trim();
        }).filter(Boolean);

        const isNamedPager = /(^|[\s_-])(pnnext|pnprev|next|prev|previous|next-page|prev-page|previous-page|page-next|page-prev)([\s_-]|$)/i.test(structuralMarker);
        if (isNamedPager) return true;

        const isDirectionLabel = labelCandidates.some(function (label) {
            return /^(首页|尾页|首頁|末頁|上一页|下一页|前一页|后一页|上一頁|下一頁|前一頁|後一頁|上页|下页|上頁|下頁|更多结果|更多結果|first(?: page)?|last(?: page)?|next(?: page)?|prev(?:ious)?(?: page)?|newer|older|more results?|show more|次へ|前へ|다음|이전)$/i.test(label);
        });
        if (isDirectionLabel) return true;

        const isPageNumber = labelCandidates.some(function (label) { return /^\d+$/.test(label); });
        const isPageLabel = labelCandidates.some(function (label) { return /^(?:go to )?page\s*\d+$|^第\s*\d+\s*[页頁]$/i.test(label); });
        const dataPage = link.getAttribute('data-page') || link.getAttribute('data-page-number') || '';
        const hasPageUrl = /[?&](?:p|pg|page|paged|pageno|page_no|pagenum|page_num|pageindex|page_index|page_number|offset|start)=\d+/i.test(url.search) || /\/(?:page|paged|p)[/-]?\d+(?:[./-]|$)/i.test(url.pathname);
        if (isPageLabel || /^\d+$/.test(dataPage) || (isPageNumber && hasPageUrl)) return true;

        const inPager = isPaginationContainer(link);
        if (!inPager) return false;

        const hasPageMarker = /(^|[\s_-])(page|page-item|page-link|page-number|page-numbers|next|prev|previous)([\s_-]|$)/i.test(marker);
        return isPageNumber || hasPageMarker || hasPageUrl;
    }

    function getMissAvPreviewContext(a) {
        if (!/(^|\.)missav\./i.test(location.hostname) || !a) return null;
        const card = a.closest?.('.thumbnail');
        const preview = card?.querySelector?.('video.preview');
        if (!card || !preview) return null;
        const previewLink = preview.closest('a[href]');
        return previewLink ? { card, preview, previewLink } : null;
    }

    function installEnabledStateListener() {
        if (valueChangeListenerInstalled || typeof GM === 'undefined' || !GM.addValueChangeListener) return;
        valueChangeListenerInstalled = true;
        GM.addValueChangeListener(sharedEnabledKey, function (_key, _oldValue, newValue) {
            if (typeof newValue !== 'boolean' || newValue === enabled) return;
            enabled = newValue;
            setVal('newTabEnabled', enabled);
            updateBtn();
        });
    }

    function refresh() {
        saveEnabledState();
        updateBtn();
    }

    function nextFrame(fn) {
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fn);
        else setTimeout(fn, 16);
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

    function scheduleVisualBurst() {
        runAtDelays([0, 40, 120, 300, 700, 1500, 3000, 6000], ensureToolbarAndSync);
    }

    function findLinkTarget(target) {
        return target?.closest?.('a[href], area[href]');
    }

    function showBackgroundToast() {
        const id = '__tb_background_toast__';
        let toast = document.getElementById(id);
        if (!toast) {
            toast = document.createElement('div');
            toast.id = id;
            toast.textContent = '后台打开';
            toast.setAttribute('role', 'status');
            toast.setAttribute('aria-live', 'polite');
            toast.style.cssText = 'position:fixed;left:50%;bottom:96px;z-index:2147483647;max-width:calc(100vw - 32px);box-sizing:border-box;padding:8px 14px;border-radius:10px;background:rgba(28,28,30,.88);color:#fff;font:600 14px/20px -apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;letter-spacing:.01em;text-align:center;white-space:nowrap;pointer-events:none;-webkit-backdrop-filter:blur(10px) saturate(140%);backdrop-filter:blur(10px) saturate(140%);box-shadow:0 2px 10px rgba(0,0,0,.16);opacity:0;transform:translate(-50%,6px);transition:opacity .12s ease,transform .12s ease;';
            (document.body || document.documentElement).appendChild(toast);
        }
        clearTimeout(backgroundToastTimer);
        clearTimeout(backgroundToastRemoveTimer);
        toast.style.opacity = '1';
        toast.style.transform = 'translate(-50%,0)';
        backgroundToastTimer = setTimeout(function () {
            toast.style.opacity = '0';
            toast.style.transform = 'translate(-50%,6px)';
            backgroundToastRemoveTimer = setTimeout(function () { toast.remove(); }, 140);
        }, 1000);
    }

    function openLinkWithAnchor(href) {
        const link = document.createElement('a');
        link.href = href;
        link.target = '_blank';
        link.rel = 'noopener';
        link.dataset.tbInternalOpen = 'true';
        link.style.position = 'fixed';
        link.style.left = '-9999px';
        link.style.top = '-9999px';
        link.style.width = '1px';
        link.style.height = '1px';
        link.style.opacity = '0';
        (document.body || document.documentElement).appendChild(link);
        try {
            link.click();
            showBackgroundToast();
        } catch (_) {}
        setTimeout(function () { link.remove(); }, 0);
    }

    function openLinkInBackground(href) {
        if (!href) return;
        try {
            if (typeof GM !== 'undefined' && typeof GM.openInTab === 'function') {
                const task = GM.openInTab(href, { active: false });
                if (task && typeof task.then === 'function') {
                    task.then(showBackgroundToast).catch(function () { openLinkWithAnchor(href); });
                } else {
                    showBackgroundToast();
                }
                return;
            }
        } catch (_) {}
        openLinkWithAnchor(href);
    }

    function getMissAvHiddenPreview(a) {
        const context = getMissAvPreviewContext(a);
        return context?.preview.classList.contains('hidden') ? context : null;
    }

    function hasNativePreviewHandler(a, context) {
        return [a, context.previewLink, context.preview, context.card].filter(Boolean).some(function (node) {
            return node.getAttributeNames?.().some(function (name) {
                return /^(?:onclick|onpointerup|ontouchend|@click(?:\.|$)|x-on:click(?:\.|$)|data-action|data-preview-action)$/i.test(name);
            });
        });
    }

    function activateMissAvPreview(context) {
        const { preview, previewLink } = context;
        const src = preview.getAttribute('src') || preview.getAttribute('data-src');
        if (src && !preview.getAttribute('src')) preview.setAttribute('src', src);
        preview.classList.remove('hidden');
        previewLink.querySelector('img')?.classList.add('hidden');
        const task = preview.play?.();
        if (task?.catch) task.catch(function () {});
    }

    function hasInlineAction(a) {
        return a.getAttributeNames?.().some(function (name) {
            return /^(?:onclick|onmousedown|onmouseup|onpointerdown|onpointerup|ontouchstart|ontouchend|@click(?:\.|$)|x-on:click(?:\.|$)|data-action|data-confirm|data-method|data-turbo-method|data-remote|formaction|hx-(?:post|put|patch|delete))$/i.test(name);
        });
    }

    function isExplicitInteractiveLink(a) {
        if (a.hasAttribute('target') || a.hasAttribute('download') || a.hasAttribute('ping') || hasInlineAction(a)) return true;
        const marker = [a.id, a.className, a.getAttribute('rel'), a.getAttribute('role'), a.getAttribute('data-lightbox'), a.getAttribute('data-fancybox'), a.getAttribute('data-gallery')].filter(Boolean).join(' ');
        if (/(?:^|[\s_-])(?:preview|lightbox|fancybox|modal|gallery|photoswipe|viewer|zoom)(?:[\s_-]|$)/i.test(marker)) return true;
        return Boolean(a.closest('form, dialog, [role="dialog"], [role="button"], [aria-haspopup], [data-confirm], [data-method], [data-turbo-method], [data-action], [contenteditable="true"]'));
    }

    function getBackgroundOpenUrl(a) {
        if (!enabled || !a || a.dataset.tbInternalOpen === 'true' || isPaginationLink(a) || isExplicitInteractiveLink(a)) return null;
        const rawHref = (a.getAttribute('href') || '').trim();
        if (!rawHref || rawHref[0] === '#') return null;
        let url;
        try { url = new URL(rawHref, document.baseURI); } catch (_) { return null; }
        if (!/^https?:$/i.test(url.protocol) || url.username || url.password) return null;
        const marker = `${url.hostname} ${url.pathname} ${url.search} ${a.id || ''} ${typeof a.className === 'string' ? a.className : ''}`;
        if (/(?:^|[\/_.-])(?:login|signin|signout|logout|auth|authorize|oauth|sso|saml|account|checkout|payment|pay|billing|subscribe|purchase|confirm|action|delete|remove|follow|like|vote|favorite|bookmark|cart)(?:[\/_.?#-]|$)/i.test(marker)) return null;
        for (const key of url.searchParams.keys()) if (/^(?:action|method|cmd|command|do|operation)$/i.test(key)) return null;
        const current = new URL(location.href);
        if (url.origin === current.origin && url.pathname === current.pathname && url.search === current.search && url.hash) return null;
        return url.href;
    }

    function handleLinkOpen(e) {
        if (!enabled || e.defaultPrevented || e.isTrusted === false || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        if (toolbar?.contains(e.target)) return;
        const a = findLinkTarget(e.target);
        if (!a || a.dataset.tbInternalOpen === 'true') return;
        const preview = getMissAvHiddenPreview(a);
        if (preview) {
            if (hasNativePreviewHandler(a, preview)) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            activateMissAvPreview(preview);
            return;
        }
        const href = getBackgroundOpenUrl(a);
        if (!href) return;
        // 在冒泡末端只取消浏览器默认导航；保留站点已执行的目标/document 处理器。
        e.preventDefault();
        openLinkInBackground(href);
    }

    function injectCSS() {
        if (document.getElementById('__tb_style__')) return;
        const style = document.createElement('style');
        style.id = '__tb_style__';
        style.textContent = `
#__tb__{position:fixed;z-index:2147483647;width:${BTN_SIZE}px;height:${BTN_SIZE}px;box-sizing:border-box;touch-action:none;-webkit-touch-callout:none;user-select:none;-webkit-user-select:none;transform:translate3d(0,0,0);will-change:left,top,right,bottom,transform;}
#__tb_btn__{width:${BTN_SIZE}px;height:${BTN_SIZE}px;box-sizing:border-box;border-radius:999px 0 0 999px;background:rgba(242,242,247,.92);color:rgba(28,28,30,.82);-webkit-backdrop-filter:blur(10px) saturate(140%);backdrop-filter:blur(10px) saturate(140%);border:0;box-shadow:inset 0 0 0 .5px rgba(60,60,67,.16);filter:none;display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:opacity .2s,background .2s,color .2s,box-shadow .2s;}
#__tb_btn__[data-enabled="true"]{background:rgba(242,242,247,.92);color:#0A84FF;box-shadow:inset 0 0 0 .5px rgba(60,60,67,.16);}
#__tb_btn__ svg{pointer-events:none;stroke:currentColor;}
#__tb_btn__:active{transform:none;opacity:.94;background:rgba(229,229,234,.96);}
#__tb_btn__[data-enabled="true"]:active{background:rgba(229,229,234,.96);}
@media (prefers-color-scheme: dark){#__tb_btn__{background:rgba(44,44,46,.82);color:rgba(255,255,255,.88);box-shadow:inset 0 0 0 .5px rgba(255,255,255,.16);}#__tb_btn__[data-enabled="true"]{background:rgba(44,44,46,.82);color:#64D2FF;box-shadow:inset 0 0 0 .5px rgba(255,255,255,.16);}#__tb_btn__:active,#__tb_btn__[data-enabled="true"]:active{background:rgba(58,58,60,.92);}}`;
        const parent = document.head || document.documentElement || document.body;
        if (parent) parent.appendChild(style);
    }

    // SVG 链接图标：开关状态只通过 currentColor 区分，保持组合栏背景一致。
    function linkSVG(on) {
        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" fill="none"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" fill="none"></path></svg>';
    }

    function updateBtn() {
        if (!linkBtn) return;
        linkBtn.innerHTML = linkSVG(enabled);
        linkBtn.dataset.enabled = enabled ? 'true' : 'false';
        linkBtn.style.opacity = '1';
        linkBtn.title = enabled ? '后台新标签页打开：开' : '后台新标签页打开：关';
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

    function clampPagerGroupPos(left, top, pager) {
        const viewport = getViewportBox();
        const width = Math.max(pager?.offsetWidth || pager?.getBoundingClientRect?.().width || 0, 35);
        const height = Math.max(pager?.offsetHeight || pager?.getBoundingClientRect?.().height || 0, 35);
        const maxLeft = Math.max(0, viewport.width - width);
        const minLeft = Math.min(GROUP_LEFT_WIDTH, maxLeft);
        return {
            left: Math.max(minLeft, Math.min(left, maxLeft)),
            top: Math.max(0, Math.min(top, viewport.height - height - BOTTOM_GAP)),
        };
    }

    function dispatchGroupDrag(pager, phase, left, top) {
        if (!pager) return;
        pager.dispatchEvent(new CustomEvent(GROUP_DRAG_EVENT, { detail: { phase, left, top } }));
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

    function getVisualViewportRect() {
        const vv = window.visualViewport;
        return {
            left: Math.floor(vv?.offsetLeft || 0),
            top: Math.floor(vv?.offsetTop || 0),
            width: Math.floor(vv?.width || document.documentElement.clientWidth || innerWidth || 1),
            height: Math.floor(vv?.height || document.documentElement.clientHeight || innerHeight || 1),
        };
    }

    // 悬浮翻页栏 id：链接按钮直接贴在它左侧，形成一条视觉组合栏。
    const PAGER_ID = 'universal-pagination-floating-menu';

    function observeNeighbor(neighbor) {
        if (observedNeighbor === neighbor) return;
        neighborResizeObserver?.disconnect();
        neighborMutationObserver?.disconnect();
        observedNeighbor = neighbor || null;
        if (!neighbor) return;
        if (typeof ResizeObserver === 'function') {
            neighborResizeObserver = new ResizeObserver(schedulePositionStabilize);
            neighborResizeObserver.observe(neighbor);
        }
        if (typeof MutationObserver === 'function') {
            neighborMutationObserver = new MutationObserver(schedulePositionStabilize);
            neighborMutationObserver.observe(neighbor, { attributes: true, attributeFilter: ['style', 'data-pagination', 'data-hidden'] });
        }
    }

    // 默认位置：横向读取悬浮翻页栏的实时 rect，把链接按钮无缝贴在其左侧；
    // 纵向始终使用 fixed bottom，不读取 rect.top，避免 iOS 过度滑动/地址栏伸缩时被临时 top 值带偏。
    // 若翻页栏尚未创建，则使用保守 right/bottom 兜底。
    function applyDefaultPosition() {
        if (!toolbar) return;
        const viewport = getViewportBox();
        const neighbor = document.getElementById(PAGER_ID);
        observeNeighbor(neighbor);
        // 纵向用 CSS bottom 锚定贴底（不换算绝对 top），避免 iOS Safari 地址栏伸缩时
        // viewport.height 取到偏大的布局视口高度，把按钮顶到屏幕中间。
        const defaultRightLeft = Math.max(0, Math.floor(viewport.width - BTN_SIZE - DEFAULT_RIGHT));
        if (neighbor) {
            const rect = neighbor.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                const pos = clampPos(rect.left - LINK_PAGER_GAP - BTN_SIZE, 0);
                toolbar.style.left = pos.left + 'px';
                toolbar.style.right = 'auto';
                const usesBottom = neighbor.style.bottom && neighbor.style.bottom !== 'auto' && (!neighbor.style.top || neighbor.style.top === 'auto');
                if (usesBottom) {
                    toolbar.style.bottom = neighbor.style.bottom;
                    toolbar.style.top = 'auto';
                } else {
                    toolbar.style.top = rect.top + 'px';
                    toolbar.style.bottom = 'auto';
                }
                return;
            }
        }
        toolbar.style.left = defaultRightLeft + 'px';
        toolbar.style.bottom = DEFAULT_BOTTOM + 'px';
        toolbar.style.right = 'auto';
        toolbar.style.top = 'auto';
    }

    function syncDefaultPosition() {
        if (!toolbar || dragging) return;
        if (document.getElementById(PAGER_ID)) {
            savedPosition = null;
            applyDefaultPosition();
        } else if (savedPosition) {
            applySavedPosition();
        } else {
            applyDefaultPosition();
        }
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

    function migrateBackgroundOpenDefault() {
        if (getVal('backgroundOpenDefaultVersion', '') === '1.1.0') return;
        // 默认值已由共享状态初始化；迁移标记不能覆盖同一主域名其他子域保存的关闭状态。
        setVal('backgroundOpenDefaultVersion', '1.1.0');
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

        const pager = document.getElementById(PAGER_ID);
        const savedLeft = getVal('tbLeft', null);
        const savedTop = getVal('tbTop', null);
        if (pager) {
            savedPosition = null;
            removeVal('tbLeft');
            removeVal('tbTop');
            applyDefaultPosition();
        } else if (savedLeft !== null && savedTop !== null) {
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
        dragPager = document.getElementById(PAGER_ID);
        if (dragPager) {
            const pagerRect = dragPager.getBoundingClientRect();
            startPagerLeft = pagerRect.left;
            startPagerTop = pagerRect.top;
        }
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

        if (dragPager) {
            const pos = clampPagerGroupPos(startPagerLeft + dx, startPagerTop + dy, dragPager);
            dispatchGroupDrag(dragPager, 'move', pos.left, pos.top);
            applyDefaultPosition();
        } else {
            // 翻页脚本未加载时，仍允许链接按钮独立拖动。
            const pos = clampPos(startLeft + dx, startTop + dy);
            toolbar.style.left = pos.left + 'px';
            toolbar.style.top = pos.top + 'px';
        }
    }

    function onPointerUp(e) {
        if (!dragging) return;
        e.preventDefault();
        e.stopPropagation();
        dragging = false;
        linkBtn.releasePointerCapture?.(e.pointerId);

        if (moved && dragPager) {
            const rect = dragPager.getBoundingClientRect();
            dispatchGroupDrag(dragPager, e.type === 'pointercancel' ? 'cancel' : 'end', rect.left, rect.top);
            savedPosition = null;
            removeVal('tbLeft');
            removeVal('tbTop');
        } else if (moved) {
            // 翻页脚本未加载时保存链接按钮的独立位置。
            savedPosition = clampPos(parseInt(toolbar.style.left, 10) || 0, parseInt(toolbar.style.top, 10) || 0);
            setVal('tbLeft', savedPosition.left);
            setVal('tbTop', savedPosition.top);
        } else if (e.type !== 'pointercancel') {
            enabled = !enabled;
            refresh();
        }
        dragPager = null;
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
        // 只关注 body/head 等根级重建；链接打开已改为单一事件代理，不再扫描页面 DOM。
        bodyObserver.observe(parent, { childList: true });
    }

    let positionSyncScheduled = false;

    function schedulePositionStabilize() {
        if (positionSyncScheduled) return;
        positionSyncScheduled = true;
        nextFrame(function () {
            positionSyncScheduled = false;
            if (!toolbar || dragging) return;
            if (document.getElementById(PAGER_ID)) {
                savedPosition = null;
                applyDefaultPosition();
            } else if (savedPosition) applySavedPosition();
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
        window.addEventListener('pageshow', function () { init(); scheduleVisualBurst(); });
        document.addEventListener('visibilitychange', function () { if (!document.hidden) { init(); scheduleVisualBurst(); } });
        window.addEventListener('focus', function () { init(); scheduleVisualBurst(); });
    }

    function scheduleUrlRefresh() {
        if (location.href === lastHref) return;
        lastHref = location.href;
        if (urlRefreshTimer) clearTimeout(urlRefreshTimer);
        urlRefreshTimer = setTimeout(function () {
            urlRefreshTimer = null;
            init();
            scheduleVisualBurst();
        }, 80);
    }

    function dispatchSharedUrlChange(kind) {
        window.dispatchEvent(new CustomEvent(SHARED_URL_CHANGE_EVENT, { detail: { kind, href: location.href } }));
    }

    function hookHistoryForUrlChange() {
        window.addEventListener(SHARED_URL_CHANGE_EVENT, scheduleUrlRefresh);
        if (window[SHARED_HISTORY_HOOK_KEY]?.eventName === SHARED_URL_CHANGE_EVENT) return;
        try { window[SHARED_HISTORY_HOOK_KEY] = { version: 1, eventName: SHARED_URL_CHANGE_EVENT }; } catch (_) {}
        ['pushState', 'replaceState'].forEach(function (name) {
            const original = history[name];
            if (typeof original !== 'function' || original.__qiqiUrlChangeEvent === SHARED_URL_CHANGE_EVENT) return;
            const wrapped = function () {
                const result = original.apply(this, arguments);
                dispatchSharedUrlChange(name);
                return result;
            };
            try { Object.defineProperty(wrapped, '__qiqiUrlChangeEvent', { value: SHARED_URL_CHANGE_EVENT }); } catch (_) {}
            try { history[name] = wrapped; } catch (_) {}
        });
        window.addEventListener('popstate', function () { dispatchSharedUrlChange('popstate'); });
        window.addEventListener('hashchange', function () { dispatchSharedUrlChange('hashchange'); });
    }

    function init() {
        migrateBackgroundOpenDefault();
        migrateDefaultPosition();
        if (!ensureToolbar()) return;
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
        init();
        nextFrame(scheduleVisualBurst);
    }

    async function start() {
        await loadEnabledState();
        installEnabledStateListener();
        window.addEventListener('click', handleLinkOpen);

        // 初始化：共享状态载入后立即执行，并保留 DOMContentLoaded 兜底，避免 body 被站点稍后创建。
        if (document.body || document.documentElement) bootstrap();
        else {
            bootstrap();
            document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
        }
    }

    void start();
})();
