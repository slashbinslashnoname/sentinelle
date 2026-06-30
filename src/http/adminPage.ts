/**
 * Self-contained admin single-page app (no build step, no external assets).
 * Flow: register-on-first-run -> login -> dashboard. The dashboard manages
 * settings and API keys and renders copy-ready integration snippets for an LLM.
 */

export function adminPage(): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Sentinelle · Admin</title>
<style>
 :root{color-scheme:light dark}
 body{font-family:system-ui,sans-serif;max-width:860px;margin:1.5rem auto;padding:0 1rem;line-height:1.45}
 h1{font-size:1.4rem} h2{font-size:1.05rem;margin-top:1.6rem}
 input,select,textarea,button{font:inherit} label{display:block;font-size:.85rem;opacity:.8;margin:.5rem 0 .15rem}
 input,select{width:100%;padding:.45rem;border:1px solid #8886;border-radius:8px;background:transparent}
 button{cursor:pointer;border:1px solid #8886;border-radius:8px;padding:.45rem .8rem;background:#8881}
 button.primary{background:#2563eb;color:#fff;border-color:#2563eb}
 .card{border:1px solid #8884;border-radius:12px;padding:1rem;margin:.8rem 0}
 .row{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center}
 .muted{opacity:.65;font-size:.85rem}
 .grid{display:grid;grid-template-columns:1fr 1fr;gap:.5rem 1rem}
 pre{background:#8881;padding:.7rem;border-radius:8px;overflow:auto;font-size:.8rem;white-space:pre-wrap;word-break:break-word}
 .tabs{display:flex;gap:.3rem;flex-wrap:wrap;margin:1rem 0}
 .tabs button.active{background:#2563eb;color:#fff;border-color:#2563eb}
 table{width:100%;border-collapse:collapse;font-size:.85rem} td,th{text-align:left;padding:.3rem;border-bottom:1px solid #8883}
 .ok{color:#16a34a}.bad{color:#dc2626}.hidden{display:none}
 code{background:#8881;padding:.05rem .3rem;border-radius:5px}
 .copywrap{position:relative} .copybtn{position:absolute;top:.4rem;right:.4rem}
</style></head>
<body>
<h1>🛡️ Sentinelle <span class="muted">Bitcoin invoicing admin</span></h1>
<div id="msg" class="muted"></div>

<!-- AUTH -->
<div id="auth" class="card hidden">
  <h2 id="authTitle">Login</h2>
  <p class="muted" id="authHint"></p>
  <label>Admin password</label>
  <input id="pw" type="password" autocomplete="current-password"/>
  <div id="pw2wrap" class="hidden"><label>Confirm password</label><input id="pw2" type="password"/></div>
  <div class="row" style="margin-top:.7rem"><button class="primary" id="authBtn">Continue</button></div>
</div>

<!-- DASHBOARD -->
<div id="dash" class="hidden">
  <div class="tabs">
    <button data-tab="status" class="active">Status</button>
    <button data-tab="settings">Settings</button>
    <button data-tab="keys">API keys</button>
    <button data-tab="invoices">Invoices</button>
    <button data-tab="llm">LLM integration</button>
    <button id="logout" style="margin-left:auto">Logout</button>
  </div>

  <section id="tab-status" class="tab"><div class="card"><pre id="statusBox">…</pre>
    <div class="row">
      <button onclick="test('phoenixd')">Test phoenixd</button>
      <button onclick="test('explorer')">Test explorer</button>
      <button onclick="test('email')">Test email</button>
      <span id="testRes" class="muted"></span>
    </div></div></section>

  <section id="tab-settings" class="tab hidden"><div class="card">
    <p class="muted">All operational config lives here (saved in the database). Secrets are write-only — leave blank to keep the current value.</p>
    <div id="settingsForm" class="grid"></div>
    <div class="row" style="margin-top:.8rem"><button class="primary" onclick="saveSettings()">Save settings</button><span id="setRes" class="muted"></span></div>
  </div></section>

  <section id="tab-keys" class="tab hidden"><div class="card">
    <div class="row"><input id="keyLabel" placeholder="key label (e.g. my-shop)" style="flex:1"/><button class="primary" onclick="createKey()">Create key</button></div>
    <div id="newKey"></div>
    <table id="keysTable"><thead><tr><th>Label</th><th>Prefix</th><th>Created</th><th>Last used</th><th></th></tr></thead><tbody></tbody></table>
  </div></section>

  <section id="tab-invoices" class="tab hidden"><div class="card">
    <div class="row"><select id="invStatus" onchange="loadInvoices()"><option value="">all</option><option>pending</option><option>paid</option><option>expired</option><option>canceled</option></select><button onclick="loadInvoices()">Refresh</button></div>
    <table id="invTable"><thead><tr><th>id</th><th>status</th><th>amount</th><th>price</th><th>created</th></tr></thead><tbody></tbody></table>
  </div></section>

  <section id="tab-llm" class="tab hidden">
    <div class="card"><p class="muted">Copy/paste this into your coding assistant. Pick an API key first (create one in the API keys tab) — it is substituted below.</p>
      <label>API key to embed</label><input id="llmKey" placeholder="snl_… (paste a key you created)"/>
    </div>
    <div id="llmDocs"></div>
  </section>
</div>

<script>
const $ = (s)=>document.querySelector(s);
const api = (p,opt={})=>fetch(p,{credentials:'same-origin',headers:{'content-type':'application/json'},...opt});
function msg(t,bad){ const m=$('#msg'); m.textContent=t; m.className=bad?'bad':'ok'; setTimeout(()=>m.textContent='',4000); }

async function boot(){
  const st = await (await api('/api/admin/state')).json();
  if(!st.registered){ showAuth(true); }
  else if(!st.authenticated){ showAuth(false); }
  else { showDash(); }
}
function showAuth(register){
  $('#auth').classList.remove('hidden'); $('#dash').classList.add('hidden');
  $('#authTitle').textContent = register?'Register admin':'Login';
  $('#authHint').textContent = register?'No admin exists yet. Choose a password to secure this instance.':'Enter your admin password.';
  $('#pw2wrap').classList.toggle('hidden',!register);
  $('#authBtn').onclick = ()=>register?doRegister():doLogin();
}
async function doRegister(){
  const pw=$('#pw').value, pw2=$('#pw2').value;
  if(pw.length<8) return msg('Password must be at least 8 characters',true);
  if(pw!==pw2) return msg('Passwords do not match',true);
  const r=await api('/api/admin/register',{method:'POST',body:JSON.stringify({password:pw})});
  if(r.ok){ msg('Registered'); showDash(); } else msg((await r.json()).error||'failed',true);
}
async function doLogin(){
  const r=await api('/api/admin/login',{method:'POST',body:JSON.stringify({password:$('#pw').value})});
  if(r.ok){ showDash(); } else msg('Invalid password',true);
}
async function logout(){ await api('/api/admin/logout',{method:'POST'}); location.reload(); }

function showDash(){
  $('#auth').classList.add('hidden'); $('#dash').classList.remove('hidden');
  document.querySelectorAll('.tabs button[data-tab]').forEach(b=>b.onclick=()=>selectTab(b.dataset.tab));
  $('#logout').onclick=logout;
  loadStatus(); loadSettings(); loadKeys(); loadInvoices(); renderLLM();
}
function selectTab(t){
  document.querySelectorAll('.tab').forEach(s=>s.classList.add('hidden'));
  $('#tab-'+t).classList.remove('hidden');
  document.querySelectorAll('.tabs button[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===t));
}

async function loadStatus(){ $('#statusBox').textContent = JSON.stringify(await (await api('/api/admin/status')).json(),null,2); }
async function test(which){ $('#testRes').textContent='testing…'; const r=await api('/api/admin/test/'+which,{method:'POST'}); const j=await r.json(); $('#testRes').textContent=(j.ok?'✅ ':'❌ ')+j.detail; }

let SETTINGS={};
const SECRET=new Set();
async function loadSettings(){
  SETTINGS=await (await api('/api/admin/settings')).json();
  (SETTINGS._secretKeys||[]).forEach(k=>SECRET.add(k));
  const form=$('#settingsForm'); form.innerHTML='';
  Object.keys(SETTINGS).filter(k=>!k.startsWith('_')).forEach(k=>{
    const isSecret=SECRET.has(k), v=SETTINGS[k];
    const wrap=document.createElement('div');
    wrap.innerHTML='<label>'+k+(isSecret?' <span class="muted">(secret'+(v?', set':'')+')</span>':'')+'</label>';
    const inp=document.createElement('input'); inp.id='set_'+k;
    if(isSecret){ inp.type='password'; inp.placeholder=v?'•••• leave blank to keep':'not set'; }
    else inp.value = typeof v==='boolean'?String(v):(v??'');
    wrap.appendChild(inp); form.appendChild(wrap);
  });
}
async function saveSettings(){
  const body={};
  Object.keys(SETTINGS).filter(k=>!k.startsWith('_')).forEach(k=>{
    const val=$('#set_'+k).value;
    if(SECRET.has(k)){ if(val!=='') body[k]=val; }
    else body[k]=val;
  });
  const r=await api('/api/admin/settings',{method:'PUT',body:JSON.stringify(body)});
  if(r.ok){ $('#setRes').textContent='saved ✓'; loadStatus(); loadSettings(); } else $('#setRes').textContent='error';
}

async function loadKeys(){
  const keys=await (await api('/api/admin/keys')).json();
  const tb=$('#keysTable tbody'); tb.innerHTML='';
  keys.forEach(k=>{
    const tr=document.createElement('tr');
    tr.innerHTML='<td>'+esc(k.label)+'</td><td><code>'+esc(k.prefix)+'…</code></td><td>'+fmt(k.createdAt)+'</td><td>'+(k.lastUsedAt?fmt(k.lastUsedAt):'—')+'</td>'+
      '<td>'+(k.revokedAt?'<span class="bad">revoked</span>':'<button data-id="'+k.id+'">revoke</button>')+'</td>';
    const btn=tr.querySelector('button'); if(btn) btn.onclick=()=>revokeKey(k.id);
    tb.appendChild(tr);
  });
}
async function createKey(){
  const label=$('#keyLabel').value||'unnamed';
  const r=await api('/api/admin/keys',{method:'POST',body:JSON.stringify({label})});
  const j=await r.json();
  if(r.ok){ $('#newKey').innerHTML='<div class="card copywrap"><b>Copy now — shown once:</b><pre id="pk">'+esc(j.key)+'</pre><button class="copybtn" onclick="copyText(\\'pk\\')">copy</button></div>';
    $('#llmKey').value=j.key; renderLLM(); loadKeys(); } else msg(j.error||'failed',true);
}
async function revokeKey(id){ if(!confirm('Revoke this key?'))return; await api('/api/admin/keys/'+id,{method:'DELETE'}); loadKeys(); }

async function loadInvoices(){
  const s=$('#invStatus').value; const q=s?('?status='+s):'';
  const list=await (await api('/api/admin/invoices'+q)).json();
  const tb=$('#invTable tbody'); tb.innerHTML='';
  list.forEach(i=>{ const tr=document.createElement('tr');
    tr.innerHTML='<td><code>'+esc(i.id.slice(0,8))+'</code></td><td>'+i.status+'</td><td>'+i.amountBtc+' BTC</td><td>'+(i.price.currency==='BTC'?'—':(Number(i.price.minor)/100).toFixed(2)+' '+i.price.currency)+'</td><td>'+fmt(i.createdAt)+'</td>';
    tb.appendChild(tr); });
}

function renderLLM(){
  const origin=location.origin; const key=$('#llmKey').value||'<YOUR_API_KEY>';
  const blocks=[
    ['Integration guide (give this to your LLM)',
\`Sentinelle is a Bitcoin invoicing gateway. Base URL: \${origin}
Auth: send header  x-api-key: \${key}  on merchant endpoints.

Create an invoice (price in BTC, EUR or USD):
  POST \${origin}/api/invoices
  body: { "amount": "19.99", "currency": "EUR", "externalId": "order-123" }
  -> returns { id, amountSat, amountBtc, onchain:{address}, lightning:{invoice}, bip21, expiresAt }

Show the customer EITHER the on-chain address, the lightning invoice, or the
unified 'bip21' string as a QR. The invoice is payable for ~15 minutes.

Watch for payment (no polling needed) over WebSocket:
  ws \${origin.replace('http','ws')}/ws?invoice=<INVOICE_ID>
  events: invoice.payment_detected (seen in mempool), invoice.paid, invoice.expired
Or poll: GET \${origin}/api/public/invoices/<INVOICE_ID>  (status field)\`],
    ['curl: create invoice',
\`curl -X POST \${origin}/api/invoices \\\\
  -H 'x-api-key: \${key}' -H 'content-type: application/json' \\\\
  -d '{"amount":"19.99","currency":"EUR","externalId":"order-123"}'\`],
    ['JS: create + listen',
\`const r = await fetch("\${origin}/api/invoices", {
  method:"POST",
  headers:{ "x-api-key":"\${key}", "content-type":"application/json" },
  body: JSON.stringify({ amount:"0.0005", currency:"BTC" })
});
const inv = await r.json();
const ws = new WebSocket("\${origin.replace('http','ws')}/ws?invoice="+inv.id);
ws.onmessage = (e)=>{ const ev=JSON.parse(e.data); if(ev.type==="invoice.paid") console.log("PAID", inv.id); };\`]
  ];
  $('#llmDocs').innerHTML = blocks.map((b,i)=>
    '<div class="card copywrap"><b>'+esc(b[0])+'</b><pre id="llm'+i+'">'+esc(b[1])+'</pre><button class="copybtn" onclick="copyText(\\'llm'+i+'\\')">copy</button></div>'
  ).join('');
}
$('#llmKey')&&($('#llmKey').oninput=renderLLM);

function copyText(id){ navigator.clipboard.writeText(document.getElementById(id).textContent); msg('Copied'); }
function copyText2(){}
function esc(s){ return String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
function fmt(ms){ return new Date(ms).toISOString().slice(0,16).replace('T',' '); }
boot();
</script>
</body></html>`;
}
