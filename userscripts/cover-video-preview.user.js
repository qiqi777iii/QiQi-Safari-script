// ==UserScript==
// @name         封面视频预览
// @namespace    https://github.com/qiqi777iii/Scripts
// @version      1.2.0
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
    const IS_XVIDEOS = /(^|\.)xvideos\.com$/i.test(location.hostname);
    const BLOCK_NATIVE_SITE_PREVIEW = IS_SPANKBANG || IS_EPORNER;
    const TAP_MAX_MS = 500;
    const SWIPE_CANCEL_DISTANCE = 10;
    // 页面最后一次滚动后的安定期：期内的点按视为“停住惯性滚动”，不触发预览。
    const SCROLL_SETTLE_MS = 300;

    if (IS_XVIDEOS) {
        initXVideos();
        return;
    }

    let active = null;
    let nativeProbeToken = 0;
    let enforcingSinglePreview = false;
    let previewStartedAt = 0;
    let previewScrollY = null;
    let nativePreviewBlockUntil = 0;
    let nativePreviewBlockUrl = null;
    // 统一手势状态。
    let touch = null;
    let lastScrollAt = 0;
    let lastScrollY = window.scrollY;
    let compatClickGuard = null;

    function initXVideos() {
        const CARD_SELECTOR = '.thumb-block:not(.thumb-ad)';
        const COVER_SELECTOR = '.thumb-inside .thumb';
        const PREVIEW_IMAGE_SELECTOR = 'img[data-pvv]';
        const VIDEO_PATH_RE = /^\/video(?:\.[^/]+|\d+)(?:\/|$)/i;
        const PREVIEW_CLASS = '__qiqi_xvideos_preview__';
        const ACTIVE_CLASS = '__qiqi_xvideos_preview_active__';
        const LINK_INTERACTION_OWNER_ATTR = 'data-qiqi-link-interaction-owner';
        const TAP_MAX_MS = 500;
        const MOVE_CANCEL_DISTANCE = 10;
        const PREVIEW_SCROLL_CANCEL_DISTANCE = 48;

        let activePreview = null;
        let gesture = null;
        let suppressNextClick = null;
        let pageScrolling = false;

        function isElement(value) {
            return value instanceof Element;
        }

        function normalizeHttpUrl(value) {
            const raw = String(value || '').trim();
            if (!raw || /^(?:data:|blob:|javascript:)/i.test(raw)) return null;
            try {
                const url = new URL(raw, document.baseURI);
                if (!/^https?:$/i.test(url.protocol) || url.username || url.password) return null;
                return url;
            } catch (_) {
                return null;
            }
        }

        function isVideoDetailUrl(url) {
            return Boolean(url && url.origin === location.origin && VIDEO_PATH_RE.test(url.pathname));
        }

        function getContext(target) {
            if (!isElement(target)) return null;
            const card = target.closest(CARD_SELECTOR);
            if (!card) return null;
            const cover = card.querySelector(COVER_SELECTOR);
            const image = cover?.querySelector(PREVIEW_IMAGE_SELECTOR);
            const link = image?.closest('a[href]');
            const detailUrl = normalizeHttpUrl(link?.getAttribute('href'));
            const previewUrl = normalizeHttpUrl(image?.getAttribute('data-pvv'));
            if (!cover || !image || !link || !isVideoDetailUrl(detailUrl) || !previewUrl) return null;
            return {
                card,
                cover,
                image,
                link,
                detailHref: detailUrl.href,
                previewHref: previewUrl.href,
            };
        }

        function isCoverTarget(context, target) {
            return Boolean(context && isElement(target) && context.cover.contains(target));
        }

        function getVideoLink(target) {
            if (!isElement(target)) return null;
            const link = target.closest('a[href]');
            if (!link) return null;
            const url = normalizeHttpUrl(link.getAttribute('href'));
            return isVideoDetailUrl(url) ? { link, href: url.href } : null;
        }

        function sameContext(a, b) {
            return Boolean(a && b && a.card === b.card && a.detailHref === b.detailHref);
        }

        function addStyle() {
            if (document.getElementById('__qiqi_xvideos_adapter_style__')) return;
            const style = document.createElement('style');
            style.id = '__qiqi_xvideos_adapter_style__';
            style.textContent = `
    .${PREVIEW_CLASS}{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;max-width:none!important;max-height:none!important;display:block!important;object-fit:cover!important;z-index:2147483000!important;margin:0!important;padding:0!important;border:0!important;outline:0!important;background:#000!important;pointer-events:none!important;opacity:1!important;visibility:visible!important;}
    `;
            (document.head || document.documentElement).appendChild(style);
        }

        function stopPreview() {
            const current = activePreview;
            activePreview = null;
            if (!current) return;
            current.observer?.disconnect();
            try { current.video.pause(); } catch (_) {}
            current.video.remove();
            current.context.card.classList.remove(ACTIVE_CLASS);
            if (current.context.cover.dataset.qiqiXvideosPosition === '1') {
                current.context.cover.style.position = current.oldPosition;
                delete current.context.cover.dataset.qiqiXvideosPosition;
            }
        }

        function watchVisibility(context) {
            if (typeof IntersectionObserver !== 'function') return null;
            const observer = new IntersectionObserver(function (entries) {
                if (entries.some(function (entry) {
                    return entry.target === context.card && entry.intersectionRatio < 0.08;
                })) stopPreview();
            }, { threshold: [0, 0.08] });
            observer.observe(context.card);
            return observer;
        }

        function startPreview(context) {
            stopPreview();
            addStyle();

            const oldPosition = context.cover.style.position;
            if (getComputedStyle(context.cover).position === 'static') {
                context.cover.dataset.qiqiXvideosPosition = '1';
                context.cover.style.position = 'relative';
            }

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
            if (context.image.currentSrc || context.image.src) video.poster = context.image.currentSrc || context.image.src;
            video.src = context.previewHref;

            context.card.classList.add(ACTIVE_CLASS);
            context.cover.appendChild(video);
            activePreview = {
                context,
                video,
                oldPosition,
                scrollY: window.scrollY,
                observer: watchVisibility(context),
            };

            video.addEventListener('error', function () {
                if (activePreview?.video === video) stopPreview();
            }, { once: true });
            try { video.play()?.catch?.(function () {}); } catch (_) {}
        }

        function openVideo(href) {
            stopPreview();
            if (requestBackgroundOpen(href)) return;
            location.assign(href);
        }

        function performCoverAction(context) {
            if (activePreview && sameContext(activePreview.context, context)) openVideo(context.detailHref);
            else startPreview(context);
        }

        function blockNativePreview(event) {
            const context = getContext(event.target);
            if (!context || !isCoverTarget(context, event.target)) return;
            if (event.type.startsWith('pointer') && event.pointerType !== 'touch') return;
            if (event.type.startsWith('mouse') && !gesture && !suppressNextClick) return;
            event.stopImmediatePropagation();
        }

        ['pointerover', 'pointerenter', 'mouseover', 'mouseenter'].forEach(function (type) {
            window.addEventListener(type, blockNativePreview, true);
        });

        window.addEventListener('touchstart', function (event) {
            suppressNextClick = null;
            if (event.isTrusted !== true) return;
            if (event.touches.length !== 1) {
                gesture = null;
                return;
            }
            const context = getContext(event.target);
            if (!context || !isCoverTarget(context, event.target)) {
                gesture = null;
                return;
            }
            const point = event.touches[0];
            gesture = {
                context,
                x: point.clientX,
                y: point.clientY,
                startedAt: Date.now(),
                scrollY: window.scrollY,
                startedWhileScrolling: pageScrolling,
                moved: false,
            };
            // 只阻断 XVideos 自己的封面手势，不阻止 Safari 滚动和长按菜单。
            event.stopImmediatePropagation();
        }, { capture: true, passive: true });

        window.addEventListener('touchmove', function (event) {
            if (!gesture) return;
            event.stopImmediatePropagation();
            if (event.touches.length !== 1 || gesture.moved) return;
            const point = event.touches[0];
            const fingerDistance = Math.hypot(point.clientX - gesture.x, point.clientY - gesture.y);
            const pageDistance = Math.abs(window.scrollY - gesture.scrollY);
            if (fingerDistance >= MOVE_CANCEL_DISTANCE || pageDistance >= MOVE_CANCEL_DISTANCE) {
                gesture.moved = true;
                stopPreview();
            }
        }, { capture: true, passive: true });

        window.addEventListener('touchend', function (event) {
            const origin = gesture;
            gesture = null;
            if (!origin) return;

            const endContext = getContext(event.target);
            suppressNextClick = { card: origin.context.card, href: origin.context.detailHref };
            event.stopImmediatePropagation();

            const elapsed = Date.now() - origin.startedAt;
            const pageMoved = Math.abs(window.scrollY - origin.scrollY) >= MOVE_CANCEL_DISTANCE;
            const validTap = !origin.moved && !origin.startedWhileScrolling && !pageMoved && elapsed < TAP_MAX_MS &&
                sameContext(origin.context, endContext) && isCoverTarget(endContext, event.target);
            if (!validTap) return;

            event.preventDefault();
            performCoverAction(origin.context);
        }, { capture: true, passive: false });

        window.addEventListener('touchcancel', function () {
            gesture = null;
            stopPreview();
        }, { capture: true, passive: true });

        window.addEventListener('contextmenu', function (event) {
            const context = getContext(event.target);
            if (!context || !isCoverTarget(context, event.target)) return;
            gesture = null;
            suppressNextClick = { card: context.card, href: context.detailHref };
        }, true);

        window.addEventListener('click', function (event) {
            if (event.isTrusted !== true) return;
            const context = getContext(event.target);
            if (context && isCoverTarget(context, event.target)) {
                if (suppressNextClick && suppressNextClick.card === context.card && suppressNextClick.href === context.detailHref) {
                    suppressNextClick = null;
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    return;
                }
                suppressNextClick = null;
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                event.stopImmediatePropagation();
                performCoverAction(context);
                return;
            }

            suppressNextClick = null;
            const videoLink = getVideoLink(event.target);
            if (!videoLink) {
                if (activePreview) stopPreview();
                return;
            }
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            openVideo(videoLink.href);
        }, true);

        window.addEventListener('scroll', function (event) {
            if (event.target !== document && event.target !== document.documentElement && event.target !== window) return;
            pageScrolling = true;
            if (!activePreview) {
                if (gesture && Math.abs(window.scrollY - gesture.scrollY) >= MOVE_CANCEL_DISTANCE) gesture.moved = true;
                return;
            }
            if (Math.abs(window.scrollY - activePreview.scrollY) >= PREVIEW_SCROLL_CANCEL_DISTANCE) stopPreview();
            if (gesture && Math.abs(window.scrollY - gesture.scrollY) >= MOVE_CANCEL_DISTANCE) gesture.moved = true;
        }, { capture: true, passive: true });

        window.addEventListener('scrollend', function () {
            pageScrolling = false;
        }, { capture: true, passive: true });

        window.addEventListener('pagehide', stopPreview);
        document.addEventListener('visibilitychange', function () {
            if (document.hidden) stopPreview();
        });

        addStyle();
        document.documentElement?.setAttribute(LINK_INTERACTION_OWNER_ATTR, 'cover-video-preview');
        document.documentElement?.setAttribute(COVER_PREVIEW_READY_ATTR, '1');
    }

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
        // “新标签页打开”存在且已开启时会接管为真正的后台标签；
        // 未安装或已关闭时无人接管，封面预览保持独立并按网站原行为进入当前页。
        if (requestBackgroundOpen(href)) return;
        location.assign(href);
    }

    window.addEventListener('click', function (event) {
        if (IS_MISSAV) return;

        const card = findCard(event.target);
        if (!card) {
            if (active) stopActive();
            return;
        }
        if (!isCoverTarget(card, event.target)) return;

        if (compatClickGuard) {
            if (Date.now() >= compatClickGuard.until) {
                compatClickGuard = null;
            } else if (card === compatClickGuard.card) {
                compatClickGuard = null;
                event.preventDefault();
                event.stopImmediatePropagation();
                return;
            }
        }

        const nativeVideo = card.querySelector('video.preview[data-src], video.preview[src]');
        const nativePreviewIsOpen = Boolean(nativeVideo && (
            !nativeVideo.classList.contains('hidden') || !nativeVideo.paused
        ));
        event.preventDefault();
        event.stopImmediatePropagation();
        if (nativePreviewIsOpen || active?.card === card) {
            openCardLink(card);
        } else {
            startPreview(card);
        }
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

    function guardCompatibilityClick(card) {
        if (!card) return;
        compatClickGuard = { card, until: Date.now() + 900 };
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
        compatClickGuard = null;
        if (event.touches.length !== 1) {
            touch = null;
            return;
        }
        const point = event.touches[0];
        const card = findCard(event.target);
        const cover = Boolean(card && isCoverTarget(card, event.target));
        const now = Date.now();
        touch = {
            x: point.clientX,
            y: point.clientY,
            card,
            url: cardUrl(card),
            cover,
            startedAt: now,
            scrollY: window.scrollY,
            moved: false,
            settled: now - lastScrollAt >= SCROLL_SETTLE_MS,
        };
        if (BLOCK_NATIVE_SITE_PREVIEW && cover) {
            nativePreviewBlockUrl = touch.url;
            nativePreviewBlockUntil = now + 1200;
            // 阻止站点自己的触摸预览；不 preventDefault，Safari 仍可滚动和长按链接。
            event.stopImmediatePropagation();
        }
    }, { capture: true, passive: true });

    window.addEventListener('touchmove', function (event) {
        if (!touch) return;
        if (BLOCK_NATIVE_SITE_PREVIEW && touch.cover) {
            nativePreviewBlockUntil = Date.now() + 800;
            event.stopImmediatePropagation();
        }
        if (event.touches.length !== 1 || touch.moved) return;
        const point = event.touches[0];
        const fingerDistance = Math.hypot(point.clientX - touch.x, point.clientY - touch.y);
        const pageDistance = Math.abs(window.scrollY - touch.scrollY);
        if (fingerDistance < SWIPE_CANCEL_DISTANCE && pageDistance < SWIPE_CANCEL_DISTANCE) return;
        touch.moved = true;
        guardCompatibilityClick(touch.card);
        cancelPreviewForGesture();
    }, { capture: true, passive: true });

    window.addEventListener('touchend', function (event) {
        const origin = touch;
        touch = null;
        const eventCard = findCard(event.target);
        const eventIsCover = Boolean(eventCard && isCoverTarget(eventCard, event.target));

        if (BLOCK_NATIVE_SITE_PREVIEW && (origin?.cover || eventIsCover)) {
            nativePreviewBlockUrl = origin?.url || cardUrl(eventCard);
            nativePreviewBlockUntil = Date.now() + 800;
            event.stopImmediatePropagation();
        }
        if (IS_MISSAV || !origin?.card || !origin.cover) return;

        const elapsed = Date.now() - origin.startedAt;
        const sameCard = eventCard === origin.card;
        const sameUrl = cardUrl(eventCard) === origin.url;
        const pageMoved = Math.abs(window.scrollY - origin.scrollY) >= SWIPE_CANCEL_DISTANCE;
        const pageStillSettling = Date.now() - lastScrollAt < SCROLL_SETTLE_MS;
        const validTap = !origin.moved && origin.settled && !pageMoved && !pageStillSettling &&
            elapsed < TAP_MAX_MS && eventIsCover && sameCard && sameUrl;

        if (!validTap) {
            guardCompatibilityClick(origin.card);
            return;
        }

        // 预览已开启时 touchend 进入详情，首次预览交给兼容 click。
        const nativeVideo = origin.card.querySelector('video.preview[data-src], video.preview[src]');
        const previewIsOpen = Boolean(nativeVideo && (!nativeVideo.classList.contains('hidden') || !nativeVideo.paused));
        if (previewIsOpen || active?.card === origin.card) {
            guardCompatibilityClick(origin.card);
            event.preventDefault();
            event.stopImmediatePropagation();
            openCardLink(origin.card);
        }
    }, { capture: true, passive: false });

    window.addEventListener('contextmenu', function (event) {
        const card = findCard(event.target);
        if (!card || !isCoverTarget(card, event.target)) return;
        touch = null;
        guardCompatibilityClick(card);
        nativePreviewBlockUrl = cardUrl(card);
        nativePreviewBlockUntil = Date.now() + 800;
    }, true);

    window.addEventListener('touchcancel', function () {
        if (touch?.card) guardCompatibilityClick(touch.card);
        cancelPreviewForGesture();
        touch = null;
    }, { capture: true, passive: true });

    window.addEventListener('scroll', function (event) {
        // 只响应页面级滚动；元素内部滚动不参与封面手势判断。
        if (event.target !== document && event.target !== document.documentElement && event.target !== window) return;
        const y = window.scrollY;
        if (Math.abs(y - lastScrollY) < 1) return;
        lastScrollY = y;

        // 预览刚开始造成的地址栏/布局位移不算用户滚动。
        if (active && Date.now() - previewStartedAt < 400) {
            previewScrollY = y;
            return;
        }

        lastScrollAt = Date.now();
        if (touch) {
            touch.moved = true;
            guardCompatibilityClick(touch.card);
        }
        if (previewScrollY === null) previewScrollY = y;
        if (Math.abs(y - previewScrollY) >= 48) cancelPreviewForGesture();
    }, { capture: true, passive: true });

    window.addEventListener('pagehide', stopActive);
    document.addEventListener('visibilitychange', function () {
        if (document.hidden) stopActive();
    });

    document.documentElement?.setAttribute(COVER_PREVIEW_READY_ATTR, '1');
    addStyle();
})();
