#!/bin/bash
# 卸载 Looklook 节点（mihomo + 节点小服务 + 防火墙）。
#   sudo bash /usr/local/lib/lk-nodes/uninstall.sh          保留节点、订阅、节点密码（/etc/lk-nodes、/var/lib/lk-nodes）
#   sudo bash /usr/local/lib/lk-nodes/uninstall.sh --purge  全部删掉
# Looklook 本身用它自己的卸载：~/.local/lib/looklook/uninstall.sh
set -u
[ "$(id -u)" = 0 ] || { echo "请用 sudo 运行"; exit 1; }
LIB=/usr/local/lib/lk-nodes
systemctl disable -q --now lk-nodes lk-mihomo 2>/dev/null
"$LIB/lk-nodes-helper" fw-off 2>/dev/null || nft delete table inet lk_nodes 2>/dev/null
rm -f /etc/systemd/system/lk-mihomo.service /etc/systemd/system/lk-nodes.service /usr/local/sbin/lk-nodes-helper
systemctl daemon-reload
if [ "${1:-}" = --purge ]; then
  rm -rf /etc/lk-nodes /var/lib/lk-nodes
  userdel lk-mihomo 2>/dev/null
  echo "节点、订阅、节点密码已删除"
else
  echo "节点、订阅、节点密码保留在 /etc/lk-nodes、/var/lib/lk-nodes（彻底删除加 --purge）"
fi
rm -rf "$LIB"
echo "✓ 已卸载 mihomo 和节点服务，网络恢复原样"
