/*
 * 字幕圈完整播放与 SenPlayer 下载
 * 解开播放页包装，隐藏会员遮罩，并提供完整播放和 SenPlayer 下载入口。
 */

(function () {
  try {
    var originalBody = typeof $response.body === "string" ? $response.body : "";
    var html = decodeWrappedHtml(originalBody) || originalBody;
    var mediaUrl = findMediaUrl(html);

    if (!mediaUrl) {
      console.log("[字幕圈] 未找到 M3U8/MP4 地址");
      return finish(originalBody);
    }

    var title = findTitle(html) || "字幕圈视频";
    var fileName = sanitizeFileName(title) + ".mp4";
    var senPlayerUrl =
      "SenPlayer://x-callback-url/download?url=" + encodeURIComponent(mediaUrl) +
      "&name=" + encodeURIComponent(fileName);

    html = removePreviousInjection(html);
    html = injectActions(html, mediaUrl, senPlayerUrl);
    console.log("[字幕圈] 已解析完整视频: " + mediaUrl);
    finish(html);
  } catch (error) {
    console.log("[字幕圈] 处理失败: " + (error && error.stack || error));
    $done({});
  }
})();

function decodeWrappedHtml(body) {
  if (!body || !/document\.write\s*\(/i.test(body)) return "";
  var match = body.match(/atob\(\s*["']([A-Za-z0-9+/=]+)["']\s*\)/i);
  if (!match) return "";

  try {
    return decodeURIComponent(decodeBase64(match[1]));
  } catch (error) {
    console.log("[字幕圈] 页面解码失败: " + error);
    return "";
  }
}

function decodeBase64(input) {
  if (typeof atob === "function") return atob(input);

  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  var output = "";
  var index = 0;
  input = String(input).replace(/[^A-Za-z0-9+/=]/g, "");

  while (index < input.length) {
    var enc1 = chars.indexOf(input.charAt(index++));
    var enc2 = chars.indexOf(input.charAt(index++));
    var enc3 = chars.indexOf(input.charAt(index++));
    var enc4 = chars.indexOf(input.charAt(index++));
    var chr1 = (enc1 << 2) | (enc2 >> 4);
    var chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
    var chr3 = ((enc3 & 3) << 6) | enc4;

    output += String.fromCharCode(chr1);
    if (enc3 !== 64 && enc3 !== -1) output += String.fromCharCode(chr2);
    if (enc4 !== 64 && enc4 !== -1) output += String.fromCharCode(chr3);
  }
  return output;
}

function findMediaUrl(html) {
  var normalized = decodeHtml(String(html || "").replace(/\\\//g, "/"));
  var patterns = [
    /\bM3U8\s*=\s*["'](https?:\/\/[^"']+?\.m3u8(?:\?[^"']*)?)["']/i,
    /["']url["']?\s*:\s*["'](https?:\/\/[^"']+?\.m3u8(?:\?[^"']*)?)["']/i,
    /(https?:\/\/[^"'<>\\\s]+?\.m3u8(?:\?[^"'<>\\\s]*)?)/i,
    /(https?:\/\/[^"'<>\\\s]+?\.mp4(?:\?[^"'<>\\\s]*)?)/i
  ];

  for (var i = 0; i < patterns.length; i++) {
    var match = normalized.match(patterns[i]);
    if (match) return match[1];
  }

  var posterPatterns = [
    /background-image\s*:\s*url\(\s*["']?(https?:\/\/[^"')\s]+\/vod\.jpg(?:\?[^"')\s]*)?)/i,
    /(?:src|data-src)=["'](https?:\/\/[^"']+\/vod\.jpg(?:\?[^"']*)?)["']/i
  ];

  for (var j = 0; j < posterPatterns.length; j++) {
    var posterMatch = normalized.match(posterPatterns[j]);
    if (posterMatch) return posterToPlaylist(posterMatch[1]);
  }
  return "";
}

function posterToPlaylist(posterUrl) {
  var value = String(posterUrl || "");
  var queryIndex = value.indexOf("?");
  var query = queryIndex >= 0 ? value.slice(queryIndex) : "";
  var path = queryIndex >= 0 ? value.slice(0, queryIndex) : value;
  return path.replace(/\/vod\.jpg$/i, "/index.m3u8") + query;
}

function findTitle(html) {
  var match = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return "";
  return decodeHtml(match[1]).replace(/<[^>]+>/g, "").trim();
}

function decodeHtml(text) {
  return String(text || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function sanitizeFileName(name) {
  var cleaned = String(name || "字幕圈视频")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || "字幕圈视频").slice(0, 120);
}

function removePreviousInjection(html) {
  return String(html || "")
    .replace(/<style[^>]*id=["']zimuquan_combined_style["'][^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*id=["']zimuquan_combined_script["'][^>]*>[\s\S]*?<\/script>/gi, "");
}

function injectActions(html, mediaUrl, senPlayerUrl) {
  var safeMediaUrl = JSON.stringify(mediaUrl);
  var safeSenPlayerUrl = JSON.stringify(senPlayerUrl);
  var injection =
    '<style id="zimuquan_combined_style">' +
    '.popup,.container>.popup,.el-nomember-info,.member-not.el-login-btn,' +
    '.vip,.list_vip,.show_poster_btn,.show_poster_title{display:none!important}' +
    '.zimuquan-actions{display:flex;justify-content:space-around;align-items:flex-start;' +
    'gap:12px;padding:12px 8px}' +
    '.zimuquan-action{flex:1;text-align:center;cursor:pointer;list-style:none;' +
    'text-decoration:none!important;-webkit-tap-highlight-color:transparent}' +
    '.zimuquan-action-icon{display:inline-flex;width:48px;height:48px;border-radius:50%;' +
    'align-items:center;justify-content:center;box-shadow:0 4px 10px rgba(0,0,0,.18);' +
    'color:#fff;font:700 21px/1 -apple-system,BlinkMacSystemFont,sans-serif}' +
    '.zimuquan-action-label{margin-top:6px;font:600 13px/1.3 -apple-system,' +
    'BlinkMacSystemFont,sans-serif}' +
    '</style>' +
    '<script id="zimuquan_combined_script">' +
    '(function(){' +
    'var mediaUrl=' + safeMediaUrl + ',senPlayerUrl=' + safeSenPlayerUrl + ';' +
    'var actions=\'<div class="zimuquan-actions" id="zimuquan_actions">\'+' +
    '\'<a class="zimuquan-action" id="zimuquan_play_full" href="javascript:void(0)">\'+' +
    '\'<span class="zimuquan-action-icon" style="background:#0a84ff">▶</span>\'+' +
    '\'<div class="zimuquan-action-label" style="color:#0a84ff">播放完整</div></a>\'+' +
    '\'<a class="zimuquan-action" id="zimuquan_senplayer" href="javascript:void(0)">\'+' +
    '\'<span class="zimuquan-action-icon" style="background:#34c759">↓</span>\'+' +
    '\'<div class="zimuquan-action-label" style="color:#34c759">SenPlayer 下载</div></a></div>\';' +
    'function removeLocks(){try{' +
    'document.querySelectorAll(\'.el-badge__content\').forEach(function(e){' +
    'if(/未登录/.test(e.textContent))e.textContent=\'VIP\'});' +
    'document.querySelectorAll(\'.popup .el-login-btn,.popup-btn,.show_poster_btn\')' +
    '.forEach(function(e){e.remove()});' +
    'document.querySelectorAll(\'.vod_title .vip,.title .vip,.show-title .vip,.play_title span\')' +
    '.forEach(function(e){if(e.textContent&&e.textContent.indexOf(\'[VIP]\')>=0)e.remove()});' +
    '}catch(_){}}' +
    'function mount(){var existing=document.getElementById(\'zimuquan_actions\');' +
    'if(!existing){var target=document.querySelector(\'ul.operation-top,.play_nav.van-grid\');' +
    'if(target){target.outerHTML=actions}}' +
    'var play=document.getElementById(\'zimuquan_play_full\');' +
    'if(play)play.onclick=function(){location.href=mediaUrl};' +
    'var sen=document.getElementById(\'zimuquan_senplayer\');' +
    'if(sen)sen.onclick=function(){location.href=senPlayerUrl};removeLocks();' +
    'return !!document.getElementById(\'zimuquan_actions\')}' +
    'function start(){mount();var count=0,timer=setInterval(function(){count++;' +
    'if(mount()||count>=30)clearInterval(timer)},200)}' +
    'if(document.readyState===\'loading\')document.addEventListener(\'DOMContentLoaded\',start);' +
    'else start();window.addEventListener(\'load\',mount)' +
    '})();<\/script>';

  if (/<\/body\s*>/i.test(html)) {
    return html.replace(/<\/body\s*>/i, injection + "</body>");
  }
  return html + injection;
}

function finish(body) {
  var headers = {};
  var sourceHeaders = $response.headers || {};

  Object.keys(sourceHeaders).forEach(function (key) {
    var lower = key.toLowerCase();
    if (lower !== "content-length" && lower !== "content-encoding") {
      headers[key] = sourceHeaders[key];
    }
  });
  headers["Content-Type"] = "text/html; charset=utf-8";
  $done({ body: body, headers: headers });
}
