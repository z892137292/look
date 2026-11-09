//! 本地改版：路由器上报 Tailscale 状态，管理台据此显示手机是直连还是经 DERP 中转。
//!
//! 服务器连不到路由器（出站被拦），反过来让路由器每 10 秒把 `tailscale status --json` 推过来：
//! - `GET /ts-report/setup.sh`：路由器上执行 `curl … | sh` 装好推送服务（procd）；
//! - `POST /ts-report`：推送状态。
//! 两个都只接受默认网关发来、带 `x-ts-token` 令牌的请求，在访问码检查之前处理（路由器没有 Cookie）。

use std::net::IpAddr;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use axum::extract::Request;
use axum::http::{header, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use serde_json::{json, Value};

use super::access;
use crate::paths::Paths;

pub const PREFIX: &str = "/ts-report";
const HEADER: &str = "x-ts-token";
/// 超过这么久没收到上报就当作没有数据（推送间隔 10 秒）。
const STALE: Duration = Duration::from_secs(45);

static TOKEN: OnceLock<String> = OnceLock::new();
static LATEST: Mutex<Option<(Instant, Vec<Value>)>> = Mutex::new(None);

/// 令牌存在数据目录的 `ts-report.token` 里（仅当前用户可读），没有就生成。
pub fn token(paths: &Paths) -> &'static str {
    TOKEN.get_or_init(|| {
        let p = paths.home.join("ts-report.token");
        if let Some(t) = std::fs::read_to_string(&p).ok().map(|s| s.trim().to_string()).filter(|s| s.len() >= 12) {
            return t;
        }
        let t = crate::util::random_id(12);
        let _ = crate::util::write_private(&p, t.as_bytes());
        t
    })
}

pub async fn handle(paths: &Paths, peer_ip: IpAddr, req: Request) -> Response {
    if !access::is_gateway(peer_ip) {
        return (StatusCode::FORBIDDEN, "only the default gateway may report").into_response();
    }
    let want = token(paths);
    if !req.headers().get(HEADER).and_then(|v| v.to_str().ok()).is_some_and(|v| super::ct_eq(v, want)) {
        return (StatusCode::FORBIDDEN, "bad token").into_response();
    }
    match (req.method().clone(), req.uri().path()) {
        (Method::GET, "/ts-report/setup.sh") => {
            let host = req.headers().get(header::HOST).and_then(|v| v.to_str().ok()).unwrap_or("127.0.0.1:1234").to_string();
            ([(header::CONTENT_TYPE, "text/plain; charset=utf-8")], setup_script(&host, want)).into_response()
        }
        (Method::POST, PREFIX) => {
            let Ok(body) = axum::body::to_bytes(req.into_body(), 4 << 20).await else {
                return StatusCode::PAYLOAD_TOO_LARGE.into_response();
            };
            let Ok(v) = serde_json::from_slice::<Value>(&body) else {
                return (StatusCode::BAD_REQUEST, "not tailscale status json").into_response();
            };
            *LATEST.lock().unwrap_or_else(|e| e.into_inner()) = Some((Instant::now(), peers(&v)));
            StatusCode::NO_CONTENT.into_response()
        }
        _ => StatusCode::NOT_FOUND.into_response(),
    }
}

/// 正在通信（Active）的对端，每个是 `{name, os, path: direct|derp|peer_relay|idle, addr, relay}`。
fn peers(v: &Value) -> Vec<Value> {
    let s = |p: &Value, k: &str| p.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    let mut out: Vec<Value> = v
        .get("Peer")
        .and_then(Value::as_object)
        .into_iter()
        .flat_map(|m| m.values())
        .filter(|p| p.get("Active").and_then(Value::as_bool) == Some(true))
        .map(|p| {
            let (cur, peer_relay, relay) = (s(p, "CurAddr"), s(p, "PeerRelay"), s(p, "Relay"));
            let path = if !cur.is_empty() {
                "direct"
            } else if !peer_relay.is_empty() {
                "peer_relay"
            } else if !relay.is_empty() {
                "derp"
            } else {
                "idle"
            };
            // 设备名：MagicDNS 名的第一段（管理后台里看到的名字）；iOS 的 HostName 常是 localhost
            let dns = s(p, "DNSName");
            let short = dns.split('.').next().unwrap_or("");
            let name = if short.is_empty() { s(p, "HostName") } else { short.to_string() };
            json!({
                "name": name,
                "os": s(p, "OS"),
                "path": path,
                "addr": if cur.is_empty() { peer_relay } else { cur },
                "relay": relay,
            })
        })
        .collect();
    out.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
    out
}

/// 给状态接口：最近一次上报（过期返回 None）。
pub fn view() -> Option<Value> {
    let g = LATEST.lock().unwrap_or_else(|e| e.into_inner());
    let (at, peers) = g.as_ref()?;
    let age = at.elapsed();
    (age < STALE).then(|| json!({ "age_s": age.as_secs(), "peers": peers }))
}

fn setup_script(host: &str, token: &str) -> String {
    format!(
        r#"#!/bin/sh
# 路由器上的 Tailscale 状态推送（管理台显示直连 / DERP 用）
set -e
command -v tailscale >/dev/null || {{ echo "没有找到 tailscale"; exit 1; }}
cat >/usr/bin/ts-report <<'EOF'
#!/bin/sh
while :; do
  tailscale status --json 2>/dev/null | curl -s -m 5 -o /dev/null -X POST -H 'x-ts-token: {token}' -H 'content-type: application/json' --data-binary @- http://{host}/ts-report
  sleep 10
done
EOF
chmod 755 /usr/bin/ts-report
cat >/etc/init.d/ts-report <<'EOF'
#!/bin/sh /etc/rc.common
START=99
USE_PROCD=1
start_service() {{
  procd_open_instance
  procd_set_param command /usr/bin/ts-report
  procd_set_param respawn
  procd_close_instance
}}
EOF
chmod 755 /etc/init.d/ts-report
/etc/init.d/ts-report enable
/etc/init.d/ts-report restart
echo "ts-report 已安装并启动；卸载：/etc/init.d/ts-report disable; /etc/init.d/ts-report stop; rm /etc/init.d/ts-report /usr/bin/ts-report"
"#
    )
}
