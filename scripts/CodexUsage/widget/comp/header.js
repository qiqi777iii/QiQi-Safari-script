"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.View = void 0;
const scripting_1 = require("scripting");
function View({ plan }) {
    const size = 19;
    return (createElement(scripting_1.Link, { url: "https://chatgpt.com", buttonStyle: "plain" },
        createElement(scripting_1.HStack, null,
            createElement(scripting_1.Image, { resizable: true, scaleToFit: true, frame: { width: size, height: size }, filePath: {
                    light: scripting_1.Script.directory + "/image/light.png",
                    dark: scripting_1.Script.directory + "/image/dark.png",
                } }),
            createElement(scripting_1.Text, { font: "headline", padding: { top: -2, leading: 4 } }, "Codex"),
            createElement(scripting_1.Spacer, null),
            plan ? (createElement(scripting_1.Text, { font: "caption2", fontWeight: "bold", foregroundStyle: "tintColor" }, plan)) : null)));
}
exports.View = View;
