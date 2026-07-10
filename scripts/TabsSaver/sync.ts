// WebDAV sync for Tabs Saver.
// Credentials are stored only in local Scripting Storage, not in code or repo.

import { fetch } from "scripting"
import { loadStore, overwriteStore, type Store } from "./store"

const LAST_SYNC_KEY = "tab.lastSyncAt"
const LAST_RESULT_KEY = "tab.lastSyncResult"
const INTERVAL_KEY = "tab.autoSyncInterval"
const WEBDAV_URL_KEY = "tab.webdav.url"
const WEBDAV_BACKUP_DIR_KEY = "tab.webdav.backupDir"
const WEBDAV_USERNAME_KEY = "tab.webdav.username"
const WEBDAV_PASSWORD_KEY = "tab.webdav.password"
const WEBDAV_MAX_BACKUPS_KEY = "tab.webdav.maxBackups"
const WEBDAV_KNOWN_BACKUPS_KEY = "tab.webdav.knownBackups"
const LARGE_DELETE_THRESHOLD = 5
const LARGE_DELETE_RATIO = 0.75

let syncLock = false

export type AutoSyncProvider = "webdav"
export const AUTO_SYNC_OPTIONS = [
  { label: "关闭", seconds: 0 },
  { label: "每次打开", seconds: -1 },
  { label: "每 1 小时", seconds: 3600 },
  { label: "每 6 小时", seconds: 21600 },
  { label: "每 24 小时", seconds: 86400 },
]

export type StoreSummary = {
  groups: number
  bookmarks: number
  favorites: number
  updatedAt: number | null
  label: string
}
export type CloudBackup = {
  path: string
  name: string
  summary: StoreSummary
  source?: "webdav" | "local"
  current?: boolean
}
export type PushResult = {
  ok: boolean
  message: string
  risk?: boolean
  localSummary?: StoreSummary
  remoteSummary?: StoreSummary
}
export type WebDAVConfig = {
  url: string
  backupDir: string
  username: string
  password: string
  maxBackups: number
}
export type SyncResult = "ok" | "failed" | "never"
export type SyncMeta = { lastSyncAt: number | null; lastResult: SyncResult }

export function getAutoSyncInterval(): number {
  const v = Storage.get<number>(INTERVAL_KEY)
  return typeof v === "number" ? v : 0
}
export function setAutoSyncInterval(seconds: number): void {
  Storage.set(INTERVAL_KEY, seconds)
}
export function autoSyncLabel(seconds: number): string {
  return AUTO_SYNC_OPTIONS.find(x => x.seconds === seconds)?.label ?? "关闭"
}
export function getAutoSyncProvider(): AutoSyncProvider | null {
  return webDAVConfigured() ? "webdav" : null
}
export function setAutoSyncProvider(provider: AutoSyncProvider | null): void {
  if (!provider) setAutoSyncInterval(0)
}

export function getWebDAVConfig(): WebDAVConfig {
  return {
    url: Storage.get<string>(WEBDAV_URL_KEY) || "",
    backupDir: Storage.get<string>(WEBDAV_BACKUP_DIR_KEY) || "TabsSaver",
    username: Storage.get<string>(WEBDAV_USERNAME_KEY) || "",
    password: Storage.get<string>(WEBDAV_PASSWORD_KEY) || "",
    maxBackups: Storage.get<number>(WEBDAV_MAX_BACKUPS_KEY) || 5,
  }
}
export function saveWebDAVConfig(config: WebDAVConfig): void {
  Storage.set(WEBDAV_URL_KEY, config.url.trim())
  Storage.set(WEBDAV_BACKUP_DIR_KEY, config.backupDir.trim() || "TabsSaver")
  Storage.set(WEBDAV_USERNAME_KEY, config.username.trim())
  Storage.set(WEBDAV_PASSWORD_KEY, config.password)
  Storage.set(WEBDAV_MAX_BACKUPS_KEY, config.maxBackups)
}
export function clearWebDAVConfig(): void {
  Storage.set(WEBDAV_URL_KEY, "")
  Storage.set(WEBDAV_BACKUP_DIR_KEY, "")
  Storage.set(WEBDAV_USERNAME_KEY, "")
  Storage.set(WEBDAV_PASSWORD_KEY, "")
  Storage.set(WEBDAV_MAX_BACKUPS_KEY, 5)
  Storage.set(WEBDAV_KNOWN_BACKUPS_KEY, "[]")
  setAutoSyncInterval(0)
}
export function webDAVConfigured(): boolean {
  const c = getWebDAVConfig()
  return /^https?:\/\//i.test(c.url) && c.username.length > 0 && c.password.length > 0
}

export function getSyncMeta(): SyncMeta {
  const at = Storage.get<number>(LAST_SYNC_KEY)
  const r = Storage.get<SyncResult>(LAST_RESULT_KEY)
  return {
    lastSyncAt: typeof at === "number" ? at : null,
    lastResult: r ?? "never",
  }
}
function setMeta(result: SyncResult): void {
  Storage.set(LAST_RESULT_KEY, result)
  if (result === "ok") Storage.set(LAST_SYNC_KEY, Date.now())
}
function pad(n: number): string {
  return n < 10 ? "0" + n : "" + n
}
function formatDateTime(ts: number | null | undefined): string {
  if (!ts) return "未知时间"
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function backupName(date = new Date()): string {
  return `store-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${date.getMilliseconds()}.json`
}

export function summarizeStore(store: Store): StoreSummary {
  const groups = Array.isArray(store.groups) ? store.groups : []
  const bookmarks = groups.reduce(
    (sum: number, group: Store["groups"][number]) =>
      sum + (Array.isArray(group.bookmarks) ? group.bookmarks.length : 0),
    0,
  )
  const favorites = Array.isArray(store.favorites) ? store.favorites.length : 0
  const updatedAt = typeof store.updatedAt === "number" ? store.updatedAt : null
  return {
    groups: groups.length,
    bookmarks,
    favorites,
    updatedAt,
    label: `${groups.length}组 · ${bookmarks}个 · 收藏${favorites}个 · 数据更新 ${formatDateTime(updatedAt)}`,
  }
}
function isPossibleAccidentalDelete(local: StoreSummary, remote: StoreSummary): boolean {
  const lost = remote.bookmarks - local.bookmarks
  if (lost < LARGE_DELETE_THRESHOLD || remote.bookmarks === 0) return false
  return local.bookmarks / remote.bookmarks < LARGE_DELETE_RATIO
}
function basicAuth(username: string, password: string): string {
  return `Basic ${btoa(`${username}:${password}`)}`
}
function trimSlashes(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, "")
}
function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "")
}
function encodePath(path: string): string {
  return trimSlashes(path)
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/")
}
function webDAVBaseUrl(): string {
  return normalizeBaseUrl(getWebDAVConfig().url)
}
function webDAVBackupDir(): string {
  return trimSlashes(getWebDAVConfig().backupDir || "TabsSaver")
}
function storeUrl(): string {
  return `${webDAVBaseUrl()}/${encodePath(webDAVBackupDir())}/store.json`
}
function backupDirUrl(): string {
  return `${webDAVBaseUrl()}/${encodePath(webDAVBackupDir())}/backups`
}
function backupDirCollectionUrl(): string {
  return `${backupDirUrl()}/`
}
function backupFileUrl(): string {
  return `${backupDirUrl()}/${backupName()}`
}
export function webDAVDisplayPath(): string {
  const c = getWebDAVConfig()
  if (!c.url) return ""
  return `${normalizeBaseUrl(c.url)}/${trimSlashes(c.backupDir || "TabsSaver")}/store.json`
}

async function webdavRequest(
  method: string,
  url: string,
  body?: string,
  extraHeaders?: Record<string, string>,
): Promise<any> {
  const c = getWebDAVConfig()
  if (!webDAVConfigured()) throw new Error("WebDAV 未配置")
  const headers: Record<string, string> = {
    Authorization: basicAuth(c.username, c.password),
    ...(extraHeaders || {}),
  }
  if (body != null && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json; charset=utf-8"
  }
  return await fetch(url, { method, headers, body })
}
async function propfindBackups(): Promise<string> {
  const body = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:resourcetype />
    <d:getcontentlength />
    <d:getlastmodified />
  </d:prop>
</d:propfind>`
  const res = await webdavRequest("PROPFIND", backupDirCollectionUrl(), body, {
    Depth: "1",
    Accept: "application/xml, text/xml, */*",
    "Content-Type": "application/xml; charset=utf-8",
  })
  if (!res.ok && res.status !== 207) {
    throw new Error(`PROPFIND 失败：HTTP ${res.status}`)
  }
  return await res.text()
}
function extractWebDAVHrefs(xml: string): string[] {
  return Array.from(
    xml.matchAll(/<[^:>]*:?href[^>]*>([\s\S]*?)<\/[^:>]*:?href>/g) as Iterable<any>,
  )
    .map((match: any) => String(match[1] || "").trim())
    .filter(Boolean)
}
function backupNameFromHref(href: string): string {
  try {
    href = decodeURIComponent(href)
  } catch {}
  return href.split("?")[0].split("#")[0].split("/").filter(Boolean).pop() || ""
}
function getKnownBackupNames(): string[] {
  const raw = Storage.get<string>(WEBDAV_KNOWN_BACKUPS_KEY) || "[]"
  try {
    const parsed = JSON.parse(raw) as string[]
    return Array.isArray(parsed)
      ? parsed.filter(name => /^store-.*\.json$/.test(name))
      : []
  } catch {
    return []
  }
}
function setKnownBackupNames(names: string[]): void {
  Storage.set(
    WEBDAV_KNOWN_BACKUPS_KEY,
    JSON.stringify(
      Array.from(new Set(names)).sort((a, b) => b.localeCompare(a)),
    ),
  )
}
function rememberBackupName(name: string): void {
  if (!/^store-.*\.json$/.test(name)) return
  setKnownBackupNames([name, ...getKnownBackupNames()])
}
async function fetchBackupByName(name: string): Promise<Store | null> {
  try {
    const res = await webdavRequest(
      "GET",
      `${backupDirUrl()}/${encodeURIComponent(name)}`,
    )
    if (!res.ok) return null
    const parsed = JSON.parse(await res.text()) as Store
    if (!parsed || !Array.isArray(parsed.groups)) return null
    return parsed
  } catch {
    return null
  }
}
async function ensureRemoteDirs(): Promise<void> {
  try {
    await webdavRequest(
      "MKCOL",
      `${webDAVBaseUrl()}/${encodePath(webDAVBackupDir())}`,
    )
  } catch {}
  try {
    await webdavRequest("MKCOL", backupDirUrl())
  } catch {}
}
async function cleanupOldBackups(): Promise<void> {
  const max = getWebDAVConfig().maxBackups
  if (!max || max <= 0) return
  try {
    const text = await propfindBackups()
    const names = extractWebDAVHrefs(text)
      .map(backupNameFromHref)
      .filter(name => /^store-.*\.json$/.test(name))
      .sort((a, b) => b.localeCompare(a))
    for (const name of names.slice(max)) {
      try {
        await webdavRequest(
          "DELETE",
          `${backupDirUrl()}/${encodeURIComponent(name)}`,
        )
      } catch {}
    }
    setKnownBackupNames(names.slice(0, max))
  } catch {
    setKnownBackupNames(getKnownBackupNames().slice(0, max))
  }
}
async function fetchRemote(): Promise<Store | null> {
  const res = await webdavRequest("GET", storeUrl())
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const parsed = JSON.parse(await res.text()) as Store
  if (!parsed || !Array.isArray(parsed.groups)) {
    throw new Error("WebDAV 数据格式无效")
  }
  return parsed
}
async function backupRemoteStore(remote: Store | null): Promise<string | null> {
  if (!remote) return null
  await ensureRemoteDirs()
  const url = backupFileUrl()
  const res = await webdavRequest("PUT", url, JSON.stringify(remote, null, 2))
  if (!res.ok && res.status !== 201 && res.status !== 204) {
    throw new Error(`备份失败 HTTP ${res.status}`)
  }
  const name = url.split("/").pop() || ""
  rememberBackupName(name)
  return url
}
async function uploadStore(local: Store): Promise<void> {
  await ensureRemoteDirs()
  const res = await webdavRequest("PUT", storeUrl(), JSON.stringify(local, null, 2))
  if (!res.ok && res.status !== 201 && res.status !== 204) {
    throw new Error(`上传失败 HTTP ${res.status}`)
  }
}
async function withSyncLock<T>(fn: () => Promise<T>, busyValue: T): Promise<T> {
  if (syncLock) return busyValue
  syncLock = true
  try {
    return await fn()
  } finally {
    syncLock = false
  }
}

export async function testWebDAVConnection(): Promise<{
  ok: boolean
  message: string
}> {
  try {
    if (!webDAVConfigured()) {
      return { ok: false, message: "请先填写 WebDAV 地址、用户名和密码/Token" }
    }
    const res = await webdavRequest("GET", storeUrl())
    if (res.ok || res.status === 404) {
      return {
        ok: true,
        message: res.status === 404 ? "连接成功，远端文件尚未创建" : "连接成功",
      }
    }
    return { ok: false, message: `连接失败：HTTP ${res.status}` }
  } catch (e) {
    return { ok: false, message: `连接失败：${String(e)}` }
  }
}

export async function pushToCloud(options?: {
  force?: boolean
  skipRiskCheck?: boolean
}): Promise<PushResult> {
  return withSyncLock(async () => {
    if (!webDAVConfigured()) return { ok: false, message: "WebDAV 未配置" }
    try {
      const local = await loadStore()
      const localSummary = summarizeStore(local)
      const remote = await fetchRemote()
      const remoteSummary = remote ? summarizeStore(remote) : undefined
      if (
        !options?.force &&
        !options?.skipRiskCheck &&
        remoteSummary &&
        isPossibleAccidentalDelete(localSummary, remoteSummary)
      ) {
        setMeta("failed")
        return {
          ok: false,
          risk: true,
          message: "本机收藏明显少于 WebDAV，已暂停上传，避免误删覆盖远端。",
          localSummary,
          remoteSummary,
        }
      }
      await backupRemoteStore(remote)
      await uploadStore(local)
      await cleanupOldBackups()
      setMeta("ok")
      return {
        ok: true,
        message: "已上传到 WebDAV，并已保存上传前远端快照",
        localSummary,
        remoteSummary,
      }
    } catch (e) {
      setMeta("failed")
      return { ok: false, message: `WebDAV 上传失败：${String(e)}` }
    }
  }, { ok: false, message: "已有同步正在进行，请稍后再试" })
}

export async function pullFromCloud(): Promise<{ ok: boolean; message: string }> {
  return withSyncLock(async () => {
    if (!webDAVConfigured()) return { ok: false, message: "WebDAV 未配置" }
    try {
      const remote = await fetchRemote()
      if (!remote) {
        setMeta("failed")
        return { ok: false, message: "WebDAV 暂无数据" }
      }
      await overwriteStore(remote)
      setMeta("ok")
      return { ok: true, message: "已从 WebDAV 恢复" }
    } catch (e) {
      setMeta("failed")
      return { ok: false, message: `WebDAV 恢复失败：${String(e)}` }
    }
  }, { ok: false, message: "已有同步正在进行，请稍后再试" })
}

export async function getCloudCurrentVersion(): Promise<CloudBackup | null> {
  if (!webDAVConfigured()) return null
  try {
    const remote = await fetchRemote()
    if (!remote) return null
    return {
      path: storeUrl(),
      name: "当前 WebDAV",
      summary: summarizeStore(remote),
      source: "webdav",
      current: true,
    }
  } catch {
    return null
  }
}
export async function getLocalCurrentVersion(): Promise<CloudBackup> {
  const store = await loadStore()
  return {
    path: "local",
    name: "当前本机",
    summary: summarizeStore(store),
    source: "local",
    current: true,
  }
}
export async function listCloudBackups(limit = 100): Promise<CloudBackup[]> {
  if (!webDAVConfigured()) return []
  let names = getKnownBackupNames()
  try {
    const text = await propfindBackups()
    const remoteNames = extractWebDAVHrefs(text)
      .map(backupNameFromHref)
      .filter(name => /^store-.*\.json$/.test(name))
    names = Array.from(new Set([...remoteNames, ...names]))
      .sort((a, b) => b.localeCompare(a))
      .slice(0, limit)
    setKnownBackupNames(names)
  } catch (e) {
    console.error("List WebDAV backups failed", e)
    names = names.slice(0, limit)
  }

  const backups: CloudBackup[] = []
  for (const name of names) {
    const store = await fetchBackupByName(name)
    if (!store) continue
    backups.push({
      path: `${backupDirUrl()}/${encodeURIComponent(name)}`,
      name,
      summary: summarizeStore(store),
      source: "webdav",
    })
  }
  return backups
}
export async function deleteCloudBackup(
  path: string,
): Promise<{ ok: boolean; message: string }> {
  if (!webDAVConfigured()) return { ok: false, message: "WebDAV 未配置" }
  if (!path.startsWith(backupDirUrl() + "/")) {
    return { ok: false, message: "只能删除 WebDAV 历史快照" }
  }
  try {
    const res = await webdavRequest("DELETE", path)
    if (!res.ok && res.status !== 204 && res.status !== 404) {
      return { ok: false, message: `删除失败：HTTP ${res.status}` }
    }
    const name = decodeURIComponent(path.split("/").pop() || "")
    setKnownBackupNames(getKnownBackupNames().filter(item => item !== name))
    return { ok: true, message: "已删除 WebDAV 历史快照" }
  } catch (e) {
    return { ok: false, message: `删除 WebDAV 历史快照失败：${String(e)}` }
  }
}
export async function restoreCloudBackup(
  path: string,
): Promise<{ ok: boolean; message: string; summary?: StoreSummary }> {
  return withSyncLock(async () => {
    if (!webDAVConfigured()) return { ok: false, message: "WebDAV 未配置" }
    try {
      if (!path.startsWith(backupDirUrl() + "/")) {
        return { ok: false, message: "只能恢复 WebDAV 历史快照" }
      }
      const res = await webdavRequest("GET", path)
      if (!res.ok) {
        return { ok: false, message: `读取历史快照失败：HTTP ${res.status}` }
      }
      const parsed = JSON.parse(await res.text()) as Store
      if (!parsed || !Array.isArray(parsed.groups)) {
        return { ok: false, message: "历史快照格式无效" }
      }
      await overwriteStore(parsed)
      setMeta("ok")
      return {
        ok: true,
        message: "已恢复 WebDAV 历史快照到本机",
        summary: summarizeStore(parsed),
      }
    } catch (e) {
      setMeta("failed")
      return { ok: false, message: `恢复 WebDAV 历史快照失败：${String(e)}` }
    }
  }, { ok: false, message: "已有同步正在进行，请稍后再试" })
}

export function formatSyncStatus(meta: SyncMeta): string {
  if (meta.lastResult === "never" || meta.lastSyncAt == null) return "尚未同步"
  const d = new Date(meta.lastSyncAt)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const when = sameDay
    ? `今天 ${hm}`
    : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`
  return `${meta.lastResult === "ok" ? "已同步" : "上次失败"} · ${when}`
}
export async function maybeAutoSync(): Promise<boolean> {
  const interval = getAutoSyncInterval()
  if (interval === 0 || !webDAVConfigured()) return false
  const meta = getSyncMeta()
  if (interval > 0 && meta.lastSyncAt != null) {
    const elapsed = (Date.now() - meta.lastSyncAt) / 1000
    if (elapsed < interval) return false
  }
  const r = await pushToCloud()
  return r.ok
}
