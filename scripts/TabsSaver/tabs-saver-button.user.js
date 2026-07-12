// ==UserScript==
// @name 标签页收藏
// @namespace qiqi.tabs-saver
// @version 0.2.21
// @description 点击悬浮按钮可收藏当前或全部 Safari 标签页，并可选择保存后关闭标签页。
// @match http://*/*
// @match https://*/*
// @run-at document-end
// @grant Scripting.FileManager
// @grant Scripting.tabs
// @grant GM.closeTab
// @grant GM.registerMenuCommand
// ==/UserScript==

(() => {
  const WRAP_ID = "qiqi-tab-save-toolbar"
  const BUTTON_ID = "qiqi-tab-save-button"
  const PICKER_ID = "qiqi-tab-save-picker"
  const TOAST_ID = "qiqi-tab-save-toast"
  const DIALOG_ID = "qiqi-tab-save-dialog"
  const STORE_FILE_NAME = "tabs-saver-store.json"
  const DEFAULT_GROUP_NAME = "默认"
  const BTN_SIZE = 30

  // 新标签页打开脚本的容器 id：若存在，默认把收藏按钮排在它左侧。
  const NEWTAB_ID = "__tb__"
  const NEIGHBOR_GAP = 4
  // 没有新标签按钮时（新用户/只装了 Tab）：居右边框 40px。
  const FALLBACK_RIGHT = 40
  const BOTTOM_GAP = 0

  const LS_KEY = "qiqi_tab_"

  let wrap = null
  let button = null
  let savedPosition = null
  let dragging = false
  let moved = false
  let startX = 0, startY = 0, startLeft = 0, startTop = 0
  let menuRegistered = false
  let positionSyncScheduled = false
  let singleClickTimer = null
  let bodyObserver = null
  let rootObserver = null
  let observedBody = null
  let healthCheckQueued = false
  let globalListenersInstalled = false

  function lsGet(key, def) {
    try {
      const v = localStorage.getItem(LS_KEY + key)
      if (v === null) return def
      const n = Number(v)
      return Number.isNaN(n) ? v : n
    } catch (_) { return def }
  }

  function lsSet(key, val) {
    try { localStorage.setItem(LS_KEY + key, String(val)) } catch (_) {}
  }

  function lsRemove(key) {
    try { localStorage.removeItem(LS_KEY + key) } catch (_) {}
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  }

  function now() {
    return Date.now()
  }

  function rootDir() {
    const root = Scripting.FileManager.safariBrowserDirectory
    if (!root) throw new Error("无法访问 Safari 脚本数据目录")
    return root
  }

  function storePath() {
    const root = rootDir()
    return {
      file: `${root}/${STORE_FILE_NAME}`,
    }
  }

  function normalizeUrl(url) {
    try {
      const value = new URL(url)
      value.hash = ""
      return value.toString()
    } catch (_) {
      return url
    }
  }

  function pageTitle() {
    const metaTitle = document.querySelector('meta[property="og:title"], meta[name="twitter:title"]')?.content?.trim()
    return metaTitle || document.title.trim() || location.href
  }

  async function loadStore(file) {
    try {
      if (!(await Scripting.FileManager.exists(file))) return { version: 1, groups: [] }
      const raw = await Scripting.FileManager.readAsString(file)
      const data = JSON.parse(raw)
      if (!data || !Array.isArray(data.groups)) return { version: 1, groups: [] }
      return data
    } catch (_) {
      return { version: 1, groups: [] }
    }
  }

  async function saveStore(file, store) {
    await Scripting.FileManager.writeAsString(file, JSON.stringify(store, null, 2))
  }

  function ensureGroups(store) {
    if (!Array.isArray(store.groups)) store.groups = []
    return store.groups
  }

  function sortGroups(groups) {
    return [...groups]
      .filter(group => group && group.id)
      .sort((a, b) => {
        const ao = typeof a.order === "number" ? a.order : 1000000 + (a.createdAt || 0)
        const bo = typeof b.order === "number" ? b.order : 1000000 + (b.createdAt || 0)
        return ao - bo
      })
  }

  function ensureDefaultGroup(store) {
    const groups = ensureGroups(store)
    let group = groups.find(item => item && item.name === DEFAULT_GROUP_NAME)
    if (!group) {
      group = { id: uid(), name: DEFAULT_GROUP_NAME, createdAt: now(), bookmarks: [] }
      groups.unshift(group)
    }
    if (!Array.isArray(group.bookmarks)) group.bookmarks = []
    return group
  }

  function hasBookmark(store, url) {
    const target = normalizeUrl(url)
    return ensureGroups(store).some(group => Array.isArray(group.bookmarks) && group.bookmarks.some(bookmark => normalizeUrl(bookmark?.url || "") === target))
  }

  function addCurrentPageToGroup(group) {
    if (!Array.isArray(group.bookmarks)) group.bookmarks = []
    const url = normalizeUrl(location.href)
    const exists = group.bookmarks.some(bookmark => normalizeUrl(bookmark?.url || "") === url)
    if (exists) return false
    group.bookmarks.unshift({ id: uid(), title: pageTitle(), url, savedAt: now(), read: false })
    return true
  }

  function tabBookmark(tab) {
    const url = normalizeUrl(tab?.url || "")
    if (!/^https?:\/\//i.test(url)) return null
    return {
      id: uid(),
      title: String(tab?.title || "").trim() || url,
      url,
      savedAt: now(),
      read: false,
    }
  }

  function addTabsToGroup(group, tabs) {
    if (!Array.isArray(group.bookmarks)) group.bookmarks = []
    const existing = new Set(group.bookmarks.map(bookmark => normalizeUrl(bookmark?.url || "")))
    const additions = []
    for (const tab of tabs) {
      const bookmark = tabBookmark(tab)
      if (!bookmark || existing.has(bookmark.url)) continue
      existing.add(bookmark.url)
      additions.push(bookmark)
    }
    group.bookmarks.unshift(...additions)
    return additions.length
  }

  async function currentSafariTab() {
    const current = await Scripting.tabs.getCurrent()
    if (current) return current
    return {
      id: null,
      url: location.href,
      title: pageTitle(),
      active: true,
      index: 0,
      windowId: 0,
      pinned: false,
    }
  }

  async function closeSavedTabs(tabs, currentId) {
    const closable = tabs.filter(tab => Number.isInteger(tab?.id))
    const current = closable.find(tab => tab.id === currentId)
    const others = closable.filter(tab => tab.id !== currentId)
    let failed = 0
    for (const tab of [...others, ...(current ? [current] : [])]) {
      try {
        await GM.closeTab(tab.id)
      } catch (_) {
        failed += 1
      }
    }
    return failed
  }

  async function tabsForMode(mode) {
    const current = await currentSafariTab()
    const tabs = mode === "all"
      ? (await Scripting.tabs.query())
          .filter(tab => /^https?:\/\//i.test(tab?.url || ""))
          .sort((a, b) => a.windowId - b.windowId || a.index - b.index)
      : [current]
    if (!tabs.length) throw new Error("没有可收藏的网页标签页")
    return { tabs, currentId: current?.id }
  }

  async function saveTabs(tabs, currentId, groupId, closeAfter) {
    const { file } = storePath()
    const store = await loadStore(file)
    const group = groupId
      ? ensureGroups(store).find(item => item && item.id === groupId)
      : ensureDefaultGroup(store)
    if (!group) throw new Error("分组不存在，请刷新页面后重试")

    const added = addTabsToGroup(group, tabs)
    if (added > 0) await saveStore(file, store)
    if (!closeAfter) {
      showToast(added > 0 ? `已收藏 ${added} 个标签页` : "已收藏过")
      setSavedVisual(true)
      return
    }

    const failed = await closeSavedTabs(tabs, currentId)
    if (failed > 0) throw new Error(`已收藏，${failed} 个标签页关闭失败`)
  }

  function showSaveDialog({ tabs, currentId, groupId = null }) {
    document.getElementById(DIALOG_ID)?.remove()
    const overlay = document.createElement("div")
    overlay.id = DIALOG_ID
    overlay.innerHTML = `
      <div class="qts-dialog-card" role="dialog" aria-modal="true" aria-label="保存会话">
        <div class="qts-dialog-title">保存会话</div>
        <div class="qts-dialog-count">${tabs.length} 个标签页</div>
        <label class="qts-dialog-option">
          <input type="checkbox">
          <span>保存后关闭标签页</span>
        </label>
        <div class="qts-dialog-actions">
          <button type="button" class="qts-dialog-cancel">取消</button>
          <button type="button" class="qts-dialog-save">保存</button>
        </div>
      </div>`
    const cancel = overlay.querySelector(".qts-dialog-cancel")
    const save = overlay.querySelector(".qts-dialog-save")
    const checkbox = overlay.querySelector('input[type="checkbox"]')
    cancel.addEventListener("click", () => overlay.remove())
    overlay.addEventListener("click", event => { if (event.target === overlay) overlay.remove() })
    save.addEventListener("click", async () => {
      cancel.disabled = true
      save.disabled = true
      try {
        await saveTabs(tabs, currentId, groupId, checkbox.checked)
        overlay.remove()
      } catch (error) {
        showToast(error?.message || "收藏失败")
        cancel.disabled = false
        save.disabled = false
      }
    })
    document.documentElement.appendChild(overlay)
  }

  async function openSaveDialog(mode, groupId = null) {
    const selection = await tabsForMode(mode)
    showSaveDialog({ ...selection, groupId })
  }

  async function saveToDefault() {
    const { file } = storePath()
    const store = await loadStore(file)
    const group = ensureDefaultGroup(store)
    if (!addCurrentPageToGroup(group)) {
      showToast("已收藏过")
      setSavedVisual(true)
      return
    }
    await saveStore(file, store)
    showToast("已收藏到默认")
    setSavedVisual(true)
  }

  async function saveToGroup(groupId) {
    const { file } = storePath()
    const store = await loadStore(file)
    const group = ensureGroups(store).find(item => item && item.id === groupId)
    if (!group) throw new Error("分组不存在，请刷新页面后重试")
    if (!addCurrentPageToGroup(group)) {
      showToast("该分组已收藏过")
      setSavedVisual(true)
      return
    }
    await saveStore(file, store)
    showToast(`已收藏到${group.name || DEFAULT_GROUP_NAME}`)
    setSavedVisual(true)
  }

  async function createGroupAndSave(name) {
    const groupName = String(name || "").trim()
    if (!groupName) {
      showToast("分组名不能为空")
      return
    }

    const { file } = storePath()
    const store = await loadStore(file)
    const groups = ensureGroups(store)
    const existing = groups.find(group => String(group?.name || "").trim() === groupName)
    if (existing) {
      await saveToGroup(existing.id)
      return
    }

    const group = { id: uid(), name: groupName, createdAt: now(), bookmarks: [] }
    addCurrentPageToGroup(group)
    groups.push(group)
    await saveStore(file, store)
    showToast(`已新建并收藏到${group.name}`)
    setSavedVisual(true)
  }

  async function removeCurrentPage() {
    const { file } = storePath()
    const store = await loadStore(file)
    const url = normalizeUrl(location.href)
    let removed = 0
    for (const group of ensureGroups(store)) {
      if (!Array.isArray(group.bookmarks)) continue
      const before = group.bookmarks.length
      group.bookmarks = group.bookmarks.filter(bookmark => normalizeUrl(bookmark?.url || "") !== url)
      removed += before - group.bookmarks.length
    }
    if (removed > 0) {
      await saveStore(file, store)
      showToast("已移除收藏")
    } else {
      showToast("未收藏")
    }
    setSavedVisual(false)
  }

  async function toggleCurrentPage() {
    const { file } = storePath()
    const store = await loadStore(file)
    if (hasBookmark(store, location.href)) await removeCurrentPage()
    else await saveToDefault()
  }

  async function refreshSavedVisual() {
    try {
      const { file } = storePath()
      const store = await loadStore(file)
      setSavedVisual(hasBookmark(store, location.href))
    } catch (_) {
      setSavedVisual(false)
    }
  }

  function bookmarkSVG(saved) {
    const fill = saved ? "currentColor" : "none"
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="19" height="19" fill="${fill}" stroke="currentColor" stroke-width="2.35" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>`
  }

  function injectCSS() {
    if (document.getElementById("qiqi-tab-save-style")) return
    const style = document.createElement("style")
    style.id = "qiqi-tab-save-style"
    style.textContent = `
#${WRAP_ID}{position:fixed;left:0;top:0;z-index:2147483647;width:${BTN_SIZE}px;height:${BTN_SIZE}px;box-sizing:border-box;touch-action:none;-webkit-touch-callout:none;user-select:none;-webkit-user-select:none;transform:translate3d(0,0,0);will-change:left,top;}
#${BUTTON_ID}{width:${BTN_SIZE}px;height:${BTN_SIZE}px;box-sizing:border-box;border-radius:50%;background:rgba(242,242,247,.92);color:rgba(28,28,30,.82);-webkit-backdrop-filter:blur(10px) saturate(140%);backdrop-filter:blur(10px) saturate(140%);border:0;box-shadow:inset 0 0 0 .5px rgba(60,60,67,.16);filter:none;display:flex;align-items:center;justify-content:center;margin:0;padding:0;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:transform .12s ease,opacity .2s,background .2s,color .2s,box-shadow .2s;}
#${BUTTON_ID}[data-saved="true"]{color:#34C759;}
#${BUTTON_ID}:active{transform:scale(.96);opacity:.94;background:rgba(229,229,234,.96);}
#${PICKER_ID}{position:fixed;right:8px;bottom:43px;z-index:2147483647;min-width:210px;max-width:min(300px,calc(100vw - 32px));max-height:min(420px,calc(100vh - 120px));overflow:auto;padding:10px;border-radius:18px;background:rgba(255,255,255,.84);-webkit-backdrop-filter:blur(18px) saturate(160%);backdrop-filter:blur(18px) saturate(160%);border:1px solid rgba(60,60,67,.16);box-shadow:0 10px 30px rgba(0,0,0,.18);font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#111;}
#${PICKER_ID} .qts-title{font-size:13px;font-weight:600;color:#6b6b72;padding:4px 8px 8px;}
#${PICKER_ID} button{width:100%;border:0;background:transparent;color:inherit;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 8px;border-radius:12px;text-align:left;font-size:15px;font-weight:500;-webkit-tap-highlight-color:transparent;}
#${PICKER_ID} button:active{background:rgba(0,122,255,.12);}
#${PICKER_ID} .qts-create{color:#007AFF;font-weight:600;justify-content:flex-start;}
#${PICKER_ID} .qts-count{font-size:12px;color:#8E8E93;font-weight:500;}
#${TOAST_ID}{position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:2147483647;padding:8px 12px;border-radius:999px;background:rgba(0,0,0,.76);color:white;font:14px/18px -apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.18);opacity:0;transition:opacity .2s;pointer-events:none;}
#${DIALOG_ID}{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.34);font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#111;}
#${DIALOG_ID} .qts-dialog-card{width:min(340px,calc(100vw - 48px));padding:24px 20px 18px;border-radius:24px;background:rgba(248,248,248,.96);-webkit-backdrop-filter:blur(24px) saturate(160%);backdrop-filter:blur(24px) saturate(160%);box-shadow:0 20px 60px rgba(0,0,0,.28);}
#${DIALOG_ID} .qts-dialog-title{font-size:24px;font-weight:700;line-height:30px;}
#${DIALOG_ID} .qts-dialog-count{margin-top:16px;font-size:18px;color:#8E8E93;}
#${DIALOG_ID} .qts-dialog-option{display:flex;align-items:center;gap:12px;margin:22px 0;font-size:17px;}
#${DIALOG_ID} .qts-dialog-option input{width:24px;height:24px;margin:0;accent-color:#7C4DFF;}
#${DIALOG_ID} .qts-dialog-actions{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
#${DIALOG_ID} .qts-dialog-actions button{height:52px;border:0;border-radius:14px;font-size:18px;font-weight:600;}
#${DIALOG_ID} .qts-dialog-cancel{background:#E5E5EA;color:#111;}
#${DIALOG_ID} .qts-dialog-save{background:#7C4DFF;color:#fff;}
#${DIALOG_ID} button:disabled{opacity:.55;}
@media (prefers-color-scheme:dark){#${BUTTON_ID}{background:rgba(44,44,46,.82);color:rgba(255,255,255,.94);box-shadow:inset 0 0 0 .5px rgba(255,255,255,.16);}#${BUTTON_ID}[data-saved="true"]{color:#30D158;}#${PICKER_ID}{background:rgba(28,28,30,.78);border-color:rgba(255,255,255,.12);color:#fff;}#${PICKER_ID} .qts-title{color:#98989F;}#${DIALOG_ID}{color:#fff;}#${DIALOG_ID} .qts-dialog-card{background:rgba(28,28,30,.96);}#${DIALOG_ID} .qts-dialog-cancel{background:#3A3A3C;color:#fff;}}
`
    ;(document.head || document.documentElement).appendChild(style)
  }

  function getViewportBox() {
    const vv = window.visualViewport
    const layoutWidth = document.documentElement.clientWidth || innerWidth || 0
    const layoutHeight = document.documentElement.clientHeight || innerHeight || 0
    return {
      width: Math.max(1, Math.floor(vv?.width || 0), Math.floor(layoutWidth), Math.floor(innerWidth || 0)),
      height: Math.max(1, Math.floor(vv?.height || 0), Math.floor(layoutHeight), Math.floor(innerHeight || 0)),
    }
  }

  function clampPos(left, top) {
    const viewport = getViewportBox()
    return {
      left: Math.max(0, Math.min(left, viewport.width - BTN_SIZE)),
      top: Math.max(0, Math.min(top, viewport.height - BTN_SIZE - BOTTOM_GAP)),
    }
  }

  function applySavedPosition() {
    if (!wrap || !savedPosition) return false
    const pos = clampPos(savedPosition.left, savedPosition.top)
    savedPosition = pos
    wrap.style.left = pos.left + "px"
    wrap.style.top = pos.top + "px"
    wrap.style.right = "auto"
    wrap.style.bottom = "auto"
    return true
  }

  function applyDefaultPosition() {
    if (!wrap) return
    const viewport = getViewportBox()
    const neighbor = document.getElementById(NEWTAB_ID)
    if (neighbor) {
      const rect = neighbor.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        const left = Math.max(0, Math.min(rect.left - NEIGHBOR_GAP - BTN_SIZE, viewport.width - BTN_SIZE))
        wrap.style.left = left + "px"
        wrap.style.bottom = BOTTOM_GAP + "px"
        wrap.style.right = "auto"
        wrap.style.top = "auto"
        return
      }
    }
    const left = Math.max(0, Math.floor(viewport.width - BTN_SIZE - FALLBACK_RIGHT))
    wrap.style.left = left + "px"
    wrap.style.bottom = BOTTOM_GAP + "px"
    wrap.style.right = "auto"
    wrap.style.top = "auto"
  }

  function schedulePositionStabilize() {
    if (positionSyncScheduled) return
    positionSyncScheduled = true
    requestAnimationFrame(() => {
      positionSyncScheduled = false
      if (!wrap || dragging) return
      if (savedPosition) applySavedPosition()
      else applyDefaultPosition()
      wrap.style.transform = "translate3d(0,0,0)"
    })
  }

  function resetPosition() {
    savedPosition = null
    lsRemove("left")
    lsRemove("top")
    applyDefaultPosition()
    if (button) {
      button.style.opacity = "0.3"
      setTimeout(() => { if (button) button.style.opacity = "1" }, 250)
    }
    showToast("已重置收藏按钮位置")
  }

  function onPointerDown(e) {
    e.preventDefault()
    e.stopPropagation()
    dragging = true
    moved = false
    startX = e.clientX
    startY = e.clientY
    const rect = wrap.getBoundingClientRect()
    startLeft = rect.left
    startTop = rect.top
    wrap.style.left = rect.left + "px"
    wrap.style.top = rect.top + "px"
    wrap.style.right = "auto"
    wrap.style.bottom = "auto"
    button.setPointerCapture?.(e.pointerId)
  }

  function onPointerMove(e) {
    if (!dragging) return
    e.preventDefault()
    e.stopPropagation()
    const dx = e.clientX - startX
    const dy = e.clientY - startY
    if (!moved && Math.abs(dx) < 5 && Math.abs(dy) < 5) return
    moved = true
    const pos = clampPos(startLeft + dx, startTop + dy)
    wrap.style.left = pos.left + "px"
    wrap.style.top = pos.top + "px"
  }

  function onPointerUp(e) {
    if (!dragging) return
    e.preventDefault()
    e.stopPropagation()
    dragging = false
    button.releasePointerCapture?.(e.pointerId)
    if (moved) {
      savedPosition = clampPos(parseInt(wrap.style.left, 10) || 0, parseInt(wrap.style.top, 10) || 0)
      lsSet("left", savedPosition.left)
      lsSet("top", savedPosition.top)
      return
    }
    if (singleClickTimer) {
      clearTimeout(singleClickTimer)
      singleClickTimer = null
      showGroupPicker().catch(error => showToast(error?.message || "操作失败"))
      return
    }
    singleClickTimer = setTimeout(() => {
      singleClickTimer = null
      showActionPicker().catch(error => showToast(error?.message || "操作失败"))
    }, 260)
  }

  function setSavedVisual(saved) {
    const btn = document.getElementById(BUTTON_ID)
    if (!btn) return
    btn.innerHTML = bookmarkSVG(saved)
    btn.dataset.saved = saved ? "true" : "false"
    btn.title = saved ? "移除收藏" : "收藏到 Tab"
  }

  function showToast(text) {
    let toast = document.getElementById(TOAST_ID)
    if (!toast) {
      toast = document.createElement("div")
      toast.id = TOAST_ID
      document.documentElement.appendChild(toast)
    }
    toast.textContent = text
    toast.style.opacity = "1"
    clearTimeout(showToast.timer)
    showToast.timer = setTimeout(() => { toast.style.opacity = "0" }, 1500)
  }

  function positionPicker(picker) {
    if (!wrap) return
    const rect = wrap.getBoundingClientRect()
    const viewport = getViewportBox()
    const margin = 8
    const pw = picker.offsetWidth || 240
    const ph = picker.offsetHeight || 320
    let left = rect.right - pw
    left = Math.max(margin, Math.min(left, viewport.width - pw - margin))
    let top = rect.top - margin - ph
    if (top < margin) {
      const below = rect.bottom + margin
      top = (below + ph <= viewport.height - margin) ? below : Math.max(margin, viewport.height - ph - margin)
    }
    picker.style.left = Math.round(left) + "px"
    picker.style.top = Math.round(top) + "px"
    picker.style.right = "auto"
    picker.style.bottom = "auto"
  }

  async function showActionPicker() {
    const current = document.getElementById(PICKER_ID)
    if (current) {
      current.remove()
      return
    }
    const picker = document.createElement("div")
    picker.id = PICKER_ID
    picker.addEventListener("click", event => event.stopPropagation())

    const title = document.createElement("div")
    title.className = "qts-title"
    title.textContent = "收藏成功后关闭标签页"
    picker.appendChild(title)

    const actions = [
      { title: "收藏当前标签页", mode: "current" },
      { title: "收藏全部标签页", mode: "all" },
    ]
    for (const action of actions) {
      const row = document.createElement("button")
      row.type = "button"
      row.innerHTML = `<span>${action.title}</span><span class="qts-count">›</span>`
      row.addEventListener("click", async event => {
        event.preventDefault()
        event.stopPropagation()
        for (const item of picker.querySelectorAll("button")) item.disabled = true
        try {
          await openSaveDialog(action.mode)
          picker.remove()
        } catch (error) {
          showToast(error?.message || "收藏失败")
          for (const item of picker.querySelectorAll("button")) item.disabled = false
        }
      })
      picker.appendChild(row)
    }

    document.documentElement.appendChild(picker)
    positionPicker(picker)
    setTimeout(() => document.addEventListener("click", closeGroupPicker, { once: true }), 0)
  }

  async function showGroupPicker() {
    const current = document.getElementById(PICKER_ID)
    if (current) {
      current.remove()
      return
    }
    const { file } = storePath()
    const store = await loadStore(file)
    const groups = sortGroups(ensureGroups(store))
    const picker = document.createElement("div")
    picker.id = PICKER_ID
    picker.addEventListener("click", event => event.stopPropagation())
    const title = document.createElement("div")
    title.className = "qts-title"
    title.textContent = groups.length ? "收藏到标签组" : "还没有分组"
    picker.appendChild(title)
    for (const group of groups) {
      const row = document.createElement("button")
      row.type = "button"
      row.innerHTML = `<span>${escapeHtml(group.name || DEFAULT_GROUP_NAME)}</span><span class="qts-count">${Array.isArray(group.bookmarks) ? group.bookmarks.length : 0}</span>`
      row.addEventListener("click", async event => {
        event.preventDefault()
        event.stopPropagation()
        row.disabled = true
        try {
          await openSaveDialog("current", group.id)
          picker.remove()
        } catch (error) {
          showToast(error?.message || "收藏失败")
          row.disabled = false
        }
      })
      picker.appendChild(row)
    }
    const create = document.createElement("button")
    create.type = "button"
    create.className = "qts-create"
    create.textContent = "＋ 新建分组"
    create.addEventListener("click", async event => {
      event.preventDefault()
      event.stopPropagation()
      const name = window.prompt("新建分组名称")
      if (name === null) return
      create.disabled = true
      try {
        await createGroupAndSave(name)
        picker.remove()
      } catch (error) {
        showToast(error?.message || "新建失败")
        create.disabled = false
      }
    })
    picker.appendChild(create)
    document.documentElement.appendChild(picker)
    positionPicker(picker)
    setTimeout(() => document.addEventListener("click", closeGroupPicker, { once: true }), 0)
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]))
  }

  function closeGroupPicker() {
    document.getElementById(PICKER_ID)?.remove()
  }

  function registerMenu() {
    if (menuRegistered) return
    if (typeof GM !== "undefined" && GM.registerMenuCommand) {
      menuRegistered = true
      GM.registerMenuCommand("📍 重置收藏按钮位置", () => resetPosition())
    }
  }

  function installPositionListeners() {
    if (globalListenersInstalled) return
    globalListenersInstalled = true
    window.addEventListener("resize", schedulePositionStabilize)
    window.addEventListener("scroll", schedulePositionStabilize, { passive: true })
    window.visualViewport?.addEventListener("resize", schedulePositionStabilize)
    window.visualViewport?.addEventListener("scroll", schedulePositionStabilize)
    window.addEventListener("pageshow", () => { refreshSavedVisual(); scheduleHealthCheck() })
    window.addEventListener("focus", () => { refreshSavedVisual(); scheduleHealthCheck() })
    window.addEventListener("load", scheduleHealthCheck, { once: true })
    window.addEventListener("popstate", scheduleHealthCheck)
    window.addEventListener("hashchange", scheduleHealthCheck)
    document.addEventListener("readystatechange", scheduleHealthCheck)
    document.addEventListener("visibilitychange", () => { if (!document.hidden) { refreshSavedVisual(); scheduleHealthCheck() } })
  }

  function ensureButtonHealthy() {
    injectCSS()
    startBodyGuard()
    const currentWrap = document.getElementById(WRAP_ID)
    const currentButton = document.getElementById(BUTTON_ID)
    if (!currentWrap || !currentButton || currentButton.parentElement !== currentWrap || !currentWrap.isConnected) {
      currentWrap?.remove?.()
      wrap = null
      button = null
      createButton()
      return
    }
    wrap = currentWrap
    button = currentButton
    schedulePositionStabilize()
  }

  function scheduleHealthCheck() {
    if (healthCheckQueued) return
    healthCheckQueued = true
    requestAnimationFrame(() => {
      healthCheckQueued = false
      ensureButtonHealthy()
    })
  }

  function watchBody(body) {
    if (!body || observedBody === body) return
    observedBody = body
    if (bodyObserver) bodyObserver.disconnect()
    bodyObserver = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        for (const node of mutation.removedNodes) {
          if (node?.id === WRAP_ID || node?.querySelector?.(`#${WRAP_ID}`)) {
            scheduleHealthCheck()
            return
          }
        }
      }
    })
    bodyObserver.observe(body, { childList: true })
  }

  function startBodyGuard() {
    const root = document.documentElement
    if (!root) return
    watchBody(document.body)
    if (rootObserver) return
    rootObserver = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes]
        if (changedNodes.some(node =>
          node === document.body ||
          node?.tagName === "HEAD" ||
          node?.id === WRAP_ID ||
          node?.id === "qiqi-tab-save-style" ||
          node?.querySelector?.(`#${WRAP_ID}, #qiqi-tab-save-style`)
        )) {
          watchBody(document.body)
          scheduleHealthCheck()
          return
        }
      }
    })
    rootObserver.observe(root, { childList: true })
  }

  function createButton() {
    if (document.getElementById(WRAP_ID)) return
    injectCSS()
    wrap = document.createElement("div")
    wrap.id = WRAP_ID
    button = document.createElement("button")
    button.id = BUTTON_ID
    button.type = "button"
    button.setAttribute("aria-label", "收藏并关闭标签页")
    button.innerHTML = bookmarkSVG(false)
    button.addEventListener("pointerdown", onPointerDown)
    button.addEventListener("pointermove", onPointerMove)
    button.addEventListener("pointerup", onPointerUp)
    button.addEventListener("pointercancel", onPointerUp)
    wrap.appendChild(button)
    document.documentElement.appendChild(wrap)
    const savedLeft = lsGet("left", null)
    const savedTop = lsGet("top", null)
    if (savedLeft !== null && savedTop !== null) {
      savedPosition = clampPos(Number(savedLeft), Number(savedTop))
      applySavedPosition()
    } else {
      savedPosition = null
      applyDefaultPosition()
    }
    refreshSavedVisual()
    registerMenu()
    installPositionListeners()
    startBodyGuard()
    schedulePositionStabilize()
  }

  function boot() {
    createButton()
    scheduleHealthCheck()
  }

  boot()
  if (document.readyState === "loading") {
    // 按钮不依赖 body，立即创建；DOMContentLoaded 只作为额外健康检查点。
    document.addEventListener("DOMContentLoaded", scheduleHealthCheck, { once: true })
  }
})()
