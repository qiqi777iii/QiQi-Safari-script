// ==UserScript==
// @name         标签页检查
// @namespace    https://github.com/qiqi777iii/Scripts
// @version      1.0.0
// @updateURL    https://raw.githubusercontent.com/qiqi777iii/Scripts/main/userscripts/tab-checker.user.js
// @downloadURL  https://raw.githubusercontent.com/qiqi777iii/Scripts/main/userscripts/tab-checker.user.js
// @description  识别 Safari 中当前及曾经打开的 MissAV 视频，并标记网页中的对应视频链接。
// @match        *://*/*
// @grant        Scripting.tabs
// @grant        Scripting.FileManager
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const MARK_ATTR = 'data-open-video-tab';
    const HISTORY_ATTR = 'data-open-video-history';
    const LEGACY_HISTORY_KEY = 'tab-checker:missav-history:v1';
    const MIGRATION_KEY = 'tab-checker:shared-history-migrated:v1';
    const HISTORY_FILE_NAME = 'video-open-history-v1.json';
    const HISTORY_LIMIT = 5000;
    const STYLE_ID = 'open-video-tab-style';
    const VIDEO_CODE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*-\d+$/i;

    let openCodes = new Set();
    let historyCodes = new Set();
    let scanFrame = 0;
    let refreshTimer = 0;
    let writeQueue = Promise.resolve();

    function isMissAvHost(hostname) {
        return /(^|\.)missav\./i.test(String(hostname || ''));
    }

    function videoCodeFromUrl(value) {
        try {
            const url = new URL(String(value || ''), document.baseURI);
            if (!/^https?:$/.test(url.protocol) || !isMissAvHost(url.hostname)) return null;
            const segments = url.pathname.split('/').filter(Boolean);
            const code = segments[segments.length - 1] || '';
            return VIDEO_CODE_RE.test(code) ? code.toLowerCase() : null;
        } catch (_) {
            return null;
        }
    }

    function emptyStore() {
        return { version: 1, updatedAt: 0, records: {} };
    }

    function getFileManager() {
        return typeof Scripting !== 'undefined' && Scripting.FileManager
            ? Scripting.FileManager
            : null;
    }

    function sharedHistoryPath() {
        const manager = getFileManager();
        const directory = manager?.safariBrowserDirectory;
        return directory ? `${directory}/${HISTORY_FILE_NAME}` : null;
    }

    function normalizeRecord(codeKey, value) {
        const code = String(codeKey || '').toLowerCase();
        if (!VIDEO_CODE_RE.test(code)) return null;
        if (typeof value === 'number' && Number.isFinite(value)) {
            return {
                code,
                firstOpenedAt: value,
                lastOpenedAt: value,
                openCount: 1,
                url: `https://missav.ai/${code}`
            };
        }
        if (!value || typeof value !== 'object') return null;
        const first = Number(value.firstOpenedAt);
        const last = Number(value.lastOpenedAt);
        const openedAt = Number.isFinite(first) ? first : (Number.isFinite(last) ? last : Date.now());
        return {
            code,
            firstOpenedAt: openedAt,
            lastOpenedAt: Number.isFinite(last) ? last : openedAt,
            openCount: Math.max(1, Math.floor(Number(value.openCount) || 1)),
            url: typeof value.url === 'string' && /^https?:\/\//i.test(value.url)
                ? value.url
                : `https://missav.ai/${code}`
        };
    }

    function normalizeStore(value) {
        const store = emptyStore();
        if (!value || typeof value !== 'object' || Array.isArray(value)) return store;
        const source = value.records && typeof value.records === 'object' && !Array.isArray(value.records)
            ? value.records
            : value;
        Object.entries(source)
            .map(function (entry) { return normalizeRecord(entry[0], entry[1]); })
            .filter(Boolean)
            .sort(function (a, b) { return b.lastOpenedAt - a.lastOpenedAt; })
            .slice(0, HISTORY_LIMIT)
            .forEach(function (record) { store.records[record.code] = record; });
        store.updatedAt = Number(value.updatedAt) || 0;
        return store;
    }

    function syncHistoryCodes(store) {
        historyCodes = new Set(Object.keys(store.records));
    }

    async function readSharedStore() {
        const manager = getFileManager();
        const path = sharedHistoryPath();
        if (!manager || !path) return emptyStore();
        try {
            if (!(await manager.exists(path))) return emptyStore();
            return normalizeStore(JSON.parse(await manager.readAsString(path, 'utf8')));
        } catch (_) {
            await new Promise(function (resolve) { setTimeout(resolve, 60); });
            try {
                return normalizeStore(JSON.parse(await manager.readAsString(path, 'utf8')));
            } catch (_) {
                return emptyStore();
            }
        }
    }

    async function writeSharedStore(store) {
        const manager = getFileManager();
        const path = sharedHistoryPath();
        if (!manager || !path) throw new Error('Scripting.FileManager is unavailable');
        const records = Object.values(store.records)
            .filter(function (record) { return record && VIDEO_CODE_RE.test(record.code); })
            .sort(function (a, b) { return b.lastOpenedAt - a.lastOpenedAt; })
            .slice(0, HISTORY_LIMIT);
        store.records = Object.fromEntries(records.map(function (record) { return [record.code, record]; }));
        store.version = 1;
        store.updatedAt = Date.now();
        await manager.writeAsString(path, JSON.stringify(store), 'utf8');
        syncHistoryCodes(store);
        return true;
    }

    function mergeLegacyHistory(store) {
        let changed = false;
        try {
            const legacy = JSON.parse(localStorage.getItem(LEGACY_HISTORY_KEY) || '{}');
            if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) {
                Object.entries(legacy).forEach(function (entry) {
                    const record = normalizeRecord(entry[0], entry[1]);
                    if (!record || store.records[record.code]) return;
                    store.records[record.code] = record;
                    changed = true;
                });
            }
            return { changed, needed: localStorage.getItem(MIGRATION_KEY) !== 'true' };
        } catch (_) {
            return { changed: false, needed: false };
        }
    }

    async function loadHistory() {
        const store = await readSharedStore();
        const migration = mergeLegacyHistory(store);
        if (migration.changed) {
            try {
                await writeSharedStore(store);
                localStorage.setItem(MIGRATION_KEY, 'true');
            } catch (_) {
                syncHistoryCodes(store);
            }
        } else {
            syncHistoryCodes(store);
            if (migration.needed) {
                try { localStorage.setItem(MIGRATION_KEY, 'true'); } catch (_) {}
            }
        }
    }

    function rememberVideos(videos, countedCode) {
        writeQueue = writeQueue.catch(function () {}).then(async function () {
            const store = await readSharedStore();
            const now = Date.now();
            let changed = false;
            videos.forEach(function (url, code) {
                if (!VIDEO_CODE_RE.test(code)) return;
                const existing = store.records[code];
                if (!existing) {
                    store.records[code] = {
                        code,
                        firstOpenedAt: now,
                        lastOpenedAt: now,
                        openCount: 1,
                        url: url || `https://missav.ai/${code}`
                    };
                    changed = true;
                    return;
                }
                if (code === countedCode) {
                    existing.lastOpenedAt = now;
                    existing.openCount = Math.max(1, Math.floor(Number(existing.openCount) || 1)) + 1;
                    if (url) existing.url = url;
                    changed = true;
                }
            });
            if (changed) {
                await writeSharedStore(store);
            } else {
                syncHistoryCodes(store);
            }
            scheduleScan();
        });
        return writeQueue;
    }

    function setLinkMark(link) {
        if (!(link instanceof HTMLAnchorElement)) return;
        const code = videoCodeFromUrl(link.getAttribute('href'));
        const currentCode = videoCodeFromUrl(location.href);
        const isCurrentVideo = Boolean(code && code === currentCode);
        const isCover = link.parentElement?.matches('div.relative.aspect-w-16.aspect-h-9') === true;
        if (!isCurrentVideo && !isCover && code && openCodes.has(code)) {
            link.setAttribute(MARK_ATTR, 'true');
            link.removeAttribute(HISTORY_ATTR);
        } else if (!isCurrentVideo && !isCover && code && historyCodes.has(code)) {
            link.removeAttribute(MARK_ATTR);
            link.setAttribute(HISTORY_ATTR, 'true');
        } else {
            link.removeAttribute(MARK_ATTR);
            link.removeAttribute(HISTORY_ATTR);
        }
    }

    function scanPage() {
        scanFrame = 0;
        document.querySelectorAll('a[href]').forEach(setLinkMark);
    }

    function scheduleScan() {
        if (scanFrame) return;
        scanFrame = requestAnimationFrame(scanPage);
    }

    async function readBackgroundVideoCodes() {
        if (typeof Scripting === 'undefined' || !Scripting.tabs?.query) return null;
        try {
            const tabs = await Scripting.tabs.query();
            const currentCode = videoCodeFromUrl(location.href);
            const seenVideos = new Map();
            const backgroundCodes = new Set();
            if (currentCode) seenVideos.set(currentCode, location.href);
            tabs.forEach(function (tab) {
                const code = videoCodeFromUrl(tab.url);
                if (!code) return;
                seenVideos.set(code, tab.url);
                if (code !== currentCode && tab.active !== true) backgroundCodes.add(code);
            });
            await rememberVideos(seenVideos, null);
            return backgroundCodes;
        } catch (_) {
            return null;
        }
    }

    async function refresh() {
        const codes = await readBackgroundVideoCodes();
        if (!codes) return;
        openCodes = codes;
        scheduleScan();
    }

    function scheduleRefresh(delay) {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(function () {
            refreshTimer = 0;
            void refresh();
        }, delay == null ? 50 : delay);
    }

    function installStyle() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
a[${MARK_ATTR}="true"]::before {
    content: "✓ 已打开";
    display: inline-block;
    box-sizing: border-box;
    margin-inline-end: 6px;
    padding: 1px 6px;
    border-radius: 999px;
    background: rgba(52, 199, 89, .16);
    color: rgb(48, 170, 78);
    font: 600 10px/16px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
    letter-spacing: 0;
    vertical-align: 2px;
    white-space: nowrap;
}
@media (prefers-color-scheme: dark) {
    a[${MARK_ATTR}="true"]::before {
        background: rgba(48, 209, 88, .18);
        color: rgb(105, 222, 126);
    }
}
a[${HISTORY_ATTR}="true"]::before {
    content: "✓ 曾打开";
    display: inline-block;
    box-sizing: border-box;
    margin-inline-end: 6px;
    padding: 1px 6px;
    border-radius: 999px;
    background: rgba(142, 142, 147, .16);
    color: rgb(99, 99, 102);
    font: 600 10px/16px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
    letter-spacing: 0;
    vertical-align: 2px;
    white-space: nowrap;
}
@media (prefers-color-scheme: dark) {
    a[${HISTORY_ATTR}="true"]::before {
        background: rgba(142, 142, 147, .20);
        color: rgb(174, 174, 178);
    }
}
`;
        (document.head || document.documentElement).appendChild(style);
    }

    function observePage() {
        const observer = new MutationObserver(function (mutations) {
            if (!openCodes.size && !historyCodes.size) return;
            for (const mutation of mutations) {
                if (mutation.type === 'attributes' || mutation.addedNodes.length) {
                    scheduleScan();
                    break;
                }
            }
        });
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['href']
        });
    }

    async function start() {
        if (!isMissAvHost(location.hostname)) return;
        installStyle();
        observePage();
        await loadHistory();
        const currentCode = videoCodeFromUrl(location.href);
        if (currentCode) await rememberVideos(new Map([[currentCode, location.href]]), currentCode);
        scheduleScan();
        window.addEventListener('pageshow', function () { scheduleRefresh(0); });
        window.addEventListener('focus', function () { scheduleRefresh(0); });
        document.addEventListener('visibilitychange', function () {
            if (!document.hidden) scheduleRefresh(0);
        });
        scheduleRefresh(0);
    }

    void start();
})();
