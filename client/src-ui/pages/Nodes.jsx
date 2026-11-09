// 本地改版：「节点」页。本机经 mihomo 全局代理（AUTO 组选延迟最低的节点；节点都不可用时直连，kill-switch 开着就断网）。
// 节点来源：粘贴的链接（可以多行）+ 订阅地址。所有请求经网关 /mihomo/ 转给 root 的节点小服务（lk-nodes-helper，
// 127.0.0.1:9091）：读不要口令，改要「节点密码」（只在这个页面的内存里，关掉就忘）。
// 节点的密码、uuid、订阅地址只存在 root 文件里，这里看不到。也兼容旧版小服务（mihomo-panel-helper，没有 /info）。
import { Gauge, Globe, Lock, Network, Pin, PinOff, Plus, RefreshCw, Rss, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button, Card, Modal, Note, PasswordInput, Switch, useConfirm, useToast } from '../shared/ui.jsx';

const H = { 'x-looklook-client': '1' };
const TEST_URL = 'https://www.gstatic.com/generate_204';

async function api(path, { method = 'GET', body, pw } = {}) {
  const headers = { ...H };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (pw) headers['x-panel-password'] = pw;
  const r = await fetch(`/mihomo${path}`, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text };
  }
  if (!r.ok) {
    const e = new Error(data?.message || `HTTP ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return data;
}

// ---------- 节点链接解析（vless / vmess / trojan / ss / hysteria2 / tuic → mihomo 节点） ----------
const dec = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

function b64(s) {
  let t = s.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
  while (t.length % 4) t += '=';
  const bin = atob(t);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function hostPort(s) {
  const m = s.match(/^\[(.+)\]:(\d+)$/) || s.match(/^([^:/]+):(\d+)$/);
  return m ? { host: m[1], port: Number(m[2]) } : { host: s, port: 0 };
}

function split(link) {
  const i = link.indexOf('://');
  if (i < 0) throw new Error('不是节点链接（要以 vless:// ss:// 之类开头）');
  const scheme = link.slice(0, i).toLowerCase();
  let rest = link.slice(i + 3);
  let name = '';
  const h = rest.indexOf('#');
  if (h >= 0) {
    name = dec(rest.slice(h + 1));
    rest = rest.slice(0, h);
  }
  let q = new URLSearchParams();
  const qi = rest.indexOf('?');
  if (qi >= 0) {
    q = new URLSearchParams(rest.slice(qi + 1));
    rest = rest.slice(0, qi);
  }
  rest = rest.replace(/\/+$/, '');
  let user = '';
  const a = rest.lastIndexOf('@');
  if (a >= 0) {
    user = dec(rest.slice(0, a));
    rest = rest.slice(a + 1);
  }
  return { scheme, user, rest, q, name, ...hostPort(rest) };
}

function transport(n, net, { host, path, serviceName, mode }) {
  net = (net || 'tcp').toLowerCase();
  if (net === 'ws') n['ws-opts'] = { path: path || '/', ...(host ? { headers: { Host: host } } : {}) };
  else if (net === 'httpupgrade') {
    net = 'ws';
    n['ws-opts'] = { path: path || '/', 'v2ray-http-upgrade': true, ...(host ? { headers: { Host: host } } : {}) };
  } else if (net === 'grpc') n['grpc-opts'] = { 'grpc-service-name': serviceName || '' };
  else if (net === 'h2' || net === 'http') {
    net = 'h2';
    n['h2-opts'] = { host: host ? [host] : [], path: path || '/' };
  } else if (net === 'xhttp') n['xhttp-opts'] = { path: path || '/', ...(host ? { host } : {}), ...(mode ? { mode } : {}) };
  if (net !== 'tcp' && net !== 'none') n.network = net;
}

function tls(n, q, sniKey = 'servername') {
  const sni = q.get('sni') || q.get('peer');
  if (sni) n[sniKey] = sni;
  if (q.get('fp')) n['client-fingerprint'] = q.get('fp');
  if (q.get('alpn')) n.alpn = q.get('alpn').split(',');
  if (['1', 'true'].includes(q.get('allowInsecure') || q.get('insecure') || '')) n['skip-cert-verify'] = true;
}

export function parseLink(raw) {
  const link = raw.trim();
  const { scheme, user, rest, q, name, host, port } = split(link);
  let n;
  if (scheme === 'vless') {
    n = { type: 'vless', server: host, port, uuid: user, udp: true };
    if (q.get('flow')) n.flow = q.get('flow');
    const sec = q.get('security') || 'none';
    if (sec === 'tls' || sec === 'reality') {
      n.tls = true;
      tls(n, q);
    }
    if (sec === 'reality') {
      n['reality-opts'] = { 'public-key': q.get('pbk') || '', ...(q.get('sid') ? { 'short-id': q.get('sid') } : {}) };
      n['client-fingerprint'] ||= 'chrome';
    }
    transport(n, q.get('type'), { host: q.get('host'), path: q.get('path'), serviceName: q.get('serviceName'), mode: q.get('mode') });
  } else if (scheme === 'trojan') {
    n = { type: 'trojan', server: host, port, password: user, udp: true };
    tls(n, q, 'sni');
    transport(n, q.get('type'), { host: q.get('host'), path: q.get('path'), serviceName: q.get('serviceName') });
  } else if (scheme === 'vmess') {
    const j = JSON.parse(b64(link.slice(8).split('#')[0]));
    n = { type: 'vmess', server: j.add, port: Number(j.port), uuid: j.id, alterId: Number(j.aid) || 0, cipher: j.scy || 'auto', udp: true };
    if (j.tls === 'tls') {
      n.tls = true;
      if (j.sni) n.servername = j.sni;
      if (j.fp) n['client-fingerprint'] = j.fp;
      if (j.alpn) n.alpn = String(j.alpn).split(',');
    }
    transport(n, j.net, { host: j.host, path: j.path, serviceName: j.path });
    return finish(n, j.ps || name);
  } else if (scheme === 'ss') {
    if (q.get('plugin')) throw new Error('带 plugin 的 ss 链接暂不支持');
    let method;
    let password;
    let server = host;
    let p = port;
    if (link.slice(5).split('#')[0].split('?')[0].includes('@')) {
      const cred = user.includes(':') ? user : b64(user);
      [method, ...password] = cred.split(':');
      password = password.join(':');
    } else {
      const whole = b64(rest);
      const at = whole.lastIndexOf('@');
      [method, ...password] = whole.slice(0, at).split(':');
      password = password.join(':');
      ({ host: server, port: p } = hostPort(whole.slice(at + 1)));
    }
    n = { type: 'ss', server, port: p, cipher: method, password, udp: true };
  } else if (scheme === 'hysteria2' || scheme === 'hy2') {
    n = { type: 'hysteria2', server: host, port: port || 443, password: user, udp: true };
    if (q.get('sni')) n.sni = q.get('sni');
    if (['1', 'true'].includes(q.get('insecure') || '')) n['skip-cert-verify'] = true;
    if (q.get('obfs') === 'salamander') {
      n.obfs = 'salamander';
      n['obfs-password'] = q.get('obfs-password') || '';
    }
  } else if (scheme === 'tuic') {
    const [uuid, ...pw] = user.split(':');
    n = {
      type: 'tuic',
      server: host,
      port,
      uuid,
      password: pw.join(':'),
      alpn: (q.get('alpn') || 'h3').split(','),
      'congestion-controller': q.get('congestion_control') || 'bbr',
      'udp-relay-mode': q.get('udp_relay_mode') || 'native',
      udp: true,
    };
    if (q.get('sni')) n.sni = q.get('sni');
    if (['1', 'true'].includes(q.get('allow_insecure') || q.get('insecure') || '')) n['skip-cert-verify'] = true;
  } else {
    throw new Error(`不支持 ${scheme}://（支持 vless、vmess、trojan、ss、hysteria2、tuic）`);
  }
  return finish(n, name);
}

function finish(n, name) {
  if (!n.server || !n.port) throw new Error('链接里没找到地址或端口');
  if (n.server.includes(':')) throw new Error('暂不支持 IPv6 地址的节点');
  n.name = (name || `${n.type}-${n.server}`).trim().slice(0, 64);
  for (const k of Object.keys(n)) if (n[k] === '' || n[k] === undefined) delete n[k];
  return { name: n.name, ...n };
}

const isIPv4 = (s) => /^(\d{1,3})(\.\d{1,3}){3}$/.test(s) && s.split('.').every((x) => Number(x) <= 255);

/** 域名 → IPv4（经 mihomo 的 DNS，走代理），并把原域名补到 SNI / Host 上，TLS 才不会失败。 */
async function pinIp(n) {
  if (isIPv4(n.server)) return { node: n, from: null };
  const domain = n.server;
  const r = await api(`/dns?name=${encodeURIComponent(domain)}&type=A`);
  const ip = (r?.Answer || []).find((a) => a.type === 1 && isIPv4(a.data))?.data;
  if (!ip) throw new Error(`解析不到 ${domain} 的 IPv4 地址`);
  const m = { ...n, server: ip };
  if (m.tls && !m.servername && m.type !== 'trojan') m.servername = domain;
  if (['trojan', 'hysteria2', 'tuic'].includes(m.type) && !m.sni) m.sni = domain;
  if (m['ws-opts'] && !m['ws-opts'].headers?.Host) m['ws-opts'] = { ...m['ws-opts'], headers: { Host: domain } };
  return { node: m, from: domain };
}

// ---------- 国家 / 时区（helper 按节点服务器 IP 查，缓存一天） ----------
const flag = (cc) => (/^[A-Z]{2}$/.test(cc || '') ? String.fromCodePoint(...[...cc].map((c) => 0x1f1a5 + c.charCodeAt(0))) : '');
let regionNames = null;
const countryName = (cc) => {
  try {
    regionNames ??= new Intl.DisplayNames(['zh-CN'], { type: 'region' });
    return regionNames.of(cc) || cc;
  } catch {
    return cc;
  }
};
/** 那个时区现在几点、UTC 偏移（按浏览器的时区库算，夏令时也对） */
function tzNow(tz, now) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'shortOffset' }).formatToParts(now);
    const get = (t) => parts.find((x) => x.type === t)?.value || '';
    const off = get('timeZoneName').replace('GMT', 'UTC');
    return `${get('hour')}:${get('minute')} ${off === 'UTC' ? 'UTC+0' : off}`;
  } catch {
    return '';
  }
}
function Geo({ g, now }) {
  if (g === undefined) return null;
  if (!g) return <span className="muted small nodes-geo">位置未知</span>;
  return (
    <span className="muted small nodes-geo" title={g.tz || ''}>
      {flag(g.code)} {countryName(g.code)}
      {g.tz && <span className="nodes-tz"> · {g.tz}</span>}
      {g.tz ? ` · ${tzNow(g.tz, now)}` : ''}
    </span>
  );
}

// ---------- 页面 ----------
function NetCard({ net, now, onRefresh }) {
  const e = net.exit;
  const v6 = net.ipv6 || {};
  const v6off = v6.mihomo === false && (v6.disabled || !v6.global_addrs);
  return (
    <Card title="出口" actions={<Button variant="ghost" icon={RefreshCw} onClick={onRefresh} aria-label="重新查询出口" title="重新查询出口" />}>
      <dl className="nodes-net">
        <dt>出口 IP</dt>
        <dd>{!e ? <span className="muted">查询中…</span> : e.error ? <span className="node-bad">{e.error}</span> : <b className="mono">{e.ip}</b>}</dd>
        {e && !e.error && (
          <>
            <dt>国家</dt>
            <dd>
              {flag(e.code)} {countryName(e.code)}
              {e.city ? ` · ${e.city}` : ''}
              {e.isp ? <span className="muted small"> · {e.isp}</span> : null}
            </dd>
            <dt>时区</dt>
            <dd>{e.tz ? `${e.tz} · ${tzNow(e.tz, now)}` : '—'}</dd>
          </>
        )}
        <dt>代理模式</dt>
        <dd>
          {!net.rules ? (
            <span className="muted">—</span>
          ) : net.rules.global ? (
            <>
              <span className="node-good">全局代理</span>
              <span className="muted small"> · 除局域网外全部走 {net.rules.final}</span>
            </>
          ) : (
            <>
              <span className="node-warn">按规则分流</span>
              <span className="muted small"> · {net.rules.count} 条规则，其余走 {net.rules.final || '—'}</span>
            </>
          )}
        </dd>
        <dt>局域网</dt>
        <dd>
          {!e?.lan || e.lan.ok === null ? (
            <span className="muted">—</span>
          ) : e.lan.ok ? (
            <span>通</span>
          ) : (
            <span className="node-good">不通</span>
          )}
          {e?.lan?.gateway && <span className="muted small"> · 本机主动连网关 {e.lan.gateway}{e.lan.ok === false ? ' 被拦（别人连进来不受影响）' : ''}</span>}
        </dd>
        <dt>TUN 模式</dt>
        <dd>
          {!net.tun ? <span className="muted">—</span> : net.tun.enable ? <span className="node-good">已开启</span> : <span className="node-bad">未开启</span>}
          {net.tun?.enable && <span className="muted small"> · {[net.tun.device, net.tun.stack, net.mode && `${net.mode} 模式`].filter(Boolean).join(' · ')}</span>}
        </dd>
        <dt>IPv6</dt>
        <dd>
          {v6off ? <span className="node-good">已关闭</span> : <span className="node-warn">未完全关闭</span>}
          <span className="muted small">
            {' '}
            · mihomo {v6.mihomo === false ? '关' : v6.mihomo ? '开' : '—'} · 系统 {v6.disabled ? '已禁用' : `开（${v6.global_addrs || 0} 个公网地址）`}
          </span>
        </dd>
      </dl>
    </Card>
  );
}

function Delay({ v }) {
  if (v === undefined || v === null) return <span className="muted">—</span>;
  if (v === 'testing') return <span className="muted">测速中…</span>;
  if (!v) return <span className="node-bad">超时</span>;
  return <span className={v < 300 ? 'node-good' : 'node-warn'}>{v} ms</span>;
}

const GB = 1024 ** 3;
const size = (b) => (b >= GB ? `${(b / GB).toFixed(b >= 100 * GB ? 0 : 1)} GB` : `${Math.round(b / 1024 ** 2)} MB`);
function SubInfo({ info }) {
  if (!info) return null;
  const used = (info.Upload || 0) + (info.Download || 0);
  const parts = [];
  if (info.Total) parts.push(`已用 ${size(used)} / ${size(info.Total)}`);
  if (info.Expire) parts.push(`${new Date(info.Expire * 1000).toLocaleDateString('zh-CN')} 到期`);
  return parts.length ? <span className="muted small"> · {parts.join(' · ')}</span> : null;
}

/** 一次最多同时测这么多个，订阅里节点多时不至于一下打出几百个连接 */
async function pool(items, n, fn) {
  const q = [...items];
  await Promise.all(Array.from({ length: Math.min(n, q.length) }, async () => {
    while (q.length) await fn(q.shift());
  }));
}

const isSubUrl = (s) => /^https?:\/\//i.test(s.trim());

export default function Nodes() {
  const toast = useToast();
  const confirm = useConfirm();
  const pw = useRef('');
  const [ask, setAsk] = useState(null); // { resolve }
  const [pwInput, setPwInput] = useState('');
  const [info, setInfo] = useState(undefined); // undefined = 还没读；null = 旧版节点服务
  const [group, setGroup] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [providers, setProviders] = useState(null);
  const [delays, setDelays] = useState({});
  const [error, setError] = useState(null);
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState([]);
  const [parseErr, setParseErr] = useState(null);
  const [subName, setSubName] = useState('');
  const [busy, setBusy] = useState(false);
  const [geo, setGeo] = useState({});
  const [net, setNet] = useState(null);
  const [now, setNow] = useState(() => new Date());

  const loadNet = (refresh) => api(`/net${refresh ? '?refresh=1' : ''}`).then(setNet, () => {});
  const load = async () => {
    try {
      const inf = await api('/info').catch((e) => (e.status === 404 ? null : Promise.reject(e)));
      const [g, n, p] = await Promise.all([api('/group'), api('/nodes'), inf ? api('/providers') : null]);
      setInfo(inf);
      setGroup(g);
      setNodes(n.nodes || []);
      setProviders(p?.providers || null);
      setError(null);
      api('/geo').then((r) => setGeo(r?.geo || {}), () => {});
      if (inf) loadNet();
    } catch (e) {
      setError(e);
    }
  };
  useEffect(() => {
    load();
    const id = setInterval(load, 10000);
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => (clearInterval(id), clearInterval(t));
  }, []);

  const test = async (name) => {
    setDelays((d) => ({ ...d, [name]: 'testing' }));
    try {
      const r = await api(`/proxies/${encodeURIComponent(name)}/delay?timeout=5000&url=${encodeURIComponent(TEST_URL)}`);
      setDelays((d) => ({ ...d, [name]: r?.delay || 0 }));
    } catch {
      setDelays((d) => ({ ...d, [name]: 0 }));
    }
  };
  const all = (group?.all ?? []).filter((n) => !['COMPATIBLE', 'DIRECT', 'REJECT'].includes(n));
  const testAll = () => pool(all, 8, test);
  useEffect(() => {
    // 节点少时打开页面自动测一遍；多时用 mihomo 自己定时测的结果
    if (all.length && all.length <= 30 && !Object.keys(delays).length) testAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all.length]);

  /** 需要口令的操作：先用记住的口令，不对或没有就弹窗问。 */
  const withPw = async (fn) => {
    for (;;) {
      if (!pw.current) {
        const got = await new Promise((resolve) => setAsk({ resolve }));
        if (!got) return undefined;
        pw.current = got;
      }
      try {
        return await fn(pw.current);
      } catch (e) {
        if (e.status === 403) {
          pw.current = '';
          toast('节点密码不对');
          continue;
        }
        throw e;
      }
    }
  };
  const submitPw = (e) => {
    e.preventDefault();
    ask?.resolve(pwInput);
    setAsk(null);
    setPwInput('');
  };

  const act = async (fn, ok) => {
    setBusy(true);
    try {
      const r = await withPw(fn);
      if (r !== undefined) {
        if (ok) toast(typeof ok === 'function' ? ok(r) : ok);
        await load();
      }
      return r;
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  };

  const select = (name) => act((p) => api('/select', { method: 'PUT', body: { name }, pw: p }), `已固定使用 ${name}`);
  const unpin = () => act((p) => api('/select', { method: 'DELETE', pw: p }), '已恢复自动切换');
  const remove = async (name) => {
    if (!(await confirm({ title: `删除节点「${name}」？`, confirm: '删除', danger: true }))) return;
    act((p) => api(`/nodes/${encodeURIComponent(name)}`, { method: 'DELETE', pw: p }), `已删除 ${name}`);
  };
  const removeSub = async (s) => {
    if (!(await confirm({ title: `删除订阅「${s.name}」？`, body: '订阅里的节点会一起移除。', confirm: '删除', danger: true }))) return;
    act((p) => api(`/subs/${s.id}`, { method: 'DELETE', pw: p }), `已删除订阅 ${s.name}`);
  };
  const updateSub = (s) => act((p) => api(`/subs/${s.id}/update`, { method: 'POST', pw: p }), `订阅 ${s.name} 已更新`);
  const setKill = async (on) => {
    const ok = await confirm(
      on
        ? { title: '打开 kill-switch？', body: '打开后，这台机器只能经节点上网（局域网不受影响）；所有节点都不可用时直接断网，不会漏出真实 IP。', confirm: '打开' }
        : { title: '关闭 kill-switch？', body: '关闭后，所有节点都不可用时会直接连网（暴露真实 IP）。', confirm: '关闭', danger: true },
    );
    if (ok) act((p) => api('/settings', { method: 'PUT', body: { kill_switch: on }, pw: p }), on ? 'kill-switch 已打开' : 'kill-switch 已关闭');
  };

  const onText = (v) => {
    setText(v);
    setParseErr(null);
    setParsed([]);
    const lines = v.split(/\s+/).filter(Boolean);
    if (!lines.length || (info && lines.length === 1 && isSubUrl(lines[0]))) return;
    const out = [];
    for (const l of lines) {
      try {
        out.push(parseLink(l));
      } catch (e) {
        setParseErr(lines.length > 1 ? `${l.slice(0, 40)}…：${e.message}` : e.message);
        return;
      }
    }
    setParsed(out);
  };
  const isSub = Boolean(info) && isSubUrl(text) && !/\s/.test(text.trim());
  const reset = () => (setText(''), setParsed([]), setSubName(''));
  const add = () =>
    act(
      async (p) => {
        let list = parsed;
        if (!info) list = [(await pinIp(parsed[0])).node]; // 旧版节点服务只收 IPv4
        const r = await api('/nodes', { method: 'POST', body: info ? list : list[0], pw: p });
        reset();
        setTimeout(() => pool(list.map((n) => n.name), 8, test), 1500);
        return r;
      },
      () => (parsed.length > 1 ? `已添加 ${parsed.length} 个节点` : '已添加'),
    );
  const addSub = () =>
    act(async (p) => {
      const r = await api('/subs', { method: 'POST', body: { url: text.trim(), name: subName.trim() }, pw: p });
      reset();
      return r;
    }, '已添加订阅，正在拉取节点…');

  const byName = Object.fromEntries(nodes.map((n) => [n.name, n]));
  const fixed = group?.fixed;
  const out = group?.out;
  const known = Object.fromEntries((providers || []).flatMap((p) => p.nodes.map((n) => [n.name, n.delay])));

  const row = (name, { manual, sub }) => {
    const n = byName[name];
    return (
      <li key={name} className={name === group.now && out !== 'DIRECT' && out !== 'REJECT' ? 'now' : ''}>
        <div className="nodes-name">
          <b className="ellipsis">{name}</b>
          <span className="muted small">{name === 'private-node' ? '主节点 · 写在配置里' : n && manual ? `${n.type} · ${n.server}:${n.port}` : sub ? sub : ''}</span>
          {manual && <Geo g={geo[name]} now={now} />}
        </div>
        <span className="nodes-delay">
          <Delay v={delays[name] ?? (known[name] || undefined)} />
        </span>
        <span className="nodes-acts">
          <Button variant="ghost" size="sm" icon={Gauge} onClick={() => test(name)} aria-label="测速" title="测速" />
          <Button variant="ghost" size="sm" icon={Pin} disabled={busy || name === fixed} onClick={() => select(name)} aria-label="固定使用" title="固定使用" />
          {manual && name !== 'private-node' && <Button variant="ghost" size="sm" icon={Trash2} disabled={busy} onClick={() => remove(name)} aria-label="删除" title="删除" />}
        </span>
      </li>
    );
  };

  let nowText = group?.now;
  if (out === 'DIRECT') nowText = '直连（没有可用节点）';
  else if (out === 'REJECT') nowText = '已断网（没有可用节点，kill-switch 开着）';

  return (
    <div className="stack nodes-page">
      <h1>节点</h1>
      {error && <Note kind="error">连不上节点服务：{error.message}。在服务器上确认节点服务在运行（sudo systemctl status lk-nodes lk-mihomo）。</Note>}
      {net && <NetCard net={net} now={now} onRefresh={() => (setNet({ ...net, exit: null }), loadNet(true))} />}
      {group && (
        <Card
          title="正在使用"
          actions={
            <>
              <Button variant="ghost" icon={Gauge} onClick={testAll}>
                全部测速
              </Button>
              <Button variant="ghost" icon={RefreshCw} onClick={load} aria-label="刷新" />
            </>
          }
        >
          <p className="nodes-now">
            <Network size={18} aria-hidden="true" /> <b>{nowText}</b>
            <span className="muted small">{fixed ? '手动固定' : info && info.mode !== 'fallback' ? '自动（选延迟最低的节点）' : '自动（排在前面的优先，挂了按顺序切到下一个）'}</span>
            {fixed && (
              <Button variant="ghost" size="sm" icon={PinOff} busy={busy} onClick={unpin}>
                恢复自动
              </Button>
            )}
          </p>
          {!all.length && <p className="muted">还没有节点。在下面粘贴节点链接或订阅地址。</p>}
          {providers && (() => {
            // 写在 mihomo 配置里、不属于任何节点源的节点（例如主节点）
            const inSrc = new Set(providers.flatMap((p) => p.nodes.map((n) => n.name)));
            const fixedNodes = all.filter((n) => !inSrc.has(n));
            return fixedNodes.length > 0 && (
              <section className="nodes-src">
                <h3 className="nodes-src-head">配置里的节点</h3>
                <ul className="nodes-list">{fixedNodes.map((n) => row(n, { manual: true }))}</ul>
              </section>
            );
          })()}
          {providers ? (
            providers.map((p) =>
              p.key === 'local' ? (
                p.nodes.length > 0 && (
                  <section key={p.key} className="nodes-src">
                    <h3 className="nodes-src-head">手动添加</h3>
                    <ul className="nodes-list">{p.nodes.map((n) => row(n.name, { manual: true }))}</ul>
                  </section>
                )
              ) : (
                <section key={p.key} className="nodes-src">
                  <h3 className="nodes-src-head">
                    <span>
                      <Rss size={15} aria-hidden="true" /> {p.name}
                      <span className="muted small">
                        {' '}
                        · {p.host} · {p.nodes.length} 个节点
                      </span>
                      <SubInfo info={p.info} />
                    </span>
                    <span className="nodes-acts">
                      <Button variant="ghost" size="sm" icon={RefreshCw} disabled={busy} onClick={() => updateSub(p)} aria-label="更新订阅" title="更新订阅" />
                      <Button variant="ghost" size="sm" icon={Trash2} disabled={busy} onClick={() => removeSub(p)} aria-label="删除订阅" title="删除订阅" />
                    </span>
                  </h3>
                  {p.error && <Note kind="error">上次更新失败：{p.error}</Note>}
                  {p.nodes.length ? (
                    <ul className="nodes-list">{p.nodes.map((n) => row(n.name, { sub: n.type }))}</ul>
                  ) : (
                    <p className="muted small">还没拉到节点（订阅地址打不开或格式不对时也会这样），可以点右边的刷新重试。</p>
                  )}
                </section>
              ),
            )
          ) : (
            <ul className="nodes-list">{all.map((name) => row(name, { manual: true }))}</ul>
          )}
        </Card>
      )}

      <Card title={info ? '添加节点或订阅' : '添加备用节点'}>
        <textarea
          className="nodes-link"
          rows={3}
          value={text}
          onChange={(e) => onText(e.target.value)}
          placeholder={info ? '粘贴节点链接（可以多行，一行一个）或订阅地址 https://…' : '粘贴节点链接：vless:// vmess:// trojan:// ss:// hysteria2:// tuic://'}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
        {parseErr && <Note kind="error">{parseErr}</Note>}
        {isSub && (
          <div className="nodes-preview">
            <label>
              订阅名字（可不填）
              <input value={subName} maxLength={32} placeholder={(() => { try { return new URL(text.trim()).hostname; } catch { return ''; } })()} onChange={(e) => setSubName(e.target.value)} />
            </label>
            <p className="muted small">每 6 小时自动更新；流量、到期时间（订阅提供的话）会显示在上面。</p>
            <Button icon={Plus} busy={busy} onClick={addSub}>
              保存订阅
            </Button>
          </div>
        )}
        {parsed.length === 1 && (
          <div className="nodes-preview">
            <label>
              名字
              <input value={parsed[0].name} maxLength={64} onChange={(e) => setParsed([{ ...parsed[0], name: e.target.value }])} />
            </label>
            <p className="muted small">
              {parsed[0].type} · {parsed[0].server}:{parsed[0].port}
              {parsed[0].network ? ` · ${parsed[0].network}` : ''}
              {parsed[0]['reality-opts'] ? ' · reality' : parsed[0].tls ? ' · tls' : ''}
              {!info && !isIPv4(parsed[0].server) && ' · 保存时会把域名解析成 IP（防火墙按 IP 放行）'}
            </p>
            <Button icon={Plus} busy={busy} onClick={add}>
              保存
            </Button>
          </div>
        )}
        {parsed.length > 1 && (
          <div className="nodes-preview">
            <ul className="nodes-parsed">
              {parsed.map((n, i) => (
                <li key={i}>
                  <b>{n.name}</b> <span className="muted small">{n.type} · {n.server}:{n.port}</span>
                </li>
              ))}
            </ul>
            <Button icon={Plus} busy={busy} onClick={add} disabled={!info}>
              {info ? `保存 ${parsed.length} 个节点` : '旧版节点服务一次只能加一个'}
            </Button>
          </div>
        )}
        <p className="muted small">
          <Lock size={13} aria-hidden="true" /> 添加、删除、切换节点要输「节点密码」（安装时设置的）。节点的密码、uuid 和订阅地址只存在服务器的 root 文件里，这个页面看不到。
        </p>
      </Card>

      {typeof info?.kill_switch === 'boolean' && (
        <Card title="kill-switch">
          <div className="nodes-kill">
            <div>
              <b>{info.kill_switch ? '已打开' : '已关闭'}</b>
              <p className="muted small">
                {info.kill_switch
                  ? '只能经节点上网，所有节点都不可用时断网（局域网、SSH 不受影响），不会漏出真实 IP。'
                  : '所有节点都不可用时直接连网。打开后，没有可用节点就断网，不会漏出真实 IP。'}
              </p>
            </div>
            <Switch checked={info.kill_switch} disabled={busy} onChange={setKill} label="kill-switch" />
          </div>
        </Card>
      )}

      <Modal open={Boolean(ask)} onClose={() => (ask?.resolve(''), setAsk(null))} title="输入节点密码">
        <form onSubmit={submitPw} className="stack">
          <PasswordInput id="node-pw" value={pwInput} onChange={(e) => setPwInput(e.target.value)} autoFocus autoComplete="current-password" />
          <p className="muted small">安装时你设置的那个密码。在这个页面里记住，关掉页面就忘。</p>
          <div className="modal-actions">
            <Button type="submit">确定</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
