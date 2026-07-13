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
exports.ReloadIntent = void 0;
const scripting_1 = require("scripting");
const api_1 = require("./class/api");
function withTimeout(p, ms) {
    return Promise.race([
        p,
        new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), ms)),
    ]);
}
exports.ReloadIntent = scripting_1.AppIntentManager.register({
    name: scripting_1.Script.name,
    protocol: scripting_1.AppIntentProtocol.AppIntent,
    perform: () => __awaiter(void 0, void 0, void 0, function* () {
        // 点击小组件时先主动拉取最新数据并写入缓存，再请求 WidgetKit 刷新展示。
        // 即使实时拉取失败，也继续触发系统刷新，保持原有兜底逻辑。
        try {
            yield withTimeout(api_1.api.getUsage(), 12000);
        }
        catch (_a) {
            // ignore
        }
        scripting_1.Widget.reloadUserWidgets();
    }),
});
