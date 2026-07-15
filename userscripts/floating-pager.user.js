// ==UserScript==
// @name         悬浮翻页
// @namespace    https://github.com/qiqi777iii/Scripts
// @version      1.3.2
// @updateURL    https://raw.githubusercontent.com/qiqi777iii/Scripts/main/userscripts/floating-pager.user.js
// @downloadURL  https://raw.githubusercontent.com/qiqi777iii/Scripts/main/userscripts/floating-pager.user.js
// @description  自动识别页面的上一页和下一页，并提供关闭、新建 Safari 起始页、刷新及可拖动的悬浮翻页按钮。
// @author       Scripting Agent
// @match        http://*/*
// @match        https://*/*
// @run-at       document-start
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.log
// @grant        GM.closeTab
// @grant        GM.openInTab
// @grant        Scripting.tabs
// ==/UserScript==

(() => {
  "use strict";

  const SCRIPT_ID = "universal-pagination-floating-menu";
  const SAFE_BOTTOM_GAP = 40;
  const DEFAULT_BOTTOM_GAP = 28;
  const PAGER_ITEM_SIZE = 35;
  const PAGE_MIN_WIDTH = 35;
  const FALLBACK_PAGER_WIDTH = PAGER_ITEM_SIZE * 3 + PAGE_MIN_WIDTH;
  const REFRESH_ICON_SIZE = 21;
  const DEFAULT_RIGHT_GAP = 60;
  const NODESEEK_BOTTOM_EXTRA = 0;
  const ENABLE_KEY = `${SCRIPT_ID}:enabled`;
  const BOUND_LINK_ID = "__tb__";
  const BOUND_CONTROL_SIZE = 35;
  const GROUP_DRAG_EVENT = "qiqi-floating-toolbar-group-drag";
  const STATE = {
    enabled: true,
    prev: null,
    next: null,
    currentPage: "?",
    lastUrl: location.href,
    observer: null,
    pagerObserver: null,
    observedPagerRoot: null,
    fallbackTimer: null,
    fallbackAttempt: 0,
    updateTimer: null,
    navigating: false,
    savedPosition: null,
    dragging: false,
    dragGestureMoved: false,
    suppressClickUntil: 0,
    initialized: false,
    settingsLoaded: false,
    numericPager: null,
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
    const anchorWithoutHref = el.tagName === "A" && !el.getAttribute("href") && !el.onclick;
    return Boolean(
      el.disabled ||
      el.getAttribute("aria-disabled") === "true" ||
      /(^|\s)(disabled|disable|unavailable|inactive)(\s|$)/i.test(el.className || "") ||
      (anchorWithoutHref && !el.hasAttribute("data-page") && !paginationContainer(el))
    );
  }

  function labelledByText(el) {
    const ids = String(el?.getAttribute?.("aria-labelledby") || "").trim().split(/\s+/).filter(Boolean);
    return ids.map((id) => document.getElementById(id)?.textContent || "").join(" ");
  }

  function normalizeText(el) {
    return [
      el.innerText,
      el.textContent,
      el.getAttribute("aria-label"),
      labelledByText(el),
      el.getAttribute("title"),
      el.getAttribute("rel"),
      el.getAttribute("class"),
      el.getAttribute("id"),
      el.getAttribute("data-page"),
      el.querySelector?.("img[alt]")?.getAttribute("alt"),
      el.querySelector?.("svg title")?.textContent,
    ]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  const PAGINATION_CONTAINER_SELECTOR = '.pagination, .pager, .pages, .page-list, .pagebar, .page-numbers, [class*="pagination" i], [class*="pager" i], [class*="page-list" i], [class*="pagebar" i], [class*="pages" i], [id*="pagination" i], [id*="pager" i], [role="navigation"][aria-label*="page" i], [role="navigation"][aria-label*="分页"], [aria-label="pagination" i], [aria-label*="page navigation" i]';

  function paginationContainer(el) {
    return el?.closest?.(PAGINATION_CONTAINER_SELECTOR) || null;
  }

  function deniedPaginationCandidate(el) {
    if (!el) return true;
    const all = `${normalizeText(el)} ${el.getAttribute?.('href') || ''} ${el.getAttribute?.('action') || ''}`;
    return Boolean(el.hasAttribute?.('download') || /pay(?:ment|wall)?|log[\s_-]?in|sign[\s_-]?in|download|preview|subscri(?:be|ption)|支付|付费|购买|登录|登陆|下载|预览|订阅/i.test(all));
  }

  function scoreCandidate(el, direction) {
    if (!visible(el) || disabled(el) || deniedPaginationCandidate(el)) return -999;
    const text = normalizeText(el).toLowerCase();
    const href = (el.getAttribute("href") || "").toLowerCase();
    const all = `${text} ${href}`;
    const inPagination = Boolean(paginationContainer(el));
    let score = 0;

    if (direction === "next") {
      if (/\bnext\b|下一页|下页|后一页|后页|下一章|下章|older|forward/.test(all)) score += 80;
      if (/[›»→＞>]|^\s*下\s*$/.test(text)) score += 65;
      if (/rel=["']?next|\bnext\b/.test(all) || el.getAttribute("rel") === "next") score += 70;
      if (inPagination && /加载更多|更多|\bload\s+more\b|\bmore\b/.test(text)) score += 80;
      if (/page[=/_-]?\d+|p=\d+|paged=\d+/.test(href)) score += 10;
    } else {
      if (/\bprev\b|\bprevious\b|上一页|上页|前一页|前页|上一章|上章|newer|\bback\b/.test(all)) score += 80;
      if (/[‹«←＜<]|^\s*上\s*$/.test(text)) score += 65;
      if (/rel=["']?prev|\bprev\b|\bprevious\b/.test(all) || el.getAttribute("rel") === "prev") score += 70;
      if (/page[=/_-]?\d+|p=\d+|paged=\d+/.test(href)) score += 10;
    }
    if (el.tagName === "A") score += 15;
    if (el.tagName === "BUTTON") score += 12;
    if (inPagination) score += 35;
    if (/comment|reply|share|广告|ad-|banner/.test(all)) score -= 40;
    return score;
  }

  function uniqueElements(list) {
    return Array.from(new Set(list.filter(Boolean)));
  }

  function explicitCurrentElement(root) {
    return root?.querySelector?.('[aria-current="page"], [class~="current"], [class~="active"], [class~="selected"], .page-numbers.current, .page-numbers.active') || null;
  }

  function numericControlValue(el) {
    if (!el) return "";
    const dataValue = String(el.getAttribute?.("data-page") || el.getAttribute?.("data-page-number") || "").trim();
    if (/^0*\d{1,5}$/.test(dataValue)) return String(parseInt(dataValue, 10));
    const text = numericText(el);
    if (text) return text;
    const href = el.href || el.getAttribute?.("href") || "";
    return href ? pageFromUrl(href) : "";
  }

  function hasPageUrlEvidence(el, page) {
    const href = el?.href || el?.getAttribute?.("href") || "";
    if (!href || !page) return false;
    try {
      const url = new URL(href, location.href);
      if (!/^https?:$/i.test(url.protocol) || url.origin !== location.origin) return false;
      if (["page", "p", "paged", "pg", "pn", "pageNo", "pageNumber"].some((key) => url.searchParams.get(key) === String(page))) return true;
      if (new RegExp(`(?:page|p|pg|list)[/_-]?0*${page}(?:/|$|\\.html?$)`, "i").test(url.pathname)) return true;
      return new RegExp(`/0*${page}/?$`).test(url.pathname);
    } catch (_) {
      return false;
    }
  }

  function numericPagerRoot(el) {
    const explicit = paginationContainer(el);
    if (explicit) return explicit;
    const list = el?.closest?.("ul, ol");
    if (list) return list;
    const parent = el?.parentElement;
    if (parent?.tagName === "LI" && parent.parentElement) return parent.parentElement;
    return parent;
  }

  function detectNumericPager() {
    const explicitRoots = $$(PAGINATION_CONTAINER_SELECTOR);
    const controls = uniqueElements([
      ...$$('a[href], button, [role="button"], [data-page], [data-page-number], [aria-current="page"], [class~="current"], [class~="active"], [class~="selected"]'),
      ...explicitRoots.flatMap((root) => $$('a, button, [role="button"], [data-page], [data-page-number], [aria-current="page"], [class~="current"], [class~="active"], [class~="selected"]', root)),
    ]).filter((el) => !el.closest?.(`#${SCRIPT_ID}, #${SCRIPT_ID}-jump-mask`) && numericControlValue(el));
    const roots = uniqueElements(controls.map(numericPagerRoot)).filter((root) => root && root !== document.body && root !== document.documentElement);
    const urlCurrent = parseInt(pageFromUrl() || "", 10);
    let best = null;

    for (const root of roots) {
      try {
        if (!visible(root) || root.querySelector("video") || root.querySelectorAll("img").length > 3) continue;
        if (/calendar|datepicker|date-picker|carousel|slider|tabs?|years?|months?/i.test(`${root.className || ""} ${root.id || ""} ${root.getAttribute?.("role") || ""}`)) continue;

        const items = uniqueElements($$('a, button, [role="button"], [data-page], [data-page-number], [aria-current="page"], [class~="current"], [class~="active"], [class~="selected"]', root));
        const byPage = new Map();
        for (const el of items) {
          const page = parseInt(numericControlValue(el) || "", 10);
          if (!Number.isFinite(page) || page < 1 || page > 99999) continue;
          const existing = byPage.get(page);
          const actionable = el.matches?.('a[href], button, [role="button"], [data-page], [data-page-number]');
          if (!existing || (actionable && !existing.matches?.('a[href], button, [role="button"], [data-page], [data-page-number]'))) byPage.set(page, el);
        }
        const pages = [...byPage.keys()].sort((a, b) => a - b);
        if (pages.length < 2) continue;

        const explicitRoot = Boolean(root.matches?.(PAGINATION_CONTAINER_SELECTOR));
        const currentEl = explicitCurrentElement(root);
        const explicitCurrent = parseInt(numericControlValue(currentEl) || "", 10);
        const urlNeighborsCurrent = Number.isFinite(urlCurrent) && (byPage.has(urlCurrent) || byPage.has(urlCurrent - 1) || byPage.has(urlCurrent + 1));
        const current = Number.isFinite(explicitCurrent) ? explicitCurrent : (urlNeighborsCurrent ? urlCurrent : NaN);
        const consecutive = pages.some((page, index) => index > 0 && page === pages[index - 1] + 1);
        const urlEvidence = [...byPage.entries()].filter(([page, el]) => hasPageUrlEvidence(el, page)).length;
        const dataEvidence = [...byPage.values()].filter((el) => el.hasAttribute?.("data-page") || el.hasAttribute?.("data-page-number")).length;
        const directionEvidence = Boolean(root.querySelector?.('a[rel~="next"], a[rel~="prev"], [class*="next" i], [class*="prev" i], [aria-label*="next" i], [aria-label*="prev" i], [aria-label*="上一页"], [aria-label*="下一页"]'));
        const structuralEvidence = urlEvidence >= 1 || dataEvidence >= 2 || directionEvidence;
        const genericTrusted = Number.isFinite(current) && consecutive && ((urlEvidence >= 2 || dataEvidence >= 2) || directionEvidence);
        if (!explicitRoot && !genericTrusted) continue;
        if (explicitRoot && (!consecutive || !structuralEvidence)) continue;
        if (explicitRoot && !Number.isFinite(current) && pages.length < 3 && !directionEvidence) continue;

        let inferredCurrent = current;
        if (!Number.isFinite(inferredCurrent) && directionEvidence && pages[0] === 2) inferredCurrent = 1;
        if (!Number.isFinite(inferredCurrent)) continue;

        const prev = byPage.get(inferredCurrent - 1) || null;
        const next = byPage.get(inferredCurrent + 1) || null;
        if (!prev && !next) continue;
        const rect = root.getBoundingClientRect();
        const score = (explicitRoot ? 100 : 0) + urlEvidence * 15 + (directionEvidence ? 20 : 0) + pages.length + Math.max(0, rect.top / Math.max(innerHeight, 1));
        if (!best || score > best.score) best = { root, currentPage: String(inferredCurrent), prev, next, score };
      } catch (error) {
        log("数字分页容器识别失败", error);
      }
    }
    return best;
  }

  function observePagerRoot(root) {
    if (STATE.observedPagerRoot === root) return;
    STATE.pagerObserver?.disconnect();
    STATE.pagerObserver = null;
    STATE.observedPagerRoot = root || null;
    if (!root?.isConnected) return;
    STATE.pagerObserver = new MutationObserver(() => scheduleUpdate(120));
    STATE.pagerObserver.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["href", "class", "aria-current", "aria-disabled", "disabled", "hidden", "data-page"],
    });
  }

  function findByRel(direction) {
    const rel = direction === "next" ? "next" : "prev";
    return $(`a[rel~="${rel}"], link[rel~="${rel}"]`);
  }

  function safeCall(label, fn, fallback = null) {
    try {
      return fn();
    } catch (error) {
      log(label, error);
      return fallback;
    }
  }

  function findCandidate(direction, numericPager = null) {
    if (isMissAv()) {
      return safeCall(`MissAV ${direction} 识别失败`, () => findMissAvCandidate(direction), null);
    }

    if (isRule34Video()) {
      const siteCandidate = safeCall(`Rule34 ${direction} 识别失败`, () => findRule34Candidate(direction), null);
      if (siteCandidate) return siteCandidate;
    }

    if (isEporner()) {
      const siteCandidate = safeCall(`Eporner ${direction} 识别失败`, () => findEpornerCandidate(direction), null);
      if (siteCandidate) return siteCandidate;
    }

    if (isEpornerVideoPage()) return null;
    if (isFutapo2SingleCollectionPage()) return null;

    if (isJable()) {
      return safeCall(`Jable ${direction} 识别失败`, () => findJableCandidate(direction), null);
    }

    if (isXVideosNewListPage() || isXVideosVideoPage()) {
      return safeCall(`XVideos ${direction} 识别失败`, () => findXVideosCandidate(direction), null);
    }

    if (isXVideos()) {
      const siteCandidate = safeCall(`XVideos ${direction} 识别失败`, () => findXVideosCandidate(direction), null);
      if (siteCandidate) return siteCandidate;
    }

    if (isOHentai()) {
      return safeCall(`OHentai ${direction} 识别失败`, () => findOHentaiCandidate(direction), null);
    }

    if (isNodeSeek()) {
      const siteCandidate = safeCall(`NodeSeek ${direction} 识别失败`, () => findNodeSeekCandidate(direction), null);
      if (siteCandidate) return siteCandidate;
    }

    if (isWhosTv()) {
      const siteCandidate = safeCall(`WhosTV ${direction} 识别失败`, () => findWhosTvCandidate(direction), null);
      if (siteCandidate) return siteCandidate;
    }

    if (isDiscuz()) {
      const siteCandidate = safeCall(`Discuz ${direction} 识别失败`, () => findDiscuzCandidate(direction), null);
      if (siteCandidate) return siteCandidate;
    }

    const byRel = safeCall(`rel ${direction} 识别失败`, () => findByRel(direction), null);
    if (byRel && byRel.href && !disabled(byRel) && !deniedPaginationCandidate(byRel)) return byRel;

    if (numericPager?.[direction]) return numericPager[direction];

    const selectors = [
      "a[href]",
      "button",
      "input[type=button]",
      "[role=button]",
      "[data-page]",
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
      "[aria-labelledby]",
      "[title]",
    ];

    const candidates = uniqueElements($$(selectors.join(",")));
    let best = null;
    let bestScore = 30; // 低于该分数认为误判风险较高
    for (const el of candidates) {
      const s = safeCall("候选元素评分失败", () => scoreCandidate(el, direction), -999);
      if (s > bestScore) {
        best = el;
        bestScore = s;
      }
    }
    return best;
  }

  function pageFromUrl(urlLike = location.href) {
    const url = new URL(urlLike, location.href);
    const xvideosNewPage = getXVideosNewDisplayPage(url.href);
    if (xvideosNewPage) return xvideosNewPage;
    const xvideosSearchPage = getXVideosSearchDisplayPage(url.href);
    if (xvideosSearchPage) return xvideosSearchPage;
    for (const key of ["page", "p", "paged", "pg", "pn", "pageNo", "pageNumber"]) {
      const value = url.searchParams.get(key);
      if (/^\d+$/.test(value || "")) return String(parseInt(value, 10));
    }
    if (/(^|\.)eporner\.com$/i.test(url.hostname)) {
      const playlistPage = getEpornerPlaylistPage(url.href);
      if (playlistPage) return playlistPage;
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

  function isXVideosNewListPage(urlLike = location.href) {
    try {
      const url = new URL(urlLike, location.href);
      if (!/(^|\.)xvideos\.com$/i.test(url.hostname)) return false;
      if (/^\/new\/[1-9]\d{0,4}\/?$/i.test(url.pathname)) return true;
      // 根路径同时承载首页和搜索结果。搜索使用 ?k=...&p=N，不能套用首页 /new/N 映射。
      return url.pathname === "/" && !["k", "p", "page"].some((key) => url.searchParams.has(key));
    } catch (_) {
      return false;
    }
  }

  function isXVideosSearchPage(urlLike = location.href) {
    try {
      const url = new URL(urlLike, location.href);
      return /(^|\.)xvideos\.com$/i.test(url.hostname) && url.pathname === "/" && url.searchParams.has("k");
    } catch (_) {
      return false;
    }
  }

  function getXVideosSearchDisplayPage(urlLike = location.href) {
    try {
      const url = new URL(urlLike, location.href);
      if (!isXVideosSearchPage(url.href)) return "";
      const raw = url.searchParams.get("p");
      if (raw == null || raw === "") return "1";
      return /^\d{1,5}$/.test(raw) ? String(parseInt(raw, 10) + 1) : "";
    } catch (_) {
      return "";
    }
  }

  function makeXVideosSearchPageUrl(displayPage) {
    displayPage = parseInt(displayPage, 10);
    if (!isXVideosSearchPage() || !Number.isFinite(displayPage) || displayPage < 1) return "";
    const url = new URL(location.href);
    if (displayPage === 1) url.searchParams.delete("p");
    else url.searchParams.set("p", String(displayPage - 1));
    url.searchParams.delete("page");
    if (/^#_tabVideos(?:,page-\d+)?$/i.test(url.hash)) url.hash = "";
    return url.href;
  }

  function isXVideosVideoPage(urlLike = location.href) {
    try {
      const url = new URL(urlLike, location.href);
      return /(^|\.)xvideos\.com$/i.test(url.hostname) && /^\/video\./i.test(url.pathname);
    } catch (_) {
      return false;
    }
  }

  function getXVideosNewDisplayPage(urlLike = location.href) {
    try {
      const url = new URL(urlLike, location.href);
      if (!/(^|\.)xvideos\.com$/i.test(url.hostname)) return "";
      if (url.pathname === "/") return isXVideosNewListPage(url.href) ? "1" : "";
      const match = url.pathname.match(/^\/new\/([1-9]\d{0,4})\/?$/i);
      return match ? String(parseInt(match[1], 10) + 1) : "";
    } catch (_) {
      return "";
    }
  }

  function makeXVideosNewPageUrl(displayPage) {
    displayPage = parseInt(displayPage, 10);
    if (!Number.isFinite(displayPage) || displayPage < 1) return "";
    const url = new URL(location.href);
    url.pathname = displayPage === 1 ? "/" : `/new/${displayPage - 1}`;
    url.searchParams.delete("page");
    if (/^#_tabVideos(?:,page-\d+)?$/i.test(url.hash)) url.hash = "";
    return url.href;
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
    if (isXVideosNewListPage()) return makeXVideosNewPageUrl(targetPage);
    if (isXVideosSearchPage()) return makeXVideosSearchPageUrl(targetPage);
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
    if (isXVideosNewListPage()) return makeXVideosNewPageUrl(targetPage);
    if (isXVideosSearchPage()) return makeXVideosSearchPageUrl(targetPage);
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
    const legacyHash = /^#_tabVideos(?:,page-\d+)?$/i.test(String(location.hash || ""));
    const legacyQuery = new URL(location.href).searchParams.has("page");
    if (!page || (!legacyHash && !legacyQuery)) return;
    if (!isXVideosNewListPage()) {
      const match = String(location.hash || "").match(/^#_tabVideos,page-(\d+)$/i);
      if (!match || match[1] !== page) return;
    }
    const cleanUrl = makeXVideosDisplayPageUrl(page);
    if (!cleanUrl) return;
    setTimeout(() => {
      try {
        if (location.href !== cleanUrl) history.replaceState(history.state, document.title, cleanUrl);
      } catch (_) {}
    }, 1500);
  }

  function findXVideosNewPageLink(targetPage) {
    targetPage = parseInt(targetPage, 10);
    if (!Number.isFinite(targetPage) || targetPage < 1) return null;
    let directionalFallback = null;
    for (const el of $$('a[href]')) {
      if (!visible(el) || disabled(el) || deniedPaginationCandidate(el)) continue;
      if (parseInt(getXVideosNewDisplayPage(el.href) || "", 10) !== targetPage) continue;
      if (parseInt(numericText(el) || "", 10) === targetPage) return el;
      if (el.matches(".next-page, .prev-page") || paginationContainer(el)) directionalFallback = directionalFallback || el;
    }
    return directionalFallback;
  }

  function findXVideosCandidate(direction) {
    if (isXVideosVideoPage()) return null;
    if (isXVideosNewListPage()) {
      const current = parseInt(getXVideosNewDisplayPage() || "", 10);
      if (!Number.isFinite(current) || current < 1) return null;
      const target = current + (direction === "next" ? 1 : -1);
      if (target < 1) return null;
      const realLink = findXVideosNewPageLink(target);
      if (realLink) return realLink;
      // 下一页必须由当前 DOM 证明，避免末页继续亮起；较小页已知存在，可安全构造上一页。
      if (direction === "next") return null;
      const url = makeXVideosNewPageUrl(target);
      return url ? { __paginationUrl: url } : null;
    }

    // 其他 XVideos 分类/搜索页仍保留旧 tab 分页，但必须有真实分页证据，不能在详情页盲造地址。
    const pager = detectNumericPager();
    if (pager?.[direction]) return pager[direction];
    const current = parseInt(pageFromUrl() || pager?.currentPage || "", 10);
    if (!Number.isFinite(current) || current < 1) return null;
    const target = current + (direction === "next" ? 1 : -1);
    if (target < 1 || direction === "next") return null;
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

  function isEpornerPlaylistPage(urlLike = location.href) {
    if (!isEporner()) return false;
    try {
      const url = new URL(urlLike, location.href);
      return /^\/profile\/[^/]+\/playlist\/[^/]+\/[^/]+(?:\/0*\d{1,5})?\/?$/i.test(url.pathname);
    } catch (_) {
      return false;
    }
  }

  function getEpornerPlaylistPage(urlLike = location.href) {
    try {
      const url = new URL(urlLike, location.href);
      if (!/(^|\.)eporner\.com$/i.test(url.hostname)) return "";
      const match = url.pathname.match(/^\/profile\/[^/]+\/playlist\/[^/]+\/[^/]+(?:\/0*(\d{1,5}))?\/?$/i);
      if (!match) return "";
      return match[1] ? String(parseInt(match[1], 10)) : "1";
    } catch (_) {
      return "";
    }
  }

  function makeEpornerPlaylistPageUrl(targetPage) {
    targetPage = parseInt(targetPage, 10);
    if (!isEpornerPlaylistPage() || !Number.isFinite(targetPage) || targetPage < 1) return "";
    const url = new URL(location.href);
    const match = url.pathname.match(/^(\/profile\/[^/]+\/playlist\/[^/]+\/[^/]+)(?:\/0*\d{1,5})?\/?$/i);
    if (!match) return "";
    url.pathname = targetPage === 1 ? `${match[1]}/` : `${match[1]}/${targetPage}/`;
    url.search = "";
    url.hash = "";
    return url.href;
  }

  function findEpornerCandidate(direction) {
    if (!isEporner()) return null;
    if (isEpornerVideoPage()) return null;

    const selector = direction === "next"
      ? '.numlist2 > a.nmnext[href], a[rel~="next"][href]'
      : '.numlist2 > a.nmback[href], a[rel~="prev"][href]';
    for (const el of $$(selector)) {
      if (visible(el) && !disabled(el) && !deniedPaginationCandidate(el)) return el;
    }

    const rel = direction === "next" ? "next" : "prev";
    const headLink = $(`link[rel~="${rel}"][href]`);
    if (headLink?.href && !deniedPaginationCandidate(headLink)) {
      return { __paginationUrl: headLink.href };
    }

    if (!isEpornerPlaylistPage()) return null;
    const current = parseInt(getEpornerCurrentPage() || "1", 10);
    const target = current + (direction === "next" ? 1 : -1);
    if (!Number.isFinite(target) || target < 1) return null;

    // 上一页只要当前页大于 1 就一定存在；下一页必须由站点真实链接证明，
    // 避免在播放列表末页构造一个不存在的地址并跳到 404。
    if (direction === "next") return null;
    const url = makeEpornerPlaylistPageUrl(target);
    return url ? { __paginationUrl: url } : null;
  }

  function getEpornerCurrentPage() {
    if (!isEporner()) return "";

    // 播放列表当前页使用 span.nmhere，而不是通用的 active/current 标记。
    // DOM 优先，兼容站点未来局部更新内容但暂未同步地址栏的情况。
    for (const el of $$('.numlist2 > .nmhere, .numlist2 .nmhere')) {
      const page = numericText(el);
      if (page) return page;
    }

    const playlistPage = getEpornerPlaylistPage();
    if (playlistPage) return playlistPage;

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
    const dataPage = String(el?.getAttribute?.("data-page") || el?.getAttribute?.("data-page-number") || "").trim();
    if (/^0*\d{1,5}$/.test(dataPage)) return String(parseInt(dataPage, 10));
    const text = (el && (el.value || el.textContent || el.innerText || "")).trim();
    const rule34DataPage = isRule34Video() ? rule34PageFromDataParameters(el) : "";
    if (rule34DataPage) return rule34DataPage;
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
    if (isEpornerPlaylistPage()) return makeEpornerPlaylistPageUrl(targetPage);
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

  function getCurrentPage(numericPager = null) {
    if (isXVideosNewListPage()) {
      const page = getXVideosNewDisplayPage();
      if (page) return page;
    }
    if (isXVideosSearchPage()) {
      const page = getXVideosSearchDisplayPage();
      if (page) return page;
    }

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

    // 通用数字分页放在所有站点专用当前页逻辑之后，避免页面内其他数字组件覆盖站点语义。
    if (numericPager?.currentPage) return numericPager.currentPage;

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
    let target;
    try { target = new URL(url, location.href).href; } catch (_) { return; }
    if (!/^https?:/i.test(target)) return;
    STATE.navigating = true;
    window.location.assign(target);
  }

  async function closeCurrentTab() {
    if (STATE.navigating) return;
    STATE.navigating = true;
    try {
      const current = await Scripting.tabs.getCurrent();
      if (!Number.isInteger(current?.id)) throw new Error("无法获取当前标签页 ID");
      await GM.closeTab(current.id);
    } catch (error) {
      STATE.navigating = false;
      updateMenu();
      log("关闭当前标签页失败", error);
    }
  }

  async function openStartPage() {
    try {
      // WebExtension 只有在不提供 URL 时，才会按 Safari 原生“+”按钮的方式创建起始页。
      await GM.openInTab(undefined, { active: true });
    } catch (error) {
      log("新建 Safari 起始页失败", error);
    }
  }

  function reloadPage() {
    if (STATE.navigating) return;
    STATE.navigating = true;
    location.reload();
    setTimeout(() => {
      window.location.href = location.href;
    }, 800);
  }

  function bindActionButton(button, action) {
    if (!button) return;
    let lastRun = 0;
    const run = (e) => {
      if (STATE.dragGestureMoved || Date.now() < STATE.suppressClickUntil) return;
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
    // 点击时重新生成数字分页快照并传给统一候选识别，避免无 class 数字分页丢失，
    // 也避免通用评分把分页区中的任意数字链接错当成相邻页。
    const numericPager = safeCall("点击前数字分页识别失败", detectNumericPager, null);
    const candidate = safeCall(`${direction} 点击前识别失败`, () => findCandidate(direction, numericPager), null);
    STATE.numericPager = numericPager;
    STATE[direction] = candidate;
    if (candidate) {
      clickOrNavigate(candidate);
      return;
    }
    scheduleUpdate(0);
  }

  function clickOrNavigate(el) {
    if (!el || STATE.navigating) return;
    if (el.__paginationElement) return clickOrNavigate(el.__paginationElement);
    if (el.__paginationUrl) return hardNavigate(el.__paginationUrl);
    if (!(el instanceof Element) || deniedPaginationCandidate(el)) return;
    const link = el.tagName === "A" || el.tagName === "LINK" ? el : el.closest("a[href]");
    const clickTarget = link || el;
    if (!(clickTarget instanceof HTMLElement) || (link && deniedPaginationCandidate(link))) return;
    let targetUrl = "";
    try { targetUrl = link?.href ? new URL(link.href, location.href).href : ""; } catch (_) {}
    const canFallback = Boolean(targetUrl && /^https?:/i.test(targetUrl) && (!link.target || link.target.toLowerCase() === "_self"));
    if (!link) {
      HTMLElement.prototype.click.call(clickTarget);
      scheduleEventUpdate();
      return;
    }
    const startUrl = location.href;
    const targetContext = paginationContainer(link) || link.parentElement;
    let targetChanged = false;
    const observer = targetContext ? new MutationObserver(() => { targetChanged = true; }) : null;
    observer?.observe(targetContext, { subtree: true, childList: true, characterData: true, attributes: true });
    STATE.navigating = true;
    try { HTMLElement.prototype.click.call(clickTarget); }
    catch (error) {
      observer?.disconnect();
      STATE.navigating = false;
      log("原生点击分页元素失败", error);
      return;
    }
    setTimeout(() => {
      observer?.disconnect();
      if (location.href === startUrl && !targetChanged && link.isConnected && canFallback) {
        STATE.navigating = false;
        hardNavigate(targetUrl);
      } else {
        STATE.navigating = false;
        scheduleEventUpdate();
      }
    }, 800);
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
    return DEFAULT_BOTTOM_GAP + (isNodeSeek() ? NODESEEK_BOTTOM_EXTRA : 0);
  }

  function positionBoundControl(control, left, box, rect) {
    if (!control) return;
    control.style.left = `${Math.max(0, left)}px`;
    control.style.right = "auto";
    const usesBottom = box.style.bottom && box.style.bottom !== "auto" && (!box.style.top || box.style.top === "auto");
    if (usesBottom) {
      control.style.bottom = box.style.bottom;
      control.style.top = "auto";
    } else {
      control.style.top = `${rect.top}px`;
      control.style.bottom = "auto";
    }
    control.style.transform = "translate3d(0,0,0)";
  }

  function syncBoundLink(box) {
    if (!box?.isConnected) return;
    const rect = box.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return;
    positionBoundControl(document.getElementById(BOUND_LINK_ID), rect.left - BOUND_CONTROL_SIZE, box, rect);
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
    syncBoundLink(box);
  }

  function applySavedMenuPosition(box) {
    if (!box || !STATE.savedPosition) return false;
    const pos = clampSavedMenuPosition(STATE.savedPosition.left, STATE.savedPosition.top, box);
    STATE.savedPosition = pos;
    box.style.left = `${pos.left}px`;
    box.style.top = `${pos.top}px`;
    box.style.right = "auto";
    box.style.bottom = "auto";
    syncBoundLink(box);
    return true;
  }

  function clampSavedMenuPosition(left, top, box) {
    const viewport = getViewportBox();
    const width = Math.max(box?.offsetWidth || 0, 34);
    const height = Math.max(box?.offsetHeight || 0, 34);
    const maxLeft = Math.max(0, viewport.width - width);
    const hasBoundLink = document.getElementById(BOUND_LINK_ID);
    const minLeft = hasBoundLink ? Math.min(BOUND_CONTROL_SIZE, maxLeft) : 0;
    return {
      left: Math.max(minLeft, Math.min(left, maxLeft)),
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
        touch-action: none;
      }
      html:has(#__tb__) #${SCRIPT_ID} {
        border-radius: 0 999px 999px 0;
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
        width: ${PAGER_ITEM_SIZE * 3}px;
        height: ${PAGER_ITEM_SIZE}px;
        border-radius: 999px;
        justify-content: center;
      }
      #${SCRIPT_ID}[data-pagination="false"] .pager-item { display: none; }
      #${SCRIPT_ID}[data-pagination="false"] .close-tab,
      #${SCRIPT_ID}[data-pagination="false"] .new-tab,
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
        transition: opacity .18s ease;
      }
      #${SCRIPT_ID} button svg {
        width: 21px;
        height: 21px;
        display: block;
        pointer-events: none;
      }
      #${SCRIPT_ID} .prev svg,
      #${SCRIPT_ID} .next svg {
        width: 22px;
        height: 22px;
      }
      #${SCRIPT_ID} button[disabled] { opacity: .28; cursor: default; transform: none; }
      #${SCRIPT_ID} button[disabled]:active { background: transparent; }
      #${SCRIPT_ID} .close-tab { color: #ff3b30; }
      @media (prefers-color-scheme: dark) {
        #${SCRIPT_ID} .close-tab { color: #ff453a; }
      }
      #${SCRIPT_ID} .close-tab::after,
      #${SCRIPT_ID} .new-tab::after {
        content: "";
        position: absolute;
        top: 7px;
        right: 0;
        bottom: 7px;
        width: 1px;
        background: var(--upfm-separator);
        pointer-events: none;
      }
      #${SCRIPT_ID} .new-tab svg {
        width: 20px;
        height: 20px;
        stroke: currentColor;
        stroke-width: 2.4;
        stroke-linecap: round;
        fill: none;
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
        font-size: 15px;
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
      <button class="new-tab" type="button" title="新建 Safari 起始页" aria-label="新建 Safari 起始页">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14"></path></svg>
      </button>
      <button class="refresh" type="button" title="刷新页面" aria-label="刷新页面">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M19.2 5.2v5.2h-5.2" />
          <path d="M18.8 10.4a7.1 7.1 0 1 0-1.9 6.5" />
        </svg>
      </button>
      <button class="prev pager-item" type="button" title="上一页"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M15 18l-6-6 6-6"></path></svg></button>
      <div class="page pager-item" title="点击选择页码，按住可临时拖动；刷新页面后恢复默认位置"><span>?</span></div>
      <button class="next pager-item" type="button" title="下一页"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 18l6-6-6-6"></path></svg></button>
    `;
    isolateFloatingUi(box);
    document.documentElement.appendChild(box);
    box.addEventListener(GROUP_DRAG_EVENT, (event) => {
      const detail = event.detail || {};
      const left = Number(detail.left);
      const top = Number(detail.top);
      if (!Number.isFinite(left) || !Number.isFinite(top)) return;
      const pos = clampSavedMenuPosition(left, top, box);
      box.style.left = `${pos.left}px`;
      box.style.top = `${pos.top}px`;
      box.style.right = "auto";
      box.style.bottom = "auto";
      STATE.savedPosition = pos;
      const finished = detail.phase === "end" || detail.phase === "cancel";
      STATE.dragging = !finished;
      box.classList.toggle("dragging", !finished);
      syncBoundLink(box);
      if (finished) STATE.savedPosition = pos;
    });
    applyDefaultMenuPosition(box);

    bindActionButton(box.querySelector(".prev"), () => navigateDirection("prev"));
    bindActionButton(box.querySelector(".next"), () => navigateDirection("next"));
    bindActionButton(box.querySelector(".close-tab"), closeCurrentTab);
    bindActionButton(box.querySelector(".new-tab"), openStartPage);
    bindActionButton(box.querySelector(".refresh"), reloadPage);
    setupMenuDrag(box);

    if (STATE.savedPosition) applySavedMenuPosition(box);
    else applyDefaultMenuPosition(box);

    return box;
  }

  function setupMenuDrag(box) {
    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let downTarget = null;

    const moveBox = (clientX, clientY) => {
      const pos = clampSavedMenuPosition(startLeft + clientX - startX, startTop + clientY - startY, box);
      box.style.left = `${pos.left}px`;
      box.style.top = `${pos.top}px`;
      box.style.right = "auto";
      box.style.bottom = "auto";
      syncBoundLink(box);
    };

    const keepTemporaryPosition = () => {
      const rect = box.getBoundingClientRect();
      STATE.savedPosition = clampSavedMenuPosition(rect.left, rect.top, box);
    };

    box.addEventListener("pointerdown", (e) => {
      if (e.button != null && e.button !== 0) return;
      pointerId = e.pointerId;
      downTarget = e.target;
      STATE.dragGestureMoved = false;
      startX = e.clientX;
      startY = e.clientY;
      const rect = box.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
    });

    box.addEventListener("pointermove", (e) => {
      if (pointerId !== e.pointerId) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!STATE.dragGestureMoved && Math.abs(dx) <= 6 && Math.abs(dy) <= 6) return;
      e.preventDefault();
      e.stopPropagation();
      if (!STATE.dragGestureMoved) {
        STATE.dragGestureMoved = true;
        STATE.dragging = true;
        box.classList.add("dragging");
        try { box.setPointerCapture(pointerId); } catch (_) {}
      }
      moveBox(e.clientX, e.clientY);
    });

    const finish = (e, cancelled) => {
      if (pointerId !== e.pointerId) return;
      const moved = STATE.dragGestureMoved;
      try { box.releasePointerCapture(pointerId); } catch (_) {}
      pointerId = null;
      STATE.dragging = false;
      box.classList.remove("dragging");
      if (moved) {
        e.preventDefault();
        e.stopPropagation();
        keepTemporaryPosition();
        STATE.suppressClickUntil = Date.now() + 500;
        syncBoundLink(box);
      } else if (!cancelled && downTarget?.closest?.(".page")) {
        promptJumpPage();
      }
      downTarget = null;
      setTimeout(() => { STATE.dragGestureMoved = false; }, 0);
    };

    box.addEventListener("pointerup", (e) => finish(e, false));
    box.addEventListener("pointercancel", (e) => finish(e, true));
  }

  async function updateMenu() {
    if (STATE.navigating) return;

    if (!STATE.enabled) {
      const box = $(`#${SCRIPT_ID}`);
      if (box) box.dataset.hidden = "true";
      return;
    }

    const numericPager = safeCall("数字分页识别失败", detectNumericPager, null);
    STATE.numericPager = numericPager;
    observePagerRoot(numericPager?.root || null);
    STATE.prev = safeCall("上一页识别失败", () => findCandidate("prev", numericPager), null);
    STATE.next = safeCall("下一页识别失败", () => findCandidate("next", numericPager), null);
    STATE.currentPage = safeCall("当前页识别失败", () => getCurrentPage(numericPager), "?");

    // 很多分类/列表第一页 URL 没有 page 参数，或当前页没有 active 标记。
    // 这时从相邻按钮推断：下一页是 2 => 当前页是 1；上一页是 7 => 当前页是 8。
    if (STATE.currentPage === "?" || !STATE.currentPage) {
      STATE.currentPage = safeCall("相邻页码推断失败", () => inferCurrentPageFromAdjacent(STATE.prev, STATE.next), "") || STATE.currentPage;
    }

    const hasPagination = Boolean(STATE.prev || STATE.next);
    const box = safeCall("创建悬浮菜单失败", createMenu, null);
    if (!box) return;
    box.dataset.hidden = "false";
    box.dataset.pagination = hasPagination ? "true" : "false";
    box.querySelector(".page span").textContent = STATE.currentPage;
    box.querySelector(".prev").disabled = !STATE.prev;
    box.querySelector(".next").disabled = !STATE.next;
    requestAnimationFrame(() => {
      if (STATE.dragging) return;
      safeCall("悬浮菜单定位失败", () => {
        if (STATE.savedPosition) {
          applySavedMenuPosition(box);
        } else {
          applyDefaultMenuPosition(box);
        }
        syncBoundLink(box);
      });
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
    STATE.updateTimer = null;
    if (document.hidden) return;
    STATE.updateTimer = setTimeout(() => {
      STATE.updateTimer = null;
      if (!document.hidden) runWhenIdle(() => { if (!document.hidden) updateMenu(); }, 800);
    }, delay);
  }

  function candidateUsable(candidate) {
    if (!candidate) return false;
    if (candidate.__paginationUrl) return true;
    if (candidate.__paginationElement) return Boolean(candidate.__paginationElement.isConnected);
    return !(candidate instanceof Element) || candidate.isConnected;
  }

  function scheduleEventUpdate(withFallback = true) {
    scheduleUpdate(0);
    if (STATE.fallbackTimer) clearTimeout(STATE.fallbackTimer);
    STATE.fallbackTimer = null;
    STATE.fallbackAttempt = 0;
    if (document.hidden || !withFallback) return;

    const retryLatePagination = () => {
      STATE.fallbackTimer = null;
      if (document.hidden || candidateUsable(STATE.prev) || candidateUsable(STATE.next)) return;
      scheduleUpdate(0);
      STATE.fallbackAttempt += 1;
      const delays = [1000, 2000, 4000];
      if (STATE.fallbackAttempt < delays.length) {
        STATE.fallbackTimer = setTimeout(retryLatePagination, delays[STATE.fallbackAttempt]);
      }
    };
    STATE.fallbackTimer = setTimeout(retryLatePagination, 1000);
  }

  function elementHasPaginationSignal(el) {
    if (!(el instanceof Element)) return false;
    if (el.matches?.(PAGINATION_CONTAINER_SELECTOR)) return true;
    if (paginationContainer(el)) return true;
    if (el.matches?.('[rel~="next"], [rel~="prev"], [aria-current="page"], [data-page], [data-page-number], [class*="next" i], [class*="prev" i]')) return true;
    if (el.matches?.('a, button, [role="button"]')) {
      const text = normalizeText(el);
      return /^\s*0*\d{1,5}\s*$/.test(text) || /\bnext\b|\bprev(?:ious)?\b|下一页|上一页|[›»→‹«←]/i.test(text);
    }
    return false;
  }

  function mutationTouchesPagination(mutation) {
    const mutationTarget = mutation.target instanceof Element ? mutation.target : mutation.target?.parentElement;
    if (mutationTarget?.closest?.(`#${SCRIPT_ID}, #${SCRIPT_ID}-jump-mask`) || mutationTarget?.id === `${SCRIPT_ID}-style`) return false;
    const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
    return nodes.some((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        if (!/^\s*\d{1,5}\s*$/.test(node.textContent || "")) return false;
        const parent = node.parentElement || mutationTarget;
        if (!(parent instanceof Element)) return false;
        if (parent.closest?.(`#${SCRIPT_ID}, #${SCRIPT_ID}-jump-mask`)) return false;
        return elementHasPaginationSignal(parent) || Boolean(parent.closest?.("ul, ol")?.querySelector?.('[aria-current="page"], [class~="current"], [class~="active"], [class~="selected"], [data-page], [data-page-number]'));
      }
      if (!(node instanceof Element)) return false;
      if (node.closest?.(`#${SCRIPT_ID}, #${SCRIPT_ID}-jump-mask`) || node.id === `${SCRIPT_ID}-style`) return false;
      if (node === document.body || elementHasPaginationSignal(node)) return true;
      const descendants = $$(`${PAGINATION_CONTAINER_SELECTOR}, a, button, [role="button"], [data-page], [data-page-number], [aria-current="page"], [rel~="next"], [rel~="prev"]`, node);
      return descendants.slice(0, 80).some(elementHasPaginationSignal);
    });
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
    safeCall("包装 pushState 失败", () => wrap("pushState"));
    safeCall("包装 replaceState 失败", () => wrap("replaceState"));
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

    hookHistory();
    normalizeXVideosHashLater();
    scheduleEventUpdate();

    STATE.observer = new MutationObserver((mutations) => {
      safeCall("动态分页观察失败", () => {
        const menuMissing = !document.getElementById(SCRIPT_ID);
        const styleMissing = !document.getElementById(`${SCRIPT_ID}-style`);
        if (menuMissing || styleMissing || mutations.some(mutationTouchesPagination)) scheduleEventUpdate(false);
      });
    });
    // 观察整棵文档，但只在新增/移除节点含分页信号时防抖重扫；忽略脚本自身 UI。
    STATE.observer.observe(observeRoot, { subtree: true, childList: true });

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
        if (STATE.savedPosition) {
          applySavedMenuPosition(box);
        } else {
          applyDefaultMenuPosition(box);
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
