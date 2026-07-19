/*
 * 字幕圈 SenPlayer 下载
 * 从播放页提取完整 M3U8 地址，并添加 SenPlayer 下载按钮。
 */

(function () {
  try {
    var originalBody = typeof $response.body === "string" ? $response.body : "";
    var html = decodeWrappedHtml(originalBody) || originalBody;
    var mediaUrl = findMediaUrl(html);

    if (!mediaUrl) {
      console.log("[字幕圈 SenPlayer] 未找到 M3U8/MP4 地址");
      return finish(originalBody);
    }

    var title = findTitle(html) || "字幕圈视频";
    var fileName = sanitizeFileName(title) + ".mp4";
    var senPlayerUrl =
      "SenPlayer://x-callback-url/download?url=" + encodeURIComponent(mediaUrl) +
      "&name=" + encodeURIComponent(fileName);

    html = injectSenPlayerButton(html, senPlayerUrl);
    console.log("[字幕圈 SenPlayer] 已解析: " + mediaUrl);
    finish(html);
  } catch (error) {
    console.log("[字幕圈 SenPlayer] 处理失败: " + (error && error.stack || error));
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
    console.log("[字幕圈 SenPlayer] 页面解码失败: " + error);
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
  var normalized = String(html || "")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&");

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
  return "";
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

function injectSenPlayerButton(html, senPlayerUrl) {
  if (/id=["']senplayer_download_button["']/i.test(html)) return html;

  var safeUrl = escapeHtmlAttribute(senPlayerUrl);
  var snippet =
    '<a id="senplayer_download_button" href="' + safeUrl + '" ' +
    'style="position:fixed;right:16px;bottom:88px;z-index:2147483647;' +
    'display:flex;align-items:center;justify-content:center;min-width:132px;' +
    'height:44px;padding:0 16px;border-radius:22px;background:#007aff;' +
    'box-shadow:0 4px 14px rgba(0,0,0,.28);color:#fff!important;' +
    'font:600 14px/1 -apple-system,BlinkMacSystemFont,sans-serif;' +
    'text-decoration:none!important;-webkit-tap-highlight-color:transparent">' +
    'SenPlayer 下载</a>';

  if (/<\/body\s*>/i.test(html)) {
    return html.replace(/<\/body\s*>/i, snippet + "</body>");
  }
  return html + snippet;
}

function escapeHtmlAttribute(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
