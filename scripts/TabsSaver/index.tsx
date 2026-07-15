import {
  Script,
  Navigation,
  NavigationStack,
  NavigationLink,
  List,
  Section,
  Form,
  TextField,
  SecureField,
  Picker,
  Button,
  Menu,
  Text,
  VStack,
  HStack,
  Image,
  Spacer,
  ForEach,
  useState,
  useEffect,
  useObservable,
} from "scripting"
import {
  loadStore,
  saveStore,
  sortedGroups,
  ensureDefaultGroup,
  createGroup,
  renameGroup,
  removeGroup,
  moveGroupToTrash,
  moveBookmark,
  moveBookmarks,
  moveBookmarksToTrash,
  getTrash,
  restoreTrashItem,
  permanentlyDeleteTrashItem,
  emptyTrash,
  cleanupExpiredTrash,
  removeBookmark,
  removeBookmarks,
  markBookmarkRead,
  normalizeOrders,
  applyGroupOrder,
  totalBookmarkCount,
  getFavorites,
  addFavorite,
  isFavorited,
  removeFavorite,
  removeFavorites,
  markFavoriteRead,
  type Group,
  type Bookmark,
  type Store,
  type TrashedBookmark,
  type TrashRetentionDays,
} from "./store"
import {
  pushToCloud,
  pullFromCloud,
  listCloudBackups,
  restoreCloudBackup,
  getCloudCurrentVersion,
  deleteCloudBackup,
  getSyncMeta,
  formatSyncStatus,
  maybeAutoSync,
  getAutoSyncInterval,
  setAutoSyncInterval,
  getAutoSyncProvider,
  setAutoSyncProvider,
  autoSyncLabel,
  AUTO_SYNC_OPTIONS,
  getWebDAVConfig,
  saveWebDAVConfig,
  clearWebDAVConfig,
  webDAVConfigured,
  webDAVDisplayPath,
  testWebDAVConnection,
  getRestoreUndoInfo,
  undoLastRestore,
  type AutoSyncProvider,
  type SyncMeta,
  type PushResult,
  type CloudBackup,
  type RestoreUndoMeta,
} from "./sync"

function host(url: string): string {
  const m = url.match(/^[a-z]+:\/\/([^/?#]+)/i)
  return m ? m[1] : url
}

function faviconUrl(url: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host(url))}&sz=64`
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => (n < 10 ? "0" + n : "" + n)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (sameDay) return `今天 ${hm}`
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`
}

function dayStart(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function dayLabel(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => (n < 10 ? "0" + n : "" + n)
  const today = dayStart(new Date())
  const that = dayStart(d)
  const diff = Math.round((today - that) / 86400000)
  if (diff === 0) return "今天"
  if (diff === 1) return "昨天"
  if (diff === 2) return "前天"
  return `${d.getFullYear()}年${pad(d.getMonth() + 1)}月${pad(d.getDate())}日`
}

type DaySection = { key: number; label: string; items: Bookmark[] }

const TRASH_RETENTION_KEY = "tab.trashRetentionDays"
const BROWSER_SCRIPT_NAME = "tabs-saver-button.user.js"
const GUIDE_SHOWN_KEY = "tab.guideShown"
const APP_VERSION = "2.0.4"
const CHANGELOG_SEEN_KEY = "tab.changelogSeenVersion"
type ChangelogEntry = {
  version: string
  date: string
  summary: string
  items: string[]
}
const CHANGELOG_ENTRIES: ChangelogEntry[] = [
  {
    version: "2.0.3",
    date: "2026-07-15",
    summary: "修复悬浮按钮重叠",
    items: [
      "收藏按钮会优先排列在新标签页打开按钮左侧，不再遮挡新标签页按钮。",
    ],
  },
  {
    version: "2.0.2",
    date: "2026-07-15",
    summary: "整理版本记录",
    items: [
      "版本更新记录按功能阶段合并展示，减少连续小版本占用的列表空间。",
      "历史更新内容重新归纳为数据安全、WebDAV、收藏管理、组件与基础同步等主题。",
    ],
  },
  {
    version: "2.0.x",
    date: "2026-07-13 — 2026-07-14",
    summary: "数据安全与回收站",
    items: [
      "保护损坏收藏库，增加跨窗口平面文件锁与版本校验。",
      "Safari 收藏按钮会刷新 SPA 页面收藏状态。",
      "回收站保留期限调整为 3 天、7 天、15 天和永久。",
    ],
  },
  {
    version: "1.5.x",
    date: "2026-07-13",
    summary: "界面与版本统一",
    items: [
      "移除标签页管理菜单中的显示设置，分组列表统一显示分割线。",
      "内置 Safari 收藏按钮与 Scripting 脚本开始统一使用同一个版本号。",
    ],
  },
  {
    version: "1.4.x",
    date: "2026-07-12",
    summary: "WebDAV 恢复与批量管理",
    items: [
      "重新整理 WebDAV 恢复页，合并当前版本与历史备份并简化版本摘要。",
      "恢复前自动保存本机保护副本，并支持撤销最近一次恢复。",
      "历史备份显示文件大小及相对前一备份的新增、删除数量。",
      "分组支持批量移动收藏，并可在移动时直接新建目标分组。",
      "分组排序入口移到主界面分组的长按菜单。",
    ],
  },
  {
    version: "1.3.x",
    date: "2026-07-12",
    summary: "搜索、移动与回收站",
    items: [
      "新增主界面域名搜索和分组内搜索。",
      "收藏支持快速移动到其他分组。",
      "删除的普通收藏和分组内容会进入回收站，可恢复、永久删除或清空。",
      "WebDAV 菜单将恢复入口合并为一个恢复页面。",
      "中尺寸小组件可直接打开管理面板，并显示最近收藏所属分组。",
    ],
  },
  {
    version: "1.2.x",
    date: "2026-06-15 — 2026-07-12",
    summary: "基础同步、组件与版本记录",
    items: [
      "同步方式从 iCloud 与 GitHub 逐步迁移为 WebDAV，并保留历史快照、冲突保护和误删保护。",
      "新增主屏幕小组件，支持小号和中号布局并可直接打开收藏面板。",
      "Safari 收藏按钮纳入脚本包统一安装与更新，并增强页面加载和 SPA 场景的稳定性。",
      "历史版本支持查看、恢复、单个删除和批量删除。",
      "新增版本更新入口，可查看各阶段的详细更新内容。",
    ],
  },
]
const CHANGELOG_MESSAGE = CHANGELOG_ENTRIES[0].items.map(item => `• ${item}`).join("\n")

const GUIDE_MESSAGE = [
  "• 在 Safari 网页里点右下角的书签按钮，把当前标签存进分组；双击按钮可选择存到哪个分组。按钮可拖动，长按其菜单里有「重置位置」。",
  "• 也可以用系统分享菜单，把链接分享到「标签页收藏」来添加。",
  "• 回到本 App 查看：收藏按分组和收藏夹整理，并按日期分段。点一下用 Safari 打开，长按可复制链接或删除。",
  "• 在分组里：左滑删除，右滑加星标到「收藏」。",
  "• 右上角「…」菜单：新建分组、回收站、WebDAV 同步和关于与更新。长按任意分组可排序分组。点击列表上方的同步状态也能立即同步。",
].join("\n\n")

async function showGuide() {
  await Dialog.alert({
    title: "标签页收藏 · 使用说明",
    message: GUIDE_MESSAGE,
  })
}

async function showVersionUpdates() {
  await Navigation.present({
    element: <ChangelogView />,
    modalPresentationStyle: "pageSheet",
  })
}

function extractUserScriptVersion(source: string): string {
  return source.match(/^\/\/\s*@version\s+(.+)$/m)?.[1]?.trim() || "0.0.0"
}

function compareVersion(a: string, b: string): number {
  const left = a.split(".").map(part => Number(part) || 0)
  const right = b.split(".").map(part => Number(part) || 0)
  const length = Math.max(left.length, right.length)
  for (let i = 0; i < length; i++) {
    const diff = (left[i] || 0) - (right[i] || 0)
    if (diff !== 0) return diff
  }
  return 0
}

async function installBundledBrowserScript(): Promise<string | null> {
  try {
    const sourcePath = `${Script.directory}/${BROWSER_SCRIPT_NAME}`
    if (!(await FileManager.exists(sourcePath))) return null
    const source = await FileManager.readAsString(sourcePath)
    const sourceVersion = extractUserScriptVersion(source)
    const targetDir = FileManager.safariBrowserUserscriptsDirectory
    const targetPath = `${targetDir}/${BROWSER_SCRIPT_NAME}`
    await FileManager.createDirectory(targetDir, true)

    let shouldInstall = true
    if (await FileManager.exists(targetPath)) {
      const current = await FileManager.readAsString(targetPath)
      const currentVersion = extractUserScriptVersion(current)
      shouldInstall = compareVersion(sourceVersion, currentVersion) > 0 || current !== source
    }

    if (!shouldInstall) return null
    await FileManager.writeAsString(targetPath, source)
    return sourceVersion
  } catch (error) {
    console.error("Install Tab browser script failed", error)
    return null
  }
}

function getTrashRetentionDays(): TrashRetentionDays {
  const value = Storage.get<number>(TRASH_RETENTION_KEY)
  if (value === 3 || value === 7 || value === 15) return value
  // 将旧版的 30 天或 90 天设置迁移为新的最长保留期限。
  if (value === 30 || value === 90) {
    Storage.set(TRASH_RETENTION_KEY, 15)
    return 15
  }
  return 0
}

function setTrashRetentionDays(value: TrashRetentionDays) {
  Storage.set(TRASH_RETENTION_KEY, value)
}

function formatBytes(bytes?: number): string {
  if (bytes == null) return "大小未知"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function backupDetailLabel(backup: CloudBackup): string {
  const size = formatBytes(backup.sizeBytes)
  const diff = backup.diffFromPrevious
  if (!diff) return size
  return `${size} · 新增 ${diff.added} · 删除 ${diff.removed}`
}

function groupByDay(bookmarks: Bookmark[]): DaySection[] {
  const map = new Map<number, Bookmark[]>()
  for (const b of bookmarks) {
    const k = dayStart(new Date(b.savedAt))
    const arr = map.get(k)
    if (arr) arr.push(b)
    else map.set(k, [b])
  }
  const keys = Array.from(map.keys()).sort((a, b) => b - a)
  return keys.map(k => {
    const items = map.get(k)!.sort((a, b) => b.savedAt - a.savedAt)
    return { key: k, label: dayLabel(k), items }
  })
}

function MainView() {
  const dismiss = Navigation.useDismiss()
  const [store, setStore] = useState<Store>({ version: 1, groups: [] })
  const [loading, setLoading] = useState(true)
  const [sorting, setSorting] = useState(false)
  const editMode = useObservable(() => EditMode.inactive())
  const [sortList, setSortList] = useState<Group[]>([])
  const [syncMeta, setSyncMeta] = useState<SyncMeta>(() => getSyncMeta())
  const [syncing, setSyncing] = useState(false)
  const [autoInterval, setAutoInterval] = useState<number>(() =>
    getAutoSyncInterval(),
  )
  const [autoProvider, setAutoProvider] = useState<AutoSyncProvider | null>(() =>
    getAutoSyncProvider(),
  )

  async function reload() {
    const s = await loadStore()
    let dirty = normalizeOrders(s)
    if (cleanupExpiredTrash(s, getTrashRetentionDays()) > 0) dirty = true
    // First launch: materialize the store file with a default group so the
    // Safari userscript writes into an existing file (avoids
    // "write path is not allowed" on a not-yet-created file).
    if (s.groups.length === 0) {
      ensureDefaultGroup(s)
      normalizeOrders(s)
      dirty = true
    }
    if (dirty) await saveStore(s)
    setStore({ ...s })
    setSyncMeta(getSyncMeta())
    setLoading(false)
  }

  useEffect(() => {
    ;(async () => {
      const installedBrowserVersion = await installBundledBrowserScript()
      await reload()
      // Foreground auto-sync: upload once if the configured interval elapsed.
      if (getAutoSyncInterval() !== 0 && webDAVConfigured()) {
        setSyncing(true)
        await maybeAutoSync()
        setSyncing(false)
        setSyncMeta(getSyncMeta())
      }
      if (installedBrowserVersion) {
        await Dialog.alert({
          title: "Safari 收藏按钮已更新",
          message: `已安装 v${installedBrowserVersion}。如果 Safari 页面已打开，刷新页面后生效。`,
        })
      }
      if (Storage.get<string>(CHANGELOG_SEEN_KEY) !== APP_VERSION) {
        await Dialog.alert({
          title: `标签页收藏已更新到 v${APP_VERSION}`,
          message: CHANGELOG_MESSAGE,
        })
        Storage.set(CHANGELOG_SEEN_KEY, APP_VERSION)
      }
      // First launch: show the usage guide once.
      if (Storage.get<boolean>(GUIDE_SHOWN_KEY) !== true) {
        await showGuide()
        Storage.set(GUIDE_SHOWN_KEY, true)
      }
    })()
  }, [])

  function onChangeAutoInterval(seconds: number) {
    if (seconds !== 0 && !webDAVConfigured()) {
      openWebDAVSettings()
      return
    }
    setAutoSyncInterval(seconds)
    setAutoInterval(seconds)
    setAutoSyncProvider(seconds === 0 ? null : "webdav")
    setAutoProvider(seconds === 0 ? null : "webdav")
  }

  function webDAVStatusLabel(): string {
    if (autoProvider === "webdav" && autoInterval !== 0) return "已启用"
    return webDAVConfigured() ? "已配置" : "未配置"
  }

  function autoSyncTitle(): string {
    if (autoInterval === 0) return "自动同步：关闭"
    return `自动同步：WebDAV · ${autoSyncLabel(autoInterval)}`
  }

  async function openWebDAVSettings() {
    await Navigation.present({
      element: <WebDAVSettingsView />,
      modalPresentationStyle: "pageSheet",
    })
    setAutoProvider(getAutoSyncProvider())
    setAutoInterval(getAutoSyncInterval())
    setSyncMeta(getSyncMeta())
  }

  async function persist() {
    await saveStore(store)
    setStore({ ...store })
  }

  function enterSort() {
    setSortList(sortedGroups(store))
    setSorting(true)
    editMode.setValue(EditMode.active())
  }

  function exitSort() {
    editMode.setValue(EditMode.inactive())
    setSorting(false)
  }

  async function onMoveGroups(indices: number[], newOffset: number) {
    const arr = [...sortList]
    const moving = indices.map(i => arr[i])
    const remaining = arr.filter((_, i) => !indices.includes(i))
    let insertAt = newOffset
    for (const i of indices) if (i < newOffset) insertAt--
    remaining.splice(insertAt, 0, ...moving)
    setSortList(remaining)
    applyGroupOrder(store, remaining.map(g => g.id))
    await saveStore(store)
    setStore({ ...store })
  }

  async function onNewGroup() {
    const name = await Dialog.prompt({
      title: "新建分组",
      message: "输入分组名称",
    })
    if (name == null) return
    const trimmed = name.trim()
    if (trimmed === "") return
    createGroup(store, trimmed)
    await persist()
  }

  async function onRename(g: Group) {
    const name = await Dialog.prompt({
      title: "重命名分组",
      defaultValue: g.name,
      selectAll: true,
    })
    if (name == null) return
    renameGroup(g, name)
    await persist()
  }

  async function onDeleteGroup(g: Group) {
    if (g.bookmarks.length > 0) {
      const ok = await Dialog.confirm({
        title: `删除分组“${g.name}”？`,
        message: `该分组内 ${g.bookmarks.length} 条收藏会移入回收站，可稍后恢复。`,
        confirmLabel: "删除",
      })
      if (!ok) return
    }
    moveGroupToTrash(store, g.id)
    setStore({ ...store })
    await saveStore(store)
  }

  async function handleWebDAVPushResult(r: PushResult): Promise<boolean> {
    if (r.ok) {
      await Dialog.alert({ title: "同步完成", message: r.message })
      return true
    }

    if (r.risk) {
      const localText = r.localSummary?.label ?? "未知"
      const remoteText = r.remoteSummary?.label ?? "未知"
      const message = `本机：${localText}\nWebDAV：${remoteText}\n\n仍然上传会先保存当前 WebDAV 快照，再上传本机数据。`

      const continueUpload = await Dialog.confirm({
        title: "本机数据少于 WebDAV",
        message,
        confirmLabel: "仍然上传",
        cancelLabel: "取消",
      })
      if (!continueUpload) return false

      const forced = await pushToCloud({ force: true, skipRiskCheck: true })
      setSyncMeta(getSyncMeta())
      await Dialog.alert({ title: forced.ok ? "同步完成" : "同步失败", message: forced.message })
      return forced.ok
    }

    await Dialog.alert({ title: "同步失败", message: r.message })
    return false
  }

  async function onSyncUp() {
    if (syncing) return
    if (!webDAVConfigured()) {
      await Dialog.alert({
        title: "WebDAV 未配置",
        message: "请先打开 WebDAV 设置并填写连接信息。",
      })
      return
    }
    setSyncing(true)
    setSyncMeta(getSyncMeta())
    const r = await pushToCloud()
    setSyncing(false)
    setSyncMeta(getSyncMeta())
    await handleWebDAVPushResult(r)
  }

  async function openWebDAVHistory() {
    if (!webDAVConfigured()) {
      await Dialog.alert({
        title: "WebDAV 未配置",
        message: "请先打开 WebDAV 设置并填写连接信息。",
      })
      return
    }
    await Navigation.present({
      element: <VersionHistoryView />,
      modalPresentationStyle: "pageSheet",
    })
    await reload()
    setSyncMeta(getSyncMeta())
  }

  const syncStatusText = syncing ? "同步中…" : formatSyncStatus(syncMeta)

  const groups = sortedGroups(store)
  const totalCount = totalBookmarkCount(store)
  const favCount = getFavorites(store).length

  return (
    <NavigationStack>
      <List
        navigationTitle=""
        navigationBarTitleDisplayMode="inline"
        listSectionSpacing="compact"
        listRowSpacing={0}
        environments={{ editMode }}
        onAppear={() => {
          if (!sorting) reload()
        }}
        toolbar={{
          cancellationAction: sorting ? undefined : (
            <Button title="关闭" action={dismiss} />
          ),
          topBarTrailing: sorting ? (
            <Button title="完成" action={exitSort} />
          ) : (
            <Menu
              label={
                <Image
                  systemName="ellipsis.circle"
                  foregroundStyle="label"
                  font="title2"
                />
              }
            >
              <Button
                title="新建分组"
                systemImage="folder.badge.plus"
                action={onNewGroup}
              />
              <Button
                title="回收站"
                systemImage="trash"
                action={async () => {
                  await Navigation.present({
                    element: <TrashView />,
                    modalPresentationStyle: "pageSheet",
                  })
                  await reload()
                }}
              />
              <Menu title={`WebDAV · ${webDAVStatusLabel()}`} systemImage="externaldrive.connected.to.line.below">
                <Button title="设置" systemImage="gearshape" action={openWebDAVSettings} />
                <Button title="上传" systemImage="arrow.up" action={onSyncUp} />
                <Button title="恢复" systemImage="arrow.uturn.backward" action={openWebDAVHistory} />
                <Menu title={autoSyncTitle()} systemImage="clock.arrow.2.circlepath">
                  {AUTO_SYNC_OPTIONS.map((opt: { label: string; seconds: number }) => (
                    <Button
                      key={`auto-${opt.seconds}`}
                      title={opt.label}
                      systemImage={opt.seconds === autoInterval ? "checkmark" : undefined}
                      action={() => onChangeAutoInterval(opt.seconds)}
                    />
                  ))}
                </Menu>
                <Button
                  title={webDAVDisplayPath() || "尚未配置路径"}
                  systemImage="doc.text.magnifyingglass"
                  disabled
                  action={() => {}}
                />
              </Menu>
              <Menu title="关于与更新" systemImage="info.circle">
                <Button title="使用说明" systemImage="questionmark.circle" action={showGuide} />
                <Button title="版本更新" systemImage="sparkles" action={showVersionUpdates} />
              </Menu>
            </Menu>
          ),
        }}
      >
        {loading ? (
          <Text foregroundStyle="secondaryLabel">加载中…</Text>
        ) : groups.length === 0 ? (
          <Section footer={<Text>从分享菜单分享网页链接到「标签页收藏」即可添加。</Text>}>
            <Text foregroundStyle="secondaryLabel">还没有收藏</Text>
          </Section>
        ) : sorting ? (
          <Section
            header={
              <Text font="footnote" foregroundStyle="secondaryLabel">
                拖动右侧图标排序
              </Text>
            }
          >
            <ForEach
              count={sortList.length}
              onMove={onMoveGroups}
              itemBuilder={(index: number) => {
                const g = sortList[index]
                return (
                  <HStack key={g.id}>
                    <Image
                      systemName="folder"
                      foregroundStyle="systemBlue"
                    />
                    <Text foregroundStyle="label">{g.name}</Text>
                    <Spacer />
                    <Text foregroundStyle="secondaryLabel">
                      {g.bookmarks.length}
                    </Text>
                  </HStack>
                )
              }}
            />
          </Section>
        ) : (
          <>
            <Section>
              <NavigationLink destination={<FavoritesView />}>
                <HStack>
                  <Image systemName="star.fill" foregroundStyle="systemYellow" />
                  <Text>收藏</Text>
                  <Spacer />
                  <Text foregroundStyle="secondaryLabel">{favCount}</Text>
                </HStack>
              </NavigationLink>
            </Section>
            <Section
              header={
                <HStack>
                  <Text font="footnote" foregroundStyle="secondaryLabel">
                    {`${groups.length} 组 · ${totalCount} 个`}
                  </Text>
                  <Spacer />
                  <Button action={onSyncUp}>
                    <HStack spacing={4}>
                      <Image
                        systemName={
                          syncing
                            ? "arrow.triangle.2.circlepath"
                            : syncMeta.lastResult === "failed"
                              ? "exclamationmark.icloud"
                              : "checkmark.icloud"
                        }
                        foregroundStyle={
                          syncing
                            ? "systemBlue"
                            : syncMeta.lastResult === "failed"
                              ? "systemRed"
                              : syncMeta.lastResult === "ok"
                                ? "systemGreen"
                                : "secondaryLabel"
                        }
                        font="caption"
                      />
                      <Text font="footnote" foregroundStyle="secondaryLabel">
                        {syncStatusText}
                      </Text>
                    </HStack>
                  </Button>
                </HStack>
              }
            >
              {groups.map((g: Group, gi: number) => (
                <NavigationLink
                  key={g.id}
                  destination={<GroupView groupId={g.id} />}
                  listRowInsets={{ top: -10, leading: 16, bottom: -10, trailing: 16 }}
                  controlSize="small"
                  buttonStyle="plain"
                  listRowSeparator={
                    gi < groups.length - 1
                      ? { visibility: "visible", edges: "bottom" }
                      : "hidden"
                  }
                  contextMenu={{
                    menuItems: (
                      <>
                        <Button
                          title="排序分组"
                          systemImage="arrow.up.arrow.down"
                          action={enterSort}
                        />
                        <Button
                          title="重命名"
                          systemImage="pencil"
                          action={() => onRename(g)}
                        />
                        <Button
                          title="删除分组"
                          systemImage="trash"
                          role="destructive"
                          action={() => onDeleteGroup(g)}
                        />
                      </>
                    ),
                  }}
                  trailingSwipeActions={{
                    allowsFullSwipe: false,
                    actions: [
                      <Button
                        title="删除"
                        systemImage="trash"
                        role="destructive"
                        action={() => onDeleteGroup(g)}
                      />,
                      <Button
                        title="重命名"
                        systemImage="pencil"
                        action={() => onRename(g)}
                      />,
                    ],
                  }}
                >
                  <HStack frame={{ minHeight: 34 }}>
                    <Image
                      systemName="folder"
                      foregroundStyle="systemBlue"
                      font="title3"
                    />
                    <Text font="body">{g.name}</Text>
                    <Spacer />
                    <Text font="body" foregroundStyle="secondaryLabel">
                      {g.bookmarks.length}
                    </Text>
                  </HStack>
                </NavigationLink>
              ))}
            </Section>
          </>
        )}
      </List>
    </NavigationStack>
  )
}

function ChangelogView() {
  const dismiss = Navigation.useDismiss()

  async function showEntry(entry: ChangelogEntry) {
    await Dialog.alert({
      title: `v${entry.version} · ${entry.summary}`,
      message: entry.items.map(item => `• ${item}`).join("\n"),
    })
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="版本更新"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title="关闭" action={() => dismiss()} />,
        }}
      >
        <Section footer={<Text>历史记录已按功能阶段合并，点击查看详细内容。</Text>}>
          {CHANGELOG_ENTRIES.map((entry: ChangelogEntry) => (
            <Button key={entry.version} action={() => showEntry(entry)} buttonStyle="plain">
              <HStack>
                <Image
                  systemName={entry.version === APP_VERSION ? "sparkles" : "clock"}
                  foregroundStyle={entry.version === APP_VERSION ? "systemBlue" : "secondaryLabel"}
                  font="title3"
                />
                <VStack alignment="leading" spacing={3}>
                  <Text font="body" foregroundStyle="label">
                    {`v${entry.version}${entry.version === APP_VERSION ? " · 当前版本" : ""}`}
                  </Text>
                  <Text font="footnote" foregroundStyle="secondaryLabel" lineLimit={1}>
                    {entry.summary}
                  </Text>
                  <Text font="caption" foregroundStyle="tertiaryLabel">
                    {`${entry.date} · ${entry.items.length} 项`}
                  </Text>
                </VStack>
                <Spacer />
                <Image systemName="chevron.right" foregroundStyle="tertiaryLabel" font="footnote" />
              </HStack>
            </Button>
          ))}
        </Section>
      </List>
    </NavigationStack>
  )
}

function WebDAVSettingsView() {
  const dismiss = Navigation.useDismiss()
  const initial = getWebDAVConfig()
  const [url, setUrl] = useState(initial.url)
  const [backupDir, setBackupDir] = useState(initial.backupDir)
  const [username, setUsername] = useState(initial.username)
  const [password, setPassword] = useState(initial.password)
  const [maxBackups, setMaxBackups] = useState(initial.maxBackups)
  const [testing, setTesting] = useState(false)

  function persistConfig() {
    saveWebDAVConfig({ url, backupDir, username, password, maxBackups })
  }

  async function testConnection() {
    persistConfig()
    setTesting(true)
    const result = await testWebDAVConnection()
    setTesting(false)
    await Dialog.alert({
      title: result.ok ? "连接成功" : "连接失败",
      message: result.message,
    })
  }

  async function clearConfig() {
    const ok = await Dialog.confirm({
      title: "清除 WebDAV 配置？",
      message: "只清除本机保存的连接信息，不会删除 WebDAV 上的数据。",
      confirmLabel: "清除",
      cancelLabel: "取消",
    })
    if (!ok) return
    clearWebDAVConfig()
    setUrl("")
    setBackupDir("TabsSaver")
    setUsername("")
    setPassword("")
    setMaxBackups(5)
  }

  function saveAndClose() {
    persistConfig()
    setAutoSyncProvider(webDAVConfigured() ? "webdav" : null)
    dismiss()
  }

  return (
    <NavigationStack>
      <Form
        navigationTitle="WebDAV 备份设置"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title="取消" action={() => dismiss()} />,
          confirmationAction: <Button title="保存" action={saveAndClose} />,
        }}
      >
        <Section
          header={<Text>连接</Text>}
          footer={<Text>地址填写 WebDAV 根目录；脚本会在备份目录下使用 store.json 与 backups/。</Text>}
        >
          <TextField
            title="WebDAV URL"
            prompt="https://example.com/dav"
            value={url}
            onChanged={setUrl}
          />
          <TextField
            title="WebDAV 备份目录"
            prompt="TabsSaver"
            value={backupDir}
            onChanged={setBackupDir}
          />
          <TextField
            title="WebDAV 用户名"
            value={username}
            onChanged={setUsername}
          />
          <SecureField
            title="WebDAV 密码 / Token"
            value={password}
            onChanged={setPassword}
          />
        </Section>
        <Section header={<Text>备份</Text>} footer={<Text>上传前自动保存远端当前版本，并按数量清理较旧快照。</Text>}>
          <Picker
            title="最大备份数"
            value={maxBackups}
            onChanged={setMaxBackups}
            pickerStyle="menu"
          >
            {[1, 3, 5, 10, 20, 50].map((value: number) => (
              <Text key={`backup-limit-${value}`} tag={value}>{`${value} 个`}</Text>
            ))}
          </Picker>
        </Section>
        <Section>
          <Button
            title={testing ? "正在测试…" : "测试连接"}
            systemImage="network"
            disabled={testing}
            action={testConnection}
          />
          <Button
            title="清除配置"
            systemImage="trash"
            role="destructive"
            action={clearConfig}
          />
        </Section>
      </Form>
    </NavigationStack>
  )
}

function VersionHistoryView() {
  const dismiss = Navigation.useDismiss()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [cloudCurrent, setCloudCurrent] = useState<CloudBackup | null>(null)
  const [backups, setBackups] = useState<CloudBackup[]>([])
  const [undoInfo, setUndoInfo] = useState<RestoreUndoMeta | null>(null)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<string[]>([])

  const providerName = "WebDAV"

  async function reloadVersions() {
    setLoading(true)
    const currentVersion = await getCloudCurrentVersion()
    const history = await listCloudBackups(100)
    const undo = await getRestoreUndoInfo()
    setCloudCurrent(currentVersion)
    setBackups(history)
    setUndoInfo(undo)
    setSelected(selected.filter(path => history.some((backup: CloudBackup) => backup.path === path)))
    setLoading(false)
  }

  useEffect(() => {
    reloadVersions()
  }, [])

  async function restoreVersion(version: CloudBackup) {
    const ok = await Dialog.confirm({
      title: `恢复 ${version.name}？`,
      message: `将覆盖本机当前收藏：\n${version.summary.label}`,
      confirmLabel: "恢复到本机",
      cancelLabel: "取消",
    })
    if (!ok) return

    setBusy(true)
    const restored = version.current
      ? await pullFromCloud()
      : await restoreCloudBackup(version.path)
    setBusy(false)

    if (!restored.ok) {
      await Dialog.alert({ title: "恢复失败", message: restored.message })
      return
    }

    await Dialog.alert({ title: "恢复完成", message: restored.message })
    await reloadVersions()
  }

  async function undoRestore() {
    if (!undoInfo || busy) return
    const ok = await Dialog.confirm({
      title: "撤销最近一次恢复？",
      message: `将返回恢复前的本机数据：\n${undoInfo.beforeSummary.label}`,
      confirmLabel: "撤销恢复",
      cancelLabel: "取消",
    })
    if (!ok) return
    setBusy(true)
    const result = await undoLastRestore()
    setBusy(false)
    await Dialog.alert({ title: result.ok ? "已撤销恢复" : "撤销失败", message: result.message })
    if (result.ok) await reloadVersions()
  }

  function toggleSelect(path: string) {
    setSelected(
      selected.includes(path)
        ? selected.filter(x => x !== path)
        : [...selected, path],
    )
  }

  function enterSelect() {
    setSelected([])
    setSelecting(true)
  }

  function exitSelect() {
    setSelecting(false)
    setSelected([])
  }

  function selectAll() {
    if (backups.length === 0) return
    if (selected.length === backups.length) {
      setSelected([])
    } else {
      setSelected(backups.map((backup: CloudBackup) => backup.path))
    }
  }

  async function deleteVersion(version: CloudBackup) {
    const ok = await Dialog.confirm({
      title: `删除 ${version.name}？`,
      message: `将从 WebDAV 永久删除这个历史快照。\n\n${version.summary.label}`,
      confirmLabel: "删除",
      cancelLabel: "取消",
    })
    if (!ok) return

    setBusy(true)
    const deleted = await deleteCloudBackup(version.path)
    setBusy(false)
    await Dialog.alert({ title: deleted.ok ? "已删除" : "删除失败", message: deleted.message })
    if (deleted.ok) await reloadVersions()
  }

  async function deleteSelectedVersions() {
    if (busy || selected.length === 0) return
    const selectedVersions = backups.filter((backup: CloudBackup) => selected.includes(backup.path))
    if (selectedVersions.length === 0) {
      exitSelect()
      return
    }

    const ok = await Dialog.confirm({
      title: `删除 ${selectedVersions.length} 个历史版本？`,
      message: `将从 WebDAV 永久删除选中的 ${selectedVersions.length} 个历史快照。此操作无法撤销。`,
      confirmLabel: "删除",
      cancelLabel: "取消",
    })
    if (!ok) return

    setBusy(true)
    let successCount = 0
    const failedNames: string[] = []
    const failedPaths: string[] = []
    for (const version of selectedVersions) {
      const deleted = await deleteCloudBackup(version.path)
      if (deleted.ok) {
        successCount += 1
      } else {
        failedPaths.push(version.path)
        failedNames.push(`${version.name}：${deleted.message}`)
      }
    }
    setBusy(false)
    await reloadVersions()
    if (failedNames.length === 0) {
      exitSelect()
      await Dialog.alert({ title: "已删除", message: `已删除 ${successCount} 个历史版本。` })
    } else {
      setSelected(failedPaths)
      await Dialog.alert({
        title: successCount > 0 ? "部分删除失败" : "删除失败",
        message: `已删除 ${successCount} 个，失败 ${failedNames.length} 个。\n\n${failedNames.slice(0, 5).join("\n")}${failedNames.length > 5 ? "\n…" : ""}`,
      })
    }
  }

  const allSelected = backups.length > 0 && selected.length === backups.length

  function versionRow(version: CloudBackup, icon: string, color: any, deletable = false) {
    const isSel = selected.includes(version.path)
    return (
      <HStack key={version.path} spacing={10} alignment="center">
        {selecting && deletable ? (
          <Image
            systemName={isSel ? "checkmark.circle.fill" : "circle"}
            foregroundStyle={isSel ? "systemRed" : "systemGray3"}
            font="title3"
          />
        ) : null}
        <Button
          action={() => selecting && deletable ? toggleSelect(version.path) : restoreVersion(version)}
          buttonStyle="plain"
          disabled={selecting && !deletable}
        >
          <HStack>
            <Image systemName={icon} foregroundStyle={color} font="title3" />
            <VStack alignment="leading" spacing={3}>
              <Text font="body" foregroundStyle="label">{version.name}</Text>
              <Text font="footnote" foregroundStyle="secondaryLabel">{version.summary.label}</Text>
              {deletable ? (
                <Text font="caption" foregroundStyle="tertiaryLabel">{backupDetailLabel(version)}</Text>
              ) : version.current ? (
                <Text font="caption" foregroundStyle="systemBlue">当前版本</Text>
              ) : null}
            </VStack>
          </HStack>
        </Button>
        <Spacer />
        {deletable && !selecting ? (
          <Button action={() => deleteVersion(version)} buttonStyle="plain">
            <Image systemName="trash" foregroundStyle="systemRed" font="body" />
          </Button>
        ) : selecting && deletable ? null : (
          <Image systemName="chevron.right" foregroundStyle="tertiaryLabel" font="footnote" />
        )}
      </HStack>
    )
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="WebDAV 恢复"
        navigationBarTitleDisplayMode="inline"
        safeAreaInset={
          selecting
            ? {
                bottom: {
                  content: (
                    <HStack padding={{ horizontal: 16 }}>
                      <HStack
                        spacing={0}
                        padding={{ horizontal: 10, vertical: 8 }}
                        glassEffect={{
                          glass: UIGlass.regular(),
                          shape: { type: "capsule", style: "continuous" },
                        }}
                      >
                        <Button
                          action={selectAll}
                          frame={{ maxWidth: "infinity" }}
                          disabled={backups.length === 0 || busy}
                        >
                          <VStack spacing={3}>
                            <Image
                              systemName={allSelected ? "checkmark.circle.fill" : "checkmark.circle"}
                              font="title3"
                              foregroundStyle={backups.length === 0 ? "systemGray3" : "label"}
                            />
                            <Text
                              font="caption2"
                              foregroundStyle={backups.length === 0 ? "systemGray3" : "label"}
                            >
                              {allSelected ? "取消" : "全选"}
                            </Text>
                          </VStack>
                        </Button>
                        <VStack spacing={3} frame={{ maxWidth: "infinity" }}>
                          <Image systemName="checklist" font="title3" foregroundStyle="secondaryLabel" />
                          <Text font="caption2" foregroundStyle="secondaryLabel">
                            {`已选 ${selected.length}`}
                          </Text>
                        </VStack>
                        <Button
                          action={deleteSelectedVersions}
                          frame={{ maxWidth: "infinity" }}
                        >
                          <VStack spacing={3}>
                            <Image
                              systemName="trash"
                              font="title3"
                              foregroundStyle={selected.length === 0 || busy ? "systemGray3" : "systemRed"}
                            />
                            <Text
                              font="caption2"
                              foregroundStyle={selected.length === 0 || busy ? "systemGray3" : "systemRed"}
                            >
                              删除
                            </Text>
                          </VStack>
                        </Button>
                      </HStack>
                    </HStack>
                  ),
                },
              }
            : undefined
        }
        toolbar={{
          cancellationAction: selecting ? undefined : <Button title="关闭" action={() => dismiss()} />,
          topBarTrailing: selecting ? (
            <Button action={exitSelect} disabled={busy}>
              <Image systemName="xmark.circle.fill" foregroundStyle="systemRed" font="title2" />
            </Button>
          ) : backups.length > 0 ? (
            <HStack>
              <Button action={enterSelect} disabled={loading || busy}>
                <Image systemName="checkmark.circle" foregroundStyle="label" font="title2" />
              </Button>
              <Button title="刷新" action={reloadVersions} />
            </HStack>
          ) : (
            <Button title="刷新" action={reloadVersions} />
          ),
        }}
      >
        {loading ? (
          <Text foregroundStyle="secondaryLabel">加载中…</Text>
        ) : (
          <>
            <Section header={<Text>WebDAV 备份</Text>}>
              {cloudCurrent
                ? versionRow(cloudCurrent, "externaldrive.badge.icloud", "systemBlue")
                : <Text foregroundStyle="secondaryLabel">WebDAV 暂无当前版本</Text>}
              {backups.map((backup: CloudBackup) => versionRow(backup, "clock.arrow.circlepath", "systemOrange", true))}
            </Section>

            {undoInfo ? (
              <Section
                header={<Text>恢复保护</Text>}
                footer={<Text>{`保存于 ${formatTime(undoInfo.createdAt)}，撤销后返回恢复前数据。`}</Text>}
              >
                <Button
                  title="撤销最近一次恢复"
                  systemImage="arrow.uturn.backward.circle"
                  disabled={busy}
                  action={undoRestore}
                />
              </Section>
            ) : null}
          </>
        )}
      </List>
    </NavigationStack>
  )
}

function GroupView({ groupId }: { groupId: string }) {
  const [store, setStore] = useState<Store>({ version: 1, groups: [] })
  const [loaded, setLoaded] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<string[]>([])

  async function reload() {
    const s = await loadStore()
    setStore({ ...s })
    setLoaded(true)
  }

  const group = store.groups.find((g: Group) => g.id === groupId)

  async function onDelete(bookmarkId: string) {
    if (!group) return
    moveBookmarksToTrash(store, group, [bookmarkId])
    setStore({ ...store })
    setSelected(selected.filter(id => id !== bookmarkId))
    await saveStore(store)
  }

  async function chooseMoveTarget(title: string): Promise<Group | null> {
    if (!group) return null
    const targets = sortedGroups(store).filter(target => target.id !== group.id)
    const index = await Dialog.actionSheet({
      title,
      message: "选择目标分组",
      actions: [
        { label: "＋ 新建分组" },
        ...targets.map(target => ({ label: target.name })),
      ],
    })
    if (index == null) return null
    if (index > 0) return targets[index - 1] ?? null

    const name = await Dialog.prompt({
      title: "新建分组",
      message: "输入分组名称",
    })
    const trimmed = name?.trim() ?? ""
    if (trimmed === "") return null
    return createGroup(store, trimmed)
  }

  async function onMove(bookmarkId: string) {
    if (!group) return
    const target = await chooseMoveTarget("移动到分组")
    if (!target) return
    if (moveBookmark(store, group.id, bookmarkId, target.id)) {
      await saveStore(store)
      setStore({ ...store })
    }
  }

  async function openBookmark(b: Bookmark) {
    if (group && !b.read) {
      markBookmarkRead(group, b.id)
      await saveStore(store)
      setStore({ ...store })
    }
    Safari.openURL(b.url)
  }

  async function onFavorite(b: Bookmark) {
    const added = addFavorite(store, b)
    await saveStore(store)
    setStore({ ...store })
    await Dialog.alert({
      title: added ? "已加入收藏" : "已在收藏中",
      message: added ? "该标签页已复制到收藏，与本分组独立。" : "收藏里已经有这个标签页了。",
    })
  }

  function toggleSelect(id: string) {
    setSelected(
      selected.includes(id)
        ? selected.filter(x => x !== id)
        : [...selected, id],
    )
  }

  function enterSelect() {
    setSelected([])
    setSelecting(true)
  }

  function exitSelect() {
    setSelecting(false)
    setSelected([])
  }

  function selectAll() {
    if (!group) return
    if (selected.length === group.bookmarks.length) {
      setSelected([])
    } else {
      setSelected(group.bookmarks.map((b: Bookmark) => b.id))
    }
  }

  async function moveSelected() {
    if (!group || selected.length === 0) return
    const target = await chooseMoveTarget(`移动 ${selected.length} 条收藏`)
    if (!target) return
    const moved = moveBookmarks(store, group.id, selected, target.id)
    if (moved === 0) return
    await saveStore(store)
    setStore({ ...store })
    exitSelect()
  }

  async function deleteSelected() {
    if (!group || selected.length === 0) return
    const ok = await Dialog.confirm({
      title: `将 ${selected.length} 条收藏移到回收站？`,
      message: "可以稍后从回收站恢复。",
    })
    if (!ok) return
    moveBookmarksToTrash(store, group, selected)
    setStore({ ...store })
    exitSelect()
    await saveStore(store)
  }

  const allSelected =
    !!group && group.bookmarks.length > 0 && selected.length === group.bookmarks.length

  return (
    <List
      navigationTitle={group?.name ?? "分组"}
      navigationBarTitleDisplayMode="inline"
      onAppear={reload}
      safeAreaInset={
        selecting
          ? {
              bottom: {
                content: (
                  <HStack padding={{ horizontal: 16 }}>
                    <HStack
                      spacing={0}
                      padding={{ horizontal: 10, vertical: 8 }}
                      glassEffect={{
                        glass: UIGlass.regular(),
                        shape: { type: "capsule", style: "continuous" },
                      }}
                    >
                      <Button
                        action={selectAll}
                        frame={{ maxWidth: "infinity" }}
                      >
                        <VStack spacing={3}>
                          <Image
                            systemName={
                              allSelected
                                ? "checkmark.circle.fill"
                                : "checkmark.circle"
                            }
                            font="title3"
                            foregroundStyle="label"
                          />
                          <Text font="caption2" foregroundStyle="label">
                            {allSelected ? "取消" : "全选"}
                          </Text>
                        </VStack>
                      </Button>
                      <VStack
                        spacing={3}
                        frame={{ maxWidth: "infinity" }}
                      >
                        <Image
                          systemName="checklist"
                          font="title3"
                          foregroundStyle="secondaryLabel"
                        />
                        <Text font="caption2" foregroundStyle="secondaryLabel">
                          {`已选 ${selected.length}`}
                        </Text>
                      </VStack>
                      <Button
                        disabled={selected.length === 0}
                        action={moveSelected}
                        frame={{ maxWidth: "infinity" }}
                      >
                        <VStack spacing={3}>
                          <Image systemName="folder" font="title3" foregroundStyle={selected.length === 0 ? "systemGray3" : "systemBlue"} />
                          <Text font="caption2" foregroundStyle={selected.length === 0 ? "systemGray3" : "systemBlue"}>移动</Text>
                        </VStack>
                      </Button>
                      <Button
                        disabled={selected.length === 0}
                        action={deleteSelected}
                        frame={{ maxWidth: "infinity" }}
                      >
                        <VStack spacing={3}>
                          <Image
                            systemName="trash"
                            font="title3"
                            foregroundStyle={
                              selected.length === 0 ? "systemGray3" : "systemRed"
                            }
                          />
                          <Text
                            font="caption2"
                            foregroundStyle={
                              selected.length === 0 ? "systemGray3" : "systemRed"
                            }
                          >
                            删除
                          </Text>
                        </VStack>
                      </Button>
                    </HStack>
                  </HStack>
                ),
              },
            }
          : undefined
      }
      toolbar={{
        topBarTrailing:
          group && group.bookmarks.length > 0 ? (
            selecting ? (
              <Button action={exitSelect}>
                <Image
                  systemName="xmark.circle.fill"
                  foregroundStyle="systemRed"
                  font="title2"
                />
              </Button>
            ) : (
              <Button action={enterSelect}>
                <Image
                  systemName="checkmark.circle"
                  foregroundStyle="label"
                  font="title2"
                />
              </Button>
            )
          ) : undefined,
      }}
    >
      {!loaded ? (
        <Text foregroundStyle="secondaryLabel">加载中…</Text>
      ) : !group ? (
        <Text foregroundStyle="secondaryLabel">该分组已不存在</Text>
      ) : (
        <>
          {group.bookmarks.length === 0 ? (
            <Text foregroundStyle="secondaryLabel">这个分组还没有收藏</Text>
          ) : (
            groupByDay(group.bookmarks).map((sec: DaySection) => (
          <Section
            key={sec.key}
            header={
              <Text font="footnote" foregroundStyle="secondaryLabel">
                {sec.label} · {sec.items.length}
              </Text>
            }
          >
            {sec.items.map((b: Bookmark) => {
              const isSel = selected.includes(b.id)
              return (
                <Button
                  key={b.id}
                  listRowInsets={{ top: 10, bottom: 10, leading: 16, trailing: 16 }}
                  action={() =>
                    selecting ? toggleSelect(b.id) : openBookmark(b)
                  }
                  contextMenu={
                    selecting
                      ? undefined
                      : {
                          menuItems: (
                            <>
                              <Button
                                title="复制链接"
                                systemImage="doc.on.doc"
                                action={() => Pasteboard.setString(b.url)}
                              />
                              <Button
                                title="移动到分组"
                                systemImage="folder"
                                action={() => onMove(b.id)}
                              />
                              <Button
                                title="删除"
                                systemImage="trash"
                                role="destructive"
                                action={() => onDelete(b.id)}
                              />
                            </>
                          ),
                        }
                  }
                  trailingSwipeActions={{
                    allowsFullSwipe: true,
                    actions: [
                      <Button
                        title="删除"
                        systemImage="trash"
                        role="destructive"
                        action={() => onDelete(b.id)}
                      />,
                    ],
                  }}
                  leadingSwipeActions={{
                    allowsFullSwipe: true,
                    actions: [
                      <Button
                        title="收藏"
                        systemImage="star.fill"
                        action={() => onFavorite(b)}
                      />,
                    ],
                  }}
                >
                  <HStack spacing={10} alignment="center">
                    {selecting ? (
                      <Image
                        systemName={
                          isSel ? "checkmark.circle.fill" : "circle"
                        }
                        foregroundStyle={isSel ? "systemRed" : "systemGray3"}
                        font="title3"
                      />
                    ) : null}
                    <Image
                      imageUrl={faviconUrl(b.url)}
                      resizable
                      frame={{ width: 24, height: 24 }}
                      placeholder={
                        <Image
                          systemName="globe"
                          foregroundStyle="systemGray3"
                          frame={{ width: 24, height: 24 }}
                        />
                      }
                      clipShape={{ type: "rect", cornerRadius: 5 }}
                    />
                    <VStack alignment="leading" spacing={4} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                      <Text
                        font="body"
                        lineLimit={1}
                        foregroundStyle="label"
                      >
                        {b.title}
                      </Text>
                      <Text
                        font="footnote"
                        foregroundStyle="secondaryLabel"
                        lineLimit={1}
                      >
                        {`${host(b.url)} · ${formatTime(b.savedAt)}`}
                      </Text>
                    </VStack>
                    {!b.read ? (
                      <Text
                        font="caption2"
                        foregroundStyle="white"
                        padding={{ horizontal: 8, vertical: 2 }}
                        background="systemBlue"
                        clipShape={{ type: "capsule", style: "continuous" }}
                      >
                        未读
                      </Text>
                    ) : null}
                  </HStack>
                </Button>
              )
            })}
          </Section>
            ))
          )}
        </>
      )}
    </List>
  )
}

function TrashView() {
  const dismiss = Navigation.useDismiss()
  const [store, setStore] = useState<Store>({ version: 1, groups: [] })
  const [loaded, setLoaded] = useState(false)
  const [retentionDays, setRetentionDaysState] = useState<TrashRetentionDays>(() => getTrashRetentionDays())

  async function reload() {
    const next = await loadStore()
    const removed = cleanupExpiredTrash(next, getTrashRetentionDays())
    if (removed > 0) await saveStore(next)
    setStore({ ...next })
    setLoaded(true)
  }

  async function changeRetention(value: TrashRetentionDays) {
    setTrashRetentionDays(value)
    setRetentionDaysState(value)
    const removed = cleanupExpiredTrash(store, value)
    if (removed > 0) {
      await saveStore(store)
      setStore({ ...store })
    }
  }

  async function restore(item: TrashedBookmark) {
    if (!restoreTrashItem(store, item.id)) return
    await saveStore(store)
    setStore({ ...store })
  }

  async function removeForever(item: TrashedBookmark) {
    const ok = await Dialog.confirm({
      title: "永久删除这条收藏？",
      message: "永久删除后无法恢复。",
      confirmLabel: "永久删除",
    })
    if (!ok) return
    permanentlyDeleteTrashItem(store, item.id)
    setStore({ ...store })
    await saveStore(store)
  }

  async function clearAll() {
    const count = getTrash(store).length
    if (count === 0) return
    const ok = await Dialog.confirm({
      title: `清空 ${count} 条回收站收藏？`,
      message: "清空后无法恢复。",
      confirmLabel: "清空",
    })
    if (!ok) return
    emptyTrash(store)
    setStore({ ...store })
    await saveStore(store)
  }

  const items = getTrash(store)

  return (
    <NavigationStack>
      <List
        navigationTitle="回收站"
        navigationBarTitleDisplayMode="inline"
        onAppear={reload}
        toolbar={{
          cancellationAction: <Button title="关闭" action={dismiss} />,
          topBarTrailing: items.length > 0 ? (
            <Button title="清空" role="destructive" action={clearAll} />
          ) : undefined,
        }}
      >
        {!loaded ? (
          <Text foregroundStyle="secondaryLabel">加载中…</Text>
        ) : (
          <>
            <Section
              header={<Text>自动清理</Text>}
              footer={<Text>超过保留期限的内容会在打开标签页收藏时永久删除。</Text>}
            >
              <Picker
                title="保留期限"
                value={retentionDays}
                onChanged={(value: number) => changeRetention(value as TrashRetentionDays)}
                pickerStyle="menu"
              >
                <Text tag={3}>3 天</Text>
                <Text tag={7}>7 天</Text>
                <Text tag={15}>15 天</Text>
                <Text tag={0}>永久</Text>
              </Picker>
            </Section>
            {items.length === 0 ? (
              <Text foregroundStyle="secondaryLabel">回收站为空</Text>
            ) : (
              <Section footer={<Text>恢复时会回到原分组；原分组已删除时会重新建立。</Text>}>
                {items.map(item => (
                  <HStack key={item.id} spacing={10}>
                    <Image systemName="trash" foregroundStyle="secondaryLabel" />
                    <VStack alignment="leading" spacing={3} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                      <Text lineLimit={1}>{item.bookmark.title}</Text>
                      <Text font="footnote" foregroundStyle="secondaryLabel" lineLimit={1}>
                        {`${item.sourceGroupName} · ${host(item.bookmark.url)}`}
                      </Text>
                    </VStack>
                    <Menu title="更多">
                      <Button title="恢复" systemImage="arrow.uturn.backward" action={() => restore(item)} />
                      <Button title="永久删除" systemImage="trash" role="destructive" action={() => removeForever(item)} />
                    </Menu>
                  </HStack>
                ))}
              </Section>
            )}
          </>
        )}
      </List>
    </NavigationStack>
  )
}

function FavoritesView() {
  const [store, setStore] = useState<Store>({ version: 1, groups: [] })
  const [loaded, setLoaded] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<string[]>([])

  async function reload() {
    const s = await loadStore()
    setStore({ ...s })
    setLoaded(true)
  }

  const favorites = getFavorites(store)

  async function onDelete(id: string) {
    removeFavorite(store, id)
    setStore({ ...store })
    setSelected(selected.filter(x => x !== id))
    await saveStore(store)
  }

  async function openBookmark(b: Bookmark) {
    if (!b.read) {
      markFavoriteRead(store, b.id)
      await saveStore(store)
      setStore({ ...store })
    }
    Safari.openURL(b.url)
  }

  function toggleSelect(id: string) {
    setSelected(
      selected.includes(id)
        ? selected.filter(x => x !== id)
        : [...selected, id],
    )
  }

  function enterSelect() {
    setSelected([])
    setSelecting(true)
  }

  function exitSelect() {
    setSelecting(false)
    setSelected([])
  }

  function selectAll() {
    if (selected.length === favorites.length) setSelected([])
    else setSelected(favorites.map((b: Bookmark) => b.id))
  }

  async function deleteSelected() {
    if (selected.length === 0) return
    const ok = await Dialog.confirm({
      title: `删除 ${selected.length} 条收藏？`,
      message: "仅从收藏移除，不影响各标签组。",
    })
    if (!ok) return
    removeFavorites(store, selected)
    setStore({ ...store })
    exitSelect()
    await saveStore(store)
  }

  const allSelected =
    favorites.length > 0 && selected.length === favorites.length

  return (
    <List
      navigationTitle="收藏"
      navigationBarTitleDisplayMode="inline"
      onAppear={reload}
      safeAreaInset={
        selecting
          ? {
              bottom: {
                content: (
                  <HStack padding={{ horizontal: 16 }}>
                    <HStack
                      spacing={0}
                      padding={{ horizontal: 10, vertical: 8 }}
                      glassEffect={{
                        glass: UIGlass.regular(),
                        shape: { type: "capsule", style: "continuous" },
                      }}
                    >
                      <Button action={selectAll} frame={{ maxWidth: "infinity" }}>
                        <VStack spacing={3}>
                          <Image
                            systemName={
                              allSelected
                                ? "checkmark.circle.fill"
                                : "checkmark.circle"
                            }
                            font="title3"
                            foregroundStyle="label"
                          />
                          <Text font="caption2" foregroundStyle="label">
                            {allSelected ? "取消" : "全选"}
                          </Text>
                        </VStack>
                      </Button>
                      <VStack spacing={3} frame={{ maxWidth: "infinity" }}>
                        <Image
                          systemName="checklist"
                          font="title3"
                          foregroundStyle="secondaryLabel"
                        />
                        <Text font="caption2" foregroundStyle="secondaryLabel">
                          {`已选 ${selected.length}`}
                        </Text>
                      </VStack>
                      <Button
                        disabled={selected.length === 0}
                        action={deleteSelected}
                        frame={{ maxWidth: "infinity" }}
                      >
                        <VStack spacing={3}>
                          <Image
                            systemName="trash"
                            font="title3"
                            foregroundStyle={
                              selected.length === 0 ? "systemGray3" : "systemRed"
                            }
                          />
                          <Text
                            font="caption2"
                            foregroundStyle={
                              selected.length === 0 ? "systemGray3" : "systemRed"
                            }
                          >
                            删除
                          </Text>
                        </VStack>
                      </Button>
                    </HStack>
                  </HStack>
                ),
              },
            }
          : undefined
      }
      toolbar={{
        topBarTrailing:
          favorites.length > 0 ? (
            selecting ? (
              <Button action={exitSelect}>
                <Image
                  systemName="xmark.circle.fill"
                  foregroundStyle="systemRed"
                  font="title2"
                />
              </Button>
            ) : (
              <Button action={enterSelect}>
                <Image
                  systemName="checkmark.circle"
                  foregroundStyle="label"
                  font="title2"
                />
              </Button>
            )
          ) : undefined,
      }}
    >
      {!loaded ? (
        <Text foregroundStyle="secondaryLabel">加载中…</Text>
      ) : favorites.length === 0 ? (
        <Text foregroundStyle="secondaryLabel">收藏还是空的，在标签组里右滑收藏。</Text>
      ) : (
        groupByDay(favorites).map((sec: DaySection) => (
          <Section
            key={sec.key}
            header={
              <Text font="footnote" foregroundStyle="secondaryLabel">
                {sec.label} · {sec.items.length}
              </Text>
            }
          >
            {sec.items.map((b: Bookmark) => {
              const isSel = selected.includes(b.id)
              return (
                <Button
                  key={b.id}
                  listRowInsets={{ top: 10, bottom: 10, leading: 16, trailing: 16 }}
                  action={() =>
                    selecting ? toggleSelect(b.id) : openBookmark(b)
                  }
                  contextMenu={
                    selecting
                      ? undefined
                      : {
                          menuItems: (
                            <>
                              <Button
                                title="复制链接"
                                systemImage="doc.on.doc"
                                action={() => Pasteboard.setString(b.url)}
                              />
                              <Button
                                title="从收藏移除"
                                systemImage="trash"
                                role="destructive"
                                action={() => onDelete(b.id)}
                              />
                            </>
                          ),
                        }
                  }
                  trailingSwipeActions={{
                    allowsFullSwipe: true,
                    actions: [
                      <Button
                        title="移除"
                        systemImage="trash"
                        role="destructive"
                        action={() => onDelete(b.id)}
                      />,
                    ],
                  }}
                >
                  <HStack spacing={10} alignment="center">
                    {selecting ? (
                      <Image
                        systemName={isSel ? "checkmark.circle.fill" : "circle"}
                        foregroundStyle={isSel ? "systemRed" : "systemGray3"}
                        font="title3"
                      />
                    ) : null}
                    <Image
                      imageUrl={faviconUrl(b.url)}
                      resizable
                      frame={{ width: 24, height: 24 }}
                      placeholder={
                        <Image
                          systemName="globe"
                          foregroundStyle="systemGray3"
                          frame={{ width: 24, height: 24 }}
                        />
                      }
                      clipShape={{ type: "rect", cornerRadius: 5 }}
                    />
                    <VStack
                      alignment="leading"
                      spacing={4}
                      frame={{ maxWidth: "infinity", alignment: "leading" }}
                    >
                      <Text font="body" lineLimit={1} foregroundStyle="label">
                        {b.title}
                      </Text>
                      <Text
                        font="footnote"
                        foregroundStyle="secondaryLabel"
                        lineLimit={1}
                      >
                        {`${host(b.url)} · ${formatTime(b.savedAt)}`}
                      </Text>
                    </VStack>
                    {!b.read ? (
                      <Text
                        font="caption2"
                        foregroundStyle="white"
                        padding={{ horizontal: 8, vertical: 2 }}
                        background="systemBlue"
                        clipShape={{ type: "capsule", style: "continuous" }}
                      >
                        未读
                      </Text>
                    ) : null}
                  </HStack>
                </Button>
              )
            })}
          </Section>
        ))
      )}
    </List>
  )
}

async function run() {
  await Navigation.present(<MainView />)
  Script.exit()
}

run()
