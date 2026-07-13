"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
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
const scripting_1 = require("scripting");
const app_intents_1 = require("./app_intents");
const api_1 = require("./class/api");
const circular_1 = require("./widget/circular");
const small_1 = require("./widget/small");
function withTimeout(p, ms) {
    return Promise.race([
        p,
        new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), ms)),
    ]);
}
(() => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const cached = api_1.api.getCached();
    let usage = (_a = cached === null || cached === void 0 ? void 0 : cached.usage) !== null && _a !== void 0 ? _a : null;
    let stale = !!cached;
    // 小组件优先展示缓存，保证和 App 页面刚写入的数据同步。
    // 只有没有缓存时才实时获取，避免 WidgetKit 进程中 WebView 慢/超时导致显示旧数据。
    if (!usage) {
        usage = yield withTimeout(api_1.api.getUsage(), 12000);
        stale = false;
    }
    const primary = (_c = (_b = usage.rate_limit) === null || _b === void 0 ? void 0 : _b.primary_window) !== null && _c !== void 0 ? _c : null;
    const secondary = (_e = (_d = usage.rate_limit) === null || _d === void 0 ? void 0 : _d.secondary_window) !== null && _e !== void 0 ? _e : null;
    const percent = Math.round((_f = primary === null || primary === void 0 ? void 0 : primary.used_percent) !== null && _f !== void 0 ? _f : 0);
    const resetAt = (_g = primary === null || primary === void 0 ? void 0 : primary.reset_at) !== null && _g !== void 0 ? _g : null;
    const weekPercent = secondary ? Math.round(secondary.used_percent) : null;
    const weekReset = (_h = secondary === null || secondary === void 0 ? void 0 : secondary.reset_at) !== null && _h !== void 0 ? _h : null;
    switch (scripting_1.Widget.family) {
        case "accessoryCircular":
            scripting_1.Widget.present(createElement(scripting_1.Button, { intent: (0, app_intents_1.ReloadIntent)(undefined), buttonStyle: "plain" },
                createElement(circular_1.View, { percent: percent })));
            break;
        case "systemSmall":
            scripting_1.Widget.present(createElement(scripting_1.Button, { intent: (0, app_intents_1.ReloadIntent)(undefined), buttonStyle: "plain" },
                createElement(small_1.View, { plan: usage.plan, percent: percent, reset: resetAt, weekPercent: weekPercent, weekReset: weekReset, stale: stale })));
            break;
        default:
            throw new Error("未适配的 Widget 尺寸");
    }
}))().catch((e) => __awaiter(void 0, void 0, void 0, function* () {
    const { Text, VStack } = yield Promise.resolve().then(() => __importStar(require("scripting")));
    const needLogin = e && e.needLogin;
    scripting_1.Widget.present(createElement(VStack, { padding: true },
        createElement(Text, { font: "caption", foregroundStyle: needLogin ? "orange" : "red" }, needLogin ? "请打开 App 登录 ChatGPT" : String(e))));
}));
