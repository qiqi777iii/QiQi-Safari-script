// GitHub private-repo sync for Tab.
// Uses Scripting's built-in GitHub capability (OAuth token from Settings → GitHub),
// so no token is ever stored in code. Reads/writes a single store.json in a private repo.

import {
  loadStore,
  overwriteStore,
  saveStore,
  type Store,
} from "./store"

export const SYNC_OWNER = "qiqi777iii"
export const SYNC_REPO = "tab-sync"
export const SYNC_PATH = "store.json"

const LAST_SYNC_KEY = "tab.lastSyncAt"
const LAST_RESULT_KEY = "tab.lastSyncResult"
const INTERVAL_KEY = "tab.autoSyncInterval" // seconds; 0 = off, -1 = every open
const AUTO_PROVIDER_KEY = "tab.autoSyncProvider"
const ICLOUD_DIR_NAME = "Tab"
const ICLOUD_FILE_NAME = "store.json"
const ICLOUD_BACKUP_DIR_NAME = "backups"
const GITHUB_BACKUP_DIR = "backups"
const LARGE_DELETE_THRESHOLD = 5
const LARGE_DELETE_RATIO = 0.75

let syncLock = false

export type AutoSyncProvider = "icloud" | "github"

/** Auto-sync interval options in seconds. 0=off, -1=every open. */
export const AUTO_SYNC_OPTIONS: { label: string; seconds: number }[] = [
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
  sha?: string
  summary: StoreSummary
  source?: "github" | "icloud" | "local"
  current?: boolean
}

export type PushResult = {
  ok: boolean
  message: string
  conflict?: boolean
  risk?: boolean
  localSummary?: StoreSummary
  remoteSummary?: StoreSummary
}

export function getAutoSyncInterval(): number {
  const v = Storage.get<number>(INTERVAL_KEY)
  return typeof v === "number" ? v : 0
}

export function setAutoSyncInterval(seconds: number): void {
  Storage.set(INTERVAL_KEY, seconds)
}

export function autoSyncLabel(seconds: number): string {
  const o = AUTO_SYNC_OPTIONS.find(x => x.seconds === seconds)
  return o ? o.label : "关闭"
}

export function getAutoSyncProvider(): AutoSyncProvider | null {
  const value = Storage.get<string>(AUTO_PROVIDER_KEY)
  if (value === "icloud" || value === "github") return value
  return null
}

export function setAutoSyncProvider(provider: AutoSyncProvider | null): void {
  if (provider) Storage.set(AUTO_PROVIDER_KEY, provider)
  else Storage.set(AUTO_PROVIDER_KEY, "")
}

export function iCloudAvailable(): boolean {
  try {
    return FileManager.isiCloudEnabled
  } catch {
    return false
  }
}

function iCloudStorePath(): string | null {
  if (!iCloudAvailable()) return null
  return `${FileManager.iCloudDocumentsDirectory}/${ICLOUD_DIR_NAME}/${ICLOUD_FILE_NAME}`
}

function iCloudBackupDir(): string | null {
  if (!iCloudAvailable()) return null
  return `${FileManager.iCloudDocumentsDirectory}/${ICLOUD_DIR_NAME}/${ICLOUD_BACKUP_DIR_NAME}`
}

export type SyncResult = "ok" | "failed" | "never"

export type SyncMeta = {
  lastSyncAt: number | null
  lastResult: SyncResult
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

/** True when PRO + a GitHub token is configured. */
export function syncAvailable(): boolean {
  try {
    return GitHub.isAvailable()
  } catch {
    return false
  }
}

/** Ensure the read/write content permissions are granted for this script. */
export async function ensurePermissions(): Promise<boolean> {
  try {
    const granted = await GitHub.requestPermissions([
      "read_contents",
      "write_contents",
    ])
    return (
      granted.includes("read_contents") && granted.includes("write_contents")
    )
  } catch {
    return false
  }
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
  const bookmarks = groups.reduce((sum: number, group: Store["groups"][number]) => sum + (Array.isArray(group.bookmarks) ? group.bookmarks.length : 0), 0)
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
  if (lost < LARGE_DELETE_THRESHOLD) return false
  if (remote.bookmarks === 0) return false
  return local.bookmarks / remote.bookmarks < LARGE_DELETE_RATIO
}

function isConflictError(error: unknown): boolean {
  const text = String(error)
  return text.includes("409") || text.toLowerCase().includes("does not match")
}

/** Fetch remote file sha (and parsed store) if it exists. */
async function fetchRemote(): Promise<{ sha?: string; store?: Store }> {
  try {
    const res = await GitHub.getTextContent({
      owner: SYNC_OWNER,
      repo: SYNC_REPO,
      path: SYNC_PATH,
    })
    const sha = res.sha as string | undefined
    let store: Store | undefined
    try {
      const parsed = JSON.parse(res.text) as Store
      if (parsed && Array.isArray(parsed.groups)) store = parsed
    } catch {
      // ignore parse error, treat as no usable remote
    }
    return { sha, store }
  } catch {
    // 404 (file not yet created) or other read error
    return {}
  }
}

async function backupRemoteStore(remote: { sha?: string; store?: Store } | null): Promise<string | null> {
  if (!remote?.store) return null
  const path = `${GITHUB_BACKUP_DIR}/${backupName()}`
  await GitHub.putContent({
    owner: SYNC_OWNER,
    repo: SYNC_REPO,
    path,
    message: `backup: ${new Date().toISOString()}`,
    content: JSON.stringify(remote.store, null, 2),
  })
  return path
}

async function loadICloudCurrent(): Promise<Store | null> {
  const file = iCloudStorePath()
  if (!file || !(await FileManager.exists(file))) return null
  const raw = await FileManager.readAsString(file)
  const parsed = JSON.parse(raw) as Store
  if (!parsed || !Array.isArray(parsed.groups)) return null
  return parsed
}

async function backupICloudCurrent(): Promise<string | null> {
  const dir = iCloudBackupDir()
  const current = await loadICloudCurrent()
  if (!dir || !current) return null
  await FileManager.createDirectory(dir, true)
  const path = `${dir}/${backupName()}`
  await FileManager.writeAsString(path, JSON.stringify(current, null, 2))
  return path
}

async function loadStoreFromPath(path: string): Promise<Store | null> {
  try {
    const raw = await FileManager.readAsString(path)
    const parsed = JSON.parse(raw) as Store
    if (!parsed || !Array.isArray(parsed.groups)) return null
    return parsed
  } catch {
    return null
  }
}

async function uploadLocalWithSha(local: Store, sha?: string): Promise<void> {
  await GitHub.putContent({
    owner: SYNC_OWNER,
    repo: SYNC_REPO,
    path: SYNC_PATH,
    message: `sync: ${new Date().toISOString()}`,
    content: JSON.stringify(local, null, 2),
    sha,
  })
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

/** Upload local store.json to iCloud Documents. */
export async function pushToICloud(): Promise<{ ok: boolean; message: string }> {
  return withSyncLock(async () => {
    const file = iCloudStorePath()
    if (!file) {
      setMeta("failed")
      return { ok: false, message: "iCloud 未开启或不可用" }
    }
    try {
      const local = await loadStore()
      const dir = file.slice(0, file.lastIndexOf("/"))
      await FileManager.createDirectory(dir, true)
      await backupICloudCurrent()
      await FileManager.writeAsString(file, JSON.stringify(local, null, 2))
      setMeta("ok")
      return { ok: true, message: "已上传到 iCloud，并已保存上传前 iCloud 快照" }
    } catch (e) {
      setMeta("failed")
      return { ok: false, message: `iCloud 上传失败：${String(e)}` }
    }
  }, { ok: false, message: "已有同步正在进行，请稍后再试" })
}

/** Download iCloud store.json and overwrite local. */
export async function pullFromICloud(): Promise<{ ok: boolean; message: string }> {
  return withSyncLock(async () => {
    const file = iCloudStorePath()
    if (!file) {
      setMeta("failed")
      return { ok: false, message: "iCloud 未开启或不可用" }
    }
    try {
      if (!(await FileManager.exists(file))) {
        setMeta("failed")
        return { ok: false, message: "iCloud 暂无备份数据" }
      }
      const raw = await FileManager.readAsString(file)
      const parsed = JSON.parse(raw) as Store
      if (!parsed || !Array.isArray(parsed.groups)) {
        setMeta("failed")
        return { ok: false, message: "iCloud 备份数据格式无效" }
      }
      await overwriteStore(parsed)
      setMeta("ok")
      return { ok: true, message: "已从 iCloud 恢复" }
    } catch (e) {
      setMeta("failed")
      return { ok: false, message: `iCloud 恢复失败：${String(e)}` }
    }
  }, { ok: false, message: "已有同步正在进行，请稍后再试" })
}

/** Upload local store.json to the private repo. Default mode refuses risky overwrites. */
export async function pushToCloud(options?: { force?: boolean; skipRiskCheck?: boolean }): Promise<PushResult> {
  return withSyncLock(async () => {
    if (!syncAvailable()) {
      return { ok: false, message: "GitHub 未配置或未启用 PRO" }
    }
    if (!(await ensurePermissions())) {
      setMeta("failed")
      return { ok: false, message: "未授予 GitHub 读写权限" }
    }
    try {
      const local = await loadStore()
      const localSummary = summarizeStore(local)
      const remote = await fetchRemote()
      const remoteSummary = remote.store ? summarizeStore(remote.store) : undefined

      if (!options?.force && !options?.skipRiskCheck && remoteSummary && isPossibleAccidentalDelete(localSummary, remoteSummary)) {
        setMeta("failed")
        return {
          ok: false,
          risk: true,
          message: "本机收藏明显少于云端，已暂停上传，避免误删覆盖云端。",
          localSummary,
          remoteSummary,
        }
      }

      await backupRemoteStore(remote)
      try {
        await uploadLocalWithSha(local, remote.sha)
      } catch (e) {
        if (isConflictError(e)) {
          const latestRemote = await fetchRemote()
          if (options?.force) {
            await backupRemoteStore(latestRemote)
            await uploadLocalWithSha(local, latestRemote.sha)
            setMeta("ok")
            return { ok: true, message: "云端已变化，已刷新版本后用本机数据覆盖云端", localSummary, remoteSummary: latestRemote.store ? summarizeStore(latestRemote.store) : remoteSummary }
          }
          setMeta("failed")
          return {
            ok: false,
            conflict: true,
            message: "云端版本已变化，请选择保留本机或恢复云端。",
            localSummary,
            remoteSummary: latestRemote.store ? summarizeStore(latestRemote.store) : remoteSummary,
          }
        }
        throw e
      }

      setMeta("ok")
      return { ok: true, message: "已上传到云端，并已保存上传前云端快照", localSummary, remoteSummary }
    } catch (e) {
      setMeta("failed")
      return { ok: false, message: `上传失败：${String(e)}` }
    }
  }, { ok: false, message: "已有同步正在进行，请稍后再试" })
}

/** Download store.json from the private repo and overwrite local. */
export async function pullFromCloud(): Promise<{
  ok: boolean
  message: string
}> {
  return withSyncLock(async () => {
    if (!syncAvailable()) {
      return { ok: false, message: "GitHub 未配置或未启用 PRO" }
    }
    if (!(await ensurePermissions())) {
      setMeta("failed")
      return { ok: false, message: "未授予 GitHub 读写权限" }
    }
    try {
      const remote = await fetchRemote()
      if (!remote.store) {
        setMeta("failed")
        return { ok: false, message: "云端暂无数据" }
      }
      await overwriteStore(remote.store)
      setMeta("ok")
      return { ok: true, message: "已从云端恢复" }
    } catch (e) {
      setMeta("failed")
      return { ok: false, message: `恢复失败：${String(e)}` }
    }
  }, { ok: false, message: "已有同步正在进行，请稍后再试" })
}

export async function getCloudCurrentVersion(): Promise<CloudBackup | null> {
  if (!syncAvailable()) return null
  if (!(await ensurePermissions())) return null
  const remote = await fetchRemote()
  if (!remote.store) return null
  return {
    path: SYNC_PATH,
    name: "当前 GitHub 云端",
    sha: remote.sha,
    summary: summarizeStore(remote.store),
    source: "github",
    current: true,
  }
}

export async function getICloudCurrentVersion(): Promise<CloudBackup | null> {
  const file = iCloudStorePath()
  const store = await loadICloudCurrent()
  if (!file || !store) return null
  return {
    path: file,
    name: "当前 iCloud",
    summary: summarizeStore(store),
    source: "icloud",
    current: true,
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

export async function listCloudBackups(limit = 10): Promise<CloudBackup[]> {
  if (!syncAvailable()) return []
  if (!(await ensurePermissions())) return []
  try {
    const content = await GitHub.getContent({
      owner: SYNC_OWNER,
      repo: SYNC_REPO,
      path: GITHUB_BACKUP_DIR,
    })
    if (!Array.isArray(content)) return []
    const files = content
      .filter(item => String(item.name || "").endsWith(".json") && item.type === "file")
      .sort((a, b) => String(b.name || "").localeCompare(String(a.name || "")))
      .slice(0, limit)

    const backups: CloudBackup[] = []
    for (const file of files) {
      try {
        const res = await GitHub.getTextContent({
          owner: SYNC_OWNER,
          repo: SYNC_REPO,
          path: String(file.path),
        })
        const parsed = JSON.parse(res.text) as Store
        if (!parsed || !Array.isArray(parsed.groups)) continue
        backups.push({
          path: String(file.path),
          name: String(file.name),
          sha: String(file.sha || ""),
          summary: summarizeStore(parsed),
          source: "github",
        })
      } catch {
        // skip broken backup
      }
    }
    return backups
  } catch {
    return []
  }
}

export async function listICloudBackups(limit = 50): Promise<CloudBackup[]> {
  const dir = iCloudBackupDir()
  if (!dir) return []
  try {
    if (!(await FileManager.exists(dir))) return []
    const paths = await FileManager.readDirectory(dir, false)
    const files = paths
      .filter(path => path.endsWith(".json"))
      .sort((a, b) => b.localeCompare(a))
      .slice(0, limit)

    const backups: CloudBackup[] = []
    for (const path of files) {
      const parsed = await loadStoreFromPath(path)
      if (!parsed) continue
      backups.push({
        path,
        name: path.split("/").pop() || path,
        summary: summarizeStore(parsed),
        source: "icloud",
      })
    }
    return backups
  } catch {
    return []
  }
}

export async function deleteICloudBackup(path: string): Promise<{ ok: boolean; message: string }> {
  try {
    const dir = iCloudBackupDir()
    if (!dir || !path.startsWith(dir + "/")) {
      return { ok: false, message: "只能删除 iCloud 历史快照" }
    }
    if (await FileManager.exists(path)) await FileManager.remove(path)
    return { ok: true, message: "已删除 iCloud 历史快照" }
  } catch (e) {
    return { ok: false, message: `删除 iCloud 历史快照失败：${String(e)}` }
  }
}

export async function deleteCloudBackup(path: string, sha?: string): Promise<{ ok: boolean; message: string }> {
  if (!syncAvailable()) return { ok: false, message: "GitHub 未配置或未启用 PRO" }
  if (!(await ensurePermissions())) return { ok: false, message: "未授予 GitHub 读写权限" }
  if (!path.startsWith(`${GITHUB_BACKUP_DIR}/`)) {
    return { ok: false, message: "只能删除 GitHub 历史快照" }
  }
  try {
    let targetSha = sha
    if (!targetSha) {
      const content = await GitHub.getContent({ owner: SYNC_OWNER, repo: SYNC_REPO, path })
      if (Array.isArray(content)) return { ok: false, message: "快照路径无效" }
      targetSha = String(content.sha || "")
    }
    if (!targetSha) return { ok: false, message: "无法获取快照版本 SHA" }
    await GitHub.deleteContent({
      owner: SYNC_OWNER,
      repo: SYNC_REPO,
      path,
      sha: targetSha,
      message: `delete backup: ${path}`,
    })
    return { ok: true, message: "已删除 GitHub 历史快照" }
  } catch (e) {
    return { ok: false, message: `删除 GitHub 历史快照失败：${String(e)}` }
  }
}

export async function restoreICloudBackup(path: string): Promise<{ ok: boolean; message: string; summary?: StoreSummary }> {
  return withSyncLock(async () => {
    try {
      const parsed = await loadStoreFromPath(path)
      if (!parsed) {
        setMeta("failed")
        return { ok: false, message: "iCloud 历史版本格式无效" }
      }
      await overwriteStore(parsed)
      setMeta("ok")
      return { ok: true, message: "已恢复 iCloud 历史版本到本机", summary: summarizeStore(parsed) }
    } catch (e) {
      setMeta("failed")
      return { ok: false, message: `恢复 iCloud 历史版本失败：${String(e)}` }
    }
  }, { ok: false, message: "已有同步正在进行，请稍后再试" })
}

export async function restoreCloudBackup(path: string): Promise<{ ok: boolean; message: string; summary?: StoreSummary }> {
  return withSyncLock(async () => {
    if (!syncAvailable()) {
      return { ok: false, message: "GitHub 未配置或未启用 PRO" }
    }
    if (!(await ensurePermissions())) {
      setMeta("failed")
      return { ok: false, message: "未授予 GitHub 读写权限" }
    }
    try {
      const res = await GitHub.getTextContent({ owner: SYNC_OWNER, repo: SYNC_REPO, path })
      const parsed = JSON.parse(res.text) as Store
      if (!parsed || !Array.isArray(parsed.groups)) {
        setMeta("failed")
        return { ok: false, message: "历史版本格式无效" }
      }
      await overwriteStore(parsed)
      setMeta("ok")
      return { ok: true, message: "已恢复历史版本到本机", summary: summarizeStore(parsed) }
    } catch (e) {
      setMeta("failed")
      return { ok: false, message: `恢复历史版本失败：${String(e)}` }
    }
  }, { ok: false, message: "已有同步正在进行，请稍后再试" })
}

export function formatSyncStatus(meta: SyncMeta): string {
  if (meta.lastResult === "never" || meta.lastSyncAt == null) {
    return "尚未同步"
  }
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
  const tag = meta.lastResult === "ok" ? "已同步" : "上次失败"
  return `${tag} · ${when}`
}

/**
 * Foreground auto-sync: called when the main view appears. If the configured
 * interval has elapsed since the last successful sync (or it's set to every-open),
 * upload to cloud once. Returns true if a sync was performed.
 */
export async function maybeAutoSync(): Promise<boolean> {
  const interval = getAutoSyncInterval()
  if (interval === 0) return false
  const provider = getAutoSyncProvider()
  if (!provider) return false
  if (provider === "github" && !syncAvailable()) return false
  if (provider === "icloud" && !iCloudAvailable()) return false
  const meta = getSyncMeta()
  if (interval > 0 && meta.lastSyncAt != null) {
    const elapsed = (Date.now() - meta.lastSyncAt) / 1000
    if (elapsed < interval) return false
  }
  const r = provider === "icloud" ? await pushToICloud() : await pushToCloud()
  return r.ok
}
