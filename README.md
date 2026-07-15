# Scripts

集中维护和分发 userscript、Surge 模块与 Scripting App 脚本包。

## 仓库结构

- `userscripts/`：可直接安装到 userscript 管理器的浏览器脚本。
- `surge/`：Surge 模块及其配套脚本。
- `scripts/`：可导入 Scripting App 的完整脚本包。

## Userscript

| 脚本 | 版本 | 功能 | 安装 |
| --- | --- | --- | --- |
| 封面视频预览 | 1.2.0 | 在手机上首次点按视频封面播放静音预览，再次点按进入详情；切换封面或滑动时停止旧预览。 | [安装](https://raw.githubusercontent.com/qiqi777iii/Scripts/main/userscripts/cover-video-preview.user.js) |
| 悬浮翻页 | 1.3 | 自动识别上一页和下一页，并提供关闭标签页、刷新及可拖动的悬浮翻页按钮。 | [安装](https://raw.githubusercontent.com/qiqi777iii/Scripts/main/userscripts/floating-pager.user.js) |
| 磁力链验车 | 1.0.0 | 识别网页中的磁力链接，提供验车和复制功能。 | [安装](https://raw.githubusercontent.com/qiqi777iii/Scripts/main/userscripts/magnet-link-checker.user.js) |
| MissAV Plyr 本地样式修复 | 1.0.0 | 为 MissAV 内置 Plyr 3.6.8 官方 CSS，避免 CDN 请求失败破坏播放器布局；网站升级 Plyr 时提示更新脚本。 | [安装](https://raw.githubusercontent.com/qiqi777iii/Scripts/main/userscripts/missav-plyr-local-style.user.js) |
| 新标签页打开 | 1.2.0 | 通过网页悬浮开关控制链接是否在 Safari 后台新标签页中打开。 | [安装](https://raw.githubusercontent.com/qiqi777iii/Scripts/main/userscripts/new-tab-opener.user.js) |
| 番号快速搜索 | 1.0.0 | 识别并标记网页中的番号，提供常用网站快捷搜索。 | [安装](https://raw.githubusercontent.com/qiqi777iii/Scripts/main/userscripts/search-av-mobile.user.js) |
| Senplayer播放 | 1.0.1 | 捕获当前网页视频地址，可一键复制地址或通过 SenPlayer 播放。 | [安装](https://raw.githubusercontent.com/qiqi777iii/Scripts/main/userscripts/senplayer-video-button.user.js) |
| 播放当前页视频 | 1.0.1 | 检测并控制当前网页视频，支持播放、暂停、快进、后退和全屏。 | [安装](https://raw.githubusercontent.com/qiqi777iii/Scripts/main/userscripts/video-player.user.js) |

## Surge 模块

| 模块 | 功能 | 安装 |
| --- | --- | --- |
| 根据出口 IP 切换出站模式 | 网络变化后通过 ipinfo 检查 DIRECT 出口；中国 IP 使用规则模式，非中国 IP 使用直接连接。 | [安装](https://raw.githubusercontent.com/qiqi777iii/Scripts/main/surge/switch-outbound-mode-by-ip.sgmodule) |

## Scripting App 脚本包

| 脚本包 | 版本 | 功能 | 项目链接 |
| --- | --- | --- | --- |
| Claude额度 | 1.0.1 | 查看 Claude 使用额度，包含 App 页面和桌面小组件。 | [复制链接](https://github.com/qiqi777iii/Scripts/tree/main/scripts/ClaudeUsage) |
| Codex额度 | 1.0.1 | 查看 Codex 使用额度，包含 App 页面和桌面小组件。 | [复制链接](https://github.com/qiqi777iii/Scripts/tree/main/scripts/CodexUsage) |
| IP查询 | 1.2.0 | 通过 IPLark 查询当前出口或指定 IP 的地址、ISP、类型、国家、使用场景和评分，并提供桌面小组件。 | [复制链接](https://github.com/qiqi777iii/Scripts/tree/main/scripts/IPQuery) |
| 标签页收藏 | 2.0.2 | 从 Safari 分享表收藏网页并分组管理，支持 WebDAV 同步、历史快照、桌面小组件和配套 Safari 收藏按钮。 | [复制链接](https://github.com/qiqi777iii/Scripts/tree/main/scripts/TabsSaver) |
| 翻译器 | 2.9.6 | 支持系统翻译、Apple Intelligence、Google 网页翻译、可配置 AI 接口、快捷指令和系统翻译界面。 | [复制链接](https://github.com/qiqi777iii/Scripts/tree/main/scripts/Translator) |

## 使用说明

### Userscript

点击对应的“安装”链接，通过支持 userscript 的浏览器扩展导入。脚本已配置 GitHub Raw 更新地址的，可由管理器检查后续版本。

### Surge 模块

点击模块的“安装”链接，将 Raw 地址添加到 Surge。模块会自动引用同目录下的配套 JavaScript，不需要单独安装脚本文件。

### Scripting App 脚本包

复制对应项目链接，在 Scripting App 中通过远程资源导入完整目录。脚本包的组件、Intent、Widget 和其他配套文件会随项目一起导入。

> `scripts/TabsSaver/tabs-saver-button.user.js` 是标签页收藏单入口包的内置组件，由脚本包负责安装和更新，不需要单独导入。
