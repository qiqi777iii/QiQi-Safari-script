"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.View = void 0;
const scripting_1 = require("scripting");
const header_1 = require("./comp/header");
function fmt(iso) {
    return iso
        ? new Date(iso).toLocaleString("zh-CN", {
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
        createElement(Progress, { percent: percent, padding: { bottom: 6 } }),
        hasWeek ? (createElement(Progress, { percent: Math.round(weekPercent), label: "7d", padding: { bottom: 6 } })) : null,
        createElement(scripting_1.Spacer, null),
        createElement(ResetRow, { label: "Reset:", value: fmt(hasWeek ? weekReset !== null && weekReset !== void 0 ? weekReset : reset : reset) })));
}
exports.View = View;
function ResetRow({ label, value }) {
    return (createElement(scripting_1.HStack, { font: "caption2", fontWeight: "semibold", foregroundStyle: "secondaryLabel" },
        createElement(scripting_1.Text, { lineLimit: 1, minScaleFactor: 0.6 }, label),
        createElement(scripting_1.Spacer, { minLength: 4 }),
        createElement(scripting_1.Text, { lineLimit: 1, minScaleFactor: 0.6, monospacedDigit: true }, value)));
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
