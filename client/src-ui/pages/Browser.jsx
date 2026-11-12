// 本地改版：本机网页 → 共享浏览器。服务器上常驻一个无头 Chrome（claude-browser 服务，调试端口 127.0.0.1:9222），
// Claude / Codex 的浏览器工具（Playwright MCP --cdp-endpoint）也连它。这里经网关的 /cdp/ 直接说 Chrome 调试协议：
// 屏幕推流（Page.startScreencast）显示画面，点击、滚动、打字用 Input.* 发回去。登录状态存在浏览器的用户目录里，
// 你在这里登录过的网站，Claude 也能直接用。
import { ArrowLeft, ArrowRight, CornerDownLeft, Delete, Image as ImageIcon, Monitor, Plus, RefreshCw, Send, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Note } from '../shared/ui.jsx';

const LIST_MS = 3000;
const H = { 'x-looklook-client': '1' };

async function cdpHttp(path, method = 'GET') {
  const r = await fetch(`/cdp${path}`, { method, headers: H, credentials: 'same-origin' });
  if (!r.ok) throw new Error(`${r.status}`);
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

/** 一个页面的调试连接：send(method, params) → Promise；on(event, fn) 订阅事件。 */
function connect(id, { onEvent, onClose }) {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/cdp/devtools/page/${id}`);
  let seq = 0;
  const wait = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && wait.has(m.id)) {
      const { ok, fail } = wait.get(m.id);
      wait.delete(m.id);
      if (m.error) fail(new Error(m.error.message));
      else ok(m.result);
    } else if (m.method) onEvent(m.method, m.params);
  };
  ws.onclose = () => {
    for (const { fail } of wait.values()) fail(new Error('closed'));
    wait.clear();
    onClose();
  };
  const send = (method, params = {}) =>
    new Promise((ok, fail) => {
      if (ws.readyState !== WebSocket.OPEN) return fail(new Error('closed'));
      seq += 1;
      wait.set(seq, { ok, fail });
      ws.send(JSON.stringify({ id: seq, method, params }));
    });
  const opened = new Promise((ok, fail) => {
    ws.onopen = ok;
    ws.onerror = fail;
  });
  return { send, opened, close: () => ws.close() };
}

// 特殊键：key、code、windowsVirtualKeyCode
const KEYS = {
  Enter: ['Enter', 'Enter', 13, '\r'],
  Backspace: ['Backspace', 'Backspace', 8],
  Tab: ['Tab', 'Tab', 9],
  Escape: ['Escape', 'Escape', 27],
  ArrowUp: ['ArrowUp', 'ArrowUp', 38],
  ArrowDown: ['ArrowDown', 'ArrowDown', 40],
  ArrowLeft: ['ArrowLeft', 'ArrowLeft', 37],
  ArrowRight: ['ArrowRight', 'ArrowRight', 39],
  Delete: ['Delete', 'Delete', 46],
  PageUp: ['PageUp', 'PageUp', 33],
  PageDown: ['PageDown', 'PageDown', 34],
  Home: ['Home', 'Home', 36],
  End: ['End', 'End', 35],
};

function normalizeUrl(s) {
  const v = s.trim();
  if (!v) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return v;
  if (/^[^\s]+\.[^\s]+$/.test(v) || /^localhost(:\d+)?/.test(v)) return `https://${v}`;
  return `https://www.baidu.com/s?wd=${encodeURIComponent(v)}`;
}

export default function Browser() {
  const { t } = useTranslation();
  const [tabs, setTabs] = useState(null);
  const [error, setError] = useState(null);
  const [current, setCurrent] = useState(null);
  const [frame, setFrame] = useState(null);
  const [url, setUrl] = useState('');
  // 正在改地址栏时，页面跳转不覆盖输入（推流回调里读，用 ref）
  const editing = useRef(false);
  const [text, setText] = useState('');
  const [live, setLive] = useState(false);
  const conn = useRef(null);
  const meta = useRef({ w: 1280, h: 800 });
  const img = useRef(null);
  const drag = useRef(null);
  const view = useRef(null);
  const seen = useRef(null);
  // 远程桌面（KasmVNC，经 /vnc/）或截图推流；记在本机
  const [vnc, setVnc] = useState(() => {
    try {
      return localStorage.getItem('browser.mode') !== 'shot';
    } catch {
      return true;
    }
  });
  const toggleMode = () => {
    setVnc((v) => {
      try {
        localStorage.setItem('browser.mode', v ? 'shot' : 'vnc');
      } catch {}
      return !v;
    });
  };

  // 标签页列表：Claude 新开的标签也会出现；当前的没了就换到第一个
  const loadTabs = useCallback(async () => {
    try {
      const list = (await cdpHttp('/json/list')).filter((x) => x.type === 'page');
      setTabs(list);
      setError(null);
      // 网页里新开的标签（比如点视频弹出新页）自动跟过去
      const fresh = seen.current ? list.find((x) => !seen.current.has(x.id)) : null;
      seen.current = new Set(list.map((x) => x.id));
      setCurrent((c) => fresh?.id ?? (c && list.some((x) => x.id === c) ? c : (list[0]?.id ?? null)));
    } catch (e) {
      setError(e);
    }
  }, []);
  useEffect(() => {
    loadTabs();
    const iv = setInterval(loadTabs, LIST_MS);
    return () => clearInterval(iv);
  }, [loadTabs]);

  // 连上当前标签，开始推流
  useEffect(() => {
    if (!current) return undefined;
    let alive = true;
    let retry = null;
    const start = () => {
      const c = connect(current, {
        onEvent: (m, p) => {
          if (m === 'Page.screencastFrame') {
            c.send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {});
            meta.current = { w: p.metadata.deviceWidth, h: p.metadata.deviceHeight };
            setFrame(`data:image/jpeg;base64,${p.data}`);
          } else if (m === 'Page.frameNavigated' && !p.frame.parentId) {
            if (!editing.current) setUrl(p.frame.url);
          }
        },
        onClose: () => {
          setLive(false);
          if (alive) retry = setTimeout(start, 2000);
        },
      });
      conn.current = c;
      c.opened
        .then(async () => {
          setLive(true);
          // 后台标签不处理点击，切过来时调到前台
          await c.send('Page.bringToFront').catch(() => {});
          await c.send('Page.enable');
          const { frameTree } = await c.send('Page.getFrameTree');
          setUrl(frameTree.frame.url);
          // 按画面实际显示宽度推流，手机上帧小很多，走 Tailscale 不卡
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          const w = Math.min(1600, Math.round((view.current?.clientWidth || 800) * dpr));
          if (vnc) return;
          await c.send('Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth: w, maxHeight: w });
        })
        .catch(() => {});
    };
    start();
    return () => {
      alive = false;
      clearTimeout(retry);
      conn.current?.close();
      conn.current = null;
      setFrame(null);
    };
  }, [current, vnc]);

  const send = (m, p) => conn.current?.send(m, p).catch(() => {});
  const point = (e) => {
    const r = img.current.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * meta.current.w, y: ((e.clientY - r.top) / r.height) * meta.current.h };
  };
  const mouse = (type, e, extra = {}) => send('Input.dispatchMouseEvent', { type, ...point(e), button: 'left', clickCount: 1, ...extra });

  // 鼠标：照常点击、拖动；手指：轻点是点击，拖动是滚动，按住不动 0.3 秒再拖是鼠标拖动（滑块验证码等）
  const onDown = (e) => {
    img.current.focus({ preventScroll: true });
    try { img.current.setPointerCapture(e.pointerId); } catch {}
    if (e.pointerType === 'touch') {
      const d = { x: e.clientX, y: e.clientY, moved: false, held: false, e };
      d.timer = setTimeout(() => {
        if (d.moved || drag.current !== d) return;
        d.held = true;
        navigator.vibrate?.(15);
        mouse('mousePressed', d.e, { buttons: 1 });
      }, 300);
      drag.current = d;
      return;
    }
    e.preventDefault();
    mouse('mousePressed', e, { buttons: 1 });
  };
  const onMove = (e) => {
    const d = drag.current;
    if (d) {
      if (d.held) {
        mouse('mouseMoved', e, { buttons: 1 });
        return;
      }
      const dx = d.x - e.clientX;
      const dy = d.y - e.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 6) d.moved = true;
      if (d.moved) {
        const r = img.current.getBoundingClientRect();
        const k = meta.current.w / r.width;
        send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point(d.e), deltaX: dx * k, deltaY: dy * k });
        d.x = e.clientX;
        d.y = e.clientY;
      }
      return;
    }
    if (e.pointerType === 'mouse') mouse('mouseMoved', e, e.buttons & 1 ? { buttons: 1 } : { button: 'none', buttons: 0 });
  };
  const onUp = (e) => {
    const d = drag.current;
    drag.current = null;
    if (d) {
      clearTimeout(d.timer);
      if (d.held) mouse('mouseReleased', e, { buttons: 0 });
      else if (!d.moved) {
        mouse('mousePressed', e, { buttons: 1 });
        mouse('mouseReleased', e, { buttons: 0 });
      }
      return;
    }
    mouse('mouseReleased', e, { buttons: 0 });
  };
  const onCancel = (e) => {
    const d = drag.current;
    drag.current = null;
    if (d) clearTimeout(d.timer);
    if (!d || d.held) mouse('mouseReleased', e, { buttons: 0 });
  };
  const onWheel = (e) => {
    send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point(e), deltaX: e.deltaX, deltaY: e.deltaY });
  };
  const key = (name) => {
    const [k, code, vk, txt] = KEYS[name];
    send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, ...(txt ? { text: txt } : {}) });
    send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
  };
  // 电脑上：画面获得焦点后直接打字
  const onKey = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (KEYS[e.key]) {
      e.preventDefault();
      key(e.key);
    } else if (e.key.length === 1) {
      e.preventDefault();
      send('Input.insertText', { text: e.key });
    }
  };
  const sendText = (e) => {
    e?.preventDefault();
    if (!text) return;
    send('Input.insertText', { text });
    setText('');
  };
  const go = (e) => {
    e.preventDefault();
    const u = normalizeUrl(url);
    editing.current = false;
    if (u) send('Page.navigate', { url: u });
  };
  const history = async (step) => {
    const h = await conn.current?.send('Page.getNavigationHistory').catch(() => null);
    const entry = h?.entries[h.currentIndex + step];
    if (entry) send('Page.navigateToHistoryEntry', { entryId: entry.id });
  };
  const newTab = async () => {
    const tab = await cdpHttp('/json/new?about:blank', 'PUT').catch(() => null);
    await loadTabs();
    if (tab) setCurrent(tab.id);
  };
  const closeTab = async (id) => {
    await cdpHttp(`/json/close/${id}`).catch(() => null);
    loadTabs();
  };

  if (error && !tabs) {
    return (
      <div className="stack browser-page">
        <h1>{t('browser.title')}</h1>
        <Note kind="error">{t('browser.down')}</Note>
      </div>
    );
  }
  return (
    <div className="stack browser-page">
      <div className="browser-tabs">
        {(tabs ?? []).map((x) => (
          <span key={x.id} className={`browser-tab ${x.id === current ? 'active' : ''}`}>
            <button type="button" className="ellipsis" onClick={() => setCurrent(x.id)} title={x.url}>
              {x.title || x.url || t('browser.blank')}
            </button>
            {tabs.length > 1 && (
              <button type="button" className="browser-tab-x" onClick={() => closeTab(x.id)} aria-label={t('browser.close_tab')}>
                <X size={13} />
              </button>
            )}
          </span>
        ))}
        <button type="button" className="btn btn-plain btn-icon" onClick={newTab} aria-label={t('browser.new_tab')} title={t('browser.new_tab')}>
          <Plus size={16} />
        </button>
      </div>
      <form className="browser-bar" onSubmit={go}>
        <Button variant="ghost" icon={ArrowLeft} onClick={() => history(-1)} aria-label={t('browser.back')} />
        <Button variant="ghost" icon={ArrowRight} onClick={() => history(1)} aria-label={t('browser.forward')} />
        <Button variant="ghost" icon={RefreshCw} onClick={() => send('Page.reload')} aria-label={t('browser.reload')} />
        <input value={url} onChange={(e) => setUrl(e.target.value)} onFocus={(e) => ((editing.current = true), e.target.select())} onBlur={() => (editing.current = false)} placeholder={t('browser.url')} inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
        <Button variant="ghost" icon={vnc ? Monitor : ImageIcon} onClick={toggleMode} aria-label={t('browser.mode_hint')} title={`${vnc ? t('browser.mode_vnc') : t('browser.mode_shot')} · ${t('browser.mode_hint')}`} />
        <span className={`dot ${live ? 'on' : ''}`} title={live ? t('browser.live') : t('browser.connecting')} />
      </form>
      <div className={`browser-view ${vnc ? 'vnc' : ''}`} ref={view}>
        {vnc ? (
          <iframe src="/vnc/index.html?path=vnc/websockify&autoconnect=1&reconnect=1&resize=scale" title={t('browser.mode_vnc')} allow="clipboard-read; clipboard-write" />
        ) : frame ? (
          <img
            ref={img}
            src={frame}
            alt=""
            tabIndex={0}
            draggable={false}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onCancel}
            onWheel={onWheel}
            onKeyDown={onKey}
            onContextMenu={(e) => e.preventDefault()}
          />
        ) : (
          <p className="muted small">{t('browser.connecting')}</p>
        )}
      </div>
      <form className="browser-type" onSubmit={sendText}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('browser.type')} autoCapitalize="off" autoCorrect="off" />
        <Button variant="ghost" icon={Send} type="submit" aria-label={t('browser.send_text')} />
        <Button variant="ghost" icon={Delete} onClick={() => key('Backspace')} aria-label="Backspace" />
        <Button variant="ghost" icon={CornerDownLeft} onClick={() => key('Enter')} aria-label="Enter" />
      </form>
      <p className="muted small">{t(vnc ? 'browser.note_vnc' : 'browser.note')}</p>
    </div>
  );
}
