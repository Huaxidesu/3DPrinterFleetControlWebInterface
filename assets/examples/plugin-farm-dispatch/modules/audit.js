const { shellCss, commonJs } = require('./_shell')

/** 侧栏：派单审核（PC） */
module.exports = async function audit() {
  return {
    __html: `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>派单审核</title>
<style>${shellCss()}</style>
</head>
<body>
<div id="app"><div class="empty">加载中…</div></div>
<script>
(function(){
${commonJs()}
var state = { me:null, jobs:[], tab:'pending_audit', selected:null };

function statusBadge(s){
  var map = {
    pending_audit:['待审核','b-wait'], approved:['已通过',''], waiting_material:['等换料','b-wait'],
    printing:['已派打','b-print'], rejected:['已驳回','b-rej'], failed:['派单失败','b-rej']
  };
  var m = map[s] || [s,''];
  return '<span class="badge '+m[1]+'">'+m[0]+'</span>';
}

function deny(msg){
  document.getElementById('app').innerHTML = '<div class="card"><h2>派单审核</h2><p class="err">'+esc(msg)+
    '</p><p class="meta">请加入用户组「审核」，或勾选 plugin.farm_dispatch.audit</p></div>';
}

async function boot(){
  if (!token()) return deny('未登录：请先在监控台登录');
  var me = await api('GET','/api/v1/farm-dispatch/me');
  if (!me || !me.ok) return deny((me && me.message) || '无法获取身份');
  if (!me.roles || !me.roles.audit) return deny('当前账号不是审核岗');
  state.me = me;
  await refresh();
}

async function refresh(){
  var j = await api('GET','/api/v1/farm-dispatch/jobs?limit=200');
  if (!j || !j.ok) {
    document.getElementById('app').innerHTML = '<div class="err">'+esc((j&&j.message)||'加载失败')+'</div>';
    return;
  }
  state.jobs = j.jobs || [];
  if (state.selected) state.selected = state.jobs.find(function(x){ return x.id === state.selected.id; }) || null;
  render();
}

function filtered(){
  if (!state.tab) return state.jobs;
  return state.jobs.filter(function(j){ return j.status === state.tab; });
}

function render(){
  var u = state.me.user || {};
  var tabs = [['pending_audit','待审核'],['waiting_material','等换料'],['printing','已派打'],['rejected','已驳回'],['','全部']];
  document.getElementById('app').innerHTML =
    '<div class="row"><div><h2>派单审核</h2><div class="sub">'+esc(u.displayName||u.username||'')+
    ' · 通过后按机型 / 材料 / 颜色智能派单</div></div>' +
    '<button class="ghost" id="reload">刷新</button></div>' +
    '<div class="tabs">' + tabs.map(function(t){
      return '<button class="tab'+(state.tab===t[0]?' on':'')+'" data-tab="'+t[0]+'">'+t[1]+'</button>';
    }).join('') + '</div><div class="grid"><div id="list"></div><div id="detail"></div></div>';
  document.getElementById('reload').onclick = refresh;
  Array.prototype.forEach.call(document.querySelectorAll('[data-tab]'), function(el){
    el.onclick = function(){ state.tab = el.getAttribute('data-tab'); renderList(); renderDetail(); };
  });
  renderList(); renderDetail();
}

function renderList(){
  var el = document.getElementById('list');
  var list = filtered();
  if (!list.length) { el.innerHTML = '<div class="card empty">暂无任务</div>'; return; }
  el.innerHTML = list.map(function(j){
    var on = state.selected && state.selected.id === j.id;
    return '<div class="card" data-id="'+esc(j.id)+'" style="cursor:pointer'+(on?';outline:1px solid var(--fd-primary)':'')+'">' +
      '<div class="row"><strong>'+esc(j.filename)+'</strong>'+statusBadge(j.status)+'</div>' +
      '<div class="meta">申请人 '+esc(j.applicantName)+' · '+esc(j.createdAt)+
      '<br>机型 '+esc(j.model)+' · '+esc(j.material)+' · '+esc(j.color||j.colorHex)+
      (j.rejectReason?'<br><span style="color:var(--fd-err)">驳回：'+esc(j.rejectReason)+'</span>':'') +
      (j.waitReason?'<br><span style="color:var(--fd-warn)">'+esc(j.waitReason)+'</span>':'') +
      '</div></div>';
  }).join('');
  Array.prototype.forEach.call(el.querySelectorAll('[data-id]'), function(c){
    c.onclick = function(){
      state.selected = state.jobs.find(function(x){ return x.id === c.getAttribute('data-id'); });
      renderList(); renderDetail();
    };
  });
}

function renderDetail(){
  var el = document.getElementById('detail');
  var j = state.selected;
  if (!j) { el.innerHTML = '<div class="card empty">选择左侧任务</div>'; return; }
  el.innerHTML = '<div class="card"><h2 style="font-size:15px">任务详情</h2>' +
    '<div class="meta">ID '+esc(j.id)+'<br>状态 '+statusBadge(j.status)+
    '<br>文件 '+esc(j.filename)+
    '<br>机型 '+esc(j.model)+' / 材料 '+esc(j.material)+' / 颜色 '+esc(j.color||j.colorHex)+
    '<br>申请人 '+esc(j.applicantName)+
    (j.deviceName?'<br>已派设备 '+esc(j.deviceName):'') +
    (j.note?'<br>备注 '+esc(j.note):'') +
    (j.rejectReason?'<br><b style="color:var(--fd-err)">驳回原因：'+esc(j.rejectReason)+'</b>':'') +
    (j.waitReason?'<br><b style="color:var(--fd-warn)">'+esc(j.waitReason)+'</b>':'') +
    '</div>' +
    (j.status==='pending_audit'
      ? '<div style="margin-top:12px"><button class="ok" id="approve">通过并智能派单</button></div>' +
        '<div class="meta" style="margin-top:12px">驳回原因（必填）</div>' +
        '<textarea id="reason" placeholder="说明为什么驳回，申请人可见"></textarea>' +
        '<button class="danger" id="reject">驳回</button>'
      : '') +
    (['waiting_material','failed','approved'].indexOf(j.status)>=0
      ? '<div style="margin-top:12px"><button class="primary" id="redispatch">重新智能派单</button></div>'
      : '') + '</div>';
  var a = document.getElementById('approve');
  if (a) a.onclick = async function(){
    a.disabled = true;
    var r = await api('POST','/api/v1/farm-dispatch/job/approve',{ id:j.id });
    alert(r.ok ? (r.dispatch && r.dispatch.waiting ? '已通过，暂无匹配机，已通知巡查换料' : '已通过并派单') : (r.message||'失败'));
    await refresh();
  };
  var rj = document.getElementById('reject');
  if (rj) rj.onclick = async function(){
    var reason = (document.getElementById('reason').value||'').trim();
    if (!reason) return alert('请填写驳回原因');
    var r = await api('POST','/api/v1/farm-dispatch/job/reject',{ id:j.id, reason:reason });
    alert(r.ok?'已驳回':(r.message||'失败'));
    await refresh();
  };
  var rd = document.getElementById('redispatch');
  if (rd) rd.onclick = async function(){
    var r = await api('POST','/api/v1/farm-dispatch/job/redispatch',{ id:j.id });
    alert(r.ok?'已触发重新派单':(r.message||'失败'));
    await refresh();
  };
}

boot().catch(function(e){ deny(String(e && e.message ? e.message : e)); });
})();
</script>
</body>
</html>`
  }
}
