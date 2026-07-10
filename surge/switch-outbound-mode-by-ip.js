/*
 * Surge 网络变化出口模式切换
 * 通过 ipinfo.io 检查 DIRECT 出口：CN -> rule，非 CN -> direct。
 */

const CONFIG = {
  endpoint: "https://ipinfo.io/json",
  settleDelayMs: 2500,
  requestTimeoutSeconds: 8,
  maxAttempts: 3,
  retryDelayMs: 2000,
};

let finished = false;

function finish() {
  if (finished) return;
  finished = true;
  $done();
}

function notifyFailure(message) {
  console.log(`[IPInfo 出站模式] ${message}`);
  $notification.post("Surge 出站模式切换失败", "已保持当前模式", message);
  finish();
}

function checkIP(attempt) {
  const separator = CONFIG.endpoint.includes("?") ? "&" : "?";
  const url = `${CONFIG.endpoint}${separator}_=${Date.now()}`;

  $httpClient.get(
    {
      url,
      policy: "DIRECT",
      timeout: CONFIG.requestTimeoutSeconds,
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache",
      },
    },
    (error, response, data) => {
      const status = response && response.status;
      if (error || !status || status < 200 || status >= 300) {
        const reason = error || `ipinfo HTTP ${status || "无响应"}`;
        return retryOrFail(attempt, reason);
      }

      let info;
      try {
        info = JSON.parse(data);
      } catch (_) {
        return retryOrFail(attempt, "ipinfo 返回了无效 JSON");
      }

      const ip = typeof info.ip === "string" ? info.ip.trim() : "";
      const country = typeof info.country === "string"
        ? info.country.trim().toUpperCase()
        : "";

      if (!ip || !/^[A-Z]{2}$/.test(country)) {
        return retryOrFail(attempt, "ipinfo 响应缺少 ip 或 country");
      }

      const targetMode = country === "CN" ? "rule" : "direct";
      applyMode(targetMode, ip, country);
    }
  );
}

function retryOrFail(attempt, reason) {
  console.log(
    `[IPInfo 出站模式] 第 ${attempt}/${CONFIG.maxAttempts} 次检测失败：${reason}`
  );

  if (attempt >= CONFIG.maxAttempts) {
    notifyFailure(`连续 ${CONFIG.maxAttempts} 次检测失败：${reason}`);
    return;
  }

  setTimeout(() => checkIP(attempt + 1), CONFIG.retryDelayMs * attempt);
}

function postStatus(ip, country, targetMode) {
  const modeName = targetMode === "rule" ? "Rule" : "DIRECT";
  $notification.post(
    "出口信息",
    `IP：${ip}`,
    `国家：${country} · ${modeName}`
  );
}

function applyMode(targetMode, ip, country) {
  $httpAPI("GET", "/v1/outbound", null, (current) => {
    if (current && current.mode === targetMode) {
      console.log(
        `[IPInfo 出站模式] ${ip} (${country})，当前已经是 ${targetMode}`
      );
      finish();
      return;
    }

    $httpAPI("POST", "/v1/outbound", { mode: targetMode }, () => {
      $httpAPI("GET", "/v1/outbound", null, (verified) => {
        if (!verified || verified.mode !== targetMode) {
          notifyFailure(
            `${ip} (${country}) 应切换为 ${targetMode}，但结果未通过验证`
          );
          return;
        }

        console.log(
          `[IPInfo 出站模式] ${ip} (${country}) -> ${targetMode}`
        );
        postStatus(ip, country, targetMode);
        finish();
      });
    });
  });
}

setTimeout(() => checkIP(1), CONFIG.settleDelayMs);
