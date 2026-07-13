"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.api = void 0;
const scripting_1 = require("scripting");
const LOGIN_FLAG = "claude_logged_in";
const CACHE_KEY = "claude_usage_cache";
const COOKIE_KEY = "claude_saved_cookies";
class API {
    constructor() {
        this.base = "https://claude.ai";
    }
    /** 是否曾经成功登录过(用于页面提示) */
    get hasLogin() {
        return Storage.get(LOGIN_FLAG) === true;
    }
    markLogin(v) {
        Storage.set(LOGIN_FLAG, v);
    }
    /** 读取上一次成功的缓存用量（供小组件秒出） */
    getCached() {
        var _a;
        return (_a = Storage.get(CACHE_KEY)) !== null && _a !== void 0 ? _a : null;
    }
    writeCache(usage) {
        Storage.set(CACHE_KEY, { usage, ts: Date.now() });
    }
    getSavedCookies() {
        var _a;
        return (_a = Storage.get(COOKIE_KEY)) !== null && _a !== void 0 ? _a : [];
    }
    restoreCookies(wv) {
        return __awaiter(this, void 0, void 0, function* () {
            const cookies = this.getSavedCookies();
            for (const c of cookies) {
                try {
                    yield wv.setCookie(Object.assign(Object.assign({}, c), { expiresDate: c.expiresDate ? new Date(c.expiresDate) : null }));
                }
                catch (_a) {
                    // ignore invalid / expired cookie
                }
            }
        });
    }
    saveCookies(wv) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const cookies = yield wv.getCookies(this.base);
                Storage.set(COOKIE_KEY, cookies.map((c) => (Object.assign(Object.assign({}, c), { expiresDate: c.expiresDate ? new Date(c.expiresDate).toISOString() : null }))));
            }
            catch (_a) {
                // ignore
            }
        });
    }
    getCookieHeader() {
        return this.getSavedCookies()
            .filter((c) => c && c.name && c.value && String(c.domain || "").includes("claude.ai"))
            .map((c) => `${c.name}=${c.value}`)
            .join("; ");
    }
    fetchJSON(path, cookie) {
        return __awaiter(this, void 0, void 0, function* () {
            const res = yield (0, scripting_1.fetch)(`${this.base}${path}`, {
                headers: {
                    accept: "application/json",
                    cookie,
                },
            });
            if (res.status === 401 || res.status === 403) {
                const err = new Error("COOKIE_INVALID");
                err.cookieInvalid = true;
                throw err;
            }
            return res.json();
        });
    }
    getUsageByCookies() {
        return __awaiter(this, void 0, void 0, function* () {
            const cookie = this.getCookieHeader();
            if (!cookie)
                throw new Error("NO_COOKIE");
            const orgs = yield this.fetchJSON("/api/organizations", cookie);
            if (!Array.isArray(orgs) || orgs.length === 0) {
                const err = new Error("NEED_LOGIN");
                err.needLogin = true;
                throw err;
            }
            const org = orgs.find((o) => (o.capabilities || []).includes("claude_pro") ||
                (o.capabilities || []).includes("claude_max")) || orgs[0];
            const caps = org.capabilities || [];
            let plan = "Free";
            if (caps.includes("claude_max"))
                plan = "Max";
            else if (caps.includes("claude_pro"))
                plan = "Pro";
            const usage = yield this.fetchJSON(`/api/organizations/${org.uuid}/usage`, cookie);
            let email = "";
            try {
                const acc = yield this.fetchJSON("/api/account", cookie);
                email = (acc && acc.email_address) || "";
            }
            catch (_a) {
                // ignore
            }
            return {
                email,
                plan,
                org_uuid: org.uuid,
                five_hour: usage.five_hour || null,
                seven_day: usage.seven_day || null,
                extra_usage: usage.extra_usage || null,
            };
        });
    }
    /**
     * 拉取 Claude 用量。只使用已保存 Cookie 直连 API。
     * Cookie 缺失/失效时要求重新登录，不在后台回退 WebView 慢刷新。
     */
    getUsage() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const usage = yield this.getUsageByCookies();
                this.markLogin(true);
                this.writeCache(usage);
                return usage;
            }
            catch (_a) {
                this.markLogin(false);
                const err = new Error("NEED_LOGIN");
                err.needLogin = true;
                throw err;
            }
        });
    }
    clearServiceWebCookies() {
        return __awaiter(this, arguments, void 0, function* (urls = [this.base]) {
            const wv = new WebViewController();
            try {
                const deleted = new Set();
                for (const url of urls) {
                    let cookies = [];
                    try {
                        cookies = yield wv.getCookies(url);
                    }
                    catch (_a) {
                        cookies = [];
                    }
                    for (const c of cookies) {
                        const key = `${c.name}|${c.domain}|${c.path}`;
                        if (deleted.has(key))
                            continue;
                        deleted.add(key);
                        try {
                            yield wv.deleteCookie({ name: c.name, domain: c.domain, path: c.path });
                        }
                        catch (_b) {
                            // ignore
                        }
                    }
                }
            }
            finally {
                wv.dispose();
            }
        });
    }
    /** 只退出 WebView/内置浏览器的网页登录态，保留本地保存的 cookie/cache。 */
    clearWebLoginState() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.clearServiceWebCookies([this.base]);
        });
    }
    /** 彻底清除本地保存的 cookie/cache，用于完全退出，不用于切换账号。 */
    clearSavedAccount() {
        return __awaiter(this, void 0, void 0, function* () {
            Storage.set(COOKIE_KEY, []);
            Storage.set(CACHE_KEY, null);
            this.markLogin(false);
            yield this.clearServiceWebCookies([this.base]);
        });
    }
    switchAccount() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            // 保留旧 cookie/cache，只有新账号登录成功并能拉到用量后才覆盖。
            const oldCookies = (_a = Storage.get(COOKIE_KEY)) !== null && _a !== void 0 ? _a : [];
            const oldCache = (_b = Storage.get(CACHE_KEY)) !== null && _b !== void 0 ? _b : null;
            const oldLogin = this.hasLogin;
            const wv = new WebViewController();
            try {
                yield wv.clearAllCookies();
                yield wv.loadURL(`${this.base}/login`);
                yield wv.present({ fullscreen: true, navigationTitle: "切换 Claude 账号" });
                yield this.saveCookies(wv);
                try {
                    const u = yield this.getUsage();
                    this.markLogin(!!u.email || !!u.org_uuid);
                    return true;
                }
                catch (_c) {
                    // 新账号未登录成功：恢复旧凭证，避免旧账号也丢失。
                    Storage.set(COOKIE_KEY, oldCookies);
                    Storage.set(CACHE_KEY, oldCache);
                    this.markLogin(oldLogin);
                    return false;
                }
            }
            finally {
                wv.dispose();
            }
        });
    }
    /**
     * 弹出 claude.ai 登录页，登录成功后 Cookie 会保存在共享的 WebView data store 中。
     */
    presentLogin() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const oldCookies = (_a = Storage.get(COOKIE_KEY)) !== null && _a !== void 0 ? _a : [];
            const oldCache = (_b = Storage.get(CACHE_KEY)) !== null && _b !== void 0 ? _b : null;
            const oldLogin = this.hasLogin;
            const wv = new WebViewController();
            try {
                yield wv.loadURL(`${this.base}/login`);
                yield wv.present({ fullscreen: true, navigationTitle: "登录 Claude" });
                yield this.saveCookies(wv);
                // 关闭后检测登录态
                try {
                    const u = yield this.getUsage();
                    this.markLogin(!!u.email || !!u.org_uuid);
                    return true;
                }
                catch (_c) {
                    Storage.set(COOKIE_KEY, oldCookies);
                    Storage.set(CACHE_KEY, oldCache);
                    this.markLogin(oldLogin);
                    return false;
                }
            }
            finally {
                wv.dispose();
            }
        });
    }
}
exports.api = new API();
