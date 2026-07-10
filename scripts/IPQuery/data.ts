export type IPInfo = {
  ip: string
  isp: string
  nativeIP: string
  country: string
  countryCode: string
  category: string
  score: number | null
  updatedAt: number
}

const CACHE_KEY = "iplark.ip.info.v1"
const PAGE_URL = "https://iplark.com"

const wait = (milliseconds: number) =>
  new Promise<void>(resolve => setTimeout(resolve, milliseconds))

function clean(value: unknown, fallback = "—") {
  const text = String(value ?? "").trim()
  return text || fallback
}

export function readCachedIPInfo(): IPInfo | null {
  const cached = Storage.get<IPInfo>(CACHE_KEY)
  if (!cached) return null
  const info: IPInfo = {
    ip: cached.ip,
    isp: cached.isp,
    nativeIP: cached.nativeIP,
    country: cached.country,
    countryCode: cached.countryCode,
    category: cached.category,
    score: cached.score,
    updatedAt: cached.updatedAt,
  }
  Storage.set(CACHE_KEY, info)
  return info
}

export async function fetchIPInfo(): Promise<IPInfo> {
  const web = new WebViewController()
  web.setCustomUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148")

  try {
    const loaded = await Promise.race([
      web.loadURL(PAGE_URL),
      wait(12_000).then(() => { throw new Error("IPLark 加载超时") }),
    ])
    if (!loaded) throw new Error("IPLark 页面加载失败")

    await wait(500)
    let didPresentVerification = false
    const initialTitle = await web.evaluateJavaScript<string>("return document.title")
    if (initialTitle === "安全验证") {
      didPresentVerification = true
      await web.present({
        fullscreen: false,
        navigationTitle: "完成验证后关闭此页面",
      })
      await wait(300)
    }

    const readPage = () => web.evaluateJavaScript<any>(`
      const item = label => Array.from(document.querySelectorAll('.info-item'))
        .find(node => (node.querySelector('label')?.textContent || '').includes(label))
        ?.querySelector('.value')?.textContent?.trim() || ''
      const tags = Array.from(document.querySelectorAll('.ip-tags .tag'))
        .map(node => (node.textContent || '').trim())
        .filter(Boolean)
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

    let raw = await readPage()
    if (!raw?.ip && !didPresentVerification) {
      await web.present({
        fullscreen: false,
        navigationTitle: "完成验证后关闭此页面",
      })
      await wait(300)
      raw = await readPage()
    }

    if (!raw?.ip) {
      throw new Error(raw?.title === "安全验证"
        ? "请完成 IPLark 安全验证后再关闭页面"
        : raw?.title?.includes("403")
          ? "IPLark 拒绝了请求"
          : "未能读取当前 IP")
    }

    const scoreValue = Number.parseInt(String(raw.score), 10)
    const info: IPInfo = {
      ip: clean(raw.ip),
      isp: clean(raw.isp),
      nativeIP: clean(raw.nativeIP),
      country: clean(raw.country),
      countryCode: clean(raw.countryCode, ""),
      category: clean(raw.category),
      score: Number.isFinite(scoreValue) ? scoreValue : null,
      updatedAt: Date.now(),
    }

    Storage.set(CACHE_KEY, info)
    return info
  } finally {
    web.dispose()
  }
}

export function countryFlag(info: Pick<IPInfo, "country" | "countryCode">) {
  const aliases: Record<string, string> = {
    "中国": "CN", "香港": "HK", "澳门": "MO", "台湾": "TW",
    "美国": "US", "日本": "JP", "韩国": "KR", "新加坡": "SG",
    "英国": "GB", "德国": "DE", "法国": "FR", "加拿大": "CA",
    "澳大利亚": "AU", "俄罗斯": "RU", "印度": "IN",
  }
  const code = (info.countryCode || aliases[info.country] || "").toUpperCase()
  if (!/^[A-Z]{2}$/.test(code)) return "🌐"
  return String.fromCodePoint(...[...code].map(char => 127397 + char.charCodeAt(0)))
}

export function scoreColor(score: number | null) {
  if (score === null) return "secondaryLabel"
  if (score >= 80) return "systemGreen"
  if (score >= 50) return "systemOrange"
  return "systemRed"
}
