# Look

**Look 是 [Looklook（看看）](https://github.com/imythu/looklook) 的非官方改版**：在自己的 Linux 服务器上跑 Claude Code、Codex，手机或电脑浏览器随时查看和回复。

> 这不是官方版本，与原作者无关，请不要把这里的问题反馈给原作者。原项目由 imythu 开发，原仓库 `github.com/imythu/looklook` 截至 2026-11-09 已无法访问。本仓库基于原项目 1.57.1 修改，代码按 AGPL-3.0-or-later 继续开源。改了什么见 [MODIFICATIONS.md](MODIFICATIONS.md)。

*Unofficial modified version of Looklook by imythu, not affiliated with or endorsed by the original author. Licensed under AGPL-3.0-or-later. See [MODIFICATIONS.md](MODIFICATIONS.md).*

## 和原版的主要区别

- 新增「节点」页：管理 mihomo 全局代理，支持导入节点链接和订阅、测速、查看出口 IP / 国家 / 时区 / TUN / IPv6 状态
- 不连原项目的托管平台：没有登录、远程中转、自动检查更新，只通过本机、局域网或你自己的隧道（SSH、Tailscale 等）访问
- 改善手机端使用，修复聊天图片缩略图和旧会话无法恢复等问题

## 安装

目前只能从源码构建（见下）。`nodes/` 里的一键安装包还没有在干净的系统上测试过，也还没有发布。

装好后打开 `http://127.0.0.1:1234`，开启局域网访问后同一网络的设备也能打开。

## 参与

欢迎提 Issue 和 PR，提交前请看 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 从源码构建

需要 Rust、Node.js 20+、python3 + fontTools（字体），以及 zig 0.15（仅在从源码构建内置的 tmux/ttyd 时需要）。

```bash
cd client
npm ci && npm run build                        # Web 控制台 → static/
scripts/fetch-vendor.sh fonts linux-x86_64     # ttyd + 字体 → vendor/（校验 SHA-256）
cargo build --release                          # → target/release/looklook
```

检查：`cargo test`、`cargo clippy --all-targets`、`npm run check:locales`。提交 PR 前请先看 [CONTRIBUTING.md](CONTRIBUTING.md)。

| 目录 | 内容 |
| --- | --- |
| `client/` | 客户端：Rust 服务 + React 控制台（`src-ui/`）、打包脚本 |
| `protocol/` | 客户端 ↔ 服务端协议：请求签名、网关令牌、DTO、错误码 |

## 许可证

客户端（`client/`）采用 [GNU Affero General Public License v3.0 or later](LICENSE)。如果你运行修改后的版本并通过网络向他人提供服务，需要向他们提供源码（AGPL 第 13 条）。应用的设置页链接到本仓库和原项目。

协议 crate（`protocol/`）保持 [MIT](protocol/LICENSE)，因为托管服务也在用它。

1.34.0 及以前的客户端版本以 MIT 发布，仍可按 MIT 使用；所有版权持有人都同意了这次变更。

聊天视图改编自 CloudCLI UI（https://github.com/siteboon/claudecodeui）的部分代码，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

内置的第三方组件列在 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。许可证只覆盖代码；Looklook / 看看 的名称和标志不授权给分叉使用。
