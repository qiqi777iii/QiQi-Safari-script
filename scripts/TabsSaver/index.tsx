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
  moveBookmarksToTrash,
  getTrash,
  restoreTrashItem,
  permanentlyDeleteTrashItem,
  emptyTrash,
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
} from "./store"
import {
  pushToCloud,
  pullFromCloud,
  listCloudBackups,
  restoreCloudBackup,
  getCloudCurrentVersion,
  getLocalCurrentVersion,
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
  type AutoSyncProvider,
  type SyncMeta,
  type PushResult,
  type CloudBackup,
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

const GROUP_SEPARATOR_KEY = "tab.showGroupSeparators"
const BROWSER_SCRIPT_NAME = "tabs-saver-button.user.js"
const GUIDE_SHOWN_KEY = "tab.guideShown"
const APP_VERSION = "1.3.0"
const CHANGELOG_SEEN_KEY = "tab.changelogSeenVersion"
type ChangelogEntry = { version: string; date: string; items: string[] }
const CHANGELOG_ENTRIES: ChangelogEntry[] = [
  {
    version: "1.3.0",
    date: "2026-07-12",
    items: [
      "新增主界面域名搜索和分组内搜索。",
      "收藏支持快速移动到其他分组。",
      "删除的普通收藏和分组内容会进入回收站，可恢复、永久删除或清空。",
      "中尺寸小组件标题可打开管理面板，并显示最近收藏所属分组。",
    ],
  },
  {
    version: "1.2.13",
    date: "2026-07-12",
    items: [
      "修复点击主屏幕小组件会进入代码编辑器的问题，现在会直接运行并打开收藏面板。",
    ],
  },
  {
    version: "1.2.12",
    date: "2026-07-12",
    items: [
      "新增主屏幕小组件，显示收藏数量并可点按直接打开标签页收藏面板。",
      "小组件支持小号和中号布局，中号会额外显示分组与星标数量。",
    ],
  },
  {
    version: "1.2.9",
    date: "2026-07-10",
    items: [
      "Safari 收藏按钮改为立即创建，不再等待 DOMContentLoaded。",
      "增强按钮和样式健康检查，网页替换 head 或关键节点后会轻量恢复。",
    ],
  },
  {
    version: "1.2.8",
    date: "2026-07-10",
    items: [
      "历史快照删除提示明确说明会从 WebDAV 永久删除。",
      "修复多选历史版本后需要多次点击才显示删除确认的问题。",
    ],
  },
  {
    version: "1.2.7",
    date: "2026-07-09",
    items: [
      "删除 iCloud / GitHub 两种同步方式，改为 WebDAV 同步。",
      "新增类似设置页的 WebDAV 备份表单：URL、备份目录、用户名、密码/Token、最大备份数。",
      "上传前会为远端当前数据保存 WebDAV 快照，并保留疑似误删保护。",
    ],
  },
  {
    version: "1.2.6",
    date: "2026-07-05",
    items: [
      "Safari 收藏按钮已同步为包内维护源 v0.2.15。",
      "远程更新 Tab 时会一并带上最新 tabs-saver-button.user.js，首次打开 Tab 会自动安装/更新到 Safari 浏览器脚本目录。",
    ],
  },
  {
    version: "1.2.5",
    date: "2026-06-29",
    items: [
      "GitHub/iCloud 历史版本页支持多选删除。",
      "历史快照页右上角新增多选按钮，底部可全选、查看已选数量并批量删除。",
      "刷新历史列表时会自动清理已不存在的选择，避免误操作当前本机或当前云端版本。",
    ],
  },
  {
    version: "1.2.4",
    date: "2026-06-15",
    items: [
      "新增「版本更新」入口，可查看所有版本更新记录。",
      "版本更新列表支持点开单个版本查看详细内容。",
      "入口放在右上角菜单的「使用说明」下面。",
    ],
  },
  {
    version: "1.2.3",
    date: "2026-06-15",
    items: [
      "历史版本恢复流程增加真正的取消：点版本后先确认恢复，恢复后再选择是否上传为最新。",
      "GitHub/iCloud 历史快照行新增删除按钮。",
      "当前本机、当前云端/iCloud 只允许恢复，不允许删除。",
      "保留 GitHub/iCloud 完整历史列表页和自动快照。",
    ],
  },
  {
    version: "1.2.2",
    date: "2026-06-15",
    items: [
      "GitHub/iCloud 菜单统一为：上传、恢复当前、历史版本。",
      "GitHub/iCloud 历史版本改为完整列表页，可直接选择某个版本。",
      "iCloud 上传前也会保存历史快照，支持从 iCloud 历史恢复。",
      "历史版本恢复到本机后，可选择立即上传为对应云端最新。",
      "保留 GitHub 冲突选择、疑似误删保护和同步锁。",
    ],
  },
  {
    version: "1.2.1",
    date: "2026-06-15",
    items: [
      "GitHub 同步上传前会保存云端历史快照，误覆盖后也能找回。",
      "本机数据明显少于云端时会暂停上传，防止误删覆盖备份。",
      "遇到 GitHub 409 冲突时，可选择保留本机覆盖云端、恢复云端或取消。",
      "GitHub 菜单新增恢复历史版本。",
      "新增同步锁，减少自动同步和手动同步同时运行导致的冲突。",
    ],
  },
  {
    version: "1.2.0",
    date: "2026-06-15",
    items: [
      "新增 iCloud 与 GitHub 双通道同步。",
      "新增自动同步频率设置。",
      "新增同步状态显示和手动上传/恢复入口。",
    ],
  },
]
const CHANGELOG_MESSAGE = CHANGELOG_ENTRIES[0].items.map(item => `• ${item}`).join("\n")

const GUIDE_MESSAGE = [
  "• 在 Safari 网页里点右下角的书签按钮，把当前标签存进分组；双击按钮可选择存到哪个分组。按钮可拖动，长按其菜单里有「重置位置」。",
  "• 也可以用系统分享菜单，把链接分享到「标签页收藏」来添加。",
  "• 回到本 App 查看：收藏按分组和收藏夹整理，并按日期分段。点一下用 Safari 打开，长按可复制链接或删除。",
  "• 在分组里：左滑删除，右滑加星标到「收藏」。",
  "• 右上角「…」菜单：新建分组、排序、显示/隐藏分割线、WebDAV 同步。点击列表上方的同步状态也能立即同步。",
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

function getShowGroupSeparators(): boolean {
  const value = Storage.get<boolean>(GROUP_SEPARATOR_KEY)
  return value !== false
}

function setShowGroupSeparators(value: boolean) {
  Storage.set(GROUP_SEPARATOR_KEY, value)
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
  const [showGroupSeparators, setShowGroupSeparatorsState] = useState<boolean>(() =>
    getShowGroupSeparators(),
  )
  const [displayRevision, setDisplayRevision] = useState(0)
  const [domainQuery, setDomainQuery] = useState("")

  async function reload() {
    const s = await loadStore()
    let dirty = normalizeOrders(s)
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

  function onToggleGroupSeparators() {
    const next = !showGroupSeparators
    setShowGroupSeparators(next)
    setShowGroupSeparatorsState(next)
    setDisplayRevision(displayRevision + 1)
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

  function onMoveGroups(indices: number[], newOffset: number) {
    const arr = [...sortList]
    const moving = indices.map(i => arr[i])
    const remaining = arr.filter((_, i) => !indices.includes(i))
    let insertAt = newOffset
    for (const i of indices) if (i < newOffset) insertAt--
    remaining.splice(insertAt, 0, ...moving)
    setSortList(remaining)
    applyGroupOrder(store, remaining.map(g => g.id))
    saveStore(store)
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
    await persist()
  }

  async function handleWebDAVPushResult(r: PushResult): Promise<boolean> {
    if (r.ok) {
      await Dialog.alert({ title: "同步完成", message: r.message })
      return true
    }

    if (r.risk) {
      const localText = r.localSummary?.label ?? "未知"
      const remoteText = r.remoteSummary?.label ?? "未知"
      const message = `${r.message}\n\n本机：${localText}\nWebDAV：${remoteText}`

      const useLocal = await Dialog.confirm({
        title: "可能误删，已暂停上传",
        message: `${message}\n\n要用本机数据覆盖 WebDAV 吗？上传前会先保存远端快照。`,
        confirmLabel: "用本机覆盖",
        cancelLabel: "其他选择",
      })
      if (useLocal) {
        const forced = await pushToCloud({ force: true, skipRiskCheck: true })
        setSyncMeta(getSyncMeta())
        await Dialog.alert({ title: forced.ok ? "同步完成" : "同步失败", message: forced.message })
        return forced.ok
      }

      const useRemote = await Dialog.confirm({
        title: "恢复 WebDAV？",
        message: "要改为从 WebDAV 恢复到本机吗？这会覆盖本机当前收藏。",
        confirmLabel: "恢复 WebDAV",
        cancelLabel: "取消",
      })
      if (useRemote) {
        const pulled = await pullFromCloud()
        setSyncMeta(getSyncMeta())
        if (pulled.ok) await reload()
        await Dialog.alert({ title: pulled.ok ? "恢复完成" : "恢复失败", message: pulled.message })
        return pulled.ok
      }
      return false
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

  async function onSyncDown() {
    if (syncing) return
    if (!webDAVConfigured()) {
      await Dialog.alert({
        title: "WebDAV 未配置",
        message: "请先打开 WebDAV 设置并填写连接信息。",
      })
      return
    }
    const ok = await Dialog.confirm({
      title: "从 WebDAV 恢复？",
      message: "将下载 WebDAV 当前数据并覆盖本机全部收藏，无法撤销。",
      confirmLabel: "恢复",
    })
    if (!ok) return
    setSyncing(true)
    const r = await pullFromCloud()
    setSyncing(false)
    setSyncMeta(getSyncMeta())
    if (r.ok) await reload()
    await Dialog.alert({ title: r.ok ? "恢复完成" : "恢复失败", message: r.message })
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
  const normalizedDomainQuery = domainQuery.trim().toLowerCase()
  const domainMatches = normalizedDomainQuery
    ? groups.flatMap(group =>
        group.bookmarks
          .filter(bookmark => host(bookmark.url).toLowerCase().includes(normalizedDomainQuery))
          .map(bookmark => ({ group, bookmark })),
      )
    : []

  return (
    <NavigationStack>
      <List
        key={`main-list-${showGroupSeparators ? "lines" : "plain"}-${displayRevision}`}
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
                title="使用说明"
                systemImage="questionmark.circle"
                action={showGuide}
              />
              <Button
                title="版本更新"
                systemImage="sparkles"
                action={showVersionUpdates}
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
              <Button
                title="新建分组"
                systemImage="folder.badge.plus"
                action={onNewGroup}
              />
              <Button
                title="排序"
                systemImage="arrow.up.arrow.down"
                action={enterSort}
              />
              <Button
                title={showGroupSeparators ? "隐藏分割线" : "显示分割线"}
                systemImage={showGroupSeparators ? "line.3.horizontal.decrease" : "line.3.horizontal"}
                action={onToggleGroupSeparators}
              />
              <Menu title={`WebDAV · ${webDAVStatusLabel()}`} systemImage="externaldrive.connected.to.line.below">
                <Button
                  title="WebDAV 设置"
                  systemImage="gearshape"
                  action={openWebDAVSettings}
                />
                <Button
                  title="上传"
                  systemImage="arrow.up"
                  action={onSyncUp}
                />
                <Button
                  title="恢复当前 WebDAV"
                  systemImage="arrow.down"
                  action={onSyncDown}
                />
                <Button
                  title="历史版本"
                  systemImage="clock.arrow.circlepath"
                  action={openWebDAVHistory}
                />
                <Button
                  title={webDAVDisplayPath() || "尚未配置路径"}
                  systemImage="doc.text.magnifyingglass"
                  disabled
                  action={() => {}}
                />
              </Menu>
              <Menu
                title={autoSyncTitle()}
                systemImage="clock.arrow.2.circlepath"
              >
                {AUTO_SYNC_OPTIONS.map((opt: { label: string; seconds: number }) => (
                  <Button
                    key={`auto-${opt.seconds}`}
                    title={opt.label}
                    systemImage={
                      opt.seconds === autoInterval ? "checkmark" : undefined
                    }
                    action={() => onChangeAutoInterval(opt.seconds)}
                  />
                ))}
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
              <TextField
                title="域名搜索"
                prompt="输入域名，例如 example.com"
                value={domainQuery}
                onChanged={setDomainQuery}
              />
            </Section>
            {normalizedDomainQuery ? (
              <Section
                header={<Text>域名搜索结果</Text>}
                footer={<Text>{`找到 ${domainMatches.length} 条收藏`}</Text>}
              >
                {domainMatches.length === 0 ? (
                  <Text foregroundStyle="secondaryLabel">没有匹配的域名</Text>
                ) : domainMatches.map(({ group, bookmark }) => (
                  <Button
                    key={`${group.id}-${bookmark.id}`}
                    buttonStyle="plain"
                    action={() => Safari.openURL(bookmark.url)}
                  >
                    <HStack spacing={10}>
                      <Image systemName="globe" foregroundStyle="systemBlue" />
                      <VStack alignment="leading" spacing={3} frame={{ maxWidth: "infinity", alignment: "leading" }}>
                        <Text lineLimit={1}>{bookmark.title}</Text>
                        <Text font="footnote" foregroundStyle="secondaryLabel" lineLimit={1}>
                          {`${group.name} · ${host(bookmark.url)}`}
                        </Text>
                      </VStack>
                    </HStack>
                  </Button>
                ))}
              </Section>
            ) : null}
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
                    showGroupSeparators && gi < groups.length - 1
                      ? { visibility: "visible", edges: "bottom" }
                      : "hidden"
                  }
                  contextMenu={{
                    menuItems: (
                      <>
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
      title: `v${entry.version} 更新内容`,
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
        <Section footer={<Text>点击版本查看详细更新内容。</Text>}>
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
                  <Text font="footnote" foregroundStyle="secondaryLabel">
                    {`${entry.date} · ${entry.items.length} 项更新`}
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
  const [local, setLocal] = useState<CloudBackup | null>(null)
  const [current, setCurrent] = useState<CloudBackup | null>(null)
  const [backups, setBackups] = useState<CloudBackup[]>([])
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<string[]>([])

  const providerName = "WebDAV"
  const currentName = "当前 WebDAV"

  async function reloadVersions() {
    setLoading(true)
    const localVersion = await getLocalCurrentVersion()
    const currentVersion = await getCloudCurrentVersion()
    const history = await listCloudBackups(100)
    setLocal(localVersion)
    setCurrent(currentVersion)
    setBackups(history)
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
    const restored = await restoreCloudBackup(version.path)
    setBusy(false)

    if (!restored.ok) {
      await Dialog.alert({ title: "恢复失败", message: restored.message })
      return
    }

    const uploadAfter = await Dialog.confirm({
      title: "是否设为最新？",
      message: `已恢复到本机。是否立刻上传为 ${providerName} 最新？`,
      confirmLabel: "上传为最新",
      cancelLabel: "暂不上传",
    })
    if (uploadAfter) {
      setBusy(true)
      const pushed = await pushToCloud({ force: true, skipRiskCheck: true })
      setBusy(false)
      await Dialog.alert({
        title: pushed.ok ? "已设为最新" : "上传失败",
        message: pushed.message,
      })
    } else {
      await Dialog.alert({ title: "恢复完成", message: restored.message })
    }
    await reloadVersions()
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
        navigationTitle={`${providerName} 历史版本`}
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
            {local ? (
              <Section header={<Text>当前本机</Text>}>
                <HStack>
                  <Image systemName="iphone" foregroundStyle="systemBlue" font="title3" />
                  <VStack alignment="leading" spacing={3}>
                    <Text font="body">{local.name}</Text>
                    <Text font="footnote" foregroundStyle="secondaryLabel">{local.summary.label}</Text>
                  </VStack>
                </HStack>
              </Section>
            ) : null}

            <Section header={<Text>{currentName}</Text>}>
              {current ? versionRow(current, "externaldrive.fill", "systemGreen") : (
                <Text foregroundStyle="secondaryLabel">暂无当前版本</Text>
              )}
            </Section>

            <Section header={<Text>历史快照</Text>} footer={<Text>{busy ? "正在处理…" : `共 ${backups.length} 个历史版本`}</Text>}>
              {backups.length === 0 ? (
                <Text foregroundStyle="secondaryLabel">暂无历史快照。上传一次后会自动生成。</Text>
              ) : backups.map((backup: CloudBackup) => versionRow(backup, "clock.arrow.circlepath", "systemOrange", true))}
            </Section>
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
  const [searchQuery, setSearchQuery] = useState("")

  async function reload() {
    const s = await loadStore()
    setStore({ ...s })
    setLoaded(true)
  }

  const group = store.groups.find((g: Group) => g.id === groupId)
  const normalizedSearch = searchQuery.trim().toLowerCase()
  const filteredBookmarks = group
    ? group.bookmarks.filter(bookmark => {
        if (!normalizedSearch) return true
        return bookmark.title.toLowerCase().includes(normalizedSearch) ||
          host(bookmark.url).toLowerCase().includes(normalizedSearch) ||
          bookmark.url.toLowerCase().includes(normalizedSearch)
      })
    : []

  async function onDelete(bookmarkId: string) {
    if (!group) return
    moveBookmarksToTrash(store, group, [bookmarkId])
    await saveStore(store)
    setStore({ ...store })
    setSelected(selected.filter(id => id !== bookmarkId))
  }

  async function onMove(bookmarkId: string) {
    if (!group) return
    const targets = sortedGroups(store).filter(g => g.id !== group.id)
    if (targets.length === 0) {
      await Dialog.alert({ title: "没有其他分组", message: "请先新建一个目标分组。" })
      return
    }
    const index = await Dialog.actionSheet({
      title: "移动到分组",
      message: "选择目标分组",
      actions: targets.map(target => ({ label: target.name })),
    })
    if (index == null || !targets[index]) return
    if (moveBookmark(store, group.id, bookmarkId, targets[index].id)) {
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
    if (selected.length === filteredBookmarks.length) {
      setSelected([])
    } else {
      setSelected(filteredBookmarks.map((b: Bookmark) => b.id))
    }
  }

  async function deleteSelected() {
    if (!group || selected.length === 0) return
    const ok = await Dialog.confirm({
      title: `将 ${selected.length} 条收藏移到回收站？`,
      message: "可以稍后从回收站恢复。",
    })
    if (!ok) return
    moveBookmarksToTrash(store, group, selected)
    await saveStore(store)
    setStore({ ...store })
    exitSelect()
  }

  const allSelected =
    filteredBookmarks.length > 0 && selected.length === filteredBookmarks.length

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
          <Section>
            <TextField
              title="搜索"
              prompt="搜索标题、域名或网址"
              value={searchQuery}
              onChanged={setSearchQuery}
            />
          </Section>
          {group.bookmarks.length === 0 ? (
            <Text foregroundStyle="secondaryLabel">这个分组还没有收藏</Text>
          ) : filteredBookmarks.length === 0 ? (
            <Text foregroundStyle="secondaryLabel">没有匹配的收藏</Text>
          ) : (
            groupByDay(filteredBookmarks).map((sec: DaySection) => (
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

  async function reload() {
    const next = await loadStore()
    setStore({ ...next })
    setLoaded(true)
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
    await saveStore(store)
    setStore({ ...store })
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
    await saveStore(store)
    setStore({ ...store })
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
        ) : items.length === 0 ? (
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
    await saveStore(store)
    setStore({ ...store })
    setSelected(selected.filter(x => x !== id))
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
    await saveStore(store)
    setStore({ ...store })
    exitSelect()
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
