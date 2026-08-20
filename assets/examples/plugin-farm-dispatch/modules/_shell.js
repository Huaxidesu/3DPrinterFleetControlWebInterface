/**
 * Shared iframe shell — 深色底跟宿主一致；token 读父窗口 localStorage
 */
function shellCss() {
  return `
:root {
  color-scheme: dark;
  --fd-bg: #0f141c;
  --fd-panel: rgba(255,255,255,.04);
  --fd-border: rgba(255,255,255,.12);
  --fd-text: #e8eaed;
  --fd-muted: rgba(232,234,237,.62);
  --fd-primary: #4096ff;
  --fd-ok: #52c41a;
  --fd-warn: #faad14;
  --fd-err: #ff7875;
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  min-height: 100%;
  background: var(--fd-bg);
  color: var(--fd-text);
}
body {
  font: 13px/1.45 system-ui, -apple-system, "PingFang SC", "Noto Sans SC", sans-serif;
  padding: 12px 14px 28px;
}
h2 { margin: 0 0 4px; font-size: 17px; font-weight: 650; }
.sub { color: var(--fd-muted); font-size: 12px; margin-bottom: 14px; }
.card {
  background: var(--fd-panel);
  border: 1px solid var(--fd-border);
  border-radius: 10px;
  padding: 12px 14px;
  margin-bottom: 10px;
}
.row { display: flex; gap: 8px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
.bar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; align-items: center; }
input, select, textarea, button {
  border-radius: 8px;
  border: 1px solid var(--fd-border);
  background: rgba(255,255,255,.06);
  color: inherit;
  padding: 8px 11px;
  font-size: 13px;
  font-family: inherit;
}
textarea { width: 100%; min-height: 72px; resize: vertical; }
button { cursor: pointer; }
button:disabled { opacity: .45; cursor: not-allowed; }
button.primary { background: rgba(64,150,255,.28); border-color: rgba(64,150,255,.5); }
button.ok { background: rgba(82,196,26,.22); border-color: rgba(82,196,26,.45); }
button.warn { background: rgba(250,173,20,.22); border-color: rgba(250,173,20,.45); }
button.danger { background: rgba(255,120,117,.22); border-color: rgba(255,120,117,.5); }
button.ghost { background: transparent; }
.badge {
  display: inline-block; font-size: 11px; font-weight: 650;
  padding: 2px 8px; border-radius: 999px; background: rgba(255,255,255,.08);
}
.b-err { background: rgba(255,120,117,.22); color: #ffccc7; }
.b-fin { background: rgba(82,196,26,.2); color: #b7eb8f; }
.b-mnt { background: rgba(250,173,20,.22); color: #ffe58f; }
.b-wait { background: rgba(250,173,20,.18); color: #ffe58f; }
.b-print { background: rgba(64,150,255,.22); color: #91caff; }
.b-rej { background: rgba(255,120,117,.18); color: #ffa39e; }
.meta { color: var(--fd-muted); font-size: 12px; line-height: 1.5; }
.empty { text-align: center; color: var(--fd-muted); padding: 36px 8px; }
.err { color: var(--fd-err); margin: 8px 0; }
.tabs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
.tab {
  border-radius: 999px; padding: 6px 12px; font-size: 12px;
  background: transparent; color: var(--fd-muted); border: 1px solid var(--fd-border);
}
.tab.on { color: var(--fd-text); background: rgba(255,255,255,.08); border-color: rgba(255,255,255,.22); }
.swatch {
  width: 12px; height: 12px; border-radius: 50%;
  border: 1px solid rgba(255,255,255,.35); display: inline-block; vertical-align: middle;
}
.grid { display: grid; grid-template-columns: 1.15fr .85fr; gap: 12px; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
@media (max-width: 860px) { .grid, .grid2 { grid-template-columns: 1fr; } }
.sheet-mask {
  position: fixed; inset: 0; background: rgba(0,0,0,.45);
  display: none; align-items: flex-end; justify-content: center; z-index: 20;
}
.sheet-mask.on { display: flex; }
.sheet {
  width: min(560px, 100%); max-height: 82vh; overflow: auto;
  background: #161d27; border: 1px solid var(--fd-border);
  border-radius: 14px 14px 0 0; padding: 14px;
}
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid rgba(255,255,255,.08); vertical-align: top; }
th { opacity: .7; }
code { white-space: pre-wrap; word-break: break-all; font-size: 11px; }
.filebox {
  border: 1px dashed var(--fd-border); border-radius: 10px; padding: 16px; text-align: center;
  cursor: pointer; background: rgba(255,255,255,.03);
}
`
}

function commonJs() {
  return `
var TOKEN_KEY = 'hanye_client_jwt';
function token(){
  try {
    var t = localStorage.getItem(TOKEN_KEY) || '';
    if (t) return t;
    if (window.parent && window.parent !== window) {
      try { t = window.parent.localStorage.getItem(TOKEN_KEY) || ''; } catch (e1) {}
      if (t) return t;
    }
    if (window.top && window.top !== window) {
      try { t = window.top.localStorage.getItem(TOKEN_KEY) || ''; } catch (e2) {}
    }
    return t || '';
  } catch (e) { return ''; }
}
function authHeaders(json){
  var h = { Accept: 'application/json' };
  if (json) h['Content-Type'] = 'application/json';
  var t = token();
  if (t) h.Authorization = 'Bearer ' + t;
  return h;
}
function unwrap(j){
  if (!j || typeof j !== 'object') return j;
  if (j.data && typeof j.data === 'object') {
    var d = j.data;
    if (j.ok === true || d.ok != null || d.roles || d.board || d.jobs || d.logs || d.models || d.records || d.user) return d;
  }
  return j;
}
function apiBase(){
  try {
    if (window.parent && window.parent !== window && window.parent.location && window.parent.location.origin && window.parent.location.origin !== 'null') {
      return window.parent.location.origin;
    }
  } catch (e) {}
  return '';
}
function apiUrl(path){
  if (/^https?:\\/\\//.test(path)) return path;
  var base = apiBase();
  return base ? (base + path) : path;
}
function api(method, path, body){
  var timeout = new Promise(function(_, reject){
    setTimeout(function(){ reject(new Error('请求超时')); }, 15000);
  });
  var req = fetch(apiUrl(path), {
    method: method,
    headers: authHeaders(body != null),
    body: body != null ? JSON.stringify(body) : undefined
  }).then(function(res){
    return res.json().catch(function(){ return { ok:false, message:'响应解析失败' }; }).then(function(j){
      j = unwrap(j);
      if (!res.ok && (!j || j.ok !== false)) j = { ok:false, message:(j && j.message) || ('HTTP '+res.status) };
      return j;
    });
  });
  return Promise.race([req, timeout]).catch(function(e){
    return { ok:false, message: e && e.message ? e.message : String(e) };
  });
}
function esc(s){
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function showErr(el, msg){
  if (!el) return;
  el.innerHTML = '<div class="card"><p class="err">' + esc(msg) + '</p></div>';
}
`
}

module.exports = { shellCss, commonJs }
