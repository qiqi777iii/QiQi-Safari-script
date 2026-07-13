"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.View = void 0;
const scripting_1 = require("scripting");
function View({ percent }) {
    const size = 11;
    return (createElement(scripting_1.Gauge, { gaugeStyle: "accessoryCircular", min: 0, max: 100, value: percent, tint: "tertiaryLabel", label: createElement(scripting_1.Image, { opacity: 0.3, resizable: true, scaleToFit: true, frame: { height: size, width: size }, filePath: {
                light: scripting_1.Script.directory + "/image/light.png",
                dark: scripting_1.Script.directory + "/image/dark.png",
            } }), currentValueLabel: createElement(scripting_1.Text, null, `${percent}%`) }));
}
exports.View = View;
