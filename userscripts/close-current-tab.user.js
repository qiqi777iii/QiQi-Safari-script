// ==UserScript==
// @name         关闭当前标签页
// @namespace    https://github.com/qiqi777iii/Scripts
// @version      1.0.1
// @updateURL    https://raw.githubusercontent.com/qiqi777iii/Scripts/main/userscripts/close-current-tab.user.js
// @downloadURL  https://raw.githubusercontent.com/qiqi777iii/Scripts/main/userscripts/close-current-tab.user.js
// @description  在标签页收藏按钮左侧显示关闭按钮，点击即可关闭当前 Safari 标签页。
// @match        http://*/*
// @match        https://*/*
// @run-at       document-start
// @grant        GM.closeTab
// @grant        Scripting.tabs
// ==/UserScript==

(() => {
  "use strict"

  const WRAP_ID = "qiqi-close-current-tab-toolbar"
  const BUTTON_ID = "qiqi-close-current-tab-button"
  const STYLE_ID = "qiqi-close-current-tab-style"
  const TABS_SAVER_ID = "qiqi-tab-save-toolbar"
  const BTN_SIZE = 30
  const NEIGHBOR_GAP = 4
  const FALLBACK_RIGHT = 74
  const BOTTOM_GAP = 0

  let wrap = null
  let button = null
  let observer = null
  let syncQueued = false
  let closing = false

  function closeSVG() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`
  }

  function injectCSS() {
    if (document.getElementById(STYLE_ID)) return
    const style = document.createElement("style")
    style.id = STYLE_ID
    style.textContent = `
#${WRAP_ID}{position:fixed;left:0;bottom:${BOTTOM_GAP}px;z-index:2147483647;width:${BTN_SIZE}px;height:${BTN_SIZE}px;box-sizing:border-box;touch-action:manipulation;-webkit-touch-callout:none;user-select:none;-webkit-user-select:none;transform:translate3d(0,0,0);}
#${BUTTON_ID}{width:${BTN_SIZE}px;height:${BTN_SIZE}px;box-sizing:border-box;border-radius:50%;background:rgba(242,242,247,.92);color:#FF3B30;-webkit-backdrop-filter:blur(10px) saturate(140%);backdrop-filter:blur(10px) saturate(140%);border:0;box-shadow:inset 0 0 0 .5px rgba(60,60,67,.16);display:flex;align-items:center;justify-content:center;margin:0;padding:0;cursor:pointer;-webkit-tap-highlight-color:transparent;transition:transform .12s ease,opacity .2s,background .2s;}
#${BUTTON_ID}:active{transform:scale(.96);opacity:.94;background:rgba(229,229,234,.96);}
#${BUTTON_ID}[disabled]{opacity:.45;}
@media (prefers-color-scheme:dark){#${BUTTON_ID}{background:rgba(44,44,46,.82);color:#FF453A;box-shadow:inset 0 0 0 .5px rgba(255,255,255,.16);}}
`
    ;(document.head || document.documentElement).appendChild(style)
  }

  function viewportWidth() {
    return Math.max(1, Math.floor(window.visualViewport?.width || 0), document.documentElement.clientWidth || 0, innerWidth || 0)
  }

  function applyPosition() {
    if (!wrap) return
    const width = viewportWidth()
    const neighbor = document.getElementById(TABS_SAVER_ID)
    let left = width - BTN_SIZE - FALLBACK_RIGHT
    if (neighbor) {
      const rect = neighbor.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) left = rect.left - NEIGHBOR_GAP - BTN_SIZE
    }
    wrap.style.left = Math.max(0, Math.min(Math.round(left), width - BTN_SIZE)) + "px"
    wrap.style.top = "auto"
    wrap.style.right = "auto"
    wrap.style.bottom = BOTTOM_GAP + "px"
  }

  function schedulePosition() {
    if (syncQueued) return
    syncQueued = true
    requestAnimationFrame(() => {
      syncQueued = false
      applyPosition()
    })
  }

  async function closeCurrentTab(event) {
    event.preventDefault()
    event.stopPropagation()
    if (closing) return
    closing = true
    button.disabled = true
    try {
      const current = await Scripting.tabs.getCurrent()
      if (!Number.isInteger(current?.id)) throw new Error("无法获取当前标签页 ID")
      await GM.closeTab(current.id)
    } catch (error) {
      closing = false
      button.disabled = false
      console.error("关闭当前标签页失败", error)
    }
  }

  function createButton() {
    injectCSS()
    const currentWrap = document.getElementById(WRAP_ID)
    const currentButton = document.getElementById(BUTTON_ID)
    if (currentWrap && currentButton && currentButton.parentElement === currentWrap) {
      wrap = currentWrap
      button = currentButton
      schedulePosition()
      return
    }
    currentWrap?.remove()
    wrap = document.createElement("div")
    wrap.id = WRAP_ID
    button = document.createElement("button")
    button.id = BUTTON_ID
    button.type = "button"
    button.title = "关闭当前标签页"
    button.setAttribute("aria-label", "关闭当前标签页")
    button.innerHTML = closeSVG()
    button.addEventListener("click", closeCurrentTab)
    wrap.appendChild(button)
    document.documentElement.appendChild(wrap)
    applyPosition()
  }

  function startGuard() {
    if (observer) return
    observer = new MutationObserver(mutations => {
      let needsHealthCheck = false
      let neighborChanged = false
      for (const mutation of mutations) {
        for (const node of [...mutation.addedNodes, ...mutation.removedNodes]) {
          if (node?.id === WRAP_ID || node?.id === STYLE_ID || node?.id === TABS_SAVER_ID) needsHealthCheck = true
          if (node?.id === TABS_SAVER_ID || node?.querySelector?.(`#${TABS_SAVER_ID}`)) neighborChanged = true
        }
      }
      if (needsHealthCheck && (!document.getElementById(WRAP_ID) || !document.getElementById(STYLE_ID))) createButton()
      if (neighborChanged) schedulePosition()
    })
    observer.observe(document.documentElement, { childList: true, subtree: true })
  }

  function boot() {
    createButton()
    startGuard()
    window.addEventListener("resize", schedulePosition)
    window.visualViewport?.addEventListener("resize", schedulePosition)
    window.visualViewport?.addEventListener("scroll", schedulePosition)
    window.addEventListener("pageshow", () => { createButton(); schedulePosition() })
    document.addEventListener("visibilitychange", () => { if (!document.hidden) schedulePosition() })
    ;[40, 120, 300, 700, 1500, 3000].forEach(delay => setTimeout(schedulePosition, delay))
  }

  boot()
})()
