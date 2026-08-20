const { shellCss, commonJs } = require('./_shell')

module.exports = async function logs() {
  return {
    __html: `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>派单日志</title>
<style>${shellCss()}</style>
</head>
<body>
<h2>派单操作日志</h2>
<div class="sub">巡查 / 审核 / 派单 / 拦截等全部操作记录</div>
<div class="bar"><button class="primary" id="r">刷新</button></div>
<div id="box" class="card">加载中…</div>
<script>
(function(){
${commonJs()}
async function load(){
  var box = document.getElementById('box');
  var j = await api('GET','/api/v1/farm-dispatch/logs?limit=300');
  if (!j || !j.ok) { box.innerHTML = '<div class="err">'+esc((j&&j.message)||'加载失败')+'</div>'; return; }
  var rows = j.logs || [];
  if (!rows.length) { box.textContent = '暂无日志'; return; }
  box.innerHTML = '<table><thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>详情</th></tr></thead><tbody>' +
    rows.map(function(r){
      return '<tr><td>'+esc(r.at)+'</td><td>'+esc(r.actorName)+'</td><td>'+esc(r.action)+
        '</td><td><code>'+esc(JSON.stringify(r.detail||{}))+'</code></td></tr>';
    }).join('') + '</tbody></table>';
}
document.getElementById('r').onclick = load;
load().catch(function(e){
  document.getElementById('box').innerHTML = '<div class="err">'+esc(String(e && e.message ? e.message : e))+'</div>';
});
})();
</script>
</body>
</html>`
  }
}
