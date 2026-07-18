// ==UserScript==
// @name         自动选择最高画质
// @namespace    local.scripting.eporner
// @version      1.0.7
// @description  自动选择播放视频的最高可用画质
// @updateURL    https://raw.githubusercontent.com/qiqi777iii/Scripts/main/userscripts/auto-select-highest-quality.user.js
// @downloadURL  https://raw.githubusercontent.com/qiqi777iii/Scripts/main/userscripts/auto-select-highest-quality.user.js
// @match        https://www.eporner.com/video-*/
// @match        https://www.eporner.com/video-*/*
// @match        https://www.eporner.com/hd-porn/*
// @match        https://xhamster.com/videos/*
// @match        https://www.xhamster.com/videos/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  "use strict"

  const QUALITY_PATTERN = /(?:^|\s)(\d{3,4})\s*p\b/i
  const USER_PLAYBACK_ATTRIBUTE = "data-user-playback-until"
  const RETRY_INTERVAL = 500
  const MAX_RETRIES = 40

  let scheduled = false
  let retryTimer = 0
  let retries = 0
  let lastLog = ""
  let playerObserver = null
  let bootstrapObserver = null

  function parseQuality(element) {
    const label =
      element.querySelector(".vjs-menu-item-text, .xplayer-settings-menu-new__option-label")?.textContent ||
      element.textContent ||
      ""
    const match = label.match(QUALITY_PATTERN)
    return match ? Number(match[1]) : 0
  }

  function logSelection(quality) {
    const message = `已自动选择 ${quality}p`
    if (message === lastLog) return
    console.info(`[自动选择最高画质] ${message}`)
    lastLog = message
  }

  function isSupportedPage() {
    if (location.hostname.endsWith("xhamster.com")) {
      return /^\/videos\//.test(location.pathname)
    }
    return true
  }

  function userPlaybackRequested(video) {
    const videoUntil = Number(video?.getAttribute(USER_PLAYBACK_ATTRIBUTE) || 0)
    const pageUntil = Number(document.documentElement?.getAttribute(USER_PLAYBACK_ATTRIBUTE) || 0)
    return Math.max(videoUntil, pageUntil) > Date.now()
  }

  function clickWithoutAutoplay(item) {
    const video = document.querySelector("#xplayer__video")
    const keepPaused = Boolean(video?.paused)
    let cleanupTimer = 0

    const preventUnexpectedPlay = (event) => {
      if (!isSupportedPage()) return
      const target = event.target
      if (target instanceof HTMLVideoElement && target.id === "xplayer__video" && !userPlaybackRequested(target)) target.pause()
    }

    if (keepPaused) document.addEventListener("play", preventUnexpectedPlay, true)
    item.click()

    if (keepPaused) {
      queueMicrotask(() => {
        const currentVideo = document.querySelector("#xplayer__video")
        if (currentVideo && !userPlaybackRequested(currentVideo)) currentVideo.pause()
      })
      cleanupTimer = window.setTimeout(() => {
        document.removeEventListener("play", preventUnexpectedPlay, true)
        window.clearTimeout(cleanupTimer)
      }, 1500)
    }
  }

  function selectHighest(items, isSelected, activate = (item) => item.click()) {
    const choices = Array.from(items)
      .filter((item) => item.getAttribute("aria-disabled") !== "true")
      .map((item) => ({ item, quality: parseQuality(item) }))
      .filter(({ quality }) => quality > 0)
      .sort((a, b) => b.quality - a.quality)

    const highest = choices[0]
    if (!highest) return { found: false, changed: false }

    if (!isSelected(highest.item)) {
      activate(highest.item)
      logSelection(highest.quality)
      return { found: true, changed: true }
    }

    return { found: true, changed: false }
  }

  function applyEporner() {
    const buttons = document.querySelectorAll(".vjs-icon-hd")
    let found = false
    let changed = false

    buttons.forEach((button) => {
      const result = selectHighest(
        button.querySelectorAll(".vjs-menu-item"),
        (item) => item.getAttribute("aria-checked") === "true" || item.classList.contains("vjs-selected")
      )
      found ||= result.found
      changed ||= result.changed
    })

    return { found, changed, root: buttons[0] || null }
  }

  function applyXHamster() {
    const player = document.querySelector("[data-role='xplayer'], #video_box")
    const items = document.querySelectorAll(".xplayer-settings-menu-new__option.quality")
    if (!player || !items.length) return { found: false, changed: false, root: player }

    const result = selectHighest(
      items,
      (item) => item.classList.contains("selected"),
      clickWithoutAutoplay
    )
    return { ...result, root: player }
  }

  function applyHighestQuality() {
    scheduled = false
    if (!isSupportedPage()) {
      stopWatchers()
      return false
    }

    const result = location.hostname.endsWith("xhamster.com")
      ? applyXHamster()
      : applyEporner()

    if (result.root) observePlayer(result.root)
    if (result.found) {
      stopBootstrapObserver()
      window.clearInterval(retryTimer)
      retryTimer = 0
    }
    return result.found
  }

  function scheduleApply() {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(applyHighestQuality)
  }

  function observePlayer(root) {
    if (playerObserver?.root === root) return
    playerObserver?.observer.disconnect()

    const observer = new MutationObserver(scheduleApply)
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "aria-checked", "aria-disabled"]
    })
    playerObserver = { root, observer }
  }

  function stopBootstrapObserver() {
    bootstrapObserver?.disconnect()
    bootstrapObserver = null
  }

  function startBootstrapObserver() {
    stopBootstrapObserver()
    if (!document.documentElement) return

    bootstrapObserver = new MutationObserver(scheduleApply)
    bootstrapObserver.observe(document.documentElement, { childList: true, subtree: true })
  }

  function stopWatchers() {
    window.clearInterval(retryTimer)
    retryTimer = 0
    playerObserver?.observer.disconnect()
    playerObserver = null
    stopBootstrapObserver()
  }

  function startRetryWindow() {
    stopWatchers()
    if (!isSupportedPage()) return

    retries = 0
    startBootstrapObserver()
    scheduleApply()

    retryTimer = window.setInterval(() => {
      retries += 1
      const found = applyHighestQuality()
      if (found || retries >= MAX_RETRIES) {
        window.clearInterval(retryTimer)
        retryTimer = 0
        stopBootstrapObserver()
      }
    }, RETRY_INTERVAL)
  }

  function handleNavigation() {
    lastLog = ""
    startRetryWindow()
  }

  for (const method of ["pushState", "replaceState"]) {
    const original = history[method]
    history[method] = function (...args) {
      const result = original.apply(this, args)
      queueMicrotask(handleNavigation)
      return result
    }
  }

  document.addEventListener("DOMContentLoaded", startRetryWindow, { once: true })
  document.addEventListener("loadedmetadata", scheduleApply, true)
  document.addEventListener("loadstart", scheduleApply, true)
  window.addEventListener("popstate", handleNavigation)
  window.addEventListener("pageshow", startRetryWindow)

  if (document.documentElement) startRetryWindow()
})()
