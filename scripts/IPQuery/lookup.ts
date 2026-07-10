import type { IPInfo } from "./data"

export type IPLookupResult = {
  info: IPInfo
}

const wait = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds))

export function isIPv4(value: string) {
  const parts = value.trim().split(".")
  return parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255)
}

export async function lookupIP(input: string): Promise<IPLookupResult> {
  const ip = input.trim()
  if (!isIPv4(ip)) throw new Error("请输入有效的 IPv4 地址")

  const web = new WebViewController()
  web.setCustomUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148")

  try {
    const loaded = await Promise.race([
      web.loadURL(`https://iplark.com/${encodeURIComponent(ip)}`),
      wait(12_000).then(() => { throw new Error("IPLark 查询超时") }),
    ])
    if (!loaded) throw new Error("IPLark 查询页面加载失败")

    const initialTitle = await web.evaluateJavaScript<string>("return document.title")
    if (initialTitle === "安全验证") {
      await web.present({
        fullscreen: false,
        navigationTitle: "完成验证后关闭此页面",
      })
    }

    let raw: any = null
    for (let attempt = 0; attempt < 24; attempt++) {
      raw = await web.evaluateJavaScript<any>(`
        const item = label => Array.from(document.querySelectorAll('.info-item'))
          .find(node => (node.querySelector('label')?.textContent || '').includes(label))
          ?.querySelector('.value')?.textContent?.trim() || ''
        const tags = Array.from(document.querySelectorAll('.ip-tags .tag'))
          .map(node => (node.textContent || '').trim()).filter(Boolean)
        return {
          title: document.title,
          ip: document.querySelector('.ip-highlight')?.textContent?.trim() || '',
          isp: tags.find(tag => tag === 'ISP') || tags[0] || '',
          nativeIP: tags.find(tag => tag.includes('原生IP')) || tags[1] || '',
          country: item('国家'),
          countryCode: document.querySelector('.info-item img[src*="/flags/"]')?.getAttribute('src')?.match(/\\/flags\\/([a-z]{2})\\./i)?.[1]?.toUpperCase() || '',
          category: document.querySelector('#type')?.textContent?.trim() || item('使用场景'),
          score: document.querySelector('#score-value')?.textContent?.trim() || ''
        }
      `)
      if (raw?.ip === ip && raw?.country && raw?.score) break
      await wait(250)
    }

    if (raw?.ip !== ip) {
      throw new Error(raw?.title === "安全验证"
        ? "请完成 IPLark 安全验证后再关闭页面"
        : "未找到该 IP 的查询结果")
    }

    const score = Number.parseInt(String(raw.score), 10)
    return {
      info: {
        ip: raw.ip,
        isp: String(raw.isp || "—"),
        nativeIP: String(raw.nativeIP || "—"),
        country: String(raw.country || "—"),
        countryCode: String(raw.countryCode || ""),
        category: String(raw.category || "—"),
        score: Number.isFinite(score) ? score : null,
        updatedAt: Date.now(),
      },
    }
  } finally {
    web.dispose()
  }
}
