// ==UserScript==
// @name         封面视频预览
// @namespace    https://github.com/qiqi777iii/Scripts
// @version      1.0.10
// @description  在手机上首次点按视频封面播放静音预览，再次点按进入详情；滑动不误触，长按保留 Safari 原生行为。
// @match        *://rule34video.com/*
// @match        *://*.rule34video.com/*
// @match        *://spankbang.com/*
// @match        *://*.spankbang.com/*
// @match        *://eporner.com/*
// @match        *://*.eporner.com/*
// @match        *://xvideos.com/*
// @match        *://*.xvideos.com/*
// @match        *://missav.ws/*
// @match        *://*.missav.ws/*
// @grant        none
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/qiqi777iii/Scripts/main/userscripts/cover-video-preview.user.js
// @downloadURL  https://raw.githubusercontent.com/qiqi777iii/Scripts/main/userscripts/cover-video-preview.user.js
// ==/UserScript==

(function () {
    'use strict';

    const PREVIEW_CLASS = '__qiqi_mobile_preview__';
    const ACTIVE_CLASS = '__qiqi_mobile_preview_active__';
    const COVER_PREVIEW_READY_ATTR = 'data-qiqi-cover-preview-ready';
    const BACKGROUND_OPEN_REQUEST_EVENT = 'qiqi:background-open-request';
    const IS_MISSAV = /(^|\.)missav\.ws$/i.test(location.hostname);
    const IS_SPANKBANG = /(^|\.)spankbang\.com$/i.test(location.hostname);
    const IS_EPORNER = /(^|\.)eporner\.com$/i.test(location.hostname);
    const BLOCK_NATIVE_SITE_PREVIEW = IS_SPANKBANG || IS_EPORNER;
    const LONG_PRESS_MS = 600;
    const SWIPE_CANCEL_DISTANCE = 12;
    const SWIPE_CLICK_BLOCK_MS = 650;

    let active = null;
    let activeUrl = null;
    let nativeProbeToken = 0;
    let touchOrigin = null;
    let suppressClickUntil = 0;
    let enforcingSinglePreview = false;
    let previewStartedAt = 0;
    let previewScrollY = null;
    let nativePreviewBlockUntil = 0;
    let nativePreviewBlockUrl = null;
    let swipeClickBlock = null;

    function addStyle() {
        if (document.getElementById('__qiqi_mobile_preview_style__')) return;
        const style = document.createElement('style');
        style.id = '__qiqi_mobile_preview_style__';
        style.textContent = `
.${PREVIEW_CLASS}{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;max-width:none!important;max-height:none!important;object-fit:cover!important;display:block!important;z-index:2147483000!important;margin:0!important;padding:0!important;border:0!important;outline:0!important;background:#000!important;pointer-events:none!important;opacity:1!important;visibility:visible!important;}
`;
        (document.head || document.documentElement).appendChild(style);
    }

    function safeClosest(target, selector) {
        return target instanceof Element ? target.closest(selector) : null;
    }

    function findCard(target) {
        let card = null;

        card = safeClosest(target, 'a[href]');
        if (card?.querySelector('video.preview[data-src], video.preview[src]') && card.querySelector('img')) return card;
        if (IS_SPANKBANG && card?.matches('[data-testid="recommended-video"]') &&
            card.querySelector('img') && card.querySelector('video source[data-src], video source[src]')) return card;

        card = safeClosest(target, '.thumb-block');
        if (card?.querySelector('img[data-pvv]')) return card;

        card = safeClosest(target, '.mb');
        if (card?.dataset.id && card.querySelector('.mbimg img, img[data-st]')) return card;

        card = safeClosest(target, '.item.thumb, a.th');
        if (card?.querySelector('[data-preview]')) return card;

        card = safeClosest(target, '.video-item, .js-video-item, [id^="recommended_video"]');
        if (card?.querySelector('a[href], video, source')) return card;

        return null;
    }

    function normalizeMediaUrl(value) {
        const raw = String(value || '').trim();
        if (!raw || /^(?:data:|blob:|javascript:)/i.test(raw)) return null;
        try {
            const url = new URL(raw, document.baseURI);
            return /^https?:$/i.test(url.protocol) ? url.href : null;
        } catch (_) {
            return null;
        }
    }

    function sourceFromMedia(media) {
        if (!media) return null;
        const values = [
            media.getAttribute?.('data-preview'),
            media.getAttribute?.('data-pvv'),
            media.getAttribute?.('data-preview-url'),
            media.getAttribute?.('data-video-preview'),
            media.getAttribute?.('data-trailer'),
            media.getAttribute?.('data-src'),
            media.currentSrc,
            media.getAttribute?.('src'),
        ];
        for (const value of values) {
            const url = normalizeMediaUrl(value);
            if (url) return url;
        }
        return null;
    }

    function resolvePreviewUrl(card) {
        const directCandidates = card.querySelectorAll([
            'img[data-pvv]',
            '[data-preview-url]',
            '[data-video-preview]',
            '[data-trailer]',
            '[data-preview]',
            'video[src]',
            'video[data-src]',
            'video source[src]',
            'video source[data-src]',
        ].join(','));
        for (const candidate of directCandidates) {
            const directUrl = sourceFromMedia(candidate);
            if (directUrl) return directUrl;
        }

        if (card.matches('.mb')) {
            const id = String(card.dataset.id || '').replace(/\D/g, '');
            const img = card.querySelector('.mbimg img, img[data-st]');
            const thumbUrl = normalizeMediaUrl(img?.currentSrc || img?.getAttribute('src'));
            if (id && thumbUrl) {
                try {
                    const url = new URL(thumbUrl);
                    url.pathname = url.pathname.replace(/\/[^/]*$/, `/${id}-preview.mp4`);
                    return url.href.replace('static-key-cdn', 'static-ca-cdn');
                } catch (_) {}
            }
        }

        return null;
    }

    function findPreviewHost(card) {
        const imageLink = card.querySelector('img')?.closest('a');
        const candidates = [
            card.querySelector('[data-preview]'),
            card.querySelector('.thumb-inside'),
            card.querySelector('.mbimg'),
            card.querySelector('a.thumb'),
            card.querySelector('.thumb'),
            card.querySelector('.video-thumb'),
            card.querySelector('.cover'),
            imageLink,
            card,
        ];
        return candidates.find(function (node) {
            if (!(node instanceof HTMLElement)) return false;
            const rect = node.getBoundingClientRect();
            return rect.width > 20 && rect.height > 20;
        }) || card;
    }

    function cardUrl(card) {
        if (!(card instanceof Element)) return null;
        const link = card.matches('a[href]') ? card : card.querySelector('a[href]');
        return normalizeMediaUrl(link?.getAttribute('href'));
    }

    function isCoverTarget(card, target) {
        if (!(target instanceof Element)) return false;
        return findPreviewHost(card).contains(target);
    }

    function resetMissAvPreviewState() {
        const seen = new Set();
        document.querySelectorAll('.thumbnail, [x-data]').forEach(function (node) {
            const stack = node._x_dataStack;
            if (!Array.isArray(stack)) return;
            stack.forEach(function (state) {
                if (!state || seen.has(state)) return;
                seen.add(state);
                if (Array.isArray(state.holdPreviews)) state.holdPreviews.splice(0, state.holdPreviews.length);
                if ('showPreview' in state) state.showPreview = null;
            });
        });
    }

    function setMissAvHeldPreview(video) {
        const id = String(video.id || '').replace(/^preview-/, '');
        if (!id) return;
        const seen = new Set();
        document.querySelectorAll('.thumbnail, [x-data]').forEach(function (node) {
            const stack = node._x_dataStack;
            if (!Array.isArray(stack)) return;
            stack.forEach(function (state) {
                if (!state || seen.has(state) || !Array.isArray(state.holdPreviews)) return;
                seen.add(state);
                state.holdPreviews.splice(0, state.holdPreviews.length, id);
                if ('showPreview' in state) state.showPreview = id;
            });
        });
    }

    function stopNativePreviews(exceptVideo = null) {
        resetMissAvPreviewState();
        document.querySelectorAll('video.preview').forEach(function (video) {
            if (video === exceptVideo) return;
            try { video.pause(); } catch (_) {}
            try { video.currentTime = 0; } catch (_) {}
            video.classList.add('hidden');
            video.parentElement?.querySelector('img')?.classList.remove('hidden');
        });
    }

    function stopActive() {
        nativeProbeToken += 1;
        stopNativePreviews();
        if (!active) {
            activeUrl = null;
            return;
        }
        active.observer?.disconnect();
        active.video?.pause?.();
        if (active.native) {
            try { active.video.currentTime = 0; } catch (_) {}
            active.video.classList.add('hidden');
            active.video.parentElement?.querySelector('img')?.classList.remove('hidden');
        } else {
            active.video?.remove();
        }
        active.card?.classList.remove(ACTIVE_CLASS);
        if (active.host?.dataset.qiqiPreviewPosition === '1') {
            active.host.style.position = active.oldPosition;
            delete active.host.dataset.qiqiPreviewPosition;
        }
        active = null;
        activeUrl = null;
        previewScrollY = null;
    }

    function markPreviewStarted() {
        previewStartedAt = Date.now();
        previewScrollY = window.scrollY;
    }

    function watchVisibility(card) {
        if (typeof IntersectionObserver !== 'function') return null;
        const observer = new IntersectionObserver(function (entries) {
            if (entries.some(function (entry) { return entry.target === card && entry.intersectionRatio < 0.08; })) {
                stopActive();
            }
        }, { threshold: [0, 0.08] });
        observer.observe(card);
        return observer;
    }

    function mountPreview(card, url) {
        stopActive();
        addStyle();

        const host = findPreviewHost(card);
        const computed = getComputedStyle(host).position;
        const oldPosition = host.style.position;
        if (computed === 'static') {
            host.dataset.qiqiPreviewPosition = '1';
            host.style.position = 'relative';
        }

        const img = card.querySelector('img');
        const video = document.createElement('video');
        video.className = PREVIEW_CLASS;
        video.muted = true;
        video.defaultMuted = true;
        video.loop = true;
        video.autoplay = true;
        video.playsInline = true;
        video.preload = 'auto';
        video.disablePictureInPicture = true;
        video.setAttribute('muted', '');
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');
        if (img?.currentSrc || img?.src) video.poster = img.currentSrc || img.src;
        video.src = url;

        card.classList.add(ACTIVE_CLASS);
        host.appendChild(video);
        active = {
            card,
            host,
            video,
            oldPosition,
            observer: watchVisibility(card),
        };
        activeUrl = cardUrl(card);
        markPreviewStarted();

        video.addEventListener('error', function () {
            if (active?.video === video) stopActive();
        }, { once: true });

        try {
            const task = video.play();
            task?.catch?.(function () {});
        } catch (_) {}
        return true;
    }

    function dispatchHover(card) {
        const targets = [card, card.querySelector('a.thumb, .thumb, .cover, img')].filter(Boolean);
        targets.forEach(function (target) {
            try { target.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' })); } catch (_) {}
            try { target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window })); } catch (_) {}
            try { target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, cancelable: true, view: window })); } catch (_) {}
        });
    }

    function probeNativePreview(card) {
        const token = ++nativeProbeToken;
        dispatchHover(card);

        [40, 120, 260, 520, 900].forEach(function (delay) {
            setTimeout(function () {
                if (token !== nativeProbeToken || active?.card === card) return;
                const url = resolvePreviewUrl(card);
                if (url) mountPreview(card, url);
            }, delay);
        });
    }

    function mountNativePreview(card, video) {
        stopActive();
        const src = sourceFromMedia(video);
        if (src && !video.getAttribute('src')) video.src = src;
        stopNativePreviews(video);
        setMissAvHeldPreview(video);
        video.muted = true;
        video.defaultMuted = true;
        video.loop = true;
        video.playsInline = true;
        video.classList.remove('hidden');
        video.parentElement?.querySelector('img')?.classList.add('hidden');
        active = {
            card,
            host: video.parentElement,
            video,
            oldPosition: '',
            observer: watchVisibility(card),
            native: true,
        };
        activeUrl = cardUrl(card);
        markPreviewStarted();
        try {
            const task = video.play();
            task?.catch?.(function () { if (active?.video === video) stopActive(); });
        } catch (_) { stopActive(); }
        return true;
    }

    function startPreview(card) {
        const nativeVideo = card.querySelector('video.preview[data-src], video.preview[src]');
        if (nativeVideo) return mountNativePreview(card, nativeVideo);
        const url = resolvePreviewUrl(card);
        if (url) return mountPreview(card, url);
        probeNativePreview(card);
        return true;
    }

    function requestBackgroundOpen(href) {
        const event = new CustomEvent(BACKGROUND_OPEN_REQUEST_EVENT, {
            cancelable: true,
            detail: { source: 'cover-video-preview', href },
        });
        window.dispatchEvent(event);
        return event.defaultPrevented;
    }

    function openCardLink(card) {
        const href = cardUrl(card);
        if (!href) return;
        stopActive();
        suppressClickUntil = Date.now() + 1200;
        // “新标签页打开”存在且已开启时会接管为真正的后台标签；
        // 未安装或已关闭时无人接管，封面预览保持独立并按网站原行为进入当前页。
        if (requestBackgroundOpen(href)) return;
        location.assign(href);
    }

    window.addEventListener('click', function (event) {
        if (IS_MISSAV) return;
        if (Date.now() < suppressClickUntil) {
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
        }
        const card = findCard(event.target);

        if (!card) {
            if (active) stopActive();
            return;
        }

        if (!isCoverTarget(card, event.target)) return;

        const currentUrl = cardUrl(card);
        if (swipeClickBlock) {
            if (Date.now() >= swipeClickBlock.until) {
                swipeClickBlock = null;
            } else if (currentUrl && currentUrl === swipeClickBlock.url) {
                // Safari 偶尔会在滑动结束后补发 click，只吞掉同一封面的这一次误点击。
                swipeClickBlock = null;
                event.preventDefault();
                event.stopImmediatePropagation();
                return;
            }
        }

        const nativeVideo = card.querySelector('video.preview[data-src], video.preview[src]');
        const nativePreviewIsOpen = Boolean(nativeVideo && (
            !nativeVideo.classList.contains('hidden') || !nativeVideo.paused
        ));
        if (nativePreviewIsOpen || (active?.card === card) || (activeUrl && currentUrl === activeUrl)) {
            event.preventDefault();
            event.stopImmediatePropagation();
            openCardLink(card);
            return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();
        startPreview(card);
    }, true);

    function enforceSingleNativePreview(video) {
        if (enforcingSinglePreview || !(video instanceof HTMLVideoElement) || !video.matches('video.preview')) return;
        enforcingSinglePreview = true;
        try {
            stopNativePreviews(video);
            setMissAvHeldPreview(video);
            video.classList.remove('hidden');
            video.parentElement?.querySelector('img')?.classList.add('hidden');

            if (active?.video !== video) {
                active?.observer?.disconnect();
                if (active && !active.native) {
                    try { active.video?.pause?.(); } catch (_) {}
                    active.video?.remove();
                    active.card?.classList.remove(ACTIVE_CLASS);
                }
                const card = video.closest('a[href]') || video.parentElement;
                active = {
                    card,
                    host: video.parentElement,
                    video,
                    oldPosition: '',
                    observer: card ? watchVisibility(card) : null,
                    native: true,
                };
                activeUrl = cardUrl(card);
            }
            markPreviewStarted();
        } finally {
            enforcingSinglePreview = false;
        }
    }

    document.addEventListener('play', function (event) {
        enforceSingleNativePreview(event.target);
    }, true);
    document.addEventListener('playing', function (event) {
        enforceSingleNativePreview(event.target);
    }, true);

    function cancelPreviewForGesture() {
        if (active || document.querySelector('video.preview:not(.hidden)')) stopActive();
    }

    function blockSwipeClick(origin) {
        if (!origin?.cover || !origin.url) return;
        swipeClickBlock = {
            url: origin.url,
            until: Date.now() + SWIPE_CLICK_BLOCK_MS,
        };
    }

    function cancelTouchForSwipe() {
        if (!touchOrigin) return;
        touchOrigin.moved = true;
        blockSwipeClick(touchOrigin);
        cancelPreviewForGesture();
    }

    function blockConflictingNativePreview(event) {
        if (!BLOCK_NATIVE_SITE_PREVIEW) return;
        const fromTouchPointer = event.pointerType === 'touch';
        if (!fromTouchPointer && Date.now() > nativePreviewBlockUntil) return;
        const card = findCard(event.target);
        if (!card || !isCoverTarget(card, event.target)) return;
        const url = cardUrl(card);
        if (!fromTouchPointer && nativePreviewBlockUrl && url !== nativePreviewBlockUrl) return;
        if (fromTouchPointer) {
            nativePreviewBlockUrl = url;
            nativePreviewBlockUntil = Date.now() + 1200;
        }
        event.stopImmediatePropagation();
    }

    window.addEventListener('pointerover', blockConflictingNativePreview, true);
    window.addEventListener('pointerenter', blockConflictingNativePreview, true);
    window.addEventListener('mouseover', blockConflictingNativePreview, true);
    window.addEventListener('mouseenter', blockConflictingNativePreview, true);

    window.addEventListener('touchstart', function (event) {
        if (event.touches.length !== 1) {
            touchOrigin = null;
            return;
        }
        const touch = event.touches[0];
        const card = findCard(event.target);
        const cover = Boolean(card && isCoverTarget(card, event.target));
        touchOrigin = {
            x: touch.clientX,
            y: touch.clientY,
            card,
            url: cardUrl(card),
            cover,
            startedAt: Date.now(),
            scrollY: window.scrollY,
            moved: false,
        };
        if (BLOCK_NATIVE_SITE_PREVIEW && cover) {
            nativePreviewBlockUrl = cardUrl(card);
            nativePreviewBlockUntil = Date.now() + 1200;
            // 只阻止站点先执行 touchstart 预览，不取消 Safari 的链接长按默认行为。
            event.stopImmediatePropagation();
        }
    }, { capture: true, passive: true });

    document.addEventListener('touchmove', function (event) {
        if (!touchOrigin || event.touches.length !== 1) return;
        const touch = event.touches[0];
        const distance = Math.hypot(touch.clientX - touchOrigin.x, touch.clientY - touchOrigin.y);
        const pageMoved = Math.abs(window.scrollY - touchOrigin.scrollY) >= 4;
        if (distance < SWIPE_CANCEL_DISTANCE && !pageMoved) return;
        cancelTouchForSwipe();
    }, { capture: true, passive: true });

    window.addEventListener('touchend', function (event) {
        const eventCard = findCard(event.target);
        const eventIsCover = Boolean(eventCard && isCoverTarget(eventCard, event.target));
        if (BLOCK_NATIVE_SITE_PREVIEW && eventIsCover) {
            nativePreviewBlockUrl = cardUrl(eventCard);
            nativePreviewBlockUntil = Date.now() + 800;
            // Eporner 在 document touchend 中启动原生预览；同时拦截随后合成的 mouseenter。
            event.stopImmediatePropagation();
        }
        if (IS_MISSAV) {
            touchOrigin = null;
            return;
        }
        const origin = touchOrigin;
        touchOrigin = null;
        if (origin?.moved || (origin?.cover && Math.abs(window.scrollY - origin.scrollY) >= 4)) {
            blockSwipeClick(origin);
            return;
        }
        if (!origin?.card || !origin.cover || !eventIsCover) return;
        const eventUrl = cardUrl(eventCard || origin.card);
        if (eventUrl && eventUrl === origin.url) swipeClickBlock = null;
        if (Date.now() - origin.startedAt >= LONG_PRESS_MS) {
            // 长按结束后抑制可能补发的 click，保留 Safari 原生链接菜单。
            suppressClickUntil = Math.max(suppressClickUntil, Date.now() + 800);
            return;
        }

        const card = eventCard || origin.card;
        const currentUrl = cardUrl(card);
        if (!currentUrl || currentUrl !== origin.url) return;
        const video = card.querySelector('video.preview[data-src], video.preview[src]');
        const previewIsOpen = Boolean(video && (!video.classList.contains('hidden') || !video.paused));
        if (!previewIsOpen && !(activeUrl && activeUrl === currentUrl)) return;

        event.preventDefault();
        event.stopImmediatePropagation();
        openCardLink(card);
    }, { capture: true, passive: false });

    window.addEventListener('contextmenu', function (event) {
        const card = findCard(event.target);
        if (!card || !isCoverTarget(card, event.target)) return;
        touchOrigin = null;
        nativePreviewBlockUrl = cardUrl(card);
        nativePreviewBlockUntil = Date.now() + 800;
        suppressClickUntil = Math.max(suppressClickUntil, Date.now() + 800);
    }, true);

    document.addEventListener('touchend', function () { touchOrigin = null; }, { capture: true, passive: true });
    document.addEventListener('touchcancel', function () {
        cancelTouchForSwipe();
        touchOrigin = null;
    }, { capture: true, passive: true });
    window.addEventListener('scroll', function (event) {
        // 只响应页面级滚动；忽略元素内部滚动，避免误取消。
        if (event.target !== document && event.target !== document.documentElement && event.target !== window) return;
        if (touchOrigin?.cover && Math.abs(window.scrollY - touchOrigin.scrollY) >= 4) {
            cancelTouchForSwipe();
        }
        // 预览刚开始时，地址栏收缩/布局位移会触发 scroll，短暂宽限。
        if (Date.now() - previewStartedAt < 400) {
            previewScrollY = window.scrollY;
            return;
        }
        if (previewScrollY === null) previewScrollY = window.scrollY;
        // 只有页面真的滚动超过阈值才取消预览（并顺带清掉 MissAV 状态）。
        if (Math.abs(window.scrollY - previewScrollY) < 48) return;
        cancelPreviewForGesture();
    }, { capture: true, passive: true });

    window.addEventListener('pagehide', stopActive);
    document.addEventListener('visibilitychange', function () {
        if (document.hidden) stopActive();
    });

    document.documentElement?.setAttribute(COVER_PREVIEW_READY_ATTR, '1');
    addStyle();
})();
