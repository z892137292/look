#!/bin/bash
# Look + 节点（mihomo 全局代理）安装：在解压后的安装包里以 root 运行（install.sh 会自动调用）。
#
#   sudo bash setup.sh [--user 名字] [--kill-switch] [--force] [--no-looklook]
#
# 装好后：
#   - lk-mihomo.service：mihomo（lk-mihomo 用户 + TUN），全局代理，局域网直连
#   - lk-nodes.service ：root 小服务 127.0.0.1:9091，Look「节点」页经它加节点、加订阅
#   - Look 装给 --user（默认是执行 sudo 的那个用户），浏览器打开 http://<IP>:1234/nodes
# 节点密码只在这里设置（终端输入），网页上改不了。
set -euo pipefail

SRC=$(cd "$(dirname "$0")" && pwd)
LIB=/usr/local/lib/lk-nodes
ETC=/etc/lk-nodes
HOME_DIR=/var/lib/lk-nodes
SVC=lk-mihomo
U=lk-mihomo

say() { printf '%s\n' "$*"; }
die() { printf '✗ %s\n' "$*" >&2; exit 1; }

TARGET=${SUDO_USER:-}
KILL=0 FORCE=0 LOOKLOOK=1
while [ $# -gt 0 ]; do
  case $1 in
    --user) TARGET=$2; shift ;;
    --kill-switch) KILL=1 ;;
    --force) FORCE=1 ;;
    --no-looklook) LOOKLOOK=0 ;;
    *) die "不认识的参数：$1" ;;
  esac
  shift
done

# ---------- 检查 ----------
[ "$(id -u)" = 0 ] || die "请用 sudo 运行"
[ "$(uname -s)" = Linux ] && [ "$(uname -m)" = x86_64 ] || die "目前只支持 Linux x86_64"
[ -d /run/systemd/system ] || die "需要 systemd"
need=""
command -v python3 >/dev/null || need="$need python3"
command -v nft >/dev/null || need="$need nftables"
command -v ip >/dev/null || need="$need iproute2"
if [ -n "$need" ]; then
  if command -v apt-get >/dev/null; then
    say "安装依赖：$need"
    apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq $need >/dev/null || die "依赖安装失败：$need"
  else
    die "缺少：$need，请先装好"
  fi
fi
if [ $LOOKLOOK = 1 ]; then
  [ -n "$TARGET" ] && [ "$TARGET" != root ] || die "Look 要装给一个普通用户：用那个用户执行 sudo，或加 --user 名字"
  id "$TARGET" >/dev/null 2>&1 || die "没有用户 $TARGET"
fi
if [ $FORCE = 0 ] && ! systemctl is-active -q $SVC 2>/dev/null; then
  other=$(pgrep -xa 'mihomo|clash|clash-meta|sing-box|xray|v2ray' | grep -v "$LIB/" || true)
  [ -z "$other" ] || die "这台机器已经在运行代理程序（$(echo "$other" | head -1)），两个 TUN 会冲突。停掉它再装，或加 --force"
fi
TTY=0
{ : </dev/tty; } 2>/dev/null && TTY=1

# ---------- 文件 ----------
say "[1/5] 安装 mihomo 和节点服务"
id $U >/dev/null 2>&1 || useradd --system --no-create-home --home-dir $HOME_DIR --shell /usr/sbin/nologin $U
install -d -m 755 $LIB
install -m 755 "$SRC/mihomo" $LIB/mihomo.new && mv -f $LIB/mihomo.new $LIB/mihomo
install -m 755 "$SRC/lk-nodes-helper" $LIB/lk-nodes-helper
install -m 755 "$SRC/uninstall.sh" $LIB/uninstall.sh
cp -f "$SRC/VERSION" $LIB/VERSION 2>/dev/null || true
ln -sf $LIB/lk-nodes-helper /usr/local/sbin/lk-nodes-helper
install -d -m 700 $ETC
install -d -m 700 -o $U -g $U $HOME_DIR

# ---------- 节点密码 ----------
if [ ! -s $ETC/panel.pass ]; then
  [ $TTY = 1 ] || die "需要在终端里运行（要设置节点密码）"
  say ""
  say "设置「节点密码」：以后在网页上加/删节点、加订阅、切换节点都要输它。只存哈希，网页上改不了。"
  while :; do
    read -rsp "  节点密码（至少 6 位，不显示）：" p1 </dev/tty; echo
    read -rsp "  再输一次：" p2 </dev/tty; echo
    if [ ${#p1} -ge 6 ] && [ "$p1" = "$p2" ]; then break; fi
    say "  两次不一致或太短，重来"
  done
  printf '%s\n' "$p1" | $LIB/lk-nodes-helper passwd
  unset p1 p2
fi

# ---------- 配置 + 服务 ----------
say "[2/5] 生成 mihomo 配置"
[ $KILL = 1 ] && $LIB/lk-nodes-helper kill-switch on >/dev/null
$LIB/lk-nodes-helper render

cat >/etc/systemd/system/$SVC.service <<EOF
[Unit]
Description=mihomo 全局代理（Look 节点）
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$U
Group=$U
AmbientCapabilities=CAP_NET_ADMIN CAP_NET_RAW CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_ADMIN CAP_NET_RAW CAP_NET_BIND_SERVICE
# 防火墙由 root 装（"+" = 以 root 运行）：DNS 交给 mihomo、SSH 回包走原路由、kill-switch
ExecStartPre=+$LIB/lk-nodes-helper fw
ExecStart=$LIB/mihomo -d $HOME_DIR -f $HOME_DIR/config.yaml
ExecStopPost=+$LIB/lk-nodes-helper fw-stop
Restart=on-failure
RestartSec=5
LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
EOF
cat >/etc/systemd/system/lk-nodes.service <<EOF
[Unit]
Description=Look 节点小服务（127.0.0.1:9091）
After=$SVC.service

[Service]
ExecStart=$LIB/lk-nodes-helper serve
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload

say "[3/5] 启动 mihomo"
systemctl enable -q $SVC lk-nodes
systemctl restart $SVC lk-nodes
ok=0
for _ in $(seq 1 10); do
  sleep 2
  if systemctl is-active -q $SVC && ip link show lk-tun >/dev/null 2>&1; then ok=1; break; fi
done
if [ $ok = 0 ]; then
  journalctl -u $SVC -n 15 --no-pager || true
  systemctl disable -q --now $SVC lk-nodes || true
  $LIB/lk-nodes-helper fw-off
  die "mihomo 没能启动，已停掉、网络恢复原样"
fi

# 防失联：SSH 装的话，确认 SSH 还通；90 秒内没人按回车就自动撤掉
if [ $TTY = 1 ] && [ -n "${SSH_CONNECTION:-}" ]; then
  say ""
  say "mihomo 已接管网络。如果你还能看到这行，按回车确认（90 秒内不按会自动撤销，防止 SSH 断开后连不上）"
  if ! read -rt 90 _ </dev/tty; then
    systemctl disable -q --now $SVC lk-nodes || true
    $LIB/lk-nodes-helper fw-off
    die "没有确认，已撤销（mihomo 已停止，网络恢复原样）"
  fi
fi

# ---------- Look ----------
if [ $LOOKLOOK = 1 ]; then
  say "[4/5] 安装 Look（用户 $TARGET）"
  uid=$(id -u "$TARGET")
  loginctl enable-linger "$TARGET"
  systemctl start "user@$uid.service"
  # 在 Look 自带的安装程序里装成该用户的 systemd 用户服务
  tmp=$(mktemp -d)
  cp -R "$SRC/../looklook" "$tmp/"
  chown -R "$TARGET": "$tmp"
  runuser -u "$TARGET" -- env HOME="$(getent passwd "$TARGET" | cut -d: -f6)" XDG_RUNTIME_DIR=/run/user/$uid \
    DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$uid/bus sh "$tmp/looklook/install.sh" >/tmp/lk-install-looklook.log 2>&1 \
    || { cat /tmp/lk-install-looklook.log; rm -rf "$tmp"; die "Look 安装失败"; }
  rm -rf "$tmp"
fi

# ---------- 完成 ----------
say "[5/5] 完成"
IP=$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p')
say ""
say "✓ 安装好了。现在还没有节点（没有节点时$( [ $KILL = 1 ] && echo '断网，只能连局域网' || echo '直接连网')）。"
say ""
say "  打开 http://${IP:-<这台机器的IP>}:1234/nodes ，粘贴节点链接或订阅地址，输入刚才设置的节点密码。"
say "  （同一局域网直接打开；在外面用：ssh -L 1234:127.0.0.1:1234 $TARGET@<服务器>，再开 http://127.0.0.1:1234/nodes）"
say ""
say "  kill-switch（没有节点就断网，防止漏出真实 IP）：$( [ $KILL = 1 ] && echo 已打开 || echo 关闭)，在「节点」页可以切换"
say "  卸载：sudo bash $LIB/uninstall.sh"
