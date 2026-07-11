import { AppIntentManager, AppIntentProtocol, Widget } from "scripting"
import { fetchIPInfo } from "./data"

export const RefreshIPIntent = AppIntentManager.register({
  name: "RefreshIP",
  protocol: AppIntentProtocol.AppIntent,
  perform: async () => {
    try {
      await fetchIPInfo({ interactiveVerification: false })
    } catch (error) {
      console.log("小组件刷新失败，保留缓存：", String(error))
    } finally {
      Widget.reloadAll()
    }
  },
})
