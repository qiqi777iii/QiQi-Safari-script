// ==UserScript==
// @name         磁力链验车
// @namespace    https://github.com/qiqi777iii/Scripts
// @modifiedFrom 磁力验车助手 Beta: https://sleazyfork.org/zh-CN/scripts/565230-%E7%A3%81%E5%8A%9B%E9%AA%8C%E8%BD%A6%E5%8A%A9%E6%89%8B-beta
// @modifiedFrom 磁力/电驴链接助手: https://sleazyfork.org/zh-CN/scripts/577143-%E7%A3%81%E5%8A%9B-%E7%94%B5%E9%A9%B4%E9%93%BE%E6%8E%A5%E5%8A%A9%E6%89%8B
// @version      1.0.0
// @description  识别网页中的磁力链接，提供验车和复制功能。
// @icon         https://uxwing.com/wp-content/themes/uxwing/download/seo-marketing/magnet-magnetic-icon.png
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @grant        GM.setClipboard
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      *
// @connect      whatslink.info
// @homepageURL  https://github.com/qiqi777iii/Scripts
// @supportURL   https://github.com/qiqi777iii/Scripts/issues
// @updateURL    https://raw.githubusercontent.com/qiqi777iii/Scripts/main/userscripts/magnet-link-checker.user.js
// @downloadURL  https://raw.githubusercontent.com/qiqi777iii/Scripts/main/userscripts/magnet-link-checker.user.js
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // ================= 1. 基础配置 =================
    const config = {
        enableCopy: GM_getValue('enableCopy', true),
        enableQb: GM_getValue('enableQb', false),
        enable115: GM_getValue('enable115', false),
        enableCheck: GM_getValue('enableCheck', true),
        qbtHost: GM_getValue('qbtHost', 'http://127.0.0.1:8080'),
        qbtUser: GM_getValue('qbtUser', 'admin'),
        qbtPass: GM_getValue('qbtPass', 'adminadmin'),
        u115Cid: GM_getValue('u115Cid', GM_getValue('u115Uid', '')),
        u115Uid: GM_getValue('u115Uid', '')
    };

    GM_registerMenuCommand("⚙️ 脚本综合设置", showSettingsModal);

    // 图标定义
    const ICONS = {
        copy: `<svg viewBox="0 0 24 24" width="18" height="18" fill="#ffffff"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>`,
        qb: `<svg viewBox="0 0 24 24" width="14" height="14" fill="#0078d4"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>`,
        u115: `<svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="11" fill="#2777F8"/><text x="12" y="17" font-family="Arial" font-size="12" font-weight="900" fill="white" text-anchor="middle">5</text></svg>`,
        car: `<svg t="1782891044507" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" width="25" height="25"><path d="M459.082278 628.869754c0-97.614202 53.396117-182.580339 132.456754-227.7941L196.27678 401.075655l51.250244-134.49825c6.407943-19.208481 16.013719-33.124422 38.479383-33.343409l358.796736 0c22.376637 0.218988 31.994692 14.134929 38.400588 33.343409l38.059827 99.892081c0.082888 0 0.150426-0.016373 0.230244-0.016373 25.128307 0 49.349965 3.734044 72.360028 10.344602l-56.94392-145.453766c-12.811794-33.124422-40.556695-61.418838-92.926436-61.418838L286.748305 169.925111c-52.303226 0-80.07678 28.293393-92.846618 61.418838l-68.088748 173.832094c-27.01733 3.423983-74.775031 34.784224-74.775031 94.16873l0 221.170239 76.56991 0 0 55.061037c0 86.99433 103.636359 85.99149 103.636359 0l0-55.061037 244.61316 0c-10.66899-28.565593-16.781198-59.356876-16.781198-91.647303L459.082278 628.867708zM217.719138 586.586742c-32.42141 0-58.751079-26.79118-58.751079-59.886949 0-33.126468 26.325575-59.912531 58.751079-59.912531 32.423457 0 58.72345 26.79118 58.72345 59.912531C276.442588 559.800679 250.141572 586.586742 217.719138 586.586742L217.719138 586.586742zM721.520409 403.63699c-124.170021 0-225.240951 101.022835-225.240951 225.242997 0 124.193557 101.071953 225.192855 225.240951 225.192855 124.190487-0.004093 225.191832-100.999298 225.191832-225.192855C946.711218 504.658801 845.710896 403.63699 721.520409 403.63699L721.520409 403.63699zM721.520409 801.061488c-94.952582 0-172.182524-77.228919-172.182524-172.181501 0-94.949512 77.229942-172.151825 172.182524-172.151825 94.978165 0 172.155918 77.202313 172.155918 172.151825C893.681444 723.83257 816.498574 801.061488 721.520409 801.061488L721.520409 801.061488zM721.143832 746.494709" fill="#ffffff"></path><path d="M944.055738 841.736886c-6.432503 0-12.897751-2.136663-18.268062-6.523577l-60.141752-49.182143c-12.350283-10.093892-14.174837-28.29544-4.075829-40.646746 10.100032-12.347213 28.296463-14.174837 40.648792-4.074805l60.142775 49.180096c12.347213 10.094916 14.173814 28.296463 4.074805 40.648792C960.726419 838.119499 952.42229 841.736886 944.055738 841.736886z" fill="#ffffff"></path></svg>`,
        checkActive: `<svg viewBox="0 0 24 24" width="14" height="14" fill="#28a745"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`
    };

    // ================= 2. 注入CSS（新增链接样式）=================
    const style = document.createElement('style');
    style.innerHTML = `
        .mag-btn-group {
            display: inline-flex !important;
            vertical-align: middle !important;
            margin-left: 4px !important;
            gap: 3px !important;
            background: transparent !important;
            padding: 0 !important;
            border-radius: 0 !important;
            border: 0 !important;
            box-shadow: none !important;
            transition: box-shadow 0.2s;
        }
        .mag-btn-group:hover {
            box-shadow: none !important;
        }
        .mag-btn {
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            width: 22px !important;
            height: 24px !important;
            background: transparent !important;
            border: 0 !important;
            border-radius: 5px !important;
            cursor: pointer !important;
            transition: all 0.2s ease !important;
            box-shadow: none !important;
            position: relative;
            overflow: hidden;
        }
        .mag-btn:hover {
            background: transparent !important;
            transform: none;
            box-shadow: none !important;
        }
        .mag-btn.active {
            background: rgba(34,197,94,.12) !important;
            box-shadow: none !important;
        }
        /* 涟漪效果 */
        .mag-btn::after {
            content: '';
            position: absolute;
            top: 50%;
            left: 50%;
            width: 0;
            height: 0;
            border-radius: 50%;
            background: rgba(0,120,212,0.3);
            transform: translate(-50%, -50%);
            transition: width 0.3s, height 0.3s;
        }
        .mag-btn:active::after {
            width: 80px;
            height: 80px;
        }
        /* 绿色勾弹入动画 */
        @keyframes popIn {
            0% { transform: scale(0); opacity: 0; }
            80% { transform: scale(1.2); }
            100% { transform: scale(1); opacity: 1; }
        }
        .mag-btn.active svg {
            animation: popIn 0.2s ease-out;
        }
        .mag-btn.mag-check-btn {
            width: 46px !important;
            height: 34px !important;
            background: #6a00d4 !important;
            border: 0 !important;
            border-radius: 5px !important;
            box-shadow: 0 1px 4px rgba(106,0,212,.28) !important;
        }
        .mag-btn.mag-check-btn:hover {
            background: #7b18ee !important;
            box-shadow: 0 2px 6px rgba(106,0,212,.36) !important;
        }
        .mag-btn.mag-copy-btn {
            width: 46px !important;
            height: 34px !important;
            background: #2563eb !important;
            border: 0 !important;
            border-radius: 5px !important;
            opacity: 1;
            box-shadow: 0 1px 4px rgba(37,99,235,.25) !important;
        }
        .mag-btn.mag-copy-btn:hover {
            background: #1d4ed8 !important;
            box-shadow: 0 2px 6px rgba(37,99,235,.34) !important;
        }
        .mag-btn.mag-copy-btn.active {
            background: #2563eb !important;
            box-shadow: 0 0 0 2px rgba(37,99,235,.22) !important;
        }
        .mag-btn.mag-copy-btn svg {
            width: 25px !important;
            height: 25px !important;
            display: block;
        }
        .mag-btn.mag-check-btn svg {
            width: 33px !important;
            height: 33px !important;
            display: block;
        }
        #jav-nong-table td:nth-child(3),
        #nong-table-new td:nth-child(3) {
            min-width: 88px;
            text-align: center;
        }
        #jav-nong-table td:nth-child(3):not(.mag-laosiji-ready-cell)::after,
        #nong-table-new td:nth-child(3):not(.mag-laosiji-ready-cell)::after {
            content: '';
            display: inline-block;
            width: 84px;
            height: 24px;
            border-radius: 7px;
            border: 1px solid #e5e7eb;
            background: linear-gradient(90deg, #f8fafc 0%, #eef2f7 48%, #f8fafc 100%);
            background-size: 180% 100%;
            vertical-align: middle;
            animation: magLaosijiHold 1.2s ease-in-out infinite;
        }
        #jav-nong-table td.mag-laosiji-ready-cell::after,
        #nong-table-new td.mag-laosiji-ready-cell::after {
            content: none !important;
        }
        @keyframes magLaosijiHold {
            0%, 100% { background-position: 0 0; opacity: .62; }
            50% { background-position: 100% 0; opacity: .9; }
        }
        #jav-nong-table .mag-btn-group,
        #nong-table-new .mag-btn-group {
            margin-left: 0 !important;
            gap: 2px !important;
            padding: 2px 2px !important;
            border-radius: 6px !important;
            vertical-align: middle !important;
        }
        #jav-nong-table .mag-btn,
        #nong-table-new .mag-btn {
            width: 22px !important;
            height: 20px !important;
            border-radius: 5px !important;
        }
        #jav-nong-table .mag-btn.mag-check-btn,
        #nong-table-new .mag-btn.mag-check-btn,
        #jav-nong-table .mag-btn.mag-copy-btn,
        #nong-table-new .mag-btn.mag-copy-btn {
            width: 46px !important;
            height: 34px !important;
        }
        #jav-nong-table .mag-btn svg,
        #nong-table-new .mag-btn svg {
            width: 13px !important;
            height: 13px !important;
        }
        #jav-nong-table .mag-btn.mag-check-btn svg,
        #nong-table-new .mag-btn.mag-check-btn svg {
            width: 33px !important;
            height: 33px !important;
        }
        #jav-nong-table .mag-btn.mag-copy-btn svg,
        #nong-table-new .mag-btn.mag-copy-btn svg {
            width: 25px !important;
            height: 25px !important;
        }
        #jav-nong-table td,
        #nong-table-new td {
            overflow: hidden;
        }
        /* 验车弹窗样式 */
        .magnet-link {
            color: #1b6ad0;
            word-break: break-all;
        }
        .magnet-link:hover {
            color: #155a8a;
            text-decoration: underline;
        }
        .ed2k-link {
            color: #d63384;
            word-break: break-all;
        }
        .ed2k-link:hover {
            color: #b32a69;
            text-decoration: underline;
        }
        .ftp-link {
            color: #ffc107;
            word-break: break-all;
        }
        .ftp-link:hover {
            color: #e0a800;
            text-decoration: underline;
        }
        .http-link {
            color: #28a745;
            word-break: break-all;
        }
        .http-link:hover {
            color: #218838;
            text-decoration: underline;
        }
        .whatslink-overlay { position: fixed; inset: 0; z-index: 10000040; display: flex; align-items: center; justify-content: center; padding: 22px; background: rgba(15,23,42,.66); backdrop-filter: blur(8px); }
        .whatslink-modal { width: min(1100px,96vw); max-height: 90vh; display: grid; grid-template-columns: 1.55fr .75fr; background: #f5f7fb; border: 1px solid rgba(203,213,225,.9); border-radius: 12px; overflow: hidden; box-shadow: 0 30px 80px rgba(2,8,23,.38); font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
        .whatslink-modal.no-shots { grid-template-columns: 1.1fr .9fr; }
        .whatslink-viewer { min-width: 0; display: grid; grid-template-rows: minmax(430px,1fr) auto; gap: 10px; padding: 14px; background: radial-gradient(circle at 20% 0%,#fff1f8 0,transparent 34%),#eef3f8; }
        .whatslink-stage { position: relative; min-height: 470px; display: flex; align-items: center; justify-content: center; overflow: hidden; border: 1px solid #dde7f2; border-radius: 12px; background: #111827; box-shadow: 0 18px 36px rgba(15,23,42,.16); }
        .whatslink-stage img { width: 100%; height: 100%; max-height: 68vh; object-fit: contain; border-radius: 10px; }
        .whatslink-modal.no-shots .whatslink-viewer { grid-template-rows: minmax(430px,1fr); background: linear-gradient(135deg,#f8fafc,#eef2ff); }
        .whatslink-modal.no-shots .whatslink-stage { background: linear-gradient(145deg,#fff,#f1f5f9); border-style: dashed; box-shadow: inset 0 0 0 1px rgba(255,255,255,.8),0 18px 36px rgba(15,23,42,.08); }
        .whatslink-modal.no-shots .whatslink-stage img, .whatslink-modal.no-shots .whatslink-nav, .whatslink-modal.no-shots .whatslink-counter, .whatslink-modal.no-shots .whatslink-thumbs { display: none; }
        .whatslink-empty { display: none; width: min(420px,72%); text-align: center; color: #475569; }
        .whatslink-modal.no-shots .whatslink-empty { display: block; }
        .whatslink-empty-icon { width: 62px; height: 62px; margin: 0 auto 15px; display: grid; place-items: center; border-radius: 18px; background: linear-gradient(135deg,#fce7f3,#e0e7ff); color: #be185d; font-size: 27px; box-shadow: 0 12px 26px rgba(190,24,93,.16); }
        .whatslink-empty-title { font-size: 18px; font-weight: 800; color: #1e293b; margin-bottom: 7px; }
        .whatslink-empty-text { margin: 0; font-size: 13px; line-height: 1.6; }
        .whatslink-nav { position: absolute; top: 50%; transform: translateY(-50%); width: 38px; height: 52px; border: 0; border-radius: 8px; background: rgba(255,255,255,.14); color: #fff; font-size: 28px; cursor: pointer; }
        .whatslink-nav:hover { background: rgba(255,255,255,.24); }
        .whatslink-prev { left: 12px; } .whatslink-next { right: 12px; }
        .whatslink-counter { position: absolute; right: 14px; bottom: 12px; color: #e2e8f0; font-size: 12px; text-shadow: 0 1px 6px rgba(0,0,0,.6); }
        .whatslink-thumbs { display: grid; grid-template-columns: repeat(5,1fr); gap: 7px; padding: 0; background: transparent; }
        .whatslink-thumb { border: 2px solid #e2e8f0; border-radius: 9px; padding: 0; overflow: hidden; background: #fff; cursor: pointer; aspect-ratio: 16 / 9; box-shadow: 0 6px 14px rgba(15,23,42,.08); }
        .whatslink-thumb.active { border-color: #db2777; box-shadow: 0 8px 18px rgba(219,39,119,.22); }
        .whatslink-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .whatslink-info { min-width: 0; padding: 18px 16px; background: #f8fafc; overflow: auto; color: #172033; display: flex; flex-direction: column; }
        .whatslink-head { position: sticky; top: 0; z-index: 2; margin: -18px -16px 16px; padding: 18px 16px 16px; background: rgba(248,250,252,.94); border-bottom: 1px solid #e2e8f0; backdrop-filter: blur(10px); display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
        .whatslink-kicker { color: #db2777; font-size: 13px; font-weight: 800; margin-bottom: 7px; }
        .whatslink-title { margin: 0; font-size: 24px; line-height: 1.2; color: #111827; word-break: break-word; }
        .whatslink-close { width: 34px; height: 34px; border: 0; border-radius: 8px; color: #64748b; background: transparent; cursor: pointer; font-size: 27px; line-height: 1; }
        .whatslink-tag { display: inline-flex; align-items: center; min-height: 25px; padding: 0 10px; margin-top: 10px; border-radius: 999px; background: #ecfdf5; color: #047857; font-size: 13px; font-weight: 700; }
        .whatslink-meta { display: grid; grid-template-columns: 1fr; gap: 13px; margin: 18px 0 0; align-content: start; }
        .whatslink-metric { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 58px; padding: 13px 14px; border: 1px solid #e2e8f0; border-radius: 12px; background: #fff; box-shadow: 0 8px 20px rgba(15,23,42,.06); }
        .whatslink-metric b { color: #172033; font-size: 15px; order: 2; }
        .whatslink-metric span { color: #64748b; font-size: 13px; order: 1; }
        .whatslink-loading { padding: 28px; text-align: center; color: #475569; font-size: 14px; }
        @media (max-width: 768px) {
            .whatslink-overlay { padding: 10px; }
            .whatslink-modal { width: 96vw; max-height: 92vh; grid-template-columns: 1fr; }
            .whatslink-viewer { grid-template-rows: minmax(260px,42vh) auto; padding: 10px; }
            .whatslink-stage { min-height: 260px; }
            .whatslink-info { max-height: 40vh; }
        }
        /* 深色模式 */
        @media (prefers-color-scheme: dark) {
            .mag-btn-group {
                background: transparent !important;
                border: 0 !important;
                box-shadow: none !important;
            }
            .mag-btn {
                background: transparent !important;
                border-color: transparent !important;
            }
            .mag-btn:hover {
                background: #4a4a4a !important;
                border-color: #3399ff !important;
            }
            .mag-btn.active {
                background: #1e3a2a !important;
                border-color: #34ce57 !important;
            }
            .mag-btn.mag-check-btn {
                background: #6a00d4 !important;
                border: 0 !important;
                box-shadow: 0 1px 4px rgba(106,0,212,.28) !important;
            }
            .mag-btn.mag-check-btn:hover {
                background: #7b18ee !important;
                box-shadow: 0 2px 6px rgba(106,0,212,.36) !important;
            }
            .mag-btn.mag-copy-btn,
            .mag-btn.mag-copy-btn.active {
                background: #2563eb !important;
                border: 0 !important;
                box-shadow: 0 1px 4px rgba(37,99,235,.25) !important;
            }
            .mag-btn.mag-copy-btn:hover {
                background: #1d4ed8 !important;
                box-shadow: 0 2px 6px rgba(37,99,235,.34) !important;
            }
            .magnet-link { color: #66b0ff; }
            .ed2k-link { color: #ff79b0; }
            .ftp-link { color: #ffd966; }
            .http-link { color: #6fcf97; }
        }
    `;
    (document.head || document.documentElement).appendChild(style);

    // ================= 3. 工具函数 =================
    function showToast(msg, success = true) {
        const toast = document.createElement('div');
        toast.style.cssText = `position:fixed;bottom:50px;right:30px;background:${success?'#28a745':'#dc3545'};color:white;padding:10px 20px;border-radius:8px;z-index:100000;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.15);`;
        toast.textContent = msg;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);
    }

    function copyTextBySelection(text) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.autocapitalize = 'off';
        textarea.autocomplete = 'off';
        textarea.autocorrect = 'off';
        textarea.spellcheck = false;
        textarea.style.cssText = 'position:fixed;top:0;left:0;width:2px;height:2px;padding:0;border:0;font-size:16px;background:#fff;color:#000;opacity:.01;z-index:2147483647;';
        document.body.appendChild(textarea);
        try {
            textarea.focus();
            textarea.select();
            textarea.setSelectionRange(0, textarea.value.length);
            const selection = window.getSelection && window.getSelection();
            if (selection) {
                selection.removeAllRanges();
                const range = document.createRange();
                range.selectNodeContents(textarea);
                selection.addRange(range);
                textarea.setSelectionRange(0, textarea.value.length);
            }
            return document.execCommand('copy');
        } finally {
            textarea.parentNode.removeChild(textarea);
        }
    }

    function copyText(text) {
        if (!text) return false;
        try {
            if (copyTextBySelection(text)) return true;
        } catch (_) {}
        try {
            if (typeof GM_setClipboard === 'function') {
                GM_setClipboard(text);
                return true;
            }
        } catch (_) {}
        try {
            if (typeof GM !== 'undefined' && GM.setClipboard) {
                GM.setClipboard(text, 'text');
                return true;
            }
        } catch (_) {}
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text);
                return true;
            }
        } catch (_) {}
        return false;
    }

    function setBtnActive(clickedBtn, group) {
        group.querySelectorAll('.mag-btn').forEach(btn => {
            btn.innerHTML = btn.dataset.origIcon;
            btn.classList.remove('active');
        });
        clickedBtn.innerHTML = ICONS.checkActive;
        clickedBtn.classList.add('active');
    }

    function highlightBtn(btn) {
        if (btn.classList.contains('mag-check-btn')) {
            btn.style.boxShadow = '0 0 0 3px rgba(106,0,212,.24)';
            setTimeout(() => {
                btn.style.boxShadow = '';
            }, 250);
            return;
        }
        const originalBg = btn.style.backgroundColor;
        btn.style.backgroundColor = '#ffb74d';
        btn.style.transition = 'background-color 0.2s';
        setTimeout(() => {
            btn.style.backgroundColor = originalBg;
        }, 200);
    }

    function hasOtherMagnetButtons(target) {
        const parent = target.parentElement;
        if (!parent) return false;
        const otherSelectors = [
            '.magnet-combined-button',
            '.magnet-button-part',
            '.magnet-loading-btn',
            '.whatslink-modal'
        ];
        return otherSelectors.some(sel => parent.querySelector(sel));
    }

    // ================= 4. 番号提取 =================
    function extractCodeFromText(text) {
        if (!text) return null;

        const patterns = [
            /([A-Z]{2,15})-(\d{2,10})(?:-(\d+))?/i,
            /([A-Z]{2,15})-([A-Z]{0,2}\d{2,10})/i,
            /FC2[-\s_]?(?:PPV)?[-\s_]?(\d{6,9})/i,
            /(\d{6})[-_ ]?(\d{2,3})/,
            /([A-Z]{1,2})(\d{3,4})/i
        ];

        for (let i = 0; i < patterns.length; i++) {
            const match = text.match(patterns[i]);
            if (match) {
                if (i === 0) {
                    return match[3] ? `${match[1]}-${match[2]}-${match[3]}` : `${match[1]}-${match[2]}`;
                } else if (i === 1) {
                    return match[0];
                } else if (i === 2) {
                    return `FC2-PPV-${match[1]}`;
                } else if (i === 3) {
                    return `${match[1]}-${match[2]}`;
                } else if (i === 4) {
                    return match[0];
                }
            }
        }
        return null;
    }

    // ================= 5. 图片轮播函数 =================
    // ================= 5. ???? =================
    function GM_Request({ method = "GET", url, data = null, headers = {} }) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method,
                url,
                headers,
                data: data && typeof data === "object" ? JSON.stringify(data) : data,
                onload: (res) => {
                    try {
                        const contentType = res.responseHeaders || "";
                        if (contentType.includes("application/json")) {
                            resolve(JSON.parse(res.responseText));
                        } else {
                            resolve(res.responseText);
                        }
                    } catch (err) {
                        reject(err);
                    }
                },
                onerror: (err) => reject(err)
            });
        });
    }

    async function getMagnetInfo(magnet) {
        const url = `https://whatslink.info/api/v1/link?url=${encodeURIComponent(magnet)}`;
        try {
            return await GM_Request({ method: "GET", url, headers: { "Accept": "application/json" } });
        } catch (err) {
            console.error("获取磁力信息失败", err);
            return null;
        }
    }

    function formatBytes(bytes) {
        const num = Number(bytes) || 0;
        if (!num) return '-';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let value = num;
        let index = 0;
        while (value >= 1024 && index < units.length - 1) {
            value /= 1024;
            index += 1;
        }
        return `${value.toFixed(index >= 3 ? 2 : 1)} ${units[index]}`;
    }

    function formatWhatslinkType(payload) {
        const raw = String(payload?.file_type || payload?.type || '').toUpperCase();
        if (raw.includes('FOLDER')) return '文件夹';
        if (raw.includes('FILE')) return '文件';
        return '-';
    }

    function showWhatslinkModal(payload, magnet) {
        document.querySelector('.whatslink-overlay')?.remove();
        const shots = Array.isArray(payload?.screenshots) ? payload.screenshots.map(item => item?.screenshot).filter(Boolean) : [];
        let index = 0;
        const resourceType = formatWhatslinkType(payload);
        const overlay = document.createElement('div');
        overlay.className = 'whatslink-overlay';
        const modal = document.createElement('section');
        modal.className = `whatslink-modal${shots.length ? '' : ' no-shots'}`;
        modal.innerHTML = `
            <div class="whatslink-viewer">
                <div class="whatslink-stage">
                    <button class="whatslink-nav whatslink-prev" type="button">‹</button>
                    <img class="whatslink-hero" alt="截图预览">
                    <button class="whatslink-nav whatslink-next" type="button">›</button>
                    <div class="whatslink-counter"></div>
                    <div class="whatslink-empty">
                        <div class="whatslink-empty-icon">?</div>
                        <div class="whatslink-empty-title">暂无截图</div>
                        <p class="whatslink-empty-text">WhatsLink 已返回资源基础信息，但没有可展示的截图。可以通过名称、大小和文件数量先做基础判断。</p>
                    </div>
                </div>
                <div class="whatslink-thumbs"></div>
            </div>
            <aside class="whatslink-info">
                <div class="whatslink-head">
                    <div>
                        <div class="whatslink-kicker">磁力验车</div>
                        <h2 class="whatslink-title"></h2>
                        <span class="whatslink-tag"></span>
                    </div>
                    <button class="whatslink-close" type="button">×</button>
                </div>
                <div class="whatslink-meta">
                    <div class="whatslink-metric"><b>${formatBytes(payload?.size)}</b><span>资源大小</span></div>
                    <div class="whatslink-metric"><b>${payload?.count ?? '-'}</b><span>文件数量</span></div>
                    <div class="whatslink-metric"><b>${resourceType}</b><span>资源结构</span></div>
                    <div class="whatslink-metric"><b>${shots.length}</b><span>截图数量</span></div>
                    <div class="whatslink-metric"><b>${payload?.error ? '异常' : '无错误'}</b><span>接口状态</span></div>
                </div>
            </aside>`;
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        modal.querySelector('.whatslink-title').textContent = payload?.name || '未知资源';
        modal.querySelector('.whatslink-tag').textContent = resourceType;
        const hero = modal.querySelector('.whatslink-hero');
        const thumbs = modal.querySelector('.whatslink-thumbs');
        const counter = modal.querySelector('.whatslink-counter');
        const render = () => {
            if (!shots.length) return;
            hero.src = shots[index];
            counter.textContent = `${index + 1} / ${shots.length}`;
            [...thumbs.children].forEach((btn, i) => btn.classList.toggle('active', i === index));
        };
        shots.forEach((url, i) => {
            const btn = document.createElement('button');
            btn.className = 'whatslink-thumb';
            btn.innerHTML = `<img src="${url}" alt="">`;
            btn.addEventListener('click', () => { index = i; render(); });
            thumbs.appendChild(btn);
        });
        modal.querySelector('.whatslink-prev').addEventListener('click', () => { if (!shots.length) return; index = (index + shots.length - 1) % shots.length; render(); });
        modal.querySelector('.whatslink-next').addEventListener('click', () => { if (!shots.length) return; index = (index + 1) % shots.length; render(); });
        const close = () => overlay.remove();
        modal.querySelector('.whatslink-close').addEventListener('click', close);
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
        render();
    }

    async function handleCheckCar(link, btn) {
        highlightBtn(btn);
        document.querySelector('.whatslink-overlay')?.remove();
        const overlay = document.createElement('div');
        overlay.className = 'whatslink-overlay';
        overlay.innerHTML = '<div class="whatslink-modal no-shots"><div class="whatslink-loading">正在验车...</div></div>';
        document.body.appendChild(overlay);

        const info = await getMagnetInfo(link);
        overlay.remove();
        if (!info) {
            showWhatslinkModal({ error: '查询失败', name: '查询失败', type: '-', file_type: '-', size: 0, count: '-', screenshots: [] }, link);
            return;
        }
        showWhatslinkModal(info, link);
    }

    // ================= 7. 精简磁力链接 =================
    function simplifyMagnetLink(link) {
        if (!link.startsWith('magnet:?')) return link;
        try {
            const paramRegex = /[?&]([^=]+)=([^&]*)/g;
            let match;
            let xt = null;
            let dn = null;
            while ((match = paramRegex.exec(link)) !== null) {
                const key = match[1];
                const value = match[2];
                if (key === 'xt') {
                    xt = value;
                } else if (key === 'dn') {
                    dn = value;
                }
            }
            if (!xt) return link;

            let newLink = `magnet:?xt=${xt}`;
            if (dn) {
                let decodedDn = null;
                try {
                    decodedDn = decodeURIComponent(dn).trim();
                } catch (e) {
                    decodedDn = dn.trim();
                }
                const code = extractCodeFromText(decodedDn);
                if (code) {
                    newLink += `&dn=${code}`;
                } else {
                    newLink += `&dn=${decodedDn}`;
                }
            }
            return newLink;
        } catch (e) {
            console.warn('精简磁力链接失败，使用原始链接', e);
            return link;
        }
    }

    // ================= 8. 按钮组构建 =================
    function createBtnGroup(link) {
        const group = document.createElement('span');
        group.className = 'mag-btn-group';
        group.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
        group.addEventListener('touchend', (e) => { e.preventDefault(); e.stopPropagation(); }, { passive: false });

        const addBtn = (type, icon, title, action) => {
            const btn = document.createElement('div');
            btn.className = 'mag-btn';
            if (type === 'check') btn.classList.add('mag-check-btn');
            if (type === 'copy') btn.classList.add('mag-copy-btn');
            btn.innerHTML = icon;
            btn.title = title;
            btn.dataset.origIcon = icon;

            let touchedAt = 0;
            const runAction = (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (type === 'check') {
                    action(btn);
                } else if (action()) {
                    setBtnActive(btn, group);
                }
            };
            btn.addEventListener('click', (e) => {
                if (Date.now() - touchedAt < 700) {
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
                runAction(e);
            });
            btn.addEventListener('touchend', (e) => {
                touchedAt = Date.now();
                runAction(e);
            }, { passive: false });
            group.appendChild(btn);
        };

        if (config.enableCheck) {
            addBtn('check', ICONS.car, '验车', (btn) => handleCheckCar(link, btn));
        }
        if (config.enableCopy) {
            addBtn('copy', ICONS.copy, '复制链接', () => {
                const processedLink = simplifyMagnetLink(link);
                const copied = copyText(processedLink);
                if (!copied) {
                    showToast('❌ 复制失败，请长按链接复制', false);
                    return false;
                }
                if (processedLink !== link) {
                    showToast('📋 精简链接已复制');
                } else {
                    showToast('📋 链接已复制');
                }
                return true;
            });
        }
        if (config.enableQb) {
            addBtn('qb', ICONS.qb, '推送至 qB', () => pushToQb(link));
        }
        if (config.enable115) {
            addBtn('115', ICONS.u115, '115 离线', () => pushTo115(link));
        }
        return group;
    }

    // ================= 9. 推送函数 =================
    function pushToQb(link) {
        GM_xmlhttpRequest({
            method: "POST",
            url: `${config.qbtHost}/api/v2/auth/login`,
            data: `username=${config.qbtUser}&password=${config.qbtPass}`,
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            onload: (res) => {
                // 登录成功应返回 "Ok."（忽略前后空白）
                if (res.status === 200 && res.responseText && res.responseText.trim() === "Ok.") {
                    GM_xmlhttpRequest({
                        method: "POST",
                        url: `${config.qbtHost}/api/v2/torrents/add`,
                        data: `urls=${encodeURIComponent(link)}`,
                        headers: { "Content-Type": "application/x-www-form-urlencoded" },
                        onload: (r) => {
                            // 添加任务成功返回 "Ok."，失败返回错误信息
                            if (r.status === 200 && r.responseText && r.responseText.trim() === "Ok.") {
                                showToast('✅ 已推送到 qB');
                            } else {
                                let errorMsg = r.responseText || '未知错误';
                                if (errorMsg.length > 50) errorMsg = errorMsg.substring(0, 50) + '...';
                                showToast(`❌ 推送失败: ${errorMsg}`, false);
                            }
                        },
                        onerror: () => showToast('❌ 推送请求失败', false)
                    });
                } else {
                    showToast('🚫 qB 登录失败，请检查地址或用户名密码', false);
                }
            },
            onerror: () => showToast('❌ 无法连接到 qB，请检查地址', false)
        });
    }

    function get115Cid() {
        return (config.u115Cid || config.u115Uid || '').trim();
    }

    function pushTo115(link) {
        GM_xmlhttpRequest({
            method: 'GET',
            url: 'https://115.com/?ct=offline&ac=space&_=' + Date.now(),
            anonymous: false,
            headers: {
                'Accept': 'application/json, text/plain, */*',
                'Origin': 'https://115.com',
                'Referer': 'https://115.com/?tab=offline&mode=wangpan'
            },
            onload: (signResponse) => {
                let signInfo = null;
                try {
                    signInfo = JSON.parse(signResponse.responseText);
                } catch (_) {}

                if (!signInfo || !signInfo.state || !signInfo.sign || !signInfo.time) {
                    showToast('❌ 115登录失效或签名获取失败', false);
                    return;
                }

                const data = new URLSearchParams();
                data.set('url', link);
                data.set('sign', signInfo.sign);
                data.set('time', signInfo.time);

                const cid = get115Cid();
                if (cid) {
                    data.set('wp_path_id', cid);
                }

                GM_xmlhttpRequest({
                    method: 'POST',
                    url: 'https://115.com/web/lixian/?ct=lixian&ac=add_task_url',
                    anonymous: false,
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                        'Accept': 'application/json, text/javascript, */*; q=0.01',
                        'Origin': 'https://115.com',
                        'Referer': 'https://115.com/?tab=offline&mode=wangpan',
                        'X-Requested-With': 'XMLHttpRequest'
                    },
                    data: data.toString(),
                    onload: (response) => {
                        try {
                            const res = JSON.parse(response.responseText);
                            if (res.state) {
                                showToast(cid ? '✅ 已发送到 115 指定目录' : '✅ 已发送到 115');
                            } else {
                                showToast('❌ 115错误: ' + (res.error_msg || res.msg || '未知错误'), false);
                            }
                        } catch(e) { showToast('❌ 115 响应解析失败', false); }
                    },
                    onerror: () => showToast('❌ 115 推送请求失败', false)
                });
            },
            onerror: () => showToast('❌ 115 签名请求失败', false)
        });
    }

    // ================= 10. 特殊处理：laosiji 表格（兼容新旧版本）=================
    function handleLaosijiTable(root = document.body) {
        if (!root) return;
        const elementRoot = root.nodeType === Node.ELEMENT_NODE ? root : root.parentElement;
        if (!elementRoot) return;
        const rowSelector = 'tr[data-maglink], tr.jav-nong-row:not(.nong-head-row)';
        const tableSelector = '#jav-nong-table, #nong-table-new';
        const rows = new Set();
        const addRow = row => {
            if (!(row instanceof HTMLTableRowElement) || !row.matches(rowSelector) || !row.closest(tableSelector)) return;
            rows.add(row);
        };
        addRow(elementRoot.closest('tr'));
        if (elementRoot.matches(rowSelector)) addRow(elementRoot);
        elementRoot.querySelectorAll?.(rowSelector).forEach(addRow);
        rows.forEach(row => {
            const cells = row.cells;
            if (cells.length < 3) return;
            const operationCell = cells[2];
            const magnetLink = row.getAttribute('data-maglink') || row.querySelector('td:first-child a[href^="magnet:"]')?.href;
            if (!magnetLink) return;
            if (!operationCell.querySelector('.mag-btn-group')) operationCell.appendChild(createBtnGroup(magnetLink));
            operationCell.classList.add('mag-laosiji-ready-cell');
        });
    }

    // ================= 11. 文本链接处理（支持磁力、ed2k、ftp、纯哈希）=================
    const linkRegexes = {
        magnet: /magnet:\?xt=urn:btih:[a-zA-Z0-9]{32,40}[^\s<>"]*/g,
        ed2k: /ed2k:\/\/\|file\|[^|]+\|[^|]+\|[^|]+\|/g,
        ftp: /ftp:\/\/[^\s]+/g
    };

    function createStyledLink(url, type) {
        const a = document.createElement('a');
        a.href = url;
        a.className = `${type}-link`;
        a.textContent = url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        return a;
    }

    function processTextNode(node) {
        const parent = node.parentElement;
        if (!parent) return null;
        const content = node.nodeValue;

        const combinedRegex = /(magnet:\?xt=urn:btih:[a-zA-Z0-9]{32,40}[^\s<>"]*|ed2k:\/\/\|file\|[^|]+\|[^|]+\|[^|]+\||ftp:\/\/[^\s]+)/gi;
        if (!combinedRegex.test(content)) return null;
        combinedRegex.lastIndex = 0;

        const fragment = document.createDocumentFragment();
        let lastIndex = 0;
        let match; // 声明变量

        while ((match = combinedRegex.exec(content)) !== null) {
            if (match.index > lastIndex) {
                fragment.appendChild(document.createTextNode(content.slice(lastIndex, match.index)));
            }
            const url = match[0];
            let type = 'http';
            if (url.startsWith('magnet:')) type = 'magnet';
            else if (url.startsWith('ed2k:')) type = 'ed2k';
            else if (url.startsWith('ftp:')) type = 'ftp';
            const link = createStyledLink(url, type);
            link.dataset.magProcessed = 'true'; // 标记已处理
            fragment.appendChild(link);

            // 立即添加按钮组
            const btnGroup = createBtnGroup(url);
            fragment.appendChild(btnGroup);

            lastIndex = combinedRegex.lastIndex;
        }

        if (lastIndex < content.length) {
            fragment.appendChild(document.createTextNode(content.slice(lastIndex)));
        }

        return fragment;
    }

    // ================= 12. 页面扫描（增量子树）=================
    const SCRIPT_UI_SELECTOR = '.mag-btn-group, .whatslink-overlay, [data-mag-ui], [data-mag-processed], [data-qiqi-ui], [data-sav-ui], [data-qts-ui], [id^="qiqi-"], [id^="sav-"], [id^="qts-"]';
    const BLOCKED_CONTENT_SELECTOR = `script, style, textarea, input, select, option, form, button, pre, code, [contenteditable]:not([contenteditable="false"]), #jav-nong-table, #nong-table-new, ${SCRIPT_UI_SELECTOR}`;

    function scanElement(node) {
        if (!node) return null;
        return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    }

    function isInsideScriptUI(node) {
        return Boolean(scanElement(node)?.closest(SCRIPT_UI_SELECTOR));
    }

    function isBlocked(node, includeAnchor = false) {
        const element = scanElement(node);
        return !element || Boolean(element.closest(includeAnchor ? `${BLOCKED_CONTENT_SELECTOR}, a` : BLOCKED_CONTENT_SELECTOR));
    }

    function processPage(root) {
        if (!root || !root.isConnected) return;
        handleLaosijiTable(root);
        if (isBlocked(root)) return;

        const textNodes = [];
        if (root.nodeType === Node.TEXT_NODE) {
            if (!isBlocked(root, true)) textNodes.push(root);
        } else if (root.nodeType === Node.ELEMENT_NODE) {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
                acceptNode(node) {
                    if (node.nodeType === Node.ELEMENT_NODE) return isBlocked(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
                    return isBlocked(node, true) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
                }
            });
            let node;
            while ((node = walker.nextNode())) if (node.nodeType === Node.TEXT_NODE) textNodes.push(node);
        }

        textNodes.forEach(node => {
            if (!node.isConnected || !node.parentNode) return;
            const fragment = processTextNode(node);
            if (fragment) node.parentNode.replaceChild(fragment, node);
        });

        if (root.nodeType !== Node.ELEMENT_NODE) return;
        const anchors = [];
        if (root.matches('a')) anchors.push(root);
        root.querySelectorAll('a').forEach(a => anchors.push(a));
        anchors.forEach(a => {
            if (!a.isConnected || isBlocked(a) || a.dataset.magProcessed) return;
            const href = a.href || '';
            if (!href.startsWith('magnet:?xt=urn:btih:') && !href.startsWith('ed2k://') && !href.startsWith('ftp://')) return;
            if (a.nextElementSibling?.classList?.contains('mag-btn-group') || hasOtherMagnetButtons(a)) return;
            a.after(createBtnGroup(href));
            a.dataset.magProcessed = 'true';
        });
    }

    // ================= 13. 设置面板 =================
    function showSettingsModal() {
        const mask = document.createElement('div');
        mask.dataset.magUi = 'true';
        mask.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:100001;display:flex;align-items:center;justify-content:center;font-family:sans-serif;';

        const modal = document.createElement('div');
        modal.style.cssText = 'background:white;padding:25px;border-radius:12px;width:450px;box-shadow:0 10px 25px rgba(0,0,0,0.2);';

        modal.innerHTML = `
            <div class="tab-header" style="display:flex;border-bottom:1px solid #ddd;margin-bottom:20px;">
                <div class="tab" data-tab="general" style="padding:8px 16px;cursor:pointer;border-bottom:2px solid #0078d4;">常规</div>
                <div class="tab" data-tab="qb" style="padding:8px 16px;cursor:pointer;">qBittorrent</div>
                <div class="tab" data-tab="115" style="padding:8px 16px;cursor:pointer;">115网盘</div>
                <div class="tab" data-tab="advanced" style="padding:8px 16px;cursor:pointer;">高级</div>
            </div>
            <div id="tab-content" style="min-height:150px;"></div>
            <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:25px;">
                <button id="btn_cancel" style="padding:8px 15px;border:1px solid #ccc;background:#eee;border-radius:4px;cursor:pointer;">取消</button>
                <button id="btn_save" style="padding:8px 15px;border:none;background:#0078d4;color:white;border-radius:4px;cursor:pointer;">保存设置</button>
            </div>
        `;

        mask.appendChild(modal);
        document.body.appendChild(mask);

        const header = modal.querySelector('.tab-header');
        const contentDiv = modal.querySelector('#tab-content');

        const panels = {
            general: `
                <div style="margin-bottom:15px;">
                    <label style="display:flex;align-items:center;margin-bottom:10px;"><input type="checkbox" id="sw_copy" ${config.enableCopy?'checked':''}> <span style="margin-left:8px;">显示复制按钮</span></label>
                    <label style="display:flex;align-items:center;margin-bottom:10px;"><input type="checkbox" id="sw_qb" ${config.enableQb?'checked':''}> <span style="margin-left:8px;">显示 qB 推送按钮</span></label>
                    <label style="display:flex;align-items:center;margin-bottom:10px;"><input type="checkbox" id="sw_115" ${config.enable115?'checked':''}> <span style="margin-left:8px;">显示 115 离线按钮</span></label>
                    <label style="display:flex;align-items:center;margin-bottom:10px;"><input type="checkbox" id="sw_check" ${config.enableCheck?'checked':''}> <span style="margin-left:8px;">显示验车按钮</span></label>
                </div>
            `,
            qb: `
                <div style="border-top:1px solid #eee;padding-top:15px;">
                    <input id="in_host" type="text" placeholder="qB 地址 (如 http://127.0.0.1:8080)" value="${config.qbtHost}" style="width:100%;margin-bottom:8px;padding:8px;border:1px solid #ccc;border-radius:4px;box-sizing:border-box;">
                    <div style="display:flex;gap:5px;margin-bottom:8px;">
                        <input id="in_user" type="text" placeholder="用户名" value="${config.qbtUser}" style="flex:1;padding:8px;border:1px solid #ccc;border-radius:4px;">
                        <input id="in_pass" type="password" placeholder="密码" value="${config.qbtPass}" style="flex:1;padding:8px;border:1px solid #ccc;border-radius:4px;">
                    </div>
                    <button id="test_qb" style="padding:8px 15px;background:#28a745;color:white;border:none;border-radius:4px;cursor:pointer;margin-top:5px;">测试连接</button>
                    <span id="qb_test_result" style="margin-left:10px;font-size:13px;"></span>
                </div>
            `,
            '115': `
                <div style="border-top:1px solid #eee;padding-top:15px;">
                    <input id="in_115_cid" type="text" placeholder="可选：115目录 CID / wp_path_id，不填则保存到默认目录" value="${config.u115Cid || config.u115Uid}" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:4px;box-sizing:border-box;">
                    <button id="test_115" style="padding:8px 15px;background:#28a745;color:white;border:none;border-radius:4px;cursor:pointer;margin-top:10px;">检查115登录状态</button>
                    <span id="u115_test_result" style="margin-left:10px;font-size:13px;"></span>
                    <p style="font-size:12px;color:#666;margin-top:8px;">需要先在浏览器中登录115官网。文件夹识别码只用于指定保存目录，留空会使用115默认离线目录。</p>
                </div>
            `,
            advanced: `
                <div style="border-top:1px solid #eee;padding-top:15px;">
                    <button id="export_config" style="padding:8px 15px;background:#0078d4;color:white;border:none;border-radius:4px;cursor:pointer;margin-right:5px;">导出配置</button>
                    <button id="import_config" style="padding:8px 15px;background:#6c757d;color:white;border:none;border-radius:4px;cursor:pointer;">导入配置</button>
                    <input type="file" id="import_file" accept=".json" style="display:none;">
                    <p style="font-size:12px;color:#666;margin-top:10px;">导出文件为 JSON 格式，可在其他浏览器中导入。</p>
                </div>
            `
        };

        contentDiv.innerHTML = panels.general;

        header.addEventListener('click', (e) => {
            const tab = e.target.closest('.tab');
            if (!tab) return;

            header.querySelectorAll('.tab').forEach(t => t.style.borderBottom = '2px solid transparent');
            tab.style.borderBottom = '2px solid #0078d4';

            const tabName = tab.dataset.tab;
            contentDiv.innerHTML = panels[tabName];

            if (tabName === 'qb') {
                modal.querySelector('#test_qb')?.addEventListener('click', testQbConnection);
            } else if (tabName === '115') {
                modal.querySelector('#test_115')?.addEventListener('click', test115Connection);
            } else if (tabName === 'advanced') {
                modal.querySelector('#export_config')?.addEventListener('click', exportConfig);
                modal.querySelector('#import_config')?.addEventListener('click', () => modal.querySelector('#import_file').click());
                modal.querySelector('#import_file')?.addEventListener('change', importConfig);
            }
        });

        function testQbConnection() {
            const host = modal.querySelector('#in_host').value.trim();
            const user = modal.querySelector('#in_user').value.trim();
            const pass = modal.querySelector('#in_pass').value.trim();
            const resultSpan = modal.querySelector('#qb_test_result');
            resultSpan.textContent = '测试中...';
            GM_xmlhttpRequest({
                method: 'POST',
                url: host + '/api/v2/auth/login',
                data: `username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}`,
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                onload: (res) => {
                    if (res.status === 200) {
                        resultSpan.innerHTML = '✅ 连接成功';
                    } else {
                        resultSpan.innerHTML = '❌ 连接失败（状态码 ' + res.status + '）';
                    }
                },
                onerror: () => {
                    resultSpan.innerHTML = '❌ 网络错误或地址不可达';
                }
            });
        }

        function test115Connection() {
            const resultSpan = modal.querySelector('#u115_test_result');
            resultSpan.textContent = '检查登录状态...';
            GM_xmlhttpRequest({
                method: 'GET',
                url: 'https://115.com/web/lixian/?ct=lixian&ac=task_lists&t=' + Date.now(),
                anonymous: false,
                headers: {
                    'Accept': 'application/json, text/plain, */*',
                    'Referer': 'https://115.com/web/lixian/'
                },
                onload: (res) => {
                    try {
                        if (res.finalUrl && res.finalUrl.includes('login.115.com')) {
                            resultSpan.innerHTML = '❌ 未登录，请先登录115官网';
                            return;
                        }
                        const text = res.responseText;
                        let json = null;
                        try { json = JSON.parse(text); } catch (_) {}
                        if (json) {
                            if (json.state === true || json.errno === 0) {
                                resultSpan.innerHTML = '✅ 已登录115';
                            } else {
                                resultSpan.innerHTML = '❌ 未登录或登录已过期';
                            }
                        } else {
                            if (text.includes('登录') || text.includes('login') || text.includes('passport')) {
                                resultSpan.innerHTML = '❌ 未登录，请先登录115官网';
                            } else {
                                resultSpan.innerHTML = '❌ 无法判断登录状态（未知响应）';
                            }
                        }
                    } catch (e) {
                        resultSpan.innerHTML = '❌ 检查失败：' + e.message;
                    }
                },
                onerror: () => {
                    resultSpan.innerHTML = '❌ 网络错误';
                }
            });
        }

        function exportConfig() {
            const currentConfig = {
                enableCopy: modal.querySelector('#sw_copy')?.checked ?? config.enableCopy,
                enableQb: modal.querySelector('#sw_qb')?.checked ?? config.enableQb,
                enable115: modal.querySelector('#sw_115')?.checked ?? config.enable115,
                enableCheck: modal.querySelector('#sw_check')?.checked ?? config.enableCheck,
                qbtHost: modal.querySelector('#in_host')?.value.trim() ?? config.qbtHost,
                qbtUser: modal.querySelector('#in_user')?.value.trim() ?? config.qbtUser,
                qbtPass: modal.querySelector('#in_pass')?.value.trim() ?? config.qbtPass,
                u115Cid: modal.querySelector('#in_115_cid')?.value.trim() ?? config.u115Cid,
                u115Uid: modal.querySelector('#in_115_cid')?.value.trim() ?? config.u115Uid
            };
            const blob = new Blob([JSON.stringify(currentConfig, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'magnet-assistant-config.json';
            a.click();
            URL.revokeObjectURL(url);
        }

        function importConfig(event) {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const imported = JSON.parse(e.target.result);
                    if (modal.querySelector('#sw_copy')) modal.querySelector('#sw_copy').checked = imported.enableCopy ?? true;
                    if (modal.querySelector('#sw_qb')) modal.querySelector('#sw_qb').checked = imported.enableQb ?? true;
                    if (modal.querySelector('#sw_115')) modal.querySelector('#sw_115').checked = imported.enable115 ?? false;
                    if (modal.querySelector('#sw_check')) modal.querySelector('#sw_check').checked = imported.enableCheck ?? true;
                    if (modal.querySelector('#in_host')) modal.querySelector('#in_host').value = imported.qbtHost || 'http://127.0.0.1:8080';
                    if (modal.querySelector('#in_user')) modal.querySelector('#in_user').value = imported.qbtUser || 'admin';
                    if (modal.querySelector('#in_pass')) modal.querySelector('#in_pass').value = imported.qbtPass || 'adminadmin';
                    if (modal.querySelector('#in_115_cid')) modal.querySelector('#in_115_cid').value = imported.u115Cid || imported.u115Uid || '';
                    showToast('✅ 配置导入成功，请检查后保存');
                } catch (err) {
                    showToast('❌ 配置文件格式错误', false);
                }
            };
            reader.readAsText(file);
        }

        modal.querySelector('#btn_save').onclick = () => {
            GM_setValue('enableCopy', modal.querySelector('#sw_copy')?.checked ?? config.enableCopy);
            GM_setValue('enableQb', modal.querySelector('#sw_qb')?.checked ?? config.enableQb);
            GM_setValue('enable115', modal.querySelector('#sw_115')?.checked ?? config.enable115);
            GM_setValue('enableCheck', modal.querySelector('#sw_check')?.checked ?? config.enableCheck);
            GM_setValue('qbtHost', modal.querySelector('#in_host')?.value.trim() ?? config.qbtHost);
            GM_setValue('qbtUser', modal.querySelector('#in_user')?.value.trim() ?? config.qbtUser);
            GM_setValue('qbtPass', modal.querySelector('#in_pass')?.value.trim() ?? config.qbtPass);
            GM_setValue('u115Cid', modal.querySelector('#in_115_cid')?.value.trim() ?? config.u115Cid);
            GM_setValue('u115Uid', modal.querySelector('#in_115_cid')?.value.trim() ?? config.u115Uid);
            mask.remove();
            showToast('✅ 设置已保存，刷新页面生效');
            setTimeout(() => location.reload(), 1000);
        };

        modal.querySelector('#btn_cancel').onclick = () => mask.remove();
    }

    // ================= 14. 启动监听 =================
    let timer = null;
    let observer = null;
    const pendingRoots = new Set();

    function containsRoot(parent, child) {
        return parent === child || (parent.nodeType === Node.ELEMENT_NODE && parent.contains(child));
    }

    function enqueueRoot(node) {
        if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.TEXT_NODE) return;
        if (isInsideScriptUI(node)) return;
        for (const existing of pendingRoots) if (containsRoot(existing, node)) return;
        for (const existing of [...pendingRoots]) if (containsRoot(node, existing)) pendingRoots.delete(existing);
        pendingRoots.add(node);
    }

    function flushRoots() {
        timer = null;
        const roots = [...pendingRoots];
        pendingRoots.clear();
        roots.forEach(root => { if (root.isConnected) processPage(root); });
    }

    function lazyRun(delay = 120) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(flushRoots, delay);
    }

    function startObserver() {
        if (!document.body) {
            setTimeout(startObserver, 30);
            return;
        }
        processPage(document.body);
        observer = new MutationObserver(records => {
            records.forEach(record => record.addedNodes.forEach(enqueueRoot));
            if (pendingRoots.size) lazyRun();
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }
    startObserver();

})();

