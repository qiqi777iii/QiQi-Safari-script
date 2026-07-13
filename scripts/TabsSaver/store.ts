// Shared data store for Tab.
// Saved into Safari browser data directory so the App script, Share Sheet intent, and
// Safari userscript can read/write the same JSON. Safari userscripts cannot
// write to appGroupDocumentsDirectory, and they cannot create subdirectories
// under the Safari data dir either, so store a single flat file at its root.

export type Bookmark = {
  id: string
  title: string
  url: string
  savedAt: number
  read?: boolean
}

export type Group = {
  id: string
  name: string
  createdAt: number
  bookmarks: Bookmark[]
  /** Manual sort order. Lower comes first. Assigned on first normalize/reorder. */
  order?: number
}

export type TrashedBookmark = {
  id: string
  bookmark: Bookmark
  sourceGroupId: string
  sourceGroupName: string
  deletedAt: number
}

export type Store = {
  version: number
  groups: Group[]
  /** Standalone favorites list (收藏组). Independent from groups. */
  favorites?: Bookmark[]
  /** Soft-deleted group bookmarks. */
  trash?: TrashedBookmark[]
  /** Last local modification time (ms). Used for sync conflict resolution. */
  updatedAt?: number
}

const FILE = FileManager.safariBrowserDirectory + "/tabs-saver-store.json"
const SUBDIR_LEGACY_FILE = FileManager.safariBrowserDirectory + "/tabs-saver/store.json"
const STORAGE_LEGACY_FILE = FileManager.safariBrowserStorageDirectory + "/tabs-saver/store.json"
const LEGACY_FILE = FileManager.appGroupDocumentsDirectory + "/tabs-saver/store.json"

const DEFAULT_GROUP_NAME = "默认"

function uid(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  )
}

function emptyStore(): Store {
  return { version: 1, groups: [] }
}

function parseStore(raw: string): Store | null {
  try {
    const data = JSON.parse(raw) as Store
    if (!data || !Array.isArray(data.groups)) return null
    return data
  } catch {
    return null
  }
}

async function loadStoreFromFile(file: string): Promise<Store | null> {
  try {
    if (!(await FileManager.exists(file))) return null
    const raw = await FileManager.readAsString(file)
    return parseStore(raw)
  } catch {
    return null
  }
}

export async function loadStore(): Promise<Store> {
  const current = await loadStoreFromFile(FILE)
  if (current) return current

  // One-time migrations from older storage locations, newest attempt first.
  for (const old of [SUBDIR_LEGACY_FILE, STORAGE_LEGACY_FILE, LEGACY_FILE]) {
    const legacy = await loadStoreFromFile(old)
    if (legacy) {
      await overwriteStore(legacy)
      return legacy
    }
  }

  return emptyStore()
}

export async function saveStore(store: Store): Promise<void> {
  store.updatedAt = Date.now()
  await FileManager.writeAsString(FILE, JSON.stringify(store))
}

/** Overwrite local store with a full object (e.g. pulled from cloud) without bumping updatedAt. */
export async function overwriteStore(store: Store): Promise<void> {
  await FileManager.writeAsString(FILE, JSON.stringify(store))
}

/** Ensure there is at least one group; returns the group to use as default. */
export function ensureDefaultGroup(store: Store): Group {
  if (store.groups.length === 0) {
    const g: Group = {
      id: uid(),
      name: DEFAULT_GROUP_NAME,
      createdAt: Date.now(),
      bookmarks: [],
    }
    store.groups.push(g)
  }
  return store.groups[0]
}

export function createGroup(store: Store, name: string): Group {
  const g: Group = {
    id: uid(),
    name: name.trim() || DEFAULT_GROUP_NAME,
    createdAt: Date.now(),
    bookmarks: [],
    order: store.groups.length,
  }
  store.groups.push(g)
  return g
}

export function addBookmark(
  group: Group,
  title: string,
  url: string,
): Bookmark {
  const b: Bookmark = {
    id: uid(),
    title: title.trim() || url,
    url: url.trim(),
    savedAt: Date.now(),
  }
  group.bookmarks.unshift(b)
  return b
}

export function renameGroup(group: Group, name: string): void {
  group.name = name.trim() || group.name
}

export function removeGroup(store: Store, groupId: string): void {
  store.groups = store.groups.filter(g => g.id !== groupId)
}

export type TrashRetentionDays = 0 | 3 | 7 | 15

export function moveBookmarks(
  store: Store,
  sourceGroupId: string,
  bookmarkIds: string[],
  targetGroupId: string,
): number {
  if (sourceGroupId === targetGroupId) return 0
  const source = store.groups.find(g => g.id === sourceGroupId)
  const target = store.groups.find(g => g.id === targetGroupId)
  if (!source || !target) return 0
  const selected = new Set(bookmarkIds)
  const moving = source.bookmarks.filter(bookmark => selected.has(bookmark.id))
  if (moving.length === 0) return 0
  source.bookmarks = source.bookmarks.filter(bookmark => !selected.has(bookmark.id))
  target.bookmarks = [...moving, ...target.bookmarks]
  return moving.length
}

export function moveBookmark(
  store: Store,
  sourceGroupId: string,
  bookmarkId: string,
  targetGroupId: string,
): boolean {
  return moveBookmarks(store, sourceGroupId, [bookmarkId], targetGroupId) > 0
}

function trashList(store: Store): TrashedBookmark[] {
  if (!Array.isArray(store.trash)) store.trash = []
  return store.trash
}

export function moveBookmarksToTrash(store: Store, group: Group, ids: string[]): void {
  const selected = new Set(ids)
  const deletedAt = Date.now()
  const entries = group.bookmarks
    .filter(b => selected.has(b.id))
    .map(bookmark => ({
      id: uid(),
      bookmark,
      sourceGroupId: group.id,
      sourceGroupName: group.name,
      deletedAt,
    }))
  store.trash = [...entries, ...trashList(store)]
  group.bookmarks = group.bookmarks.filter(b => !selected.has(b.id))
}

export function moveGroupToTrash(store: Store, groupId: string): void {
  const group = store.groups.find(g => g.id === groupId)
  if (!group) return
  moveBookmarksToTrash(store, group, group.bookmarks.map(b => b.id))
  removeGroup(store, groupId)
}

export function getTrash(store: Store): TrashedBookmark[] {
  return [...trashList(store)].sort((a, b) => b.deletedAt - a.deletedAt)
}

export function cleanupExpiredTrash(
  store: Store,
  retentionDays: TrashRetentionDays,
  now = Date.now(),
): number {
  if (retentionDays === 0) return 0
  const before = trashList(store).length
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000
  store.trash = trashList(store).filter(item => item.deletedAt >= cutoff)
  return before - store.trash.length
}

export function restoreTrashItem(store: Store, trashId: string): boolean {
  const item = trashList(store).find(x => x.id === trashId)
  if (!item) return false
  let target = store.groups.find(g => g.id === item.sourceGroupId)
  if (!target) {
    target = createGroup(store, item.sourceGroupName)
  }
  target.bookmarks.unshift(item.bookmark)
  store.trash = trashList(store).filter(x => x.id !== trashId)
  return true
}

export function permanentlyDeleteTrashItem(store: Store, trashId: string): void {
  store.trash = trashList(store).filter(x => x.id !== trashId)
}

export function emptyTrash(store: Store): void {
  store.trash = []
}

export function removeBookmark(group: Group, bookmarkId: string): void {
  group.bookmarks = group.bookmarks.filter(b => b.id !== bookmarkId)
}

export function removeBookmarks(group: Group, ids: string[]): void {
  const set = new Set(ids)
  group.bookmarks = group.bookmarks.filter(b => !set.has(b.id))
}

export function markBookmarkRead(group: Group, bookmarkId: string): void {
  const b = group.bookmarks.find(x => x.id === bookmarkId)
  if (b) b.read = true
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/#.*$/, "").replace(/\/$/, "")
}

/** Total number of bookmarks across all groups. */
export function totalBookmarkCount(store: Store): number {
  return store.groups.reduce((sum, g) => sum + g.bookmarks.length, 0)
}

/** Get the favorites list (always an array). */
export function getFavorites(store: Store): Bookmark[] {
  if (!Array.isArray(store.favorites)) store.favorites = []
  return store.favorites
}

/**
 * Add a bookmark into the standalone favorites list (a copy, independent from
 * its group). Deduped by normalized URL. Returns true if newly added.
 */
export function addFavorite(store: Store, src: Bookmark): boolean {
  const favs = getFavorites(store)
  const key = normalizeUrl(src.url)
  if (favs.some(b => normalizeUrl(b.url) === key)) return false
  favs.unshift({
    id: uid(),
    title: src.title,
    url: src.url,
    savedAt: Date.now(),
  })
  return true
}

/** Whether a url is already in favorites (by normalized URL). */
export function isFavorited(store: Store, url: string): boolean {
  const key = normalizeUrl(url)
  return getFavorites(store).some(b => normalizeUrl(b.url) === key)
}

export function removeFavorite(store: Store, id: string): void {
  store.favorites = getFavorites(store).filter(b => b.id !== id)
}

export function removeFavorites(store: Store, ids: string[]): void {
  const set = new Set(ids)
  store.favorites = getFavorites(store).filter(b => !set.has(b.id))
}

export function markFavoriteRead(store: Store, id: string): void {
  const b = getFavorites(store).find(x => x.id === id)
  if (b) b.read = true
}

/**
 * Ensure every group has a stable `order`. Returns true if anything changed
 * (so the caller can persist). On first run (no orders yet) the existing
 * creation-time order is preserved, then frozen into explicit orders.
 */
export function normalizeOrders(store: Store): boolean {
  const missing = store.groups.some(g => g.order == null)
  const ordered = missing
    ? [...store.groups].sort((a, b) => a.createdAt - b.createdAt)
    : [...store.groups].sort((a, b) => (a.order! - b.order!))
  let changed = false
  ordered.forEach((g, i) => {
    if (g.order !== i) {
      g.order = i
      changed = true
    }
  })
  return changed
}

/** Apply a new manual order based on an ordered list of group ids. */
export function applyGroupOrder(store: Store, orderedIds: string[]): void {
  const indexOf = new Map(orderedIds.map((id, i) => [id, i] as const))
  for (const g of store.groups) {
    const i = indexOf.get(g.id)
    if (i != null) g.order = i
  }
}

/** Groups sorted by manual order (falls back to creation time). */
export function sortedGroups(store: Store): Group[] {
  const hasOrder = store.groups.some(g => g.order != null)
  if (!hasOrder) {
    return [...store.groups].sort((a, b) => a.createdAt - b.createdAt)
  }
  return [...store.groups].sort(
    (a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER),
  )
}
