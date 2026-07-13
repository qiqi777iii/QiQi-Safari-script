"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.View = void 0;
const scripting_1 = require("scripting");
const header_1 = require("./comp/header");
function fmt(ts) {
    return ts
        ? new Date(ts * 1000).toLocaleString("zh-CN", {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
        })
        : "—";
}
function View({ plan, percent, reset, weekPercent, weekReset, stale, }) {
    const hasWeek = weekPercent != null;
    return (createElement(scripting_1.VStack, { padding: true, alignment: "leading" },
        createElement(header_1.View, { plan: plan }),
        createElement(scripting_1.Divider, null),
        createElement(scripting_1.Spacer, null),
        createElement(Progress, { percent: percent, label: "5h", padding: { bottom: 2 } }),
        createElement(ResetRow, { label: hasWeek ? "5h:" : "Reset:", value: fmt(reset) }),
        hasWeek ? (createElement(Fragment, null,
            createElement(Progress, { percent: Math.round(weekPercent), label: "7d", padding: { bottom: 2, top: 2 } }),
            createElement(ResetRow, { label: "7d:", value: fmt(weekReset !== null && weekReset !== void 0 ? weekReset : null) }))) : null));
}
exports.View = View;
function ResetRow({ label, value }) {
    return (createElement(scripting_1.HStack, { font: "caption2", fontWeight: "semibold", foregroundStyle: "secondaryLabel" },
        createElement(scripting_1.Text, { lineLimit: 1, minScaleFactor: 0.55 }, label),
        createElement(scripting_1.Spacer, { minLength: 4 }),
        createElement(scripting_1.Text, { lineLimit: 1, minScaleFactor: 0.55, monospacedDigit: true }, value)));
}
function Progress({ percent, label }) {
    const cornerRadius = 13;
    return (createElement(scripting_1.ZStack, null,
        createElement(scripting_1.Rectangle, { fill: "tertiarySystemFill", clipShape: {
                type: "rect",
                cornerRadius: cornerRadius,
            }, overlay: createElement(scripting_1.Rectangle, { fill: {
                    gradient: true,
                    color: "tintColor",
                }, scaleEffect: {
                    x: percent / 100,
                    y: 1,
                    anchor: "leading",
                }, clipShape: {
                    type: "rect",
                    cornerRadius: cornerRadius,
                } }) }),
        createElement(scripting_1.HStack, null,
            label ? (createElement(scripting_1.Text, { font: "caption2", fontWeight: "semibold", padding: { leading: 9 }, foregroundStyle: "label" }, label)) : null,
            createElement(scripting_1.Spacer, null),
            createElement(scripting_1.Text, { font: "headline", padding: { trailing: 9 }, monospacedDigit: true }, `${percent}%`))));
}
