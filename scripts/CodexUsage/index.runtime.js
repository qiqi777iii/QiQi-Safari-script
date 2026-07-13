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
const scripting_1 = require("scripting");
const page_1 = require("./page");
(() => __awaiter(void 0, void 0, void 0, function* () {
    yield scripting_1.Navigation.present({
        element: createElement(page_1.View, null),
        // modalPresentationStyle: "fullScreen",
    });
}))().finally(scripting_1.Script.exit);
