#!/bin/bash
# 打安装包 dist/lk-linux-x86_64.tar.gz（+ .sha256、install.sh），发布到 GitHub Release 用。
#   bash nodes/package.sh [mihomo 可执行文件，默认 /usr/bin/mihomo]
# 需要先编译好 client/target/release/looklook；looklook-term / looklook-mux / 字体等用官方安装包里的
# （LOOKLOOK_DIST，默认 ~/.local/lib/looklook，即装好的官方 1.57.1）。
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
MIHOMO=${1:-/usr/bin/mihomo}
OFFICIAL=${LOOKLOOK_DIST:-$HOME/.local/lib/looklook}
OUT=$ROOT/dist
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

ver=$(sed -n 's/^VERSION = "\(.*\)"/\1/p' "$ROOT/nodes/lk-nodes-helper")
L=$STAGE/lk/looklook N=$STAGE/lk/nodes
mkdir -p "$L" "$N"

# Looklook（改版主程序 + 官方的终端/会话程序）
install -m 755 "$ROOT/client/target/release/looklook" "$L/looklook"
for f in looklook-term looklook-mux stop.sh uninstall.sh; do install -m 755 "$OFFICIAL/$f" "$L/$f"; done
cp -R "$OFFICIAL/fonts" "$OFFICIAL/LICENSES" "$OFFICIAL/trzsz" "$L/"
install -m 755 "$ROOT/client/packaging/install-linux.sh" "$L/install.sh"
cp "$ROOT/LICENSE" "$L/LICENSE"

# 节点
install -m 755 "$MIHOMO" "$N/mihomo"
"$N/mihomo" -v | head -1 >"$N/MIHOMO_VERSION"
for f in lk-nodes-helper setup.sh uninstall.sh; do install -m 755 "$ROOT/nodes/$f" "$N/$f"; done
echo "$ver" >"$N/VERSION"
cat >"$STAGE/lk/README.txt" <<EOF
Looklook + 节点 $ver（Linux x86_64）
安装：sudo bash lk/nodes/setup.sh

源码（AGPL-3.0）：https://github.com/z892137292/look
  - Looklook 改版，原作者 imythu（原仓库 github.com/imythu/looklook 已无法访问）
mihomo（GPL-3.0）：$(cat "$N/MIHOMO_VERSION")，源码 https://github.com/MetaCubeX/mihomo
EOF

mkdir -p "$OUT"
tar -C "$STAGE" -czf "$OUT/lk-linux-x86_64.tar.gz" lk
(cd "$OUT" && sha256sum lk-linux-x86_64.tar.gz >lk-linux-x86_64.tar.gz.sha256)
cp "$ROOT/nodes/install.sh" "$OUT/install.sh"
ls -la "$OUT"
