# Modifications / 修改说明

本项目是 Looklook（看看，作者 imythu，AGPL-3.0-or-later）客户端 1.57.1 的修改版，修改始于 2026-10-30，至今持续进行。
This work is a modified version of the Looklook client 1.57.1 by imythu, licensed under AGPL-3.0-or-later. Modifications began on 2026-10-30.

与原版的主要差异：

- 新增「节点」页（`client/src-ui/pages/Nodes.jsx`）、网关转发（`client/src/gateway/mihomo.rs`）和安装脚本（`nodes/`）
- 新增线路显示（局域网 / Tailscale / DERP，`client/src/gateway/ts_report.rs`）和内置浏览器页面（`client/src-ui/pages/Browser.jsx`）
- 平台地址解析到本机，关闭自动检查更新，移除推广和更新提示：不再连接原项目的托管服务
- 手机端：输入框不被底部导航遮挡、iOS 输入不缩放等
- 修复：聊天图片缩略图 404、聊天滚动卡顿和残影、旧会话恢复失败
- 更换产品名和图标：「Looklook / 看看」的名称和标志不随代码授权给分叉。界面文案已改为 Look；为了兼容已有安装，程序内部的小写标识（命令和程序名 `looklook`、安装目录、环境变量 `LOOKLOOK_*` 等）暂未改名

`nodes/` 捆绑的 mihomo（GPL-3.0）及其他第三方组件各按原许可证授权，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
