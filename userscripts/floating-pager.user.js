// ==UserScript==
// @name         悬浮翻页
// @namespace    https://github.com/qiqi777iii/Scripts
// @version      1.0.68
// @updateURL    https://raw.githubusercontent.com/qiqi777iii/Scripts/main/userscripts/floating-pager.user.js
// @downloadURL  https://raw.githubusercontent.com/qiqi777iii/Scripts/main/userscripts/floating-pager.user.js
// @description  自动识别页面的上一页和下一页，并提供关闭标签页、刷新及可拖动的悬浮翻页按钮。
// @author       Scripting Agent
// @match        http://*/*
// @match        https://*/*
// @run-at       document-start
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.registerMenuCommand
// @grant        GM.log
// @grant        GM.closeTab
// @grant        Scripting.tabs
// ==/UserScript==

(() => {
  "use strict";

  const SCRIPT_ID = "universal-pagination-floating-menu";
  const POS_KEY = `${SCRIPT_ID}:position:v9`;
  const SAFE_BOTTOM_GAP = 25;
  const PAGER_ITEM_SIZE = 35;
  const PAGE_MIN_WIDTH = 35;
  const FALLBACK_PAGER_WIDTH = PAGER_ITEM_SIZE * 3 + PAGE_MIN_WIDTH;
  const REFRESH_ICON_SIZE = 19;
  const DEFAULT_RIGHT_GAP = 16;
  const NODESEEK_BOTTOM_EXTRA = 0;
  const ENABLE_KEY = `${SCRIPT_ID}:enabled`;
  const STATE = {
    enabled: true,
    prev: null,
    next: null,
    currentPage: "?",
    lastUrl: location.href,
    observer: null,
    fallbackTimer: null,
    updateTimer: null,
    navigating: false,
    savedPosition: null,
    positionRevision: 0,
    dragging: false,
    initialized: false,
    settingsLoaded: false,
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  async function gmGet(key, defaultValue) {
    try {
      if (typeof GM !== "undefined" && GM.getValue) return await GM.getValue(key, defaultValue);
    } catch (_) {}
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? defaultValue : JSON.parse(raw);
    } catch (_) {
      return defaultValue;
    }
  }

  async function gmSet(key, value) {
    try {
      if (typeof GM !== "undefined" && GM.setValue) return await GM.setValue(key, value);
    } catch (_) {}
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {}
  }

  function log(...args) {
    try {
      if (typeof GM !== "undefined" && GM.log) GM.log("[翻页菜单]", ...args);
      else console.log("[翻页菜单]", ...args);
    } catch (_) {}
  }

  function absorbFloatingUiEvent(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  function isolateFloatingUi(root) {
    ["pointerdown", "pointerup", "pointercancel", "touchstart", "touchend", "mousedown", "mouseup", "click"].forEach((type) => {
      root.addEventListener(type, absorbFloatingUiEvent, { passive: false });
    });
  }

  function visible(el) {
    if (!el || !(el instanceof Element)) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function disabled(el) {
    if (!el) return true;
    return Boolean(
      el.disabled ||
      el.getAttribute("aria-disabled") === "true" ||
      /(^|\s)(disabled|disable|unavailable|inactive)(\s|$)/i.test(el.className || "") ||
      (el.tagName === "A" && !el.getAttribute("href") && !el.onclick)
    );
  }

  function normalizeText(el) {
    return [
      el.innerText,
      el.textContent,
      el.getAttribute("aria-label"),
      el.getAttribute("title"),
      el.getAttribute("rel"),
      el.getAttribute("class"),
      el.getAttribute("id"),
    ]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function scoreCandidate(el, direction) {
    if (!visible(el) || disabled(el)) return -999;
    const text = normalizeText(el).toLowerCase();
    const href = (el.getAttribute("href") || "").toLowerCase();
    const all = `${text} ${href}`;
    let score = 0;

    if (direction === "next") {
      if (/\bnext\b|下一页|下页|后一页|后页|下一章|下章|更多|加载更多|older|forward|more/.test(all)) score += 80;
      if (/[›»→＞>]|^\s*下\s*$/.test(text)) score += 65;
      if (/rel=["']?next|\bnext\b/.test(all) || el.getAttribute("rel") === "next") score += 70;
      if (/page[=/_-]?\d+|p=\d+|paged=\d+/.test(href)) score += 10;
    } else {
      if (/\bprev\b|\bprevious\b|上一页|上页|前一页|前页|上一章|上章|newer|\bback\b/.test(all)) score += 80;
      if (/[‹«←＜<]|^\s*上\s*$/.test(text)) score += 65;
      if (/rel=["']?prev|\bprev\b|\bprevious\b/.test(all) || el.getAttribute("rel") === "prev") score += 70;
      if (/page[=/_-]?\d+|p=\d+|paged=\d+/.test(href)) score += 10;
    }

    const tag = el.tagName;
    if (tag === "A") score += 15;
    if (tag === "BUTTON") score += 12;
    if (el.closest(".pagination, .pager, .pages, .page-numbers, [class*=pagination], [class*=pager], [class*=page-numbers], [id*=pagination], [id*=pager]")) score += 35;
    if (/comment|reply|share|login|广告|ad-|banner/.test(all)) score -= 40;
    return score;
  }

  function uniqueElements(list) {
    return Array.from(new Set(list.filter(Boolean)));
  }

  function findByRel(direction) {
    const rel = direction === "next" ? "next" : "prev";
    return $(`a[rel~="${rel}"], link[rel~="${rel}"]`);
  }

  function findCandidate(direction) {
    if (isMissAv()) {
      return findMissAvCandidate(direction);
    }

    if (isRule34Video()) {
      const siteCandidate = findRule34Candidate(direction);
      if (siteCandidate) return siteCandidate;
    }

    if (isEpornerVideoPage()) {
      return null;
    }

    if (isFutapo2SingleCollectionPage()) {
      return null;
    }

    if (isJable()) {
      return findJableCandidate(direction);
    }

    if (isXVideos()) {
      return findXVideosCandidate(direction);
    }

    if (isOHentai()) {
      return findOHentaiCandidate(direction);
    }

    if (isNodeSeek()) {
      const siteCandidate = findNodeSeekCandidate(direction);
      if (siteCandidate) return siteCandidate;
    }

    if (isWhosTv()) {
      const siteCandidate = findWhosTvCandidate(direction);
      if (siteCandidate) return siteCandidate;
    }

    if (isDiscuz()) {
      const siteCandidate = findDiscuzCandidate(direction);
      if (siteCandidate) return siteCandidate;
    }

    const byRel = findByRel(direction);
    if (byRel && byRel.href && !disabled(byRel)) return byRel;

    const selectors = [
      "a[href]",
      "button",
      "input[type=button]",
      "input[type=submit]",
      "[role=button]",
      "[onclick]",
      ".next",
      ".prev",
      ".previous",
      ".pagination a",
      ".pagination button",
      ".pager a",
      ".pager button",
      "[class*=next]",
      "[class*=prev]",
      "[aria-label]",
      "[title]",
    ];

    const candidates = uniqueElements($$(selectors.join(",")));
    let best = null;
    let bestScore = 30; // 低于该分数认为误判风险较高
    for (const el of candidates) {
      const s = scoreCandidate(el, direction);
      if (s > bestScore) {
        best = el;
        bestScore = s;
      }
    }
    return best;
  }

  function pageFromUrl(urlLike = location.href) {
    const url = new URL(urlLike, location.href);
    for (const key of ["page", "p", "paged", "pg", "pn", "pageNo", "pageNumber"]) {
      const value = url.searchParams.get(key);
      if (/^\d+$/.test(value || "")) return String(parseInt(value, 10));
    }
    // NodeSeek 列表页：/page-2，最后一个数字就是页码。
    if (/(^|\.)nodeseek\.com$/i.test(url.hostname)) {
      const nodeSeekListMatch = url.pathname.match(/^\/page-0*(\d{1,5})(?:\/)?$/i);
      if (nodeSeekListMatch) return String(parseInt(nodeSeekListMatch[1], 10));
      const nodeSeekCategoryMatch = url.pathname.match(/^\/categories\/[^/]+\/page-0*(\d{1,5})(?:\/)?$/i);
      if (nodeSeekCategoryMatch) return String(parseInt(nodeSeekCategoryMatch[1], 10));
    }

    // NodeSeek 帖子分页格式：/post-174345-3，最后一个数字才是页码，
    // 中间的 174345 是帖子 ID，不能误当成页码。
    if (/(^|\.)nodeseek\.com$/i.test(url.hostname)) {
      const nodeSeekPostMatch = url.pathname.match(/^\/post-\d+-0*(\d{1,5})(?:\/)?$/i);
      if (nodeSeekPostMatch) return String(parseInt(nodeSeekPostMatch[1], 10));
    }

    if (isXVideos()) {
      const xvideosPathPage = getXVideosPathPage(urlLike);
      if (xvideosPathPage) return xvideosPathPage;
    }

    const pathMatch = url.pathname.match(/(?:page|p|pg|list)[/-]?(\d+)(?:\/|$|\.html?$)/i);
    if (pathMatch) return String(parseInt(pathMatch[1], 10));
    return "";
  }

  function isXVideos() {
    return /(^|\.)xvideos\.com$/i.test(location.hostname);
  }

  function isJable() {
    return /(^|\.)jable\.tv$/i.test(location.hostname);
  }

  function getJablePathPage(urlLike = location.href) {
    if (!isJable()) return "";
    try {
      const url = new URL(urlLike, location.href);
      const match = url.pathname.match(/^(\/(?:tags|categories|models|studios|makers?|latest-updates|new-release|hot|search)(?:\/[^/?#]+){0,4})\/0*(\d{1,5})\/?$/i);
      if (match) return String(parseInt(match[2], 10));
    } catch (_) {}
    return "";
  }

  function getJableCurrentPage() {
    const fromPath = getJablePathPage();
    if (fromPath) return fromPath;
    const fromUrl = pageFromUrl();
    if (fromUrl) return fromUrl;
    const active = $('.pagination .active, .pagination .current, nav .active, nav .current, [aria-current="page"]');
    const n = active ? numericText(active) : "";
    if (n) return n;
    if (/^\/(?:tags|categories|models|studios|makers?|latest-updates|new-release|hot|search)(?:\/|$)/i.test(location.pathname)) return "1";
    return "";
  }

  function makeJablePageUrl(targetPage) {
    targetPage = parseInt(targetPage, 10);
    if (!Number.isFinite(targetPage) || targetPage < 1) return "";
    const url = new URL(location.href);
    let path = url.pathname || "/";
    path = path.replace(/\/0*\d{1,5}\/?$/i, "/");
    path = path.replace(/\/+$/g, "") + "/";
    if (targetPage > 1) path += `${targetPage}/`;
    url.pathname = path;
    return url.href;
  }

  function findJableCandidate(direction) {
    const current = parseInt(getJableCurrentPage() || "1", 10);
    if (!Number.isFinite(current) || current < 1) return null;
    const target = current + (direction === "next" ? 1 : -1);
    if (target < 1) return null;
    const url = makeJablePageUrl(target);
    return url ? { __paginationUrl: url } : null;
  }

  function isOHentai() {
    return /(^|\.)ohentai\.org$/i.test(location.hostname);
  }

  function findOHentaiCandidate(direction) {
    const current = parseInt(pageFromUrl() || getCurrentPage() || "1", 10);
    if (!Number.isFinite(current) || current < 1) return null;
    const target = current + (direction === "next" ? 1 : -1);
    if (target < 1) return null;
    const url = new URL(location.href);
    url.searchParams.set("p", String(target));
    return { __paginationUrl: url.href };
  }

  function makeXVideosDisplayPageUrl(targetPage) {
    targetPage = parseInt(targetPage, 10);
    if (!Number.isFinite(targetPage) || targetPage < 1) return "";
    const url = new URL(location.href);
    const pathPage = getXVideosPathPage();
    if (pathPage) {
      url.search = "";
      url.hash = "";
      url.pathname = replaceXVideosPathPage(url.pathname, targetPage);
      return url.href;
    }
    // xvideos 地址栏最终正常格式：?page=N#_tabVideos。
    url.searchParams.set("page", String(targetPage));
    url.hash = "_tabVideos";
    return url.href;
  }

  function getXVideosPathPage(urlLike = location.href) {
    if (!isXVideos()) return "";
    try {
      const url = new URL(urlLike, location.href);
      const match = url.pathname.match(/^(\/(?:best-of-[^/]+|new-[^/]+|tags?|channels?|pornstars?|profiles?|c|cat|search)(?:\/[^/?#]+){1,6})\/0*(\d{1,5})\/?$/i);
      if (match) return String(parseInt(match[2], 10));
    } catch (_) {}
    return "";
  }

  function replaceXVideosPathPage(pathname, targetPage) {
    targetPage = parseInt(targetPage, 10);
    if (!Number.isFinite(targetPage) || targetPage < 1) return pathname;
    const clean = String(pathname || "/").replace(/\/+$/g, "");
    if (/^(\/(?:best-of-[^/]+|new-[^/]+|tags?|channels?|pornstars?|profiles?|c|cat|search)(?:\/[^/?#]+){1,6})\/0*\d{1,5}$/i.test(clean)) {
      return clean.replace(/\/0*\d{1,5}$/i, targetPage <= 1 ? "" : `/${targetPage}`);
    }
    return targetPage <= 1 ? clean : `${clean}/${targetPage}`;
  }

  function makeXVideosPageUrl(targetPage) {
    targetPage = parseInt(targetPage, 10);
    if (!Number.isFinite(targetPage) || targetPage < 1) return "";
    const url = new URL(location.href);
    const pathPage = getXVideosPathPage();
    if (pathPage) {
      url.search = "";
      url.hash = "";
      url.pathname = replaceXVideosPathPage(url.pathname, targetPage);
      return url.href;
    }
    // xvideos 真正触发视频 tab 翻页需要临时 hash page-N；
    // 页面加载完成后会清理成 ?page=N#_tabVideos。
    url.searchParams.set("page", String(targetPage));
    url.hash = `_tabVideos,page-${targetPage}`;
    return url.href;
  }

  function normalizeXVideosHashLater() {
    if (!isXVideos()) return;
    const page = pageFromUrl();
    const match = String(location.hash || "").match(/^#_tabVideos,page-(\d+)$/i);
    if (!page || !match || match[1] !== page) return;
    const cleanUrl = makeXVideosDisplayPageUrl(page);
    if (!cleanUrl) return;
    setTimeout(() => {
      try {
        if (location.href !== cleanUrl) history.replaceState(history.state, document.title, cleanUrl);
      } catch (_) {}
    }, 1500);
  }

  function findXVideosCandidate(direction) {
    const current = parseInt(pageFromUrl() || getCurrentPage() || "1", 10);
    if (!Number.isFinite(current) || current < 1) return null;
    const target = current + (direction === "next" ? 1 : -1);
    if (target < 1) return null;
    const url = makeXVideosPageUrl(target);
    return url ? { __paginationUrl: url } : null;
  }

  function isRule34Video() {
    return /(^|\.)rule34video\.com$/i.test(location.hostname);
  }

  function rule34PageFromDataParameters(el) {
    if (!el || !isRule34Video()) return "";
    const raw = el.getAttribute?.("data-parameters") || "";
    const match = raw.match(/(?:^|;)(?:from(?:_[^:;]*)?):0*(\d{1,5})(?:;|$)/i);
    if (!match) return "";
    return String(parseInt(match[1], 10));
  }

  function getRule34AjaxPaginationLinks() {
    if (!isRule34Video()) return [];
    return $$('a[data-action="ajax"][data-parameters]').filter((el) => rule34PageFromDataParameters(el));
  }

  function getRule34VisiblePaginationPage() {
    let best = "";
    let bestBottom = -Infinity;
    for (const el of getRule34AjaxPaginationLinks()) {
      if (!visible(el)) continue;
      const text = (el.textContent || el.innerText || "").trim();
      if (!/^0*\d{1,5}$/.test(text)) continue;
      const page = rule34PageFromDataParameters(el) || numericText(el);
      if (!page) continue;
      const rect = el.getBoundingClientRect();
      if (rect.top >= bestBottom) {
        best = page;
        bestBottom = rect.top;
      }
    }
    return best;
  }

  function findRule34AjaxPageLink(targetPage) {
    targetPage = parseInt(targetPage, 10);
    if (!Number.isFinite(targetPage) || targetPage < 1) return null;
    let fallback = null;
    for (const el of getRule34AjaxPaginationLinks()) {
      const page = parseInt(rule34PageFromDataParameters(el) || "", 10);
      if (page !== targetPage) continue;
      if (visible(el)) return el;
      fallback = fallback || el;
    }
    return fallback;
  }

  function isRule34PaginationContainer(el) {
    if (!el || !isRule34Video()) return false;
    if (rule34PageFromDataParameters(el)) return true;
    return Boolean(el.closest?.('nav, .pagination, .pager, [class*="pagination"], [class*="pager"], [class*="pages"], [class*="page-list"], [class*="pagebar"]'));
  }

  function hasRule34PaginationDom() {
    if ($('.pagination, .pager, [class*="pagination"], [class*="pager"], [class*="pages"], [class*="page-list"], [class*="pagebar"]')) return true;
    return $$('a[href], button, [role="button"], [onclick]').some((el) => isRule34PaginationContainer(el) && numericText(el));
  }

  function getRule34PathPage() {
    const path = location.pathname;

    // /tags/37807/ 里的 37807 是标签 ID，不是页码；真正分页通常是 /tags/37807/2/。
    const nestedPage = path.match(/^\/(?:tags|models|channels|sites|categories|search)\/[^/]+\/0*(\d{1,5})\/?$/i);
    if (nestedPage) return String(parseInt(nestedPage[1], 10));

    // rule34video 的普通列表页常见格式：/latest-updates/9/。
    const listPage = path.match(/^\/(?:latest-updates|top-rated|most-popular|private|premium|albums(?:\/(?:top-rated|most-popular|private|premium)?)?)\/0*(\d{1,5})\/?$/i);
    if (listPage) return String(parseInt(listPage[1], 10));

    // 其他末尾数字只有在页面存在真实分页 DOM 时才可视为页码，避免把 ID 误判成页码。
    const genericPage = path.match(/\/0*(\d{1,5})\/?$/);
    if (genericPage && hasRule34PaginationDom()) return String(parseInt(genericPage[1], 10));
    return "";
  }

  function isRule34AjaxPaginationLink(el) {
    const link = el && (el.tagName === "A" ? el : el.closest?.("a[href]"));
    if (!link || !isRule34Video()) return false;
    if (link.getAttribute("data-action") !== "ajax") return false;
    return isRule34PaginationContainer(link);
  }

  function clickRule34AjaxPagination(link) {
    if (!link) return;
    link.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));
    link.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    link.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    link.click();
    scheduleEventUpdate();
  }

  function isMissAv() {
    return /(^|\.)missav\.[a-z0-9-]+$/i.test(location.hostname);
  }

  function isEporner() {
    return /(^|\.)eporner\.com$/i.test(location.hostname);
  }

  function isFutapo2() {
    return /(^|\.)futapo2\.com$/i.test(location.hostname);
  }

  function isFutapo2SingleCollectionPage() {
    if (!isFutapo2()) return false;
    return /^\/futa-on-futa\/?$/i.test(location.pathname);
  }

  // Discuz! 论坛（含触屏版 mobile=2）：搜索结果 / 版块列表 / 帖子分页。
  // 这些页面的「下一页」DOM 链接在触屏版常是 javascript:; 或缺少 searchid，
  // 直接点会停在原页。改为基于当前 URL 构造翻页地址（保留全部 query 只改 page）。
  function isDiscuz() {
    const path = location.pathname || "";
    if (!/(?:search|forum|home|space|group)\.php$/i.test(path) &&
        !/(?:forum|thread|space|group)-\d+/i.test(path)) {
      return false;
    }
    // 进一步用全局变量 / 典型脚本确认是 Discuz，降低误判。
    try {
      if (typeof window.discuz_uid !== "undefined") return true;
      if (typeof window.STYLEID !== "undefined" || typeof window.SITEURL !== "undefined") return true;
    } catch (_) {}
    // search.php?searchid=... 这类带 Discuz 特征参数的地址也认。
    const search = location.search || "";
    return /[?&](?:searchid|mod|fid|tid|forumlist)=/i.test(search) ||
      /(?:forum|thread|space|group)-\d+/i.test(path);
  }

  // 为 Discuz 构造翻页地址：query 有 page 则改 page；否则 page=1 + 偏移；
  // 静态化地址 thread-TID-PAGE-1.html / forum-FID-PAGE.html 改中间页码段。
  function makeDiscuzPageUrl(targetPage) {
    targetPage = parseInt(targetPage, 10);
    if (!Number.isFinite(targetPage) || targetPage < 1) return "";
    const url = new URL(location.href);
    if (url.searchParams.has("page")) {
      url.searchParams.set("page", String(targetPage));
      return url.href;
    }
    // thread-12345-3-1.html -> thread-12345-4-1.html（中间段是页码）。
    let m = url.pathname.match(/^(.*\/(?:thread|forum)-\d+-)(\d+)(-\d+\.html?)$/i);
    if (m) {
      url.pathname = `${m[1]}${targetPage}${m[3]}`;
      return url.href;
    }
    // forum-12345-3.html -> forum-12345-4.html。
    m = url.pathname.match(/^(.*\/(?:forum|group)-\d+-)(\d+)(\.html?)$/i);
    if (m) {
      url.pathname = `${m[1]}${targetPage}${m[3]}`;
      return url.href;
    }
    // 其余 .php 列表页：直接补 page 参数。
    url.searchParams.set("page", String(targetPage));
    return url.href;
  }

  function getDiscuzCurrentPage() {
    const fromUrl = pageFromUrl();
    if (fromUrl) return fromUrl;
    // thread-12345-3-1.html / forum-12345-3.html 中间段页码。
    let m = location.pathname.match(/^.*\/(?:thread|forum|group)-\d+-(\d+)(?:-\d+)?\.html?$/i);
    if (m) return m[1];
    return "";
  }

  function findDiscuzCandidate(direction) {
    const current = parseInt(getDiscuzCurrentPage() || "1", 10);
    const cur = Number.isFinite(current) ? current : 1;
    const target = cur + (direction === "next" ? 1 : -1);
    if (target < 1) return null;
    // 下一页：需页面存在 Discuz 分页区（.pg/.pgs）或当前不是首页，
    // 避免在单页结果上也亮起“下一页”。
    if (direction === "next") {
      const hasPager = !!$(".pg, .pgs, .pages, [class*=\"pg\"] a");
      const hasNextLink = !!$(".pg .nxt, .pg a.nxt, a.nxt");
      if (!hasPager && !hasNextLink && cur <= 1) return null;
    }
    const url = makeDiscuzPageUrl(target);
    return url ? { __paginationUrl: url } : null;
  }

  function isEpornerVideoPage() {
    return isEporner() && /^\/video-[^/]+\//i.test(location.pathname);
  }

  function getEpornerCurrentPage() {
    if (!isEporner()) return "";
    // eporner 的列表页常见格式：/recommendations/2/，这里的末尾数字就是页码。
    // 只对明确的列表路径启用，避免把视频详情页 ID 误判成页码。
    const match = location.pathname.match(/^\/(?:recommendations|videos|cat|category|search|channels?|pornstars?|albums?|photos?|top-rated|most-viewed|latest|newest)\/(?:[^/]+\/)*0*(\d{1,5})\/?$/i);
    if (match) return String(parseInt(match[1], 10));
    return "";
  }

  function normalizeMissAvPath(pathname = location.pathname) {
    let path = decodeURIComponent(pathname || "");
    // MissAV 常见路径：/cn/genres/...；也有 /dm46/cn/genres/... 这类代理/分区前缀。
    path = path.replace(/^\/(?:dm\d+|dm)(?=\/|$)/i, "");
    path = path.replace(/^\/[a-z]{2}(?=\/|$)/i, "");
    return path || "/";
  }

  function isMissAvSavedPage() {
    if (!isMissAv()) return false;
    try {
      const url = new URL(location.href);
      const path = normalizeMissAvPath(url.pathname || "");
      return /^\/saved(?:\/|$)/i.test(path) || /(?:^|[?#&/])saved(?:[/?#&]|$)/i.test(url.href);
    } catch (_) {
      return /missav\.[a-z0-9-]+\/.*saved/i.test(location.href);
    }
  }

  function isMissAvVideoPath(path) {
    const normalized = normalizeMissAvPath(path);
    // 影片详情页通常是 /abc-123、/abc123 这类番号；列表路径不能被 /dm46 前缀误判。
    return /^\/[a-z]{2,10}-?\d+(?:\/|$)/i.test(normalized);
  }

  function isMissAvPaginationPage() {
    if (!isMissAv()) return false;
    if (isMissAvSavedPage()) return true;
    const url = new URL(location.href);
    const path = normalizeMissAvPath(url.pathname);
    // MissAV 移动端/代理路径可能带语言前缀或 /dm46 前缀，例如：
    // /cn/genres/name、/dm46/cn/genres/name、/dm46/cn/saved。
    if (/^\/(saved|search|genre|genres|series|dm|makers?|actress|actresses|tag|tags|release|today|weekly|monthly|new|uncensored|chinese-subtitle)(?:\/|$)/i.test(path)) return true;
    if (url.searchParams.has("page") && !isMissAvVideoPath(url.pathname)) return true;
    return false;
  }

  function getMissAvCurrentPage() {
    if (!isMissAvPaginationPage()) return "";
    const fromUrl = pageFromUrl();
    if (fromUrl) return fromUrl;
    for (const el of $$('[aria-current="page"], .active, .current, [class*="active"], [class*="current"]')) {
      const n = numericText(el);
      if (n) return n;
    }
    return "1";
  }

  function getMissAvTotalPages() {
    if (!isMissAvPaginationPage()) return NaN;

    // 常见显示：当前页旁边的“/ 3”。优先从完整正文里提取，
    // 避免需要依赖具体 class（MissAV/Tailwind class 经常变化）。
    const bodyText = document.body ? (document.body.innerText || document.body.textContent || "") : "";
    let best = NaN;
    for (const match of bodyText.matchAll(/\/\s*0*(\d{1,5})(?!\d)/g)) {
      const n = parseInt(match[1], 10);
      if (Number.isFinite(n) && n > 0) best = Number.isFinite(best) ? Math.max(best, n) : n;
    }

    // 同时扫描分页区里的数字按钮，作为没有“/ 总页数”时的保底。
    for (const el of $$('nav, .pagination, .pager, [class*="pagination"], [class*="pager"]')) {
      const text = el.innerText || el.textContent || "";
      for (const match of text.matchAll(/\b0*(\d{1,5})\b/g)) {
        const n = parseInt(match[1], 10);
        if (Number.isFinite(n) && n > 0) best = Number.isFinite(best) ? Math.max(best, n) : n;
      }
    }
    return best;
  }

  function hasMissAvDirectionControl(direction) {
    const wordRe = direction === "next" ? /下一[页頁]|下[页頁]|\bnext\b/i : /上一[页頁]|上[页頁]|\bprev(?:ious)?\b/i;
    const arrowRe = direction === "next" ? /^[\s›»→＞>]+$/ : /^[\s‹«←＜<]+$/;
    for (const el of $$('a[href], button, [role="button"], [onclick]')) {
      if (!visible(el) || disabled(el)) continue;
      const text = normalizeText(el);
      if (wordRe.test(text) || arrowRe.test(text)) return true;
    }
    return false;
  }

  function makeMissAvPageUrl(targetPage) {
    if (!isMissAvPaginationPage() || !targetPage || targetPage < 1) return "";
    const url = new URL(location.href);
    url.searchParams.set("page", String(targetPage));
    return url.href;
  }

  function getMissAvSavedCurrentPage() {
    if (!isMissAvSavedPage()) return "";
    const fromUrl = pageFromUrl();
    if (fromUrl) return fromUrl;
    const text = document.body ? (document.body.innerText || document.body.textContent || "") : "";
    const m = text.match(/(?:^|\s)0*(\d{1,5})\s*\/\s*0*\d{1,5}(?:\s|$)/);
    if (m) return String(parseInt(m[1], 10));
    return "1";
  }

  function makeMissAvSavedPageUrl(targetPage) {
    targetPage = parseInt(targetPage, 10);
    if (!isMissAvSavedPage() || !Number.isFinite(targetPage) || targetPage < 1) return "";
    const url = new URL(location.href);
    url.pathname = url.pathname.replace(/\/+$/g, "") || "/saved";
    url.searchParams.set("page", String(targetPage));
    return url.href;
  }

  function findMissAvSavedCandidate(direction) {
    if (!isMissAvSavedPage()) return null;
    const current = parseInt(getMissAvSavedCurrentPage() || "1", 10);
    const target = current + (direction === "next" ? 1 : -1);
    if (!Number.isFinite(target) || target < 1) return null;

    const total = getMissAvTotalPages();
    if (direction === "next" && Number.isFinite(total) && total > 0 && current >= total) return null;

    // 先用真实“上一頁/下一頁”按钮；没有 href 或识别不到时再构造 URL。
    const wordRe = direction === "next" ? /下一[页頁]|下[页頁]|\bnext\b/i : /上一[页頁]|上[页頁]|\bprev(?:ious)?\b/i;
    for (const el of $$('a[href], button, [role="button"], [onclick]')) {
      if (!visible(el) || disabled(el)) continue;
      if (wordRe.test(normalizeText(el))) return el;
    }

    if (direction === "next" && Number.isFinite(total) && target > total) return null;
    const url = makeMissAvSavedPageUrl(target);
    return url ? { __paginationUrl: url } : null;
  }

  function findMissAvCandidate(direction) {
    if (isMissAvSavedPage()) return findMissAvSavedCandidate(direction);
    if (!isMissAvPaginationPage()) return null;

    const current = parseInt(getMissAvCurrentPage() || "1", 10);
    const target = current + (direction === "next" ? 1 : -1);
    if (target < 1) return null;

    const total = getMissAvTotalPages();
    if (direction === "next" && Number.isFinite(total) && total > 0 && current >= total) return null;

    // 优先点击页面中真实的相邻页按钮。
    for (const el of $$('a[href], button, [role="button"], [onclick]')) {
      if (!visible(el) || disabled(el)) continue;
      const n = parseInt(elementPageNumber(el) || "", 10);
      if (n === target) return el;
    }

    // /saved 等页面的“下一页”按钮有时没有可解析页码，但页面会显示“1 / 3”。
    // 只要总页数证明存在相邻页，直接构造 URL，避免被 DOM 结构变化影响。
    if (direction === "next") {
      if ((Number.isFinite(total) && target <= total) || hasMissAvDirectionControl(direction)) {
        const url = makeMissAvPageUrl(target);
        return url ? { __paginationUrl: url } : null;
      }
      return null;
    }

    const url = makeMissAvPageUrl(target);
    return url ? { __paginationUrl: url } : null;
  }

  function numericText(el) {
    const text = (el && (el.value || el.textContent || el.innerText || "")).trim();
    const dataPage = isRule34Video() ? rule34PageFromDataParameters(el) : "";
    if (dataPage) return dataPage;
    const match = text.match(/^0*(\d{1,5})$/);
    return match ? String(parseInt(match[1], 10)) : "";
  }

  function getRule34CurrentPage() {
    const fromUrl = pageFromUrl();
    if (fromUrl) return fromUrl;

    const ajaxPage = getRule34VisiblePaginationPage();
    if (ajaxPage) return ajaxPage;

    // AJAX 翻页后地址栏可能不变，优先读取底部分页当前按钮（红色数字）。
    const activeSelectors = [
      ".pagination .active",
      ".pagination .current",
      ".page-link.active",
      ".page-item.active",
      "[class*=pagination] [class*=active]",
      "[class*=pagination] [class*=current]",
      "[aria-current=page]",
    ];
    for (const el of $$(activeSelectors.join(","))) {
      const n = numericText(el);
      if (n) return n;
    }

    // rule34video 的列表页常见格式：/latest-updates/9/；/tags/37807/ 这类末尾数字是 ID，不是页码。
    const pathPage = getRule34PathPage();
    if (pathPage) return pathPage;

    // rule34video 顶部标题通常是：Newest (...) Page 8
    const headingText = $$('h1, h2, .headline, .page-title, [class*="title"], [class*="heading"]')
      .map((el) => el.textContent || "")
      .join("\n");
    const headingMatch = headingText.match(/\bPage\s*0*(\d+)\b/i);
    if (headingMatch) return String(parseInt(headingMatch[1], 10));

    // 底部分页当前按钮通常是红色数字，例如 08；前面已优先读取，这里不再重复。

    const bodyText = document.body ? document.body.innerText.slice(0, 5000) : "";
    const bodyMatch = bodyText.match(/\bPage\s*0*(\d+)\b/i);
    if (bodyMatch) return String(parseInt(bodyMatch[1], 10));
    return "";
  }

  function makePageUrl(targetPage) {
    if (!targetPage || targetPage < 1) return "";
    const url = new URL(location.href);
    const existingKey = ["page", "p", "paged", "pg", "pn", "pageNo", "pageNumber"].find((key) => url.searchParams.has(key));
    if (existingKey) {
      url.searchParams.set(existingKey, String(targetPage));
      if (isXVideos()) url.hash = "_tabVideos";
      return url.href;
    }
    // NodeSeek 帖子分页：/post-174345-3 -> /post-174345-4。
    if (isNodeSeek() && /^\/post-\d+-\d+\/?$/i.test(url.pathname)) {
      url.pathname = url.pathname.replace(/^(\/post-\d+-)\d+(\/?$)/i, `$1${targetPage}$2`);
      return url.href;
    }

    // 支持 /latest-updates/9/、/category/name/2/ 这类末尾数字页码。
    if (/\/\d+\/?$/i.test(url.pathname)) {
      url.pathname = url.pathname.replace(/\/\d+\/?$/i, `/${targetPage}/`);
      return url.href;
    }
    if (/\/(?:page|p|pg|list)[/-]?\d+(?:\/|$|\.html?$)/i.test(url.pathname)) {
      url.pathname = url.pathname.replace(/((?:page|p|pg|list)[/-]?)(\d+)(?=\/|$|\.html?$)/i, `$1${targetPage}`);
      return url.href;
    }
    // rule34video 的列表页常见格式是 /latest-updates/9/，当前 URL 没页码时第一页可构造为 /latest-updates/2/。
    if (isRule34Video()) {
      const basePath = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
      url.pathname = `${basePath}${targetPage}/`.replace(/\/+/g, "/");
      return url.href;
    }
    return "";
  }

  function replacePageNumberInUrl(urlLike, oldPage, targetPage) {
    if (!urlLike || !oldPage || !targetPage) return "";
    try {
      const url = new URL(urlLike, location.href);
      const keys = ["page", "p", "paged", "pg", "pn", "pageNo", "pageNumber"];
      for (const key of keys) {
        if (url.searchParams.get(key) === String(oldPage)) {
          url.searchParams.set(key, String(targetPage));
          if (isXVideos()) url.hash = `_tabVideos,page-${targetPage}`;
          return url.href;
        }
      }
      if (isNodeSeek() && /^\/post-\d+-\d+\/?$/i.test(url.pathname)) {
        url.pathname = url.pathname.replace(/^(\/post-\d+-)\d+(\/?$)/i, `$1${targetPage}$2`);
        return url.href;
      }

      const oldEscaped = String(oldPage).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`(^|/)0*${oldEscaped}(/?$|(?=\\.html?$))`);
      if (re.test(url.pathname)) {
        url.pathname = url.pathname.replace(re, `$1${targetPage}$2`);
        return url.href;
      }
    } catch (_) {}
    return "";
  }

  function makeJumpPageUrl(targetPage) {
    targetPage = parseInt(targetPage, 10);
    if (!Number.isFinite(targetPage) || targetPage < 1) return "";

    if (isMissAvPaginationPage()) return makeMissAvPageUrl(targetPage);
    if (isJable()) return makeJablePageUrl(targetPage);
    if (isXVideos()) return makeXVideosPageUrl(targetPage);

    if (isNodeSeek()) return makeNodeSeekPageUrl(targetPage);
    if (isWhosTv()) return makeWhosTvPageUrl(targetPage);

    if (isRule34Video()) {
      const ajaxLink = findRule34AjaxPageLink(targetPage);
      if (ajaxLink) return { __paginationElement: ajaxLink };
    }

    const direct = makePageUrl(targetPage);
    if (direct) return direct;

    const current = parseInt(STATE.currentPage || getCurrentPage() || "", 10);
    if (Number.isFinite(current) && current > 0) {
      const currentUrl = replacePageNumberInUrl(location.href, current, targetPage);
      if (currentUrl) return currentUrl;
    }

    for (const candidate of [STATE.next, STATE.prev]) {
      const href = candidate?.href || candidate?.getAttribute?.("href") || candidate?.__paginationUrl || "";
      const n = parseInt(elementPageNumber(candidate) || "", 10);
      const url = replacePageNumberInUrl(href, n, targetPage);
      if (url) return url;
    }

    // 兜底：列表页常见 page 参数跳转。详情页没有翻页菜单，通常不会走到这里。
    const url = new URL(location.href);
    url.searchParams.set("page", String(targetPage));
    return url.href;
  }

  function promptJumpPage() {
    if ($(`#${SCRIPT_ID}-jump-mask`)) return;

    const current = /^\d+$/.test(String(STATE.currentPage || "")) ? STATE.currentPage : "1";
    const mask = document.createElement("div");
    mask.id = `${SCRIPT_ID}-jump-mask`;
    mask.innerHTML = `
      <div class="jump-card" role="dialog" aria-modal="true">
        <div class="jump-title">跳转页码</div>
        <input class="jump-input" type="number" min="1" inputmode="numeric" pattern="[0-9]*" value="${current}" autofocus />
        <div class="jump-actions">
          <button class="jump-cancel" type="button">取消</button>
          <button class="jump-ok" type="button">跳转</button>
        </div>
      </div>
    `;
    document.documentElement.appendChild(mask);

    const input = mask.querySelector(".jump-input");
    const focusInput = () => {
      try { input.focus({ preventScroll: true }); }
      catch (_) { input.focus(); }
      try { input.select(); } catch (_) {}
    };
    const close = () => mask.remove();
    const submit = () => {
      const target = parseInt(String(input.value || "").trim(), 10);
      if (!Number.isFinite(target) || target < 1) {
        focusInput();
        return;
      }
      const pageAction = makeJumpPageUrl(target);
      if (typeof pageAction === "string" && pageAction) hardNavigate(pageAction);
      else if (pageAction?.__paginationElement) clickOrNavigate(pageAction.__paginationElement);
      else close();
    };

    mask.addEventListener("click", (e) => {
      if (e.target === mask) close();
    });
    mask.querySelector(".jump-cancel").addEventListener("click", close);
    mask.querySelector(".jump-ok").addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
      if (e.key === "Escape") close();
    });

    // iOS Safari 只有在用户点击事件链里 focus，才更可能自动唤醒输入法；
    // 这里立即 focus，并在下一帧/短延迟补焦点，兼顾弹窗刚插入 DOM 的情况。
    focusInput();
    requestAnimationFrame(focusInput);
    setTimeout(focusInput, 50);
    setTimeout(focusInput, 250);
  }

  function elementPageNumber(el) {
    if (!el) return "";
    const href = el.href || el.getAttribute?.("href") || "";
    const fromData = isRule34Video() ? rule34PageFromDataParameters(el) : "";
    if (fromData) return fromData;
    const fromHref = href ? pageFromUrl(href) : "";
    if (fromHref) return fromHref;

    // 很多站点分类页第一页没有页码，下一页链接是 /category/name/2/ 或 /page/2/。
    // 只在分页区域内解析 URL 末尾数字，避免把视频 ID 误判成页码。
    const inPager = isRule34Video()
      ? isRule34PaginationContainer(el)
      : el.closest?.('nav, .pagination, .pager, [class*="pagination"], [class*="pager"], [class*="pages"], [class*="page-numbers"]');
    if (href && inPager) {
      try {
        const url = new URL(href, location.href);
        if (url.origin === location.origin) {
          const match = url.pathname.match(/(?:\/page)?\/0*(\d{1,5})\/?$/i);
          if (match) return String(parseInt(match[1], 10));
        }
      } catch (_) {}
    }

    return numericText(el);
  }

  function inferCurrentPageFromAdjacent(prev, next) {
    const nextPage = parseInt(elementPageNumber(next) || "", 10);
    if (Number.isFinite(nextPage) && nextPage > 1) return String(nextPage - 1);

    const prevPage = parseInt(elementPageNumber(prev) || "", 10);
    if (Number.isFinite(prevPage) && prevPage >= 1) return String(prevPage + 1);

    // 分页区只有下一页/右箭头，且 URL 无页码时，通常就是第 1 页。
    if (next && !pageFromUrl()) return "1";
    return "";
  }

  function findRule34Candidate(direction) {
    const current = parseInt(getRule34CurrentPage() || pageFromUrl() || "", 10);
    const target = Number.isFinite(current) ? current + (direction === "next" ? 1 : -1) : NaN;

    if (target >= 1) {
      const ajaxLink = findRule34AjaxPageLink(target);
      if (ajaxLink) return ajaxLink;

      for (const el of $$('a[href], button, [role="button"], [onclick]')) {
        if (!visible(el) || disabled(el)) continue;
        const n = parseInt(elementPageNumber(el) || "", 10);
        if (n === target) return el;
      }

      // rule34video 上一页/下一页按钮有时会被识别成站点内部错误链接。
      // 先找真实分页 DOM；找不到时才对 /latest-updates/9/ 这类页面构造 URL。
      if (getRule34PathPage()) {
        const url = makePageUrl(target);
        if (url) return { __paginationUrl: url };
      }
    }

    // 识别底部分页两侧的纯箭头按钮。
    const arrowRe = direction === "next" ? /^[\s›»→＞>]+$/ : /^[\s‹«←＜<]+$/;
    const wordRe = direction === "next" ? /\bnext\b|下一页|下页/i : /\bprev\b|\bprevious\b|上一页|上页/i;
    let best = null;
    let bestScore = 0;
    for (const el of $$('a[href], button, [role="button"], [onclick]')) {
      if (!visible(el) || disabled(el)) continue;
      const text = normalizeText(el);
      let score = 0;
      if (arrowRe.test(text)) score += 80;
      if (wordRe.test(text)) score += 80;
      if (rule34PageFromDataParameters(el)) {
        const page = parseInt(rule34PageFromDataParameters(el) || "", 10);
        const targetPage = Number.isFinite(target) ? target : NaN;
        if (Number.isFinite(targetPage) && page !== targetPage) score -= 100;
        else score += 80;
      }
      if (isRule34PaginationContainer(el)) score += 40;
      else if (el.closest('nav, .pagination, .pager, [class*="pagination"], [class*="pager"], [class*="pages"]')) score += 40;
      const rect = el.getBoundingClientRect();
      if (rect.top > innerHeight * 0.45) score += 10;
      if (score > bestScore) {
        best = el;
        bestScore = score;
      }
    }
    if (bestScore >= 70) return best;

    // 如果页面没有真实链接但 URL 可构造，返回一个虚拟跳转对象。
    const url = target >= 1 ? makePageUrl(target) : "";
    return url ? { __paginationUrl: url } : null;
  }

  function getCurrentPage() {
    if (isMissAv()) {
      const sitePage = getMissAvCurrentPage();
      if (sitePage) return sitePage;
    }

    if (isJable()) {
      const sitePage = getJableCurrentPage();
      if (sitePage) return sitePage;
    }

    if (isRule34Video()) {
      const sitePage = getRule34CurrentPage();
      if (sitePage) return sitePage;
    }

    if (isEporner()) {
      const sitePage = getEpornerCurrentPage();
      if (sitePage) return sitePage;
    }

    if (isDiscuz()) {
      const sitePage = getDiscuzCurrentPage();
      if (sitePage) return sitePage;
    }

    if (isNodeSeek()) {
      const sitePage = getNodeSeekCurrentPage();
      if (sitePage) return sitePage;
    }

    if (isWhosTv()) {
      const sitePage = getWhosTvCurrentPage();
      if (sitePage) return sitePage;
    }

    const fromUrl = pageFromUrl();
    if (fromUrl) return fromUrl;

    const selectors = [
      ".pagination .active",
      ".pagination .current",
      ".pager .active",
      ".pager .current",
      "nav .active",
      "nav .current",
      ".page-numbers.current",
      ".page-numbers.active",
      "[aria-current=page]",
      "[class*=pagination] [class*=active]",
      "[class*=pagination] [class*=current]",
      "[class*=pager] [class*=active]",
      "[class*=pager] [class*=current]",
      "input[type=number]",
      "input[aria-label*=页]",
      "input[aria-label*=\"page\" i]",
    ];

    for (const el of $$(selectors.join(","))) {
      const value = (el.value || el.textContent || el.innerText || "").trim();
      const match = value.match(/\d+/);
      if (match) return match[0];
    }

    const bodyText = document.body ? document.body.innerText.slice(0, 3000) : "";
    const match = bodyText.match(/(?:第|page\s*)\s*(\d+)\s*(?:页|\/|of)?/i);
    if (match) return match[1];
    return "?";
  }

  function hardNavigate(url) {
    if (!url || STATE.navigating) return;
    STATE.navigating = true;
    try {
      const box = $(`#${SCRIPT_ID}`);
      if (box) {
        box.querySelectorAll("button").forEach((button) => (button.disabled = true));
        box.style.opacity = "0.72";
      }
    } catch (_) {}

    const target = new URL(url, location.href).href;
    // 用 assign 强制整页导航；部分站点/移动 Safari 下直接改 location.href 可能只改历史状态。
    window.location.assign(target);

    // 如果站点脚本拦截导致 0.8 秒后仍停在原文档，强制刷新目标地址。
    setTimeout(() => {
      if (location.href !== target) {
        window.location.href = target;
      } else {
        window.location.reload();
      }
    }, 800);
  }

  async function closeCurrentTab() {
    if (STATE.navigating) return;
    STATE.navigating = true;
    try {
      const box = $(`#${SCRIPT_ID}`);
      if (box) {
        box.querySelectorAll("button").forEach((button) => (button.disabled = true));
        box.style.opacity = "0.72";
      }
      const current = await Scripting.tabs.getCurrent();
      if (!Number.isInteger(current?.id)) throw new Error("无法获取当前标签页 ID");
      await GM.closeTab(current.id);
    } catch (error) {
      STATE.navigating = false;
      const box = $(`#${SCRIPT_ID}`);
      if (box) {
        box.style.opacity = "";
        updateMenu();
      }
      log("关闭当前标签页失败", error);
    }
  }

  function reloadPage() {
    if (STATE.navigating) return;
    STATE.navigating = true;
    try {
      const box = $(`#${SCRIPT_ID}`);
      if (box) {
        box.querySelectorAll("button").forEach((button) => (button.disabled = true));
        box.style.opacity = "0.72";
      }
    } catch (_) {}
    location.reload();
    setTimeout(() => {
      window.location.href = location.href;
    }, 800);
  }

  function bindActionButton(button, action) {
    if (!button) return;
    let lastRun = 0;
    const run = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      const now = Date.now();
      if (now - lastRun < 450) return;
      lastRun = now;
      action();
    };
    button.addEventListener("pointerup", run, { passive: false });
    button.addEventListener("touchend", run, { passive: false });
    button.addEventListener("click", run, { passive: false });
  }

  function navigateDirection(direction) {
    if (STATE.navigating) return;
    // 点击时重新识别一次。这样异步渲染或局部替换分页 DOM 的网站无需常驻观察整页，
    // 仍能在真正翻页前拿到最新且仍连接在文档中的按钮。
    const candidate = findCandidate(direction);
    STATE[direction] = candidate;
    if (candidate) {
      clickOrNavigate(candidate);
      return;
    }
    scheduleUpdate(0);
  }

  function clickOrNavigate(el) {
    if (!el || STATE.navigating) return;
    if (el.__paginationElement) {
      clickOrNavigate(el.__paginationElement);
      return;
    }
    if (el.__paginationUrl) {
      hardNavigate(el.__paginationUrl);
      return;
    }
    const link = el.tagName === "A" || el.tagName === "LINK" ? el : el.closest("a[href]");
    if (isRule34AjaxPaginationLink(link)) {
      clickRule34AjaxPagination(link);
      return;
    }
    if (link && link.href) {
      hardNavigate(link.href);
      return;
    }
    el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    el.click();
  }

  function getViewportBox() {
    const vv = window.visualViewport;
    // fixed 元素的 left/top 是相对布局视口的；iPhone Safari 地址栏展开/收起、
    // 刷新加载中、底部地址栏浮起时，visualViewport.height 会临时变小。
    // 如果用这个临时高度去校正已保存位置，刷新后悬浮窗就会被向上挤。
    // 所以宽高取 visualViewport / layout viewport / innerWidth-Height 中较大的值，
    // 只用于防止真正出屏，不让浏览器工具栏的临时变化改写显示位置。
    const layoutWidth = document.documentElement.clientWidth || innerWidth || 0;
    const layoutHeight = document.documentElement.clientHeight || innerHeight || 0;
    return {
      width: Math.max(1, Math.floor(vv?.width || 0), Math.floor(layoutWidth), Math.floor(innerWidth || 0)),
      height: Math.max(1, Math.floor(vv?.height || 0), Math.floor(layoutHeight), Math.floor(innerHeight || 0)),
    };
  }

  function isXsijisheSignPage() {
    return /(^|\.)xsijishe\.com$/i.test(location.hostname) && /\/k_misign-sign\.html$/i.test(location.pathname);
  }

  function isNodeSeek() {
    return /(^|\.)nodeseek\.com$/i.test(location.hostname);
  }

  function getNodeSeekCurrentPage() {
    if (!isNodeSeek()) return "";
    const fromUrl = pageFromUrl();
    if (fromUrl) return fromUrl;
    for (const el of $$('a[href^="/page-"], a[href*="/page-"]')) {
      const text = (el.textContent || el.innerText || "").trim();
      if (/^1$/.test(text) && visible(el)) return "1";
    }
    return "1";
  }

  function makeNodeSeekPageUrl(targetPage) {
    targetPage = parseInt(targetPage, 10);
    if (!isNodeSeek() || !Number.isFinite(targetPage) || targetPage < 1) return "";
    const url = new URL(location.href);
    if (/^\/page-\d+\/?$/i.test(url.pathname)) {
      url.pathname = `/page-${targetPage}`;
      url.search = "";
      url.hash = "";
      return url.href;
    }
    if (/^\/categories\/[^/]+(?:\/page-\d+)?\/?$/i.test(url.pathname)) {
      const base = url.pathname.replace(/\/page-\d+\/?$/i, "").replace(/\/+$/g, "");
      url.pathname = targetPage <= 1 ? base : `${base}/page-${targetPage}`;
      url.hash = "";
      return url.href;
    }
    return "";
  }

  function findNodeSeekPageLink(targetPage) {
    targetPage = parseInt(targetPage, 10);
    if (!isNodeSeek() || !Number.isFinite(targetPage) || targetPage < 1) return null;
    for (const el of $$('a[href]')) {
      if (!visible(el) || disabled(el)) continue;
      const page = parseInt(elementPageNumber(el) || "", 10);
      if (page === targetPage) return el;
    }
    return null;
  }

  function findNodeSeekCandidate(direction) {
    if (!isNodeSeek()) return null;
    const current = parseInt(getNodeSeekCurrentPage() || "1", 10);
    const target = current + (direction === "next" ? 1 : -1);
    if (!Number.isFinite(target) || target < 1) return null;

    const link = findNodeSeekPageLink(target);
    if (link) return link;

    const url = makeNodeSeekPageUrl(target);
    return url ? { __paginationUrl: url } : null;
  }

  function isWhosTv() {
    return /(^|\.)whos\.tv$/i.test(location.hostname);
  }

  function isWhosTvFramesListPage() {
    if (!isWhosTv()) return false;
    return /^\/frames\/(?:type-[^/]+|tags|tag-[^/]+|label-\d+)(?:\/[^/]+)*(?:\/page-\d+)?\/?$/i.test(location.pathname);
  }

  function getWhosTvCurrentPage() {
    if (!isWhosTvFramesListPage()) return "";
    const match = location.pathname.match(/\/page-0*(\d{1,5})\/?$/i);
    return match ? String(parseInt(match[1], 10)) : "1";
  }

  function makeWhosTvPageUrl(targetPage) {
    targetPage = parseInt(targetPage, 10);
    if (!isWhosTvFramesListPage() || !Number.isFinite(targetPage) || targetPage < 1) return "";
    const url = new URL(location.href);
    const base = url.pathname.replace(/\/page-\d+\/?$/i, "").replace(/\/+$/g, "");
    url.pathname = targetPage <= 1 ? base : `${base}/page-${targetPage}`;
    url.search = "";
    url.hash = "";
    return url.href;
  }

  function findWhosTvPageLink(targetPage) {
    targetPage = parseInt(targetPage, 10);
    if (!isWhosTvFramesListPage() || !Number.isFinite(targetPage) || targetPage < 1) return null;
    for (const el of $$('a[href]')) {
      if (!visible(el) || disabled(el)) continue;
      const href = el.getAttribute("href") || "";
      if (!/\/frames\//i.test(href) || !/\/page-\d+/i.test(href)) continue;
      const page = parseInt(pageFromUrl(el.href) || elementPageNumber(el) || "", 10);
      if (page === targetPage) return el;
    }
    return null;
  }

  function findWhosTvCandidate(direction) {
    if (!isWhosTvFramesListPage()) return null;
    const current = parseInt(getWhosTvCurrentPage() || "1", 10);
    const target = current + (direction === "next" ? 1 : -1);
    if (!Number.isFinite(target) || target < 1) return null;

    const link = findWhosTvPageLink(target);
    if (link) return link;

    const url = makeWhosTvPageUrl(target);
    return url ? { __paginationUrl: url } : null;
  }

  function shouldForceRightBottomPosition() {
    // 司姬社签到页是桌面版页面被手机缩放显示，普通 fixed/right 定位会跑到页面中间。
    // 其他网页只保持“初始默认位置”和新标签页打开按钮一致；如果用户拖动保存位置，仍使用自己的保存位置，
    // 不跟随新标签页打开按钮后续移动。
    return isXsijisheSignPage();
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

  function getDefaultBottomGap() {
    return SAFE_BOTTOM_GAP + (isNodeSeek() ? NODESEEK_BOTTOM_EXTRA : 0);
  }

  function applyDefaultMenuPosition(box) {
    if (!box) return;
    // 用 CSS right/bottom 锚定贴边，而不是换算成绝对 top/left。
    // iOS Safari 地址栏伸缩时，固定元素的 bottom 会自动停在可见底边之上；
    // 而早先用 viewport.height 换算 top 会因地址栏状态取到偏大的布局视口高度，
    // 导致按钮被顶到屏幕中间（nodeseek / iplark 等长页面尤其明显）。
    box.style.right = `${DEFAULT_RIGHT_GAP}px`;
    box.style.bottom = `${getDefaultBottomGap()}px`;
    box.style.left = "auto";
    box.style.top = "auto";
  }

  function applySavedMenuPosition(box) {
    if (!box || !STATE.savedPosition) return false;
    const pos = clampSavedMenuPosition(STATE.savedPosition.left, STATE.savedPosition.top, box);
    STATE.savedPosition = pos;
    box.style.left = `${pos.left}px`;
    box.style.top = `${pos.top}px`;
    box.style.right = "auto";
    box.style.bottom = "auto";
    return true;
  }

  function clampSavedMenuPosition(left, top, box) {
    const viewport = getViewportBox();
    const width = Math.max(box?.offsetWidth || 0, 34);
    const height = Math.max(box?.offsetHeight || 0, 34);
    return {
      left: Math.max(0, Math.min(left, viewport.width - width)),
      top: Math.max(0, Math.min(top, viewport.height - height - SAFE_BOTTOM_GAP)),
    };
  }

  function addStyles() {
    if ($(`#${SCRIPT_ID}-style`)) return;
    const style = document.createElement("style");
    style.id = `${SCRIPT_ID}-style`;
    style.textContent = `
      #${SCRIPT_ID} {
        --upfm-text: rgba(28,28,30,.82);
        --upfm-bg: rgba(242, 242, 247, .92);
        --upfm-border: rgba(255,255,255,.12);
        --upfm-separator: rgba(255,255,255,.11);
        --upfm-active: rgba(229,229,234,.96);
        --upfm-page-active: rgba(255,255,255,.10);
        --upfm-shadow: rgba(0,0,0,.50);
        color-scheme: light dark;
        box-sizing: border-box;
        position: fixed;
        right: ${DEFAULT_RIGHT_GAP}px;
        bottom: ${getDefaultBottomGap()}px;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        gap: 0;
        color: var(--upfm-text);
        font: 600 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: var(--upfm-bg);
        border: 0;
        border-radius: 999px;
        box-shadow: inset 0 0 0 .5px rgba(60,60,67,.16);
        filter: none;
        backdrop-filter: blur(10px) saturate(140%);
        -webkit-backdrop-filter: blur(10px) saturate(140%);
        overflow: hidden;
        user-select: none;
        touch-action: manipulation;
      }
      @media (prefers-color-scheme: dark) {
        #${SCRIPT_ID} {
          --upfm-text: rgba(255,255,255,.94);
          --upfm-bg: rgba(44,44,46,.82);
          --upfm-active: rgba(58,58,60,.92);
        }
      }
      @media (prefers-color-scheme: dark) {
        #${SCRIPT_ID} {
          /* qiqi-auto-dark-mode */
          --upfm-text: rgba(255,255,255,.94);
          --upfm-bg: rgba(44,44,46,.82);
          --upfm-active: rgba(58,58,60,.92);
          box-shadow: inset 0 0 0 .5px rgba(255,255,255,.16);
        }
      }
      #${SCRIPT_ID}[data-hidden="true"] { display: none; }
      #${SCRIPT_ID}[data-pagination="false"] {
        width: ${PAGER_ITEM_SIZE * 2}px;
        height: ${PAGER_ITEM_SIZE}px;
        border-radius: 999px;
        justify-content: center;
      }
      #${SCRIPT_ID}[data-pagination="false"] .pager-item { display: none; }
      #${SCRIPT_ID}[data-pagination="false"] .close-tab,
      #${SCRIPT_ID}[data-pagination="false"] .refresh {
        width: ${PAGER_ITEM_SIZE}px;
        min-width: ${PAGER_ITEM_SIZE}px;
        height: 100%;
        padding: 0;
      }
      #${SCRIPT_ID} button, #${SCRIPT_ID} .page {
        box-sizing: border-box;
        position: relative;
        height: ${PAGER_ITEM_SIZE}px;
        min-width: ${PAGER_ITEM_SIZE}px;
        border: 0;
        margin: 0;
        padding: 0;
        color: inherit;
        background: transparent;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      #${SCRIPT_ID} button {
        cursor: pointer;
        font-size: 16px;
        -webkit-tap-highlight-color: transparent;
        transition: background .18s ease, transform .12s ease, opacity .18s ease;
      }
      #${SCRIPT_ID} button svg {
        width: 19px;
        height: 19px;
        display: block;
        pointer-events: none;
      }
      #${SCRIPT_ID} button:active {
        background: var(--upfm-active);
        transform: scale(.94);
      }
      #${SCRIPT_ID} button[disabled] { opacity: .28; cursor: default; transform: none; }
      #${SCRIPT_ID} button[disabled]:active { background: transparent; }
      #${SCRIPT_ID} .close-tab { color: #ff3b30; }
      @media (prefers-color-scheme: dark) {
        #${SCRIPT_ID} .close-tab { color: #ff453a; }
      }
      #${SCRIPT_ID} .close-tab::after {
        content: "";
        position: absolute;
        top: 7px;
        right: 0;
        bottom: 7px;
        width: 1px;
        background: var(--upfm-separator);
        pointer-events: none;
      }
      #${SCRIPT_ID} .refresh svg {
        width: ${REFRESH_ICON_SIZE}px;
        height: ${REFRESH_ICON_SIZE}px;
        display: block;
        stroke: currentColor;
        stroke-width: 2.35;
        stroke-linecap: round;
        stroke-linejoin: round;
        fill: none;
      }
      #${SCRIPT_ID} .prev::before,
      #${SCRIPT_ID} .page::before,
      #${SCRIPT_ID} .page::after {
        content: "";
        position: absolute;
        top: 7px;
        bottom: 7px;
        width: 1px;
        background: var(--upfm-separator);
        pointer-events: none;
      }
      #${SCRIPT_ID} .prev::before { left: 0; }
      #${SCRIPT_ID} .page::before { left: 0; }
      #${SCRIPT_ID} .page::after { right: 0; }
      #${SCRIPT_ID} .page {
        min-width: ${PAGE_MIN_WIDTH}px;
        cursor: grab;
        font-size: 11px;
        font-weight: 600;
        opacity: .78;
        letter-spacing: .02em;
        touch-action: none;
        transition: background .18s ease, opacity .18s ease;
      }
      #${SCRIPT_ID} .page:active { background: var(--upfm-page-active); opacity: 1; }
      #${SCRIPT_ID}-jump-mask {
        --upfm-dialog-text: #fff;
        --upfm-dialog-bg: rgba(28,28,30,.96);
        --upfm-dialog-border: rgba(255,255,255,.16);
        --upfm-dialog-input-bg: rgba(255,255,255,.10);
        --upfm-dialog-input-border: rgba(255,255,255,.22);
        --upfm-dialog-button-bg: rgba(255,255,255,.14);
        --upfm-dialog-shadow: rgba(0,0,0,.38);
        --upfm-mask-bg: rgba(0,0,0,.28);
        color-scheme: light dark;
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--upfm-mask-bg);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      @media (prefers-color-scheme: light) {
        #${SCRIPT_ID}-jump-mask {
          --upfm-dialog-text: #111;
          --upfm-dialog-bg: rgba(255,255,255,.96);
          --upfm-dialog-border: rgba(0,0,0,.14);
          --upfm-dialog-input-bg: rgba(0,0,0,.06);
          --upfm-dialog-input-border: rgba(0,0,0,.18);
          --upfm-dialog-button-bg: rgba(0,0,0,.08);
          --upfm-dialog-shadow: rgba(0,0,0,.18);
          --upfm-mask-bg: rgba(255,255,255,.22);
        }
      }
      #${SCRIPT_ID}-jump-mask .jump-card {
        width: min(280px, calc(100vw - 48px));
        padding: 18px;
        border-radius: 18px;
        color: var(--upfm-dialog-text);
        background: var(--upfm-dialog-bg);
        box-shadow: 0 12px 40px var(--upfm-dialog-shadow);
        border: 1px solid var(--upfm-dialog-border);
      }
      #${SCRIPT_ID}-jump-mask .jump-title {
        margin-bottom: 12px;
        font-size: 16px;
        font-weight: 700;
        text-align: center;
      }
      #${SCRIPT_ID}-jump-mask .jump-input {
        box-sizing: border-box;
        width: 100%;
        height: 44px;
        border: 1px solid var(--upfm-dialog-input-border);
        border-radius: 12px;
        padding: 0 12px;
        color: var(--upfm-dialog-text);
        background: var(--upfm-dialog-input-bg);
        font-size: 20px;
        text-align: center;
        outline: none;
      }
      #${SCRIPT_ID}-jump-mask .jump-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
        margin-top: 14px;
      }
      #${SCRIPT_ID}-jump-mask button {
        height: 40px;
        border: 0;
        border-radius: 12px;
        color: var(--upfm-dialog-text);
        background: var(--upfm-dialog-button-bg);
        font-size: 16px;
        font-weight: 600;
      }
      #${SCRIPT_ID}-jump-mask .jump-ok { background: #0a84ff; }
      #${SCRIPT_ID}.dragging .page { cursor: grabbing; }
    `;
    document.documentElement.appendChild(style);
  }

  function createMenu() {
    addStyles();
    let box = $(`#${SCRIPT_ID}`);
    if (box) return box;

    box = document.createElement("div");
    box.id = SCRIPT_ID;
    box.dataset.hidden = "false";
    box.dataset.pagination = "false";
    box.innerHTML = `
      <button class="close-tab" type="button" title="关闭当前标签页" aria-label="关闭当前标签页">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18"></path></svg>
      </button>
      <button class="refresh" type="button" title="刷新页面" aria-label="刷新页面">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M19.2 5.2v5.2h-5.2" />
          <path d="M18.8 10.4a7.1 7.1 0 1 0-1.9 6.5" />
        </svg>
      </button>
      <button class="prev pager-item" type="button" title="上一页"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M15 18l-6-6 6-6"></path></svg></button>
      <div class="page pager-item" title="点击选择页码，按住拖动位置（复原请用扩展菜单）"><span>?</span></div>
      <button class="next pager-item" type="button" title="下一页"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 18l6-6-6-6"></path></svg></button>
    `;
    isolateFloatingUi(box);
    document.documentElement.appendChild(box);
    applyDefaultMenuPosition(box);

    bindActionButton(box.querySelector(".prev"), () => navigateDirection("prev"));
    bindActionButton(box.querySelector(".next"), () => navigateDirection("next"));
    bindActionButton(box.querySelector(".close-tab"), closeCurrentTab);
    bindActionButton(box.querySelector(".refresh"), reloadPage);
    setupPageControl(box, box.querySelector(".page"));

    if (shouldForceRightBottomPosition()) {
      STATE.savedPosition = null;
      requestAnimationFrame(() => {
        if (box.isConnected && document.getElementById(SCRIPT_ID) === box && !STATE.dragging) applyDefaultMenuPosition(box);
      });
    } else {
      const positionRevision = STATE.positionRevision;
      gmGet(POS_KEY, null).then((pos) => {
        if (!box.isConnected || document.getElementById(SCRIPT_ID) !== box || STATE.dragging || STATE.positionRevision !== positionRevision) return;
        if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
          STATE.savedPosition = { left: pos.left, top: pos.top };
          applySavedMenuPosition(box);
          requestAnimationFrame(() => {
            if (box.isConnected && document.getElementById(SCRIPT_ID) === box && !STATE.dragging && STATE.positionRevision === positionRevision && STATE.savedPosition) {
              applySavedMenuPosition(box);
            }
          });
        } else {
          STATE.savedPosition = null;
          applyDefaultMenuPosition(box);
        }
      }).catch(() => {});
    }

    return box;
  }

  function setupPageControl(box, handle) {
    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let moved = false;

    const moveBox = (clientX, clientY) => {
      const pos = clampSavedMenuPosition(startLeft + clientX - startX, startTop + clientY - startY, box);
      box.style.left = `${pos.left}px`;
      box.style.top = `${pos.top}px`;
      box.style.right = "auto";
      box.style.bottom = "auto";
    };

    const savePosition = async () => {
      const left = parseFloat(box.style.left || box.getBoundingClientRect().left || 0) || 0;
      const top = parseFloat(box.style.top || box.getBoundingClientRect().top || 0) || 0;
      STATE.savedPosition = clampSavedMenuPosition(left, top, box);
      await gmSet(POS_KEY, STATE.savedPosition);
    };

    handle.addEventListener("pointerdown", (e) => {
      if (e.button != null && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      pointerId = e.pointerId;
      moved = false;
      startX = e.clientX;
      startY = e.clientY;
      const rect = box.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      box.style.left = `${rect.left}px`;
      box.style.top = `${rect.top}px`;
      box.style.right = "auto";
      box.style.bottom = "auto";
      STATE.dragging = true;
      box.classList.add("dragging");
      try { handle.setPointerCapture(pointerId); } catch (_) {}
      // 长按复原已移除，改为扩展菜单「📍 重置悬浮菜单位置」点击复原。
    });

    handle.addEventListener("pointermove", (e) => {
      if (pointerId !== e.pointerId) return;
      e.preventDefault();
      e.stopPropagation();
      if (Math.abs(e.clientX - startX) > 6 || Math.abs(e.clientY - startY) > 6) {
        moved = true;
      }
      if (moved) moveBox(e.clientX, e.clientY);
    });

    const finish = (e) => {
      if (pointerId !== e.pointerId) return;
      e.preventDefault();
      e.stopPropagation();
      try { handle.releasePointerCapture(pointerId); } catch (_) {}
      pointerId = null;
      STATE.dragging = false;
      box.classList.remove("dragging");
      if (moved) {
        STATE.positionRevision += 1;
        savePosition();
      }
      else promptJumpPage();
    };

    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", (e) => {
      if (pointerId !== e.pointerId) return;
      try { handle.releasePointerCapture(pointerId); } catch (_) {}
      pointerId = null;
      STATE.dragging = false;
      box.classList.remove("dragging");
      if (moved) {
        STATE.positionRevision += 1;
        savePosition();
      }
    });
  }

  async function updateMenu() {
    if (STATE.navigating) return;

    if (!STATE.enabled) {
      const box = $(`#${SCRIPT_ID}`);
      if (box) box.dataset.hidden = "true";
      return;
    }

    STATE.prev = findCandidate("prev");
    STATE.next = findCandidate("next");
    STATE.currentPage = getCurrentPage();

    // 很多分类/列表第一页 URL 没有 page 参数，或当前页没有 active 标记。
    // 这时从相邻按钮推断：下一页是 2 => 当前页是 1；上一页是 7 => 当前页是 8。
    if (STATE.currentPage === "?" || !STATE.currentPage) {
      STATE.currentPage = inferCurrentPageFromAdjacent(STATE.prev, STATE.next) || STATE.currentPage;
    }

    const hasPagination = Boolean(STATE.prev || STATE.next);
    const box = createMenu();
    box.dataset.hidden = "false";
    box.dataset.pagination = hasPagination ? "true" : "false";
    box.querySelector(".page span").textContent = STATE.currentPage;
    box.querySelector(".prev").disabled = !STATE.prev;
    box.querySelector(".next").disabled = !STATE.next;
    requestAnimationFrame(() => {
      if (shouldForceRightBottomPosition() || !hasPagination) {
        applyDefaultMenuPosition(box);
      }
      else if (STATE.savedPosition) {
        applySavedMenuPosition(box);
      } else {
        applyDefaultMenuPosition(box);
      }
    });
  }

  function runWhenIdle(fn, timeout = 800) {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(fn, { timeout });
    } else {
      setTimeout(fn, 1);
    }
  }

  function scheduleUpdate(delay = 250) {
    clearTimeout(STATE.updateTimer);
    STATE.updateTimer = setTimeout(() => runWhenIdle(updateMenu, 800), delay);
  }

  function scheduleEventUpdate(withFallback = true) {
    scheduleUpdate(0);
    if (STATE.fallbackTimer) clearTimeout(STATE.fallbackTimer);
    STATE.fallbackTimer = null;
    if (!withFallback) return;

    // 只为晚渲染分页的站点保留一次低成本兜底；不观察 body 子树，也不持续轮询。
    STATE.fallbackTimer = setTimeout(() => {
      STATE.fallbackTimer = null;
      if (!STATE.prev && !STATE.next) scheduleUpdate(0);
    }, 1000);
  }

  function hookHistory() {
    const wrap = (name) => {
      const original = history[name];
      history[name] = function (...args) {
        const result = original.apply(this, args);
        STATE.navigating = false;
        window.dispatchEvent(new Event(`${SCRIPT_ID}:urlchange`));
        return result;
      };
    };
    wrap("pushState");
    wrap("replaceState");
    window.addEventListener("popstate", () => {
      STATE.navigating = false;
      scheduleEventUpdate();
    });
    window.addEventListener(`${SCRIPT_ID}:urlchange`, () => {
      STATE.navigating = false;
      scheduleEventUpdate();
    });
  }

  function init() {
    if (STATE.initialized) return;

    const observeRoot = document.documentElement || document.body;
    if (!observeRoot) {
      setTimeout(init, 80);
      return;
    }
    STATE.initialized = true;

    // 基础守护先同步安装；GM 设置读取变慢或异常时也不会阻塞按钮出现。
    const box = createMenu();
    gmGet(ENABLE_KEY, true).then((enabled) => {
      STATE.settingsLoaded = true;
      STATE.enabled = enabled !== false;
      scheduleUpdate(0);
    }).catch(() => {
      STATE.settingsLoaded = true;
      STATE.enabled = true;
      scheduleUpdate(0);
    });

    if (typeof GM !== "undefined" && GM.registerMenuCommand) {
      GM.registerMenuCommand("📍 重置悬浮菜单位置", async () => {
        STATE.positionRevision += 1;
        STATE.savedPosition = null;
        await gmSet(POS_KEY, null);
        if (box) applyDefaultMenuPosition(box);
        scheduleUpdate(0);
      });
    }

    hookHistory();
    normalizeXVideosHashLater();
    scheduleEventUpdate();

    STATE.observer = new MutationObserver((mutations) => {
      const bodyChanged = mutations.some(mutation => [...mutation.addedNodes, ...mutation.removedNodes].some(node => node === document.body))
      const menuMissing = !document.getElementById(SCRIPT_ID)
      const styleMissing = !document.getElementById(`${SCRIPT_ID}-style`)
      if (bodyChanged || menuMissing || styleMissing) scheduleEventUpdate()
    });
    // 只盯住 html 的直接子节点，用来发现 body 被整体替换；不常驻扫描整棵页面 DOM。
    STATE.observer.observe(observeRoot, { childList: true });

    let stabilizeTimer = null;
    const stabilizeMenuPosition = () => {
      const box = $(`#${SCRIPT_ID}`);
      if (!box || STATE.dragging) return;
      const needReapply = true;
      if (!needReapply) return;
      // 防抖：合并连珠 resize，只在稳定后重算一次。
      if (stabilizeTimer) clearTimeout(stabilizeTimer);
      stabilizeTimer = setTimeout(() => {
        stabilizeTimer = null;
        if (!box || STATE.dragging) return;
        const hasPagination = box.dataset.pagination !== "false";
        if (shouldForceRightBottomPosition() || !hasPagination) {
          applyDefaultMenuPosition(box);
        } else if (STATE.savedPosition) {
          applySavedMenuPosition(box);
        }
      }, 120);
    };

    window.addEventListener("resize", stabilizeMenuPosition);
    window.addEventListener("scroll", stabilizeMenuPosition, { passive: true });
    window.visualViewport?.addEventListener("resize", stabilizeMenuPosition);
    window.visualViewport?.addEventListener("scroll", stabilizeMenuPosition);

    const watchdog = () => {
      // 有些站点翻页是 PJAX/局部刷新，会替换 body 或拦截跳转；这时旧悬浮 DOM 可能被删，
      // 或 STATE.navigating 会一直保持 true，导致脚本不再显示。这里主动复位并重新扫描。
      STATE.navigating = false;
      if (!document.getElementById(SCRIPT_ID)) {
        STATE.savedPosition = STATE.savedPosition || null;
      }
      scheduleEventUpdate();
    };

    window.addEventListener("pageshow", watchdog);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) watchdog();
    });

    log("已加载");
  }

  init();
  if (document.readyState === "loading") setTimeout(init, 80);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      normalizeXVideosHashLater();
      scheduleEventUpdate();
    }, { once: true });
  }
})();
