// ==UserScript==
// @name         视频封面预览
// @namespace    https://github.com/qiqi777iii/Scripts
// @version      1.3.1
// @description  首次点按视频封面播放静音预览，再次点按进入详情；支持通用网页检测，并保留已适配站点的专用逻辑。
// @match        *://*/*
// @grant        none
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/qiqi777iii/Scripts/main/userscripts/cover-video-preview.user.js
// @downloadURL  https://raw.githubusercontent.com/qiqi777iii/Scripts/main/userscripts/cover-video-preview.user.js
// ==/UserScript==

(function () {
    'use strict';

    const PREVIEW_CLASS = '__mobile_preview__';
    const ACTIVE_CLASS = '__mobile_preview_active__';
    const COVER_PREVIEW_READY_ATTR = 'data-cover-preview-ready';
    const LINK_INTERACTION_OWNER_ATTR = 'data-link-interaction-owner';
    const BACKGROUND_OPEN_REQUEST_EVENT = 'scripts:background-open-request';
    const IS_MISSAV = /(^|\.)missav\.[a-z0-9-]+$/i.test(location.hostname);
    const IS_RULE34VIDEO = /(^|\.)rule34video\.com$/i.test(location.hostname);
    const IS_SPANKBANG = /(^|\.)spankbang\.com$/i.test(location.hostname);
    const IS_EPORNER = /(^|\.)eporner\.com$/i.test(location.hostname);
    const IS_XVIDEOS = /(^|\.)xvideos\.com$/i.test(location.hostname);
    const IS_XHAMSTER = /(^|\.)xhamster\.com$/i.test(location.hostname);
    const IS_PORNHUB = /(^|\.)pornhub\.com$/i.test(location.hostname);
    const IS_SPECIAL_SITE = IS_MISSAV || IS_RULE34VIDEO || IS_SPANKBANG || IS_EPORNER || IS_XVIDEOS || IS_XHAMSTER || IS_PORNHUB;
    const BLOCK_NATIVE_SITE_PREVIEW = IS_MISSAV || IS_SPANKBANG || IS_EPORNER || IS_XVIDEOS || IS_XHAMSTER || IS_PORNHUB;
    const TAP_MAX_MS = 500;
    const SWIPE_CANCEL_DISTANCE = 10;
    const PREVIEW_SCROLL_CANCEL_DISTANCE = 48;
    const SCROLL_SETTLE_MS = 300;

    let active = null;
    let gesture = null;
    let compatClickGuard = null;
    let lastScrollAt = 0;
    let lastScrollY = window.scrollY;
    let nativePreviewBlockUntil = 0;
    let nativePreviewBlockUrl = null;

    function safeClosest(target, selector) {
        return target instanceof Element ? target.closest(selector) : null;
    }

    function normalizeMediaUrl(value) {
        const raw = String(value || '').trim();
        if (!raw || /^(?:data:|blob:|javascript:)/i.test(raw)) return null;
        try {
            const url = new URL(raw, document.baseURI);
            if (!/^https?:$/i.test(url.protocol) || url.username || url.password) return null;
            return url.href;
        } catch (_) {
            return null;
        }
    }

    function sourceFromMedia(media) {
        if (!media) return null;
        const values = [
            media.getAttribute?.('data-pvv'),
            media.getAttribute?.('data-preview'),
            media.getAttribute?.('data-preview-url'),
            media.getAttribute?.('data-video-preview'),
            media.getAttribute?.('data-previewvideo'),
            media.getAttribute?.('data-trailer'),
            media.getAttribute?.('data-webm'),
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

    function resolveEpornerPreviewUrl(card) {
        if (!IS_EPORNER || !card?.matches?.('.mb')) return null;
        const img = card.querySelector('.mbimg img, .mbcontent img, img[data-st]');
        const imageUrl = normalizeMediaUrl(img?.currentSrc || img?.getAttribute('src'));
        const id = String(card.dataset.id || card.dataset.vp?.split('|')[0] || '').replace(/\D/g, '');
        if (!id || !imageUrl) return null;
        try {
            const url = new URL(imageUrl);
            if (!/(^|\.)eporner\.com$/i.test(url.hostname) || !url.pathname.includes(`/${id}/`)) return null;
            url.pathname = url.pathname.replace(/\/[^/]*$/, `/${id}-preview.mp4`);
            url.hostname = url.hostname.replace(/^static-key-cdn\./i, 'static-ca-cdn.');
            return url.href;
        } catch (_) {
            return null;
        }
    }

    function resolvePreviewUrl(card) {
        const epornerUrl = resolveEpornerPreviewUrl(card);
        if (epornerUrl) return epornerUrl;

        const ownUrl = sourceFromMedia(card);
        if (ownUrl) return ownUrl;

        const directCandidates = card.querySelectorAll([
            '[data-pvv]',
            '[data-preview-url]',
            '[data-video-preview]',
            '[data-previewvideo]',
            '[data-trailer]',
            '[data-webm]',
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

        if (card.matches('.mb') && !IS_EPORNER) {
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

    function isXVideosDetailUrl(href) {
        if (!IS_XVIDEOS || !href) return false;
        try {
            const url = new URL(href);
            return url.origin === location.origin && /^\/video(?:\.[^/]+|\d+)(?:\/|$)/i.test(url.pathname);
        } catch (_) {
            return false;
        }
    }

    function cardUrl(card) {
        if (!(card instanceof Element)) return null;
        let link = null;
        if (IS_XVIDEOS && card.matches('.thumb-block:not(.thumb-ad)')) {
            link = card.querySelector('.thumb-inside .thumb img[data-pvv]')?.closest('a[href]');
        } else if (IS_EPORNER && card.matches('.mb')) {
            link = card.querySelector('.mbimg a[href^="/video-"], .mbcontent a[href^="/video-"]');
        } else if (IS_PORNHUB && card.matches('li[data-video-vkey], li[data-video-id]')) {
            link = card.querySelector('a.imageLink[href*="view_video.php?viewkey="]');
        } else {
            link = card.matches('a[href]') ? card : card.querySelector('img')?.closest('a[href]') || card.querySelector('a[href]');
        }
        const href = normalizeMediaUrl(link?.getAttribute('href'));
        return IS_XVIDEOS && card.matches('.thumb-block:not(.thumb-ad)') && !isXVideosDetailUrl(href) ? null : href;
    }

    function isPreviewCapableCard(card) {
        if (!(card instanceof Element)) return false;
        return Boolean(cardUrl(card) && card.querySelector('img, picture') && resolvePreviewUrl(card));
    }

    function findCard(target) {
        let card = null;

        if (IS_XVIDEOS) {
            card = safeClosest(target, '.thumb-block:not(.thumb-ad)');
            if (card?.querySelector('.thumb-inside .thumb img[data-pvv]') && isPreviewCapableCard(card)) return card;
        }

        card = safeClosest(target, 'li[data-video-vkey], li[data-video-id]');
        if (IS_PORNHUB && card?.querySelector('a.imageLink[data-webm][href*="view_video.php?viewkey="] img') && isPreviewCapableCard(card)) return card;

        if (IS_XHAMSTER) {
            card = safeClosest(target, 'a[data-previewvideo][href]');
            if (!isPreviewCapableCard(card)) return null;
            try {
                const url = new URL(cardUrl(card));
                return url.origin === location.origin && /^\/videos\/[^/]+(?:\/|$)/i.test(url.pathname) ? card : null;
            } catch (_) {
                return null;
            }
        }

        card = safeClosest(target, 'a[href]');
        if (IS_MISSAV && card?.querySelector('video.preview[data-src], video.preview[src]') && isPreviewCapableCard(card)) return card;
        if (IS_SPANKBANG && card?.matches('[data-testid="recommended-video"]') && isPreviewCapableCard(card)) return card;

        card = safeClosest(target, '.mb[data-id], .mb[data-vp]');
        if (IS_EPORNER && card?.querySelector('.mbimg img, .mbcontent img') && cardUrl(card) && resolveEpornerPreviewUrl(card)) return card;

        card = safeClosest(target, '.mb');
        if (IS_RULE34VIDEO && card?.dataset.id && isPreviewCapableCard(card)) return card;

        card = safeClosest(target, '.item.thumb, a.th');
        if (IS_EPORNER && isPreviewCapableCard(card)) return card;

        card = safeClosest(target, '.video-item, .js-video-item, [id^="recommended_video"]');
        if (IS_SPECIAL_SITE && isPreviewCapableCard(card)) return card;

        card = safeClosest(target, 'a[href]');
        if (isPreviewCapableCard(card)) return card;

        card = safeClosest(target, 'article, li, [class*="video" i], [class*="thumb" i], [class*="card" i]');
        if (isPreviewCapableCard(card)) return card;
        return null;
    }

    function findPreviewHost(card) {
        if (IS_XVIDEOS && card.matches('.thumb-block:not(.thumb-ad)')) {
            const cover = card.querySelector('.thumb-inside .thumb');
            if (cover instanceof HTMLElement) return cover;
        }
        const imageLink = card.querySelector('img')?.closest('a');
        const candidates = [
            card.querySelector('.mbcontent'),
            card.querySelector('.mbimg'),
            card.querySelector('.wrap_image[data-preview]'),
            card.querySelector('a.imageLink[data-webm]'),
            card.querySelector('a.thumb'),
            card.querySelector('.thumb'),
            card.querySelector('.video-thumb'),
            card.querySelector('.cover'),
            imageLink,
            card.querySelector('[data-pvv], [data-preview-url], [data-video-preview], [data-previewvideo], [data-trailer], [data-webm], [data-preview]'),
            card.querySelector('video[src], video[data-src], video source[src], video source[data-src]'),
            card,
        ];
        return candidates.find(function (node) {
            if (!(node instanceof HTMLElement)) return false;
            const rect = node.getBoundingClientRect();
            return rect.width > 20 && rect.height > 20;
        }) || card;
    }

    function isCoverTarget(card, target) {
        return target instanceof Element && findPreviewHost(card).contains(target);
    }

    function initMissAv() {
        let missAvActive = null;
        let enforcingSinglePreview = false;
        let previewStartedAt = 0;
        let previewScrollY = null;
        let touch = null;
        let lastScrollAt = 0;
        let lastScrollY = window.scrollY;

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

        function stopMissAvPreview() {
            const current = missAvActive;
            missAvActive = null;
            stopNativePreviews();
            current?.observer?.disconnect();
            if (current?.video) {
                try { current.video.pause(); } catch (_) {}
                try { current.video.currentTime = 0; } catch (_) {}
                current.video.classList.add('hidden');
                current.video.parentElement?.querySelector('img')?.classList.remove('hidden');
            }
            previewScrollY = null;
        }

        function markPreviewStarted() {
            previewStartedAt = Date.now();
            previewScrollY = window.scrollY;
        }

        function watchMissAvVisibility(card) {
            if (typeof IntersectionObserver !== 'function' || !card) return null;
            const observer = new IntersectionObserver(function (entries) {
                if (entries.some(function (entry) { return entry.target === card && entry.intersectionRatio < 0.08; })) {
                    stopMissAvPreview();
                }
            }, { threshold: [0, 0.08] });
            observer.observe(card);
            return observer;
        }

        function enforceSingleNativePreview(video) {
            if (enforcingSinglePreview || !(video instanceof HTMLVideoElement) || !video.matches('video.preview')) return;
            enforcingSinglePreview = true;
            try {
                stopNativePreviews(video);
                setMissAvHeldPreview(video);
                video.classList.remove('hidden');
                video.parentElement?.querySelector('img')?.classList.add('hidden');

                if (missAvActive?.video !== video) {
                    missAvActive?.observer?.disconnect();
                    const card = video.closest('a[href]') || video.parentElement;
                    missAvActive = {
                        card,
                        video,
                        observer: watchMissAvVisibility(card),
                    };
                }
                markPreviewStarted();
            } finally {
                enforcingSinglePreview = false;
            }
        }

        function cancelPreviewForGesture() {
            if (missAvActive || document.querySelector('video.preview:not(.hidden)')) stopMissAvPreview();
        }

        document.addEventListener('play', function (event) {
            enforceSingleNativePreview(event.target);
        }, true);
        document.addEventListener('playing', function (event) {
            enforceSingleNativePreview(event.target);
        }, true);

        window.addEventListener('touchstart', function (event) {
            if (event.touches.length !== 1) {
                touch = null;
                return;
            }
            const point = event.touches[0];
            const card = findCard(event.target);
            const now = Date.now();
            touch = {
                x: point.clientX,
                y: point.clientY,
                card,
                cover: Boolean(card && isCoverTarget(card, event.target)),
                startedAt: now,
                scrollY: window.scrollY,
                moved: false,
                settled: now - lastScrollAt >= SCROLL_SETTLE_MS,
            };
        }, { capture: true, passive: true });

        window.addEventListener('touchmove', function (event) {
            if (!touch || event.touches.length !== 1 || touch.moved) return;
            const point = event.touches[0];
            const fingerDistance = Math.hypot(point.clientX - touch.x, point.clientY - touch.y);
            const pageDistance = Math.abs(window.scrollY - touch.scrollY);
            if (fingerDistance < SWIPE_CANCEL_DISTANCE && pageDistance < SWIPE_CANCEL_DISTANCE) return;
            touch.moved = true;
            cancelPreviewForGesture();
        }, { capture: true, passive: true });

        window.addEventListener('touchend', function () {
            touch = null;
        }, { capture: true, passive: true });

        window.addEventListener('touchcancel', function () {
            cancelPreviewForGesture();
            touch = null;
        }, { capture: true, passive: true });

        window.addEventListener('scroll', function (event) {
            if (event.target !== document && event.target !== document.documentElement && event.target !== window) return;
            const y = window.scrollY;
            if (Math.abs(y - lastScrollY) < 1) return;
            lastScrollY = y;

            if (missAvActive && Date.now() - previewStartedAt < 400) {
                previewScrollY = y;
                return;
            }

            lastScrollAt = Date.now();
            if (touch) touch.moved = true;
            if (previewScrollY === null) previewScrollY = y;
            if (Math.abs(y - previewScrollY) >= PREVIEW_SCROLL_CANCEL_DISTANCE) cancelPreviewForGesture();
        }, { capture: true, passive: true });

        window.addEventListener('pagehide', stopMissAvPreview);
        document.addEventListener('visibilitychange', function () {
            if (document.hidden) stopMissAvPreview();
        });

        if (document.documentElement) initializeDocument();
        else document.addEventListener('readystatechange', initializeDocument, { once: true });
    }

    if (IS_MISSAV) {
        initMissAv();
        return;
    }

    function addStyle() {
        if (!document.documentElement || document.getElementById('__mobile_preview_style__')) return;
        const style = document.createElement('style');
        style.id = '__mobile_preview_style__';
        style.textContent = `
.${PREVIEW_CLASS}{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;max-width:none!important;max-height:none!important;object-fit:cover!important;display:block!important;z-index:2147483000!important;margin:0!important;padding:0!important;border:0!important;outline:0!important;background:#000!important;pointer-events:none!important;opacity:1!important;visibility:visible!important;}
`;
        (document.head || document.documentElement).appendChild(style);
    }

    function initializeDocument() {
        if (!document.documentElement) return;
        addStyle();
        if (IS_XVIDEOS) document.documentElement.setAttribute(LINK_INTERACTION_OWNER_ATTR, 'cover-video-preview');
        document.documentElement.setAttribute(COVER_PREVIEW_READY_ATTR, '1');
    }

    function attributeSnapshot(element, names) {
        const result = {};
        for (const name of names) result[name] = element.hasAttribute(name) ? element.getAttribute(name) : null;
        return result;
    }

    function restoreAttributes(element, snapshot) {
        for (const [name, value] of Object.entries(snapshot)) {
            if (value === null) element.removeAttribute(name);
            else element.setAttribute(name, value);
        }
    }

    function snapshotNativeVideo(video) {
        const image = video.parentElement?.querySelector('img') || null;
        return {
            attrs: attributeSnapshot(video, ['src', 'class', 'muted', 'autoplay', 'loop', 'playsinline', 'webkit-playsinline', 'preload', 'disablepictureinpicture']),
            image,
            imageAttrs: image ? attributeSnapshot(image, ['class', 'style', 'hidden']) : null,
            muted: video.muted,
            defaultMuted: video.defaultMuted,
            autoplay: video.autoplay,
            loop: video.loop,
            playsInline: video.playsInline,
            preload: video.preload,
            disablePictureInPicture: video.disablePictureInPicture,
            paused: video.paused,
            currentTime: Number.isFinite(video.currentTime) ? video.currentTime : 0,
        };
    }

    function restoreNativeVideo(video, snapshot) {
        try { video.pause(); } catch (_) {}
        restoreAttributes(video, snapshot.attrs);
        if (snapshot.image && snapshot.imageAttrs) restoreAttributes(snapshot.image, snapshot.imageAttrs);
        try { video.muted = snapshot.muted; } catch (_) {}
        try { video.defaultMuted = snapshot.defaultMuted; } catch (_) {}
        try { video.autoplay = snapshot.autoplay; } catch (_) {}
        try { video.loop = snapshot.loop; } catch (_) {}
        try { video.playsInline = snapshot.playsInline; } catch (_) {}
        try { video.preload = snapshot.preload; } catch (_) {}
        try { video.disablePictureInPicture = snapshot.disablePictureInPicture; } catch (_) {}
        try { video.load(); } catch (_) {}
        const restorePlayback = function () {
            try { video.currentTime = snapshot.currentTime; } catch (_) {}
            if (snapshot.paused) {
                try { video.pause(); } catch (_) {}
            } else {
                try { video.play()?.catch?.(function () {}); } catch (_) {}
            }
        };
        if (video.readyState >= 1 || !video.currentSrc) restorePlayback();
        else video.addEventListener('loadedmetadata', restorePlayback, { once: true });
    }

    function releaseDynamicVideo(video) {
        if (!video) return;
        try { video.pause(); } catch (_) {}
        try {
            video.removeAttribute('src');
            video.querySelectorAll('source').forEach(function (source) { source.removeAttribute('src'); });
            video.load();
        } catch (_) {}
        video.remove();
    }

    function stopActive() {
        const current = active;
        active = null;
        if (!current) return;
        current.observer?.disconnect();
        current.video.removeEventListener('error', current.onError);
        if (current.native) restoreNativeVideo(current.video, current.snapshot);
        else releaseDynamicVideo(current.video);
        current.card?.classList.remove(ACTIVE_CLASS);
        if (current.positionChanged) current.host.style.position = current.oldPosition;
    }

    function watchVisibility(card) {
        if (typeof IntersectionObserver !== 'function') return null;
        const observer = new IntersectionObserver(function (entries) {
            if (entries.some(function (entry) { return entry.target === card && entry.intersectionRatio < 0.08; })) stopActive();
        }, { threshold: [0, 0.08] });
        observer.observe(card);
        return observer;
    }

    function createActiveRecord(card, host, video, details) {
        const record = {
            card,
            href: cardUrl(card),
            host,
            video,
            oldPosition: details.oldPosition || '',
            positionChanged: Boolean(details.positionChanged),
            native: Boolean(details.native),
            snapshot: details.snapshot || null,
            scrollY: window.scrollY,
            observer: null,
            onError: null,
        };
        record.observer = watchVisibility(card);
        record.onError = function () { if (active === record) stopActive(); };
        video.addEventListener('error', record.onError, { once: true });
        active = record;
        return record;
    }

    function mountDynamicPreview(card, url) {
        stopActive();
        addStyle();
        const host = findPreviewHost(card);
        const oldPosition = host.style.position;
        const positionChanged = getComputedStyle(host).position === 'static';
        if (positionChanged) host.style.position = 'relative';

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
        const img = card.querySelector('img');
        if (img?.currentSrc || img?.src) video.poster = img.currentSrc || img.src;
        video.src = url;

        card.classList.add(ACTIVE_CLASS);
        host.appendChild(video);
        createActiveRecord(card, host, video, { oldPosition, positionChanged });
        try {
            const task = video.play();
            task?.catch?.(function () { if (active?.video === video) stopActive(); });
        } catch (_) {
            stopActive();
            return false;
        }
        return true;
    }

    function mountNativePreview(card, video) {
        stopActive();
        const snapshot = snapshotNativeVideo(video);
        const src = sourceFromMedia(video);
        if (src && !video.getAttribute('src')) video.src = src;
        video.muted = true;
        video.defaultMuted = true;
        video.loop = true;
        video.playsInline = true;
        video.setAttribute('muted', '');
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');
        video.classList.remove('hidden');
        snapshot.image?.classList.add('hidden');
        card.classList.add(ACTIVE_CLASS);
        createActiveRecord(card, video.parentElement || card, video, { native: true, snapshot });
        try {
            const task = video.play();
            task?.catch?.(function () { if (active?.video === video) stopActive(); });
        } catch (_) {
            stopActive();
            return false;
        }
        return true;
    }

    function startPreview(card) {
        const nativeVideo = card.querySelector('video.preview[data-src], video.preview[src]');
        if (nativeVideo && sourceFromMedia(nativeVideo)) return mountNativePreview(card, nativeVideo);
        const url = resolvePreviewUrl(card);
        return url ? mountDynamicPreview(card, url) : false;
    }

    function requestBackgroundOpen(href) {
        const event = new CustomEvent(BACKGROUND_OPEN_REQUEST_EVENT, {
            cancelable: true,
            detail: { source: 'cover-video-preview', href },
        });
        window.dispatchEvent(event);
        return event.defaultPrevented;
    }

    function openCardLink(card, expectedHref = null) {
        const href = expectedHref || cardUrl(card);
        if (!href) return;
        stopActive();
        if (requestBackgroundOpen(href)) return;
        location.assign(href);
    }

    function performCoverAction(card, expectedHref = null) {
        const href = expectedHref || cardUrl(card);
        if (!href || cardUrl(card) !== href) return;
        if (active?.card === card && active.href === href) openCardLink(card, href);
        else startPreview(card);
    }

    function sameContext(card, href, otherCard, otherHref) {
        return Boolean(card && otherCard && card === otherCard && href && href === otherHref);
    }

    function guardCompatibilityClick(card) {
        if (card) compatClickGuard = { card, href: cardUrl(card), until: Date.now() + 900 };
    }

    function consumeCompatibilityClick(card) {
        if (!compatClickGuard) return false;
        if (Date.now() >= compatClickGuard.until) {
            compatClickGuard = null;
            return false;
        }
        if (compatClickGuard.card !== card || compatClickGuard.href !== cardUrl(card)) return false;
        compatClickGuard = null;
        return true;
    }

    function blockConflictingNativePreview(event) {
        if (!BLOCK_NATIVE_SITE_PREVIEW) return;
        const fromTouchPointer = event.pointerType === 'touch';
        if (!fromTouchPointer && Date.now() > nativePreviewBlockUntil) return;
        const card = findCard(event.target);
        if (!card || !isCoverTarget(card, event.target)) return;
        const href = cardUrl(card);
        if (!fromTouchPointer && nativePreviewBlockUrl && href !== nativePreviewBlockUrl) return;
        if (fromTouchPointer) {
            nativePreviewBlockUrl = href;
            nativePreviewBlockUntil = Date.now() + 1200;
        }
        event.stopImmediatePropagation();
    }

    ['pointerover', 'pointerenter', 'mouseover', 'mouseenter'].forEach(function (type) {
        window.addEventListener(type, blockConflictingNativePreview, true);
    });

    window.addEventListener('touchstart', function (event) {
        compatClickGuard = null;
        if (event.isTrusted !== true || event.touches.length !== 1) {
            gesture = null;
            return;
        }
        const card = findCard(event.target);
        if (!card || !isCoverTarget(card, event.target)) {
            gesture = null;
            return;
        }
        const point = event.touches[0];
        const now = Date.now();
        gesture = {
            card,
            href: cardUrl(card),
            x: point.clientX,
            y: point.clientY,
            scrollY: window.scrollY,
            startedAt: now,
            settled: now - lastScrollAt >= SCROLL_SETTLE_MS,
            moved: false,
        };
        nativePreviewBlockUrl = gesture.href;
        nativePreviewBlockUntil = now + 1200;
        // 只在需要阻断站点原生触摸预览时截断网页监听；不 preventDefault，保留滚动和长按。
        if (BLOCK_NATIVE_SITE_PREVIEW) event.stopImmediatePropagation();
    }, { capture: true, passive: true });

    window.addEventListener('touchmove', function (event) {
        if (!gesture) return;
        if (BLOCK_NATIVE_SITE_PREVIEW) event.stopImmediatePropagation();
        if (event.touches.length !== 1 || gesture.moved) return;
        const point = event.touches[0];
        const fingerDistance = Math.hypot(point.clientX - gesture.x, point.clientY - gesture.y);
        const pageDistance = Math.abs(window.scrollY - gesture.scrollY);
        if (fingerDistance < SWIPE_CANCEL_DISTANCE && pageDistance < SWIPE_CANCEL_DISTANCE) return;
        gesture.moved = true;
        guardCompatibilityClick(gesture.card);
        stopActive();
    }, { capture: true, passive: true });

    window.addEventListener('touchend', function (event) {
        const origin = gesture;
        gesture = null;
        if (!origin) return;
        const endCard = findCard(event.target);
        const endHref = cardUrl(endCard);
        const endIsCover = Boolean(endCard && isCoverTarget(endCard, event.target));
        guardCompatibilityClick(origin.card);
        nativePreviewBlockUrl = origin.href;
        nativePreviewBlockUntil = Date.now() + 800;
        if (BLOCK_NATIVE_SITE_PREVIEW) event.stopImmediatePropagation();

        const elapsed = Date.now() - origin.startedAt;
        const pageMoved = Math.abs(window.scrollY - origin.scrollY) >= SWIPE_CANCEL_DISTANCE;
        const pageStillSettling = Date.now() - lastScrollAt < SCROLL_SETTLE_MS;
        const validTap = !origin.moved && origin.settled && !pageMoved && !pageStillSettling &&
            elapsed < TAP_MAX_MS && endIsCover && sameContext(origin.card, origin.href, endCard, endHref);
        if (!validTap) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        performCoverAction(origin.card, origin.href);
    }, { capture: true, passive: false });

    window.addEventListener('touchcancel', function () {
        if (gesture?.card) guardCompatibilityClick(gesture.card);
        gesture = null;
        stopActive();
    }, { capture: true, passive: true });

    window.addEventListener('contextmenu', function (event) {
        const card = findCard(event.target);
        if (!card || !isCoverTarget(card, event.target)) return;
        gesture = null;
        guardCompatibilityClick(card);
        nativePreviewBlockUrl = cardUrl(card);
        nativePreviewBlockUntil = Date.now() + 800;
    }, true);

    window.addEventListener('click', function (event) {
        if (event.isTrusted !== true) return;
        const card = findCard(event.target);
        if (!card) {
            if (active) stopActive();
            return;
        }
        if (!isCoverTarget(card, event.target)) return;
        if (consumeCompatibilityClick(card)) {
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
        }
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        performCoverAction(card);
    }, true);

    window.addEventListener('scroll', function (event) {
        if (event.target !== document && event.target !== document.documentElement && event.target !== window) return;
        const y = window.scrollY;
        if (Math.abs(y - lastScrollY) < 1) return;
        lastScrollY = y;
        lastScrollAt = Date.now();
        if (gesture && Math.abs(y - gesture.scrollY) >= SWIPE_CANCEL_DISTANCE) {
            gesture.moved = true;
            guardCompatibilityClick(gesture.card);
        }
        if (active && Math.abs(y - active.scrollY) >= PREVIEW_SCROLL_CANCEL_DISTANCE) stopActive();
    }, { capture: true, passive: true });

    window.addEventListener('pagehide', stopActive);
    document.addEventListener('visibilitychange', function () {
        if (document.hidden) stopActive();
    });

    if (document.documentElement) initializeDocument();
    else document.addEventListener('readystatechange', initializeDocument, { once: true });
})();
