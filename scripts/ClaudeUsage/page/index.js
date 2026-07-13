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
exports.View = void 0;
const scripting_1 = require("scripting");
const api_1 = require("../class/api");
function View() {
    const dismiss = scripting_1.Navigation.useDismiss();
    const reloadKey = (0, scripting_1.useObservable)(0);
    return (createElement(scripting_1.NavigationStack, null,
        createElement(StackView, { reloadKey: reloadKey.value, navigationTitle: scripting_1.Script.name, toolbar: {
                topBarLeading: [createElement(scripting_1.Button, { title: "关闭", systemImage: "xmark", action: dismiss })],
                topBarTrailing: [
                    createElement(scripting_1.Button, { title: "账号", systemImage: "person.crop.circle", action: () => scripting_1.Navigation.present(createElement(AccountView, { onChanged: () => reloadKey.setValue(reloadKey.value + 1) })) }),
                ],
            } })));
}
exports.View = View;
function AccountView({ onChanged }) {
    const dismiss = scripting_1.Navigation.useDismiss();
    function done(message) {
        return __awaiter(this, void 0, void 0, function* () {
            scripting_1.Widget.reloadUserWidgets();
            onChanged();
            yield Dialog.alert({ message });
            dismiss();
        });
    }
    return (createElement(scripting_1.NavigationStack, null,
        createElement(scripting_1.List, { navigationTitle: "账号管理", toolbar: { topBarLeading: [createElement(scripting_1.Button, { title: "关闭", systemImage: "xmark", action: dismiss })] } },
            createElement(scripting_1.Section, { footer: createElement(scripting_1.Text, null, "平时刷新只使用已保存的 Claude Cookie，不会反复打开 Claude 官网。Cookie 失效后请重新授权；如果只想退出网页登录态，请使用“退出网页登录”。") },
                createElement(scripting_1.Button, { title: "登录 / 重新授权", systemImage: "person.crop.circle.badge.checkmark", action: () => __awaiter(this, void 0, void 0, function* () {
                        const ok = yield api_1.api.presentLogin();
                        yield done(ok ? "凭证保存成功" : "未保存，新凭证获取失败，旧凭证已保留");
                    }) }),
                createElement(scripting_1.Button, { title: "切换账号", systemImage: "arrow.triangle.2.circlepath", action: () => __awaiter(this, void 0, void 0, function* () {
                        const ok = yield api_1.api.switchAccount();
                        yield done(ok ? "已切换账号" : "切换失败，旧账号仍保留");
                    }) }),
                createElement(scripting_1.Button, { title: "退出网页登录（保留本地凭证）", systemImage: "rectangle.portrait.and.arrow.right", action: () => __awaiter(this, void 0, void 0, function* () {
                        yield api_1.api.clearWebLoginState();
                        yield done("已退出网页登录，本地凭证仍保留，可继续刷新额度");
                    }) }),
                createElement(scripting_1.Button, { title: "彻底退出并清除本地凭证", systemImage: "trash", role: "destructive", action: () => __awaiter(this, void 0, void 0, function* () {
                        yield api_1.api.clearSavedAccount();
                        yield done("已彻底退出，并清除本地凭证");
                    }) })))));
}
function StackView({ reloadKey }) {
    var _a, _b;
    const data = (0, scripting_1.useObservable)();
    const needLogin = (0, scripting_1.useObservable)(false);
    function init() {
        return __awaiter(this, void 0, void 0, function* () {
            const cached = api_1.api.getCached();
            const hasCached = !!cached;
            if (cached) {
                // 先秒开显示缓存，后台再刷新。
                data.setValue(cached.usage);
            }
            else {
                data.setValue(undefined);
            }
            needLogin.setValue(false);
            try {
                const r = yield api_1.api.getUsage();
                data.setValue(r);
                scripting_1.Widget.reloadUserWidgets();
            }
            catch (e) {
                if (hasCached) {
                    // 已有缓存时，不因为后台刷新失败打断页面显示。
                    return;
                }
                if (e && e.needLogin) {
                    needLogin.setValue(true);
                    data.setValue(null);
                }
                else {
                    data.setValue(null);
                    yield Dialog.alert({ message: String(e) });
                }
            }
        });
    }
    (0, scripting_1.useEffect)(() => {
        init();
    }, [reloadKey]);
    if (data.value === undefined) {
        return createElement(scripting_1.ProgressView, null);
    }
    if (data.value === null) {
        return (createElement(scripting_1.ContentUnavailableView, { label: createElement(scripting_1.Label, { title: needLogin.value ? "请先登录 Claude" : "暂无数据", systemImage: "person.crop.circle.badge.exclamationmark" }), actions: [
                createElement(scripting_1.Button, { title: "登录", systemImage: "person.crop.circle", action: () => __awaiter(this, void 0, void 0, function* () {
                        const ok = yield api_1.api.presentLogin();
                        if (!ok)
                            yield Dialog.alert({ message: "未保存，新凭证获取失败，旧凭证已保留" });
                        init();
                    }) }),
            ] }));
    }
    const usage = data.value;
    const fivePercent = Math.round((_b = (_a = usage.five_hour) === null || _a === void 0 ? void 0 : _a.utilization) !== null && _b !== void 0 ? _b : 0);
    return (createElement(scripting_1.List, { refreshable: () => __awaiter(this, void 0, void 0, function* () {
            yield Promise.all([init(), new Promise((r) => setTimeout(r, 500))]);
        }) },
        createElement(scripting_1.Section, { header: createElement(scripting_1.HStack, null,
                createElement(scripting_1.Text, null, usage.email),
                createElement(scripting_1.Spacer, null),
                createElement(scripting_1.Text, null, usage.plan)), footer: createElement(scripting_1.Text, null, usage.five_hour
                ? "重置: " + new Date(usage.five_hour.resets_at).toLocaleString("zh-CN")
                : "无 5 小时窗口数据") },
            createElement(Bar, { label: "5 小时用量", percent: fivePercent })),
        usage.seven_day ? (createElement(scripting_1.Section, { footer: createElement(scripting_1.Text, null, "重置: " + new Date(usage.seven_day.resets_at).toLocaleString("zh-CN")) },
            createElement(Bar, { label: "7 天用量", percent: Math.round(usage.seven_day.utilization) }))) : null,
        usage.extra_usage && usage.extra_usage.is_enabled ? (createElement(scripting_1.Section, { header: createElement(scripting_1.Text, null, "额外用量"), footer: createElement(scripting_1.Text, null, `已用 ${usage.extra_usage.used_credits} / ${usage.extra_usage.monthly_limit} ${usage.extra_usage.currency}`) },
            createElement(Bar, { label: "额外额度", percent: Math.round(usage.extra_usage.utilization) }))) : null));
}
function Bar({ label, percent }) {
    return (createElement(scripting_1.HStack, { spacing: 10 },
        createElement(scripting_1.Text, { font: "footnote", foregroundStyle: "secondaryLabel", frame: { width: 78, alignment: "leading" } }, label),
        createElement(scripting_1.Rectangle, { frame: { height: 22 }, fill: "tertiarySystemFill", clipShape: { type: "capsule", style: "continuous" }, overlay: createElement(scripting_1.Rectangle, { fill: { gradient: true, color: "tintColor" }, scaleEffect: { x: percent / 100, y: 1, anchor: "leading" }, clipShape: { type: "capsule", style: "continuous" } }) }),
        createElement(scripting_1.Text, { font: "footnote", monospacedDigit: true, frame: { width: 42, alignment: "trailing" } }, `${percent}%`)));
}
