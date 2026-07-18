export type VideoHistoryRecord = {
  code: string
  firstOpenedAt: number
  lastOpenedAt: number
  openCount: number
  url: string
}

export type VideoHistoryStore = {
  version: 1
  updatedAt: number
  records: Record<string, VideoHistoryRecord>
}

const FILE = FileManager.safariBrowserDirectory + "/video-open-history-v1.json"
const VIDEO_CODE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*-\d+$/i
const HISTORY_LIMIT = 5000

function emptyStore(): VideoHistoryStore {
  return { version: 1, updatedAt: 0, records: {} }
}

function normalizeRecord(codeKey: string, value: unknown): VideoHistoryRecord | null {
  const code = String(codeKey || "").toLowerCase()
  if (!VIDEO_CODE_RE.test(code)) return null

  if (typeof value === "number" && Number.isFinite(value)) {
    return {
      code,
      firstOpenedAt: value,
      lastOpenedAt: value,
      openCount: 1,
      url: `https://missav.ai/${code}`,
    }
  }

  if (!value || typeof value !== "object") return null
  const item = value as Partial<VideoHistoryRecord>
  const firstOpenedAt = Number(item.firstOpenedAt)
  const lastOpenedAt = Number(item.lastOpenedAt)
  const openedAt = Number.isFinite(firstOpenedAt)
    ? firstOpenedAt
    : Number.isFinite(lastOpenedAt)
      ? lastOpenedAt
      : Date.now()

  return {
    code,
    firstOpenedAt: openedAt,
    lastOpenedAt: Number.isFinite(lastOpenedAt) ? lastOpenedAt : openedAt,
    openCount: Math.max(1, Math.floor(Number(item.openCount) || 1)),
    url: typeof item.url === "string" && /^https?:\/\//i.test(item.url)
      ? item.url
      : `https://missav.ai/${code}`,
  }
}

function parseStore(raw: string): VideoHistoryStore {
  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return emptyStore()

  const candidate = parsed as { records?: unknown; updatedAt?: unknown }
  const source = candidate.records && typeof candidate.records === "object" && !Array.isArray(candidate.records)
    ? candidate.records as Record<string, unknown>
    : parsed as Record<string, unknown>

  const records: Record<string, VideoHistoryRecord> = {}
  Object.entries(source)
    .map(([code, value]) => normalizeRecord(code, value))
    .filter((item): item is VideoHistoryRecord => item !== null)
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
    .slice(0, HISTORY_LIMIT)
    .forEach(item => { records[item.code] = item })

  return {
    version: 1,
    updatedAt: Number(candidate.updatedAt) || 0,
    records,
  }
}

export async function loadVideoHistory(): Promise<VideoHistoryStore> {
  if (!(await FileManager.exists(FILE))) return emptyStore()
  try {
    return parseStore(await FileManager.readAsString(FILE, "utf8"))
  } catch {
    await new Promise<void>(resolve => setTimeout(() => resolve(), 60))
    try {
      return parseStore(await FileManager.readAsString(FILE, "utf8"))
    } catch {
      return emptyStore()
    }
  }
}

async function saveVideoHistory(store: VideoHistoryStore): Promise<void> {
  store.updatedAt = Date.now()
  await FileManager.writeAsString(FILE, JSON.stringify(store), "utf8")
}

export async function deleteVideoHistory(code: string): Promise<VideoHistoryStore> {
  const store = await loadVideoHistory()
  delete store.records[code.toLowerCase()]
  await saveVideoHistory(store)
  return store
}

export async function clearVideoHistory(): Promise<VideoHistoryStore> {
  const store = emptyStore()
  await saveVideoHistory(store)
  return store
}

export function historyFilePath(): string {
  return FILE
}
