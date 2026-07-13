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
const LOGIN_FLAG = "codex_logged_in";
const CACHE_KEY = "codex_usage_cache";
const COOKIE_KEY = "codex_saved_cookies";
const TOKEN_KEY = "codex_access_token";
class API {
    constructor() {
        this.base = "https://chatgpt.com";
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
    getSavedToken() {
        return Storage.get(TOKEN_KEY) || "";
    }
    saveToken(token) {
        if (token)
            Storage.set(TOKEN_KEY, token);
    }
    getUsageByToken(token) {
        return __awaiter(this, void 0, void 0, function* () {
            const usage = yield (0, scripting_1.fetch)(`${this.base}/backend-api/wham/usage`, {
                headers: {
                    accept: "application/json",
                    authorization: `Bearer ${token}`,
                },
            }).then((r) => {
                if (r.status === 401 || r.status === 403) {
                    const err = new Error("TOKEN_INVALID");
                    err.tokenInvalid = true;
                    throw err;
                }
                return r.json();
            });
            const rl = usage.rate_limit || {};
            return {
                email: usage.email || "",
                plan: normalizePlan(usage.plan_type || ""),
                rate_limit: {
                    primary_window: rl.primary_window || null,
                    secondary_window: rl.secondary_window || null,
                },
            };
        });
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
    /**
     * 拉取 Codex(ChatGPT) 用量。通过隐藏的 WebView 加载 chatgpt.com 并在页面内 fetch 内部接口。
     * 若未登录会抛出带有 needLogin 标记的错误。
     */
    getUsage() {
        return __awaiter(this, void 0, void 0, function* () {
            // 只走快路径：使用已保存 accessToken 直接请求 usage。
            // token 缺失/失效时直接要求重新登录，不在后台走 WebView 慢刷新。
            const savedToken = this.getSavedToken();
            if (!savedToken) {
                this.markLogin(false);
                const err = new Error("NEED_LOGIN");
                err.needLogin = true;
                throw err;
            }
            try {
                const usage = yield this.getUsageByToken(savedToken);
                this.markLogin(true);
                this.writeCache(usage);
                return usage;
            }
            catch (_a) {
                Storage.set(TOKEN_KEY, "");
                this.markLogin(false);
                const err = new Error("NEED_LOGIN");
                err.needLogin = true;
                throw err;
            }
        });
    }
    readSessionToken(wv) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const raw = yield wv.evaluateJavaScript(`
        return (async () => {
          try {
            const s = await fetch('/api/auth/session', { credentials: 'include' }).then(r => r.json());
            return JSON.stringify({ token: s.accessToken || '', email: s.user && s.user.email || '' });
          } catch (e) {
            return JSON.stringify({ token: '', error: String(e) });
          }
        })();
      `);
                const data = JSON.parse(raw);
                return data.token || "";
            }
            catch (_a) {
                // ignore
            }
            return "";
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
    /** 只退出 WebView/内置浏览器的网页登录态，保留本地保存的 token/cookie/cache。 */
    clearWebLoginState() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.clearServiceWebCookies([
                this.base,
                "https://auth.openai.com",
                "https://auth0.openai.com",
                "https://openai.com",
            ]);
        });
    }
    /** 彻底清除本地保存的 token/cookie/cache，用于完全退出，不用于切换账号。 */
    clearSavedAccount() {
        return __awaiter(this, void 0, void 0, function* () {
            Storage.set(TOKEN_KEY, "");
            Storage.set(COOKIE_KEY, []);
            Storage.set(CACHE_KEY, null);
            this.markLogin(false);
            yield this.clearWebLoginState();
        });
    }
    switchAccount() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            // 保留旧 token/cookie/cache，只有新账号登录成功并能拉到用量后才覆盖。
            const oldToken = Storage.get(TOKEN_KEY) || "";
            const oldCookies = (_a = Storage.get(COOKIE_KEY)) !== null && _a !== void 0 ? _a : [];
            const oldCache = (_b = Storage.get(CACHE_KEY)) !== null && _b !== void 0 ? _b : null;
            const oldLogin = this.hasLogin;
            const wv = new WebViewController();
            try {
                yield wv.clearAllCookies();
                yield wv.loadURL(`${this.base}/auth/login`);
                yield wv.present({ fullscreen: true, navigationTitle: "切换 ChatGPT 账号" });
                yield wv.loadURL(`${this.base}/`);
                yield wv.waitForLoad();
                yield this.saveCookies(wv);
                const token = yield this.readSessionToken(wv);
                if (!token) {
                    Storage.set(TOKEN_KEY, oldToken);
                    Storage.set(COOKIE_KEY, oldCookies);
                    Storage.set(CACHE_KEY, oldCache);
                    this.markLogin(oldLogin);
                    return false;
                }
                Storage.set(TOKEN_KEY, token);
                try {
                    const u = yield this.getUsage();
                    this.markLogin(!!u.email || !!u.rate_limit.primary_window);
                    return true;
                }
                catch (_c) {
                    // 新 token 检测失败：恢复旧凭证，避免旧账号也丢失。
                    Storage.set(TOKEN_KEY, oldToken);
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
     * 弹出 chatgpt.com 登录页，登录成功后 Cookie 会保存在共享的 WebView data store 中。
     */
    presentLogin() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const oldToken = Storage.get(TOKEN_KEY) || "";
            const oldCookies = (_a = Storage.get(COOKIE_KEY)) !== null && _a !== void 0 ? _a : [];
            const oldCache = (_b = Storage.get(CACHE_KEY)) !== null && _b !== void 0 ? _b : null;
            const oldLogin = this.hasLogin;
            const wv = new WebViewController();
            try {
                yield wv.loadURL(`${this.base}/auth/login`);
                yield wv.present({ fullscreen: true, navigationTitle: "登录 ChatGPT" });
                yield wv.loadURL(`${this.base}/`);
                yield wv.waitForLoad();
                yield this.saveCookies(wv);
                const token = yield this.readSessionToken(wv);
                if (!token) {
                    Storage.set(TOKEN_KEY, oldToken);
                    Storage.set(COOKIE_KEY, oldCookies);
                    Storage.set(CACHE_KEY, oldCache);
                    this.markLogin(oldLogin);
                    return false;
                }
                Storage.set(TOKEN_KEY, token);
                // 关闭后用新 token 快速检测并写入缓存
                try {
                    const u = yield this.getUsage();
                    this.markLogin(!!u.email || !!u.rate_limit.primary_window);
                    return true;
                }
                catch (_c) {
                    Storage.set(TOKEN_KEY, oldToken);
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
function normalizePlan(plan) {
    if (!plan)
        return "";
    const p = plan.toLowerCase();
    if (p.includes("pro"))
        return "Pro";
    if (p.includes("team"))
        return "Team";
    if (p.includes("enterprise"))
        return "Enterprise";
    if (p.includes("plus"))
        return "Plus";
    if (p.includes("free"))
        return "Free";
    return plan;
}
exports.api = new API();
