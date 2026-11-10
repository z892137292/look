#!/bin/bash
# 一键安装 Look + 节点（mihomo 全局代理）。用法（在要装的机器上，用普通用户执行）：
#
#   curl -fsSL https://github.com/z892137292/look/releases/latest/download/install.sh | sudo bash
#
# 参数（放在 bash 后面：… | sudo bash -s -- --kill-switch）：
#   --kill-switch   没有可用节点时断网（默认关：没有节点时直接连网）
#   --user 名字     Look 装给哪个用户（默认执行 sudo 的用户）
#   --no-looklook   只装 mihomo 和节点服务
# 环境变量 GH_PROXY：GitHub 下载慢时加个镜像前缀，例如 GH_PROXY=https://ghfast.top/
set -euo pipefail
REPO=${LK_REPO:-z892137292/look}
TAG=${LK_TAG:-latest}
NAME=lk-linux-x86_64.tar.gz
if [ "$TAG" = latest ]; then BASE="https://github.com/$REPO/releases/latest/download"; else BASE="https://github.com/$REPO/releases/download/$TAG"; fi
BASE="${GH_PROXY:-}$BASE"

[ "$(id -u)" = 0 ] || { echo "请用 sudo 运行：curl -fsSL …/install.sh | sudo bash"; exit 1; }
command -v curl >/dev/null || { echo "缺少 curl"; exit 1; }
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
echo "下载 $BASE/$NAME"
curl -fL --retry 3 -o "$tmp/$NAME" "$BASE/$NAME"
curl -fsSL --retry 3 -o "$tmp/$NAME.sha256" "$BASE/$NAME.sha256"
(cd "$tmp" && sha256sum -c "$NAME.sha256") || { echo "✗ 校验失败，下载的文件不完整或被改过"; exit 1; }
tar -xzf "$tmp/$NAME" -C "$tmp"
bash "$tmp/lk/nodes/setup.sh" "$@"
