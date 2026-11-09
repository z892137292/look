//! 本地改版：管理台「节点」页 → 本机节点小服务（mihomo-panel-helper，root 运行，127.0.0.1:9091）。
//!
//! 节点文件、mihomo 密钥都只有 root 能读；加/删/切换节点要「节点密码」（请求头 X-Panel-Password，
//! 由小服务比对）。这里只是转发，不存任何密钥，也碰不到防火墙。
//!
//! 权限同 `/cdp`：只给直接入口，必须带 `x-looklook-client: 1`。

use axum::extract::{Request, State};
use axum::http::header;
use axum::response::{IntoResponse, Response};

use super::{proxy, Access, App, CLIENT_HEADER};
use crate::error::LocalError;

const PORT: u16 = 9091;

pub async fn handle(State(app): State<App>, mut req: Request) -> Response {
    let access = req.extensions().get::<Access>().cloned().unwrap_or(Access::Local);
    if !access.is_local() {
        return LocalError::new("REMOTE_FORBIDDEN").into_response();
    }
    if req.headers().get(CLIENT_HEADER).and_then(|v| v.to_str().ok()) != Some("1") {
        return LocalError::new("CSRF_FAILED").into_response();
    }
    let pq = req.uri().path_and_query().map(|p| p.as_str()).unwrap_or("/mihomo/");
    let Ok(uri) = pq.strip_prefix("/mihomo").filter(|r| !r.is_empty()).unwrap_or("/").parse() else {
        return axum::http::StatusCode::BAD_REQUEST.into_response();
    };
    *req.uri_mut() = uri;
    req.headers_mut().remove(header::ORIGIN);
    req.headers_mut().remove(header::COOKIE);
    let opts = proxy::Opts { auth: None, host: Some(format!("127.0.0.1:{PORT}")), inject: None, rewrite_location: None, terminal: false };
    proxy::forward(&app.http, req, PORT, opts).await
}
