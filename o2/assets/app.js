/* ============================================================
   U01H O2 数据集成平台 · 独立版（Lily）
   纯前端：IndexedDB 本地存储 + WebCrypto 登录 + SheetJS 解析
   不依赖任何外部服务器（AI 助手需自行配置 OpenAI 兼容接口）
   ============================================================ */
(function () {
  'use strict';

  /* ---------------- 基础工具 ---------------- */
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function toast(msg, ms) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('on'), ms || 2200);
  }

  const fmtSize = (n) => {
    if (n == null) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  };
  const fmtTime = (ts) => {
    if (!ts) return '—';
    const d = new Date(ts);
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  /* ---------------- IndexedDB ---------------- */
  const DB_NAME = 'o2platform';
  const DB_VER = 1;
  let _db = null;

  function openDB() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('datasets')) db.createObjectStore('datasets', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('logs')) db.createObjectStore('logs', { keyPath: 'id' });
      };
      req.onsuccess = () => { _db = req.result; resolve(_db); };
      req.onerror = () => reject(req.error);
    });
  }

  async function kvGet(k, dflt) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readonly');
      const r = tx.objectStore('kv').get(k);
      r.onsuccess = () => resolve(r.result === undefined ? dflt : r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async function kvSet(k, v) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(v, k);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function kvDel(k) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').delete(k);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function dsAll() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('datasets', 'readonly');
      const r = tx.objectStore('datasets').getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    });
  }
  async function dsGet(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('datasets', 'readonly');
      const r = tx.objectStore('datasets').get(id);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async function dsPut(obj) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('datasets', 'readwrite');
      tx.objectStore('datasets').put(obj);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function dsDel(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('datasets', 'readwrite');
      tx.objectStore('datasets').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function logAdd(action, detail) {
    const db = await openDB();
    const rec = { id: uid(), ts: Date.now(), action, detail: detail || '' };
    return new Promise((resolve) => {
      const tx = db.transaction('logs', 'readwrite');
      tx.objectStore('logs').put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      setTimeout(() => {
        try {
          const tx2 = _db.transaction('logs', 'readwrite');
          const st = tx2.objectStore('logs');
          const all = st.getAll();
          all.onsuccess = () => {
            const a = all.result || [];
            if (a.length > 300) a.slice(0, a.length - 300).forEach((x) => st.delete(x.id));
          };
        } catch (e) {}
      }, 300);
    });
  }
  async function logsAll() {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction('logs', 'readonly');
      const r = tx.objectStore('logs').getAll();
      r.onsuccess = () => resolve((r.result || []).sort((a, b) => b.ts - a.ts));
      r.onerror = () => resolve([]);
    });
  }

  /* ---------------- 密码学 ---------------- */
  const enc = new TextEncoder();
  const b64 = (buf) => btoa(String.fromCharCode.apply(null, new Uint8Array(buf)));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const randHex = (n) => {
    const a = new Uint8Array(n);
    crypto.getRandomValues(a);
    return Array.from(a).map((x) => x.toString(16).padStart(2, '0')).join('');
  };

  async function hashPw(pw, saltB64) {
    const salt = unb64(saltB64);
    const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: 120000, hash: 'SHA-256' }, key, 256);
    return b64(bits);
  }

  function genRecovery() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    const s = Array.from(a).map((x) => chars[x % chars.length]).join('');
    return s.match(/.{1,4}/g).join('-');
  }
  const normRecovery = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  /* ---------------- 登录状态 ---------------- */
  const SESSION_DAYS = 7;
  let ACCOUNT = null;
  let SESSION = null;

  async function loadSession() {
    ACCOUNT = await kvGet('account', null);
    SESSION = await kvGet('session', null);
    if (SESSION && SESSION.exp && Date.now() > SESSION.exp) {
      await kvDel('session');
      SESSION = null;
    }
  }

  function showAuth() {
    $('authWrap').style.display = 'flex';
    $('shell').classList.remove('on');
    renderAuth();
  }
  function showApp() {
    $('authWrap').style.display = 'none';
    $('shell').classList.add('on');
    const n = (SESSION && SESSION.user) || 'Lily';
    $('whoName').textContent = n;
    $('whoAvatar').textContent = n.slice(0, 1).toUpperCase();
    go('dashboard');
  }

  function authMsg(text, kind) {
    const m = $('authMsg');
    m.className = 'msg ' + (kind || 'err');
    m.textContent = text;
  }

  function renderAuth(mode) {
    mode = mode || (ACCOUNT ? 'login' : 'setup');
    const body = $('authBody');
    const foot = $('authFoot');
    $('authMsg').className = 'msg';

    if (mode === 'setup') {
      $('authCard').querySelector('h1').textContent = '初始化平台';
      $('authCard').querySelector('.sub').textContent = '首次使用 · 设置你自己的管理员账号（仅保存在本机浏览器）';
      body.innerHTML = `
        <div class="hint-box">这是<b>你自己</b>的独立平台，账号只存在本机浏览器里，与任何人的系统无关。</div>
        <div class="field"><label>用户名</label><input id="f_user" placeholder="例如 lily" autocomplete="username"></div>
        <div class="field"><label>密码（至少 8 位）</label><input id="f_pw" type="password" placeholder="设置登录密码" autocomplete="new-password"></div>
        <div class="field"><label>确认密码</label><input id="f_pw2" type="password" placeholder="再输入一次" autocomplete="new-password"></div>
        <button class="btn-primary" id="f_go">创建并进入</button>`;
      foot.innerHTML = '';
      $('f_go').onclick = doSetup;
      $('f_pw2').onkeydown = (e) => { if (e.key === 'Enter') doSetup(); };
      return;
    }

    if (mode === 'recover') {
      $('authCard').querySelector('h1').textContent = '重置密码';
      $('authCard').querySelector('.sub').textContent = '使用初始化时生成的 16 位恢复码';
      body.innerHTML = `
        <div class="hint-box">恢复码形如 <b>XXXX-XXXX-XXXX-XXXX</b>，在初始化账号时显示过一次。若已丢失，只能清空本机数据重新初始化。</div>
        <div class="field"><label>恢复码</label><input id="f_code" placeholder="XXXX-XXXX-XXXX-XXXX" autocomplete="off"></div>
        <div class="field"><label>新密码</label><input id="f_np" type="password" placeholder="至少 8 位"></div>
        <div class="field"><label>确认新密码</label><input id="f_np2" type="password" placeholder="再输入一次"></div>
        <button class="btn-primary" id="f_go">重置密码</button>`;
      foot.innerHTML = '<a href="#" id="f_back">← 返回登录</a>';
      $('f_back').onclick = (e) => { e.preventDefault(); renderAuth('login'); };
      $('f_go').onclick = doRecover;
      return;
    }

    $('authCard').querySelector('h1').textContent = 'O2 数据集成平台';
    $('authCard').querySelector('.sub').textContent = 'U01H · 独立部署版 · 请登录后访问';
    body.innerHTML = `
      <div class="field"><label>用户名</label><input id="f_user" placeholder="请输入用户名" autocomplete="username" autofocus></div>
      <div class="field"><label>密码</label><input id="f_pw" type="password" placeholder="请输入密码" autocomplete="current-password"></div>
      <button class="btn-primary" id="f_go">登 录</button>`;
    foot.innerHTML = '<a href="#" id="f_forgot">忘记密码？</a>';
    $('f_forgot').onclick = (e) => { e.preventDefault(); renderAuth('recover'); };
    $('f_go').onclick = doLogin;
    $('f_pw').onkeydown = (e) => { if (e.key === 'Enter') doLogin(); };
    setTimeout(() => { const u = $('f_user'); if (u) u.focus(); }, 60);
  }

  async function doSetup() {
    const u = ($('f_user').value || '').trim();
    const p = $('f_pw').value, p2 = $('f_pw2').value;
    if (u.length < 2) return authMsg('用户名至少 2 个字符');
    if (p.length < 8) return authMsg('密码至少 8 位');
    if (p !== p2) return authMsg('两次输入的密码不一致');
    const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
    const hash = await hashPw(p, salt);
    const recovery = genRecovery();
    const recSalt = b64(crypto.getRandomValues(new Uint8Array(16)));
    const recHash = await hashPw(normRecovery(recovery), recSalt);
    ACCOUNT = { user: u, salt, hash, createdAt: Date.now(), recSalt, recHash };
    await kvSet('account', ACCOUNT);
    await logAdd('初始化账号', u);

    const body = $('authBody');
    $('authMsg').className = 'msg';
    $('authCard').querySelector('h1').textContent = '保存恢复码';
    $('authCard').querySelector('.sub').textContent = '这串码只显示这一次，请抄到纸上或密码管理器';
    body.innerHTML = `
      <div class="code-box">${esc(recovery)}</div>
      <div class="hint-box">忘记密码时用它重置。<b>平台数据全部存在本机浏览器</b>，清浏览器数据会一并清除。</div>
      <button class="btn-primary" id="f_saved">我已保存，进入平台</button>`;
    $('authFoot').innerHTML = '';
    $('f_saved').onclick = async () => {
      await kvSet('session', { user: u, exp: Date.now() + SESSION_DAYS * 864e5 });
      SESSION = { user: u, exp: Date.now() + SESSION_DAYS * 864e5 };
      showApp();
    };
  }

  async function doLogin() {
    const u = ($('f_user').value || '').trim();
    const p = $('f_pw').value;
    if (!u || !p) return authMsg('请输入用户名和密码');
    if (!ACCOUNT || u.toLowerCase() !== String(ACCOUNT.user).toLowerCase()) return authMsg('用户名不存在');
    const h = await hashPw(p, ACCOUNT.salt);
    if (h !== ACCOUNT.hash) return authMsg('密码不正确');
    SESSION = { user: ACCOUNT.user, exp: Date.now() + SESSION_DAYS * 864e5 };
    await kvSet('session', SESSION);
    logAdd('登录', ACCOUNT.user);
    showApp();
  }

  async function doRecover() {
    const code = normRecovery($('f_code').value);
    const p = $('f_np').value, p2 = $('f_np2').value;
    if (!code) return authMsg('请输入恢复码');
    if (p.length < 8) return authMsg('新密码至少 8 位');
    if (p !== p2) return authMsg('两次输入的新密码不一致');
    if (!ACCOUNT) return authMsg('本机还没有账号');
    const h = await hashPw(code, ACCOUNT.recSalt);
    if (h !== ACCOUNT.recHash) return authMsg('恢复码不正确');
    ACCOUNT.salt = b64(crypto.getRandomValues(new Uint8Array(16)));
    ACCOUNT.hash = await hashPw(p, ACCOUNT.salt);
    await kvSet('account', ACCOUNT);
    authMsg('密码已重置，请用新密码登录', 'ok');
    setTimeout(() => renderAuth('login'), 1200);
  }

  /* ---------------- 路由 ---------------- */
  const TITLES = {
    dashboard: ['概览', '平台运行状态与最近数据'],
    upload: ['数据上传', '拖入 Excel / CSV，直接在本机解析入库'],
    datasets: ['数据管理', '查看、预览、导出、删除本机数据'],
    analysis: ['分析中心', '选择数据表做分组统计并导出结果'],
    chat: ['AI 助手', '配置任意 OpenAI 兼容接口后可直接对话'],
    settings: ['设置', '账号、存储、备份与 AI 配置'],
  };
  let VIEW = 'dashboard';

  function go(view) {
    VIEW = view;
    document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.view === view));
    const t = TITLES[view] || ['', ''];
    $('viewTitle').textContent = t[0];
    $('viewCrumb').textContent = t[1];
    $('sidebar').classList.remove('open');
    render();
  }

  async function render() {
    const v = $('view');
    v.innerHTML = '<div class="empty">加载中…</div>';
    try {
      if (VIEW === 'dashboard') return renderDashboard(v);
      if (VIEW === 'upload') return renderUpload(v);
      if (VIEW === 'datasets') return renderDatasets(v);
      if (VIEW === 'analysis') return renderAnalysis(v);
      if (VIEW === 'chat') return renderChat(v);
      if (VIEW === 'settings') return renderSettings(v);
    } catch (e) {
      v.innerHTML = '<div class="empty">出错了：' + esc(e.message) + '</div>';
    }
  }

  /* ---------------- 概览 ---------------- */
  async function renderDashboard(v) {
    const list = await dsAll();
    const logs = await logsAll();
    const totalRows = list.reduce((s, d) => s + (d.rows || 0), 0);
    const bytes = list.reduce((s, d) => s + (d.size || 0), 0);
    const last = list.slice().sort((a, b) => b.uploadedAt - a.uploadedAt)[0];

    v.innerHTML = `
      <div class="cards">
        <div class="card"><div class="k">数据文件</div><div class="v">${list.length}</div><div class="d">本机 IndexedDB 存储</div></div>
        <div class="card"><div class="k">数据行数</div><div class="v">${totalRows.toLocaleString()}</div><div class="d">全部工作表合计</div></div>
        <div class="card"><div class="k">占用空间</div><div class="v">${fmtSize(bytes)}</div><div class="d">原文件大小合计</div></div>
        <div class="card"><div class="k">最近更新</div><div class="v" style="font-size:16px;line-height:1.5">${last ? esc(fmtTime(last.uploadedAt)) : '—'}</div><div class="d">${last ? esc(last.name) : '还没有上传任何数据'}</div></div>
      </div>

      <div class="panel">
        <div class="panel-head"><h3>快捷操作</h3></div>
        <div class="row">
          <button class="btn green" data-act="upload">＋ 上传数据文件</button>
          <button class="btn" data-act="datasets">查看数据管理</button>
          <button class="btn" data-act="analysis">去分析</button>
          <button class="btn" data-act="chat">打开 AI 助手</button>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><h3>最近数据</h3><span class="spacer"></span><span class="muted">最近 6 条</span></div>
        ${list.length ? `<div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>文件名</th><th>工作表</th><th>行数</th><th>大小</th><th>上传时间</th></tr></thead>
          <tbody>${list.slice().sort((a, b) => b.uploadedAt - a.uploadedAt).slice(0, 6).map((d) => `
            <tr><td>${esc(d.name)}</td><td>${d.sheetCount || (d.sheets || []).length}</td>
            <td>${(d.rows || 0).toLocaleString()}</td><td>${fmtSize(d.size)}</td><td>${fmtTime(d.uploadedAt)}</td></tr>`).join('')}
          </tbody></table></div>`
        : '<div class="empty">还没有数据，先去「数据上传」拖一个 Excel 进来</div>'}
      </div>

      <div class="panel">
        <div class="panel-head"><h3>操作记录</h3></div>
        ${logs.length ? `<div class="tbl-wrap" style="max-height:260px"><table class="tbl">
          <thead><tr><th>时间</th><th>操作</th><th>详情</th></tr></thead>
          <tbody>${logs.slice(0, 30).map((l) => `<tr><td>${fmtTime(l.ts)}</td><td>${esc(l.action)}</td><td>${esc(l.detail)}</td></tr>`).join('')}</tbody>
        </table></div>` : '<div class="empty">暂无记录</div>'}
      </div>`;

    v.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => go(b.dataset.act)));
  }

  /* ---------------- 上传 ---------------- */
  let PENDING = null;

  async function renderUpload(v) {
    v.innerHTML = `
      <div class="panel">
        <div class="panel-head"><h3>上传数据文件</h3><span class="spacer"></span><span class="muted">支持 .xlsx .xls .csv，可多选</span></div>
        <div class="drop" id="drop">
          <div class="big">📄</div>
          <div class="t">把 Excel / CSV 拖到这里，或点击选择文件</div>
          <div class="s">文件只在本机浏览器解析，不上传任何服务器</div>
        </div>
        <input type="file" id="fileInput" multiple accept=".xlsx,.xls,.csv" class="hidden">
        <div class="row" style="margin-top:14px">
          <button class="btn" id="btnImportPack">导入数据包 (.json)</button>
          <span class="muted">把之前在别的设备导出的数据包，或本机脚本生成的数据包一次性导入</span>
        </div>
        <input type="file" id="packInput" accept=".json,application/json" class="hidden">
        <div id="uploadResult" style="margin-top:16px"></div>
      </div>`;

    const drop = $('drop'), input = $('fileInput');
    drop.onclick = () => input.click();
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = (e) => {
      e.preventDefault(); drop.classList.remove('over');
      handleFiles(Array.from(e.dataTransfer.files || []));
    };
    input.onchange = () => { handleFiles(Array.from(input.files || [])); input.value = ''; };

    const packInput = $('packInput');
    $('btnImportPack').onclick = () => packInput.click();
    packInput.onchange = () => { importPack(Array.from(packInput.files || [])[0], $('uploadResult')); packInput.value = ''; };
  }

  /* -------- 数据包导入 -------- */
  async function importPack(file, boxEl) {
    const box = boxEl || $('uploadResult');
    if (!file) return;
    box.innerHTML = '<div class="empty">读取数据包…</div>';
    try {
      const txt = await file.text();
      const pack = JSON.parse(txt);
      const list = Array.isArray(pack) ? pack : pack.datasets;
      if (!Array.isArray(list) || !list.length) throw new Error('数据包里没有 datasets');
      const rows = [];
      for (const d of list) {
        const sheets = (d.sheets || []).map((s) => ({
          name: s.name || 'Sheet',
          aoa: Array.isArray(s.aoa) ? s.aoa : [],
        }));
        const totalRows = d.rows != null ? d.rows : sheets.reduce((a, s) => a + Math.max(0, s.aoa.length - 1), 0);
        await dsPut({
          id: uid(), name: d.name || '未命名数据',
          size: d.size || 0, uploadedAt: d.uploadedAt || Date.now(),
          rows: totalRows, sheets,
        });
        rows.push(`<tr><td>${esc(d.name || '未命名数据')}</td><td>${sheets.length}</td><td>${totalRows.toLocaleString()}</td><td><span class="badge">已导入</span></td></tr>`);
      }
      await logAdd('导入数据包', `${file.name} · ${list.length} 个数据表`);
      box.innerHTML = `<div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>数据表</th><th>工作表</th><th>行数</th><th>状态</th></tr></thead>
        <tbody>${rows.join('')}</tbody></table></div>
        <div class="row" style="margin-top:14px"><button class="btn green" id="goDs2">去数据管理</button></div>`;
      $('goDs2').onclick = () => go('datasets');
      toast(`已导入 ${list.length} 个数据表`);
    } catch (e) {
      box.innerHTML = '<div class="empty" style="color:#D93025">导入失败：' + esc(e.message) + '</div>';
    }
  }

  async function handleFiles(files) {
    const box = $('uploadResult');
    if (!files.length) return;
    box.innerHTML = '<div class="empty">解析中…（大文件需要几秒）</div>';
    const rows = [];
    for (const f of files) {
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      if (!['xlsx', 'xls', 'csv'].includes(ext)) {
        rows.push(`<tr><td>${esc(f.name)}</td><td colspan="3" style="color:#D93025">不支持的格式</td></tr>`);
        continue;
      }
      try {
        const buf = await f.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array', cellDates: true });
        const sheets = wb.SheetNames.map((n) => {
          const ws = wb.Sheets[n];
          const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, blankrows: false });
          return { name: n, aoa };
        });
        const totalRows = sheets.reduce((s, sh) => s + Math.max(0, sh.aoa.length - 1), 0);
        const id = uid();
        await dsPut({ id, name: f.name, size: f.size, uploadedAt: Date.now(), rows: totalRows, sheets });
        await logAdd('上传文件', `${f.name} · ${sheets.length} 工作表 · ${totalRows} 行`);
        rows.push(`<tr><td>${esc(f.name)}</td><td>${sheets.length}</td><td>${totalRows.toLocaleString()}</td><td><span class="badge">已入库</span></td></tr>`);
      } catch (e) {
        rows.push(`<tr><td>${esc(f.name)}</td><td colspan="3" style="color:#D93025">解析失败：${esc(e.message)}</td></tr>`);
      }
    }
    box.innerHTML = `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>文件</th><th>工作表</th><th>行数</th><th>状态</th></tr></thead>
      <tbody>${rows.join('')}</tbody></table></div>
      <div class="row" style="margin-top:14px"><button class="btn green" id="goDs">去数据管理</button>
      <button class="btn" id="goAna">直接分析</button></div>`;
    const a = $('goDs'), b = $('goAna');
    if (a) a.onclick = () => go('datasets');
    if (b) b.onclick = () => go('analysis');
    toast('解析完成');
  }

  /* ---------------- 数据管理 ---------------- */
  async function renderDatasets(v) {
    const list = (await dsAll()).sort((a, b) => b.uploadedAt - a.uploadedAt);
    v.innerHTML = `
      <div class="panel">
        <div class="panel-head"><h3>本机数据</h3><span class="spacer"></span>
          <input class="search" id="dsSearch" placeholder="搜索文件名…">
        </div>
        ${list.length ? `<div class="tbl-wrap"><table class="tbl" id="dsTable">
          <thead><tr><th>文件名</th><th>工作表</th><th>行数</th><th>大小</th><th>上传时间</th><th style="width:190px">操作</th></tr></thead>
          <tbody>${list.map((d) => `
            <tr data-id="${d.id}" data-name="${esc(d.name.toLowerCase())}">
              <td title="${esc(d.name)}">${esc(d.name)}</td>
              <td>${(d.sheets || []).length}</td>
              <td>${(d.rows || 0).toLocaleString()}</td>
              <td>${fmtSize(d.size)}</td>
              <td>${fmtTime(d.uploadedAt)}</td>
              <td>
                <button class="btn sm" data-preview="${d.id}">预览</button>
                <button class="btn sm" data-export="${d.id}">导出</button>
                <button class="btn sm danger" data-del="${d.id}">删除</button>
              </td>
            </tr>`).join('')}</tbody></table></div>`
        : '<div class="empty">还没有数据，先去「数据上传」</div>'}
      </div>
      <div id="previewBox"></div>`;

    const s = $('dsSearch');
    if (s) s.oninput = () => {
      const q = s.value.trim().toLowerCase();
      document.querySelectorAll('#dsTable tbody tr').forEach((tr) => {
        tr.style.display = !q || tr.dataset.name.includes(q) ? '' : 'none';
      });
    };
    v.querySelectorAll('[data-preview]').forEach((b) => (b.onclick = () => previewDataset(b.dataset.preview)));
    v.querySelectorAll('[data-export]').forEach((b) => (b.onclick = () => exportDataset(b.dataset.export)));
    v.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
      const d = await dsGet(b.dataset.del);
      if (!d) return;
      if (!confirm(`确定删除「${d.name}」？此操作不可撤销。`)) return;
      await dsDel(d.id);
      await logAdd('删除数据', d.name);
      toast('已删除');
      render();
    }));
  }

  async function previewDataset(id) {
    const d = await dsGet(id);
    const box = $('previewBox');
    if (!d) return;
    let sheetIdx = 0;
    const draw = () => {
      const sh = d.sheets[sheetIdx];
      const aoa = sh.aoa || [];
      const head = aoa[0] || [];
      const body = aoa.slice(1, 51);
      box.innerHTML = `
        <div class="panel">
          <div class="panel-head"><h3>${esc(d.name)}</h3><span class="spacer"></span>
            <select class="search" id="shSel">${d.sheets.map((s, i) => `<option value="${i}" ${i === sheetIdx ? 'selected' : ''}>${esc(s.name)} (${Math.max(0, s.aoa.length - 1)} 行)</option>`).join('')}</select>
          </div>
          <div class="muted" style="margin-bottom:10px">共 ${aoa.length} 行（含表头），预览前 50 行</div>
          <div class="tbl-wrap"><table class="tbl">
            <thead><tr>${head.map((h, i) => `<th>${esc(h || ('列' + (i + 1)))}</th>`).join('')}</tr></thead>
            <tbody>${body.map((r) => `<tr>${head.map((_, i) => `<td>${esc(r[i] == null ? '' : r[i])}</td>`).join('')}</tr>`).join('')}</tbody>
          </table></div>
        </div>`;
      $('shSel').onchange = (e) => { sheetIdx = +e.target.value; draw(); };
      box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    draw();
  }

  async function exportDataset(id) {
    const d = await dsGet(id);
    if (!d) return;
    const wb = XLSX.utils.book_new();
    d.sheets.forEach((s) => {
      const ws = XLSX.utils.aoa_to_sheet(s.aoa || []);
      XLSX.utils.book_append_sheet(wb, ws, String(s.name).slice(0, 31) || 'Sheet');
    });
    XLSX.writeFile(wb, d.name.replace(/\.(xlsx|xls|csv)$/i, '') + '_导出.xlsx');
    toast('已导出');
  }

  /* ---------------- 分析中心 ---------------- */
  async function renderAnalysis(v) {
    const list = (await dsAll()).sort((a, b) => b.uploadedAt - a.uploadedAt);
    if (!list.length) {
      v.innerHTML = '<div class="panel"><div class="empty">还没有数据，先去「数据上传」</div></div>';
      return;
    }
    v.innerHTML = `
      <div class="panel">
        <div class="panel-head"><h3>分组统计</h3></div>
        <div class="row" style="margin-bottom:14px">
          <select class="search" id="aDs">${list.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select>
          <select class="search" id="aSheet"></select>
          <select class="search" id="aGroup"></select>
          <select class="search" id="aAgg">
            <option value="count">计数</option>
            <option value="distinct">去重计数</option>
            <option value="sum">求和</option>
            <option value="avg">平均</option>
          </select>
          <select class="search" id="aCol"></select>
          <button class="btn green" id="aRun">统计</button>
          <button class="btn" id="aXls">导出结果</button>
        </div>
        <div id="aOut"><div class="empty">选择数据表与分组列后点「统计」</div></div>
      </div>`;

    let LAST = null;
    const fillSheets = async () => {
      const d = await dsGet($('aDs').value);
      $('aSheet').innerHTML = (d.sheets || []).map((s, i) => `<option value="${i}">${esc(s.name)}</option>`).join('');
      fillCols();
    };
    const fillCols = async () => {
      const d = await dsGet($('aDs').value);
      const sh = d.sheets[+$('aSheet').value || 0];
      const head = ((sh.aoa || [])[0] || []).filter((h) => String(h).trim() !== '');
      $('aGroup').innerHTML = head.map((h, i) => `<option value="${i}">${esc(h)}</option>`).join('');
      $('aCol').innerHTML = head.map((h, i) => `<option value="${i}">${esc(h)}</option>`).join('');
    };
    $('aDs').onchange = fillSheets;
    $('aSheet').onchange = fillCols;
    await fillSheets();

    $('aRun').onclick = async () => {
      const d = await dsGet($('aDs').value);
      const sh = d.sheets[+$('aSheet').value || 0];
      const aoa = sh.aoa || [];
      const head = aoa[0] || [];
      const gi = +$('aGroup').value, ci = +$('aCol').value, agg = $('aAgg').value;
      const map = new Map();
      for (let i = 1; i < aoa.length; i++) {
        const r = aoa[i] || [];
        const key = String(r[gi] == null ? '(空)' : r[gi]) || '(空)';
        let o = map.get(key);
        if (!o) { o = { key, n: 0, sum: 0, set: new Set() }; map.set(key, o); }
        o.n++;
        o.set.add(String(r[ci]));
        const num = parseFloat(String(r[ci]).replace(/,/g, ''));
        if (!isNaN(num)) o.sum += num;
      }
      const out = Array.from(map.values()).map((o) => ({
        g: o.key, n: o.n, d: o.set.size, sum: +o.sum.toFixed(4), avg: o.n ? +(o.sum / o.n).toFixed(4) : 0,
      })).sort((a, b) => b.n - a.n);
      LAST = { head: ['分组', '记录数', '去重数', '合计', '平均'], rows: out.map((o) => [o.g, o.n, o.d, o.sum, o.avg]), title: head[gi] + ' 分组统计' };
      $('aOut').innerHTML = `
        <div class="muted" style="margin-bottom:8px">按「${esc(head[gi])}」分组，${agg === 'count' ? '计数' : agg === 'distinct' ? '去重计数(' + esc(head[ci]) + ')' : (agg === 'sum' ? '求和' : '平均') + '(' + esc(head[ci]) + ')'} · 共 ${out.length} 组</div>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>${esc(head[gi] || '分组')}</th><th>记录数</th><th>去重数</th><th>合计</th><th>平均</th></tr></thead>
          <tbody>${out.map((o) => `<tr><td>${esc(o.g)}</td><td>${o.n}</td><td>${o.d}</td><td>${o.sum}</td><td>${o.avg}</td></tr>`).join('')}</tbody>
        </table></div>`;
      toast('统计完成');
    };
    $('aXls').onclick = () => {
      if (!LAST) return toast('先点「统计」生成结果');
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([LAST.head].concat(LAST.rows)), '统计结果');
      XLSX.writeFile(wb, LAST.title + '_' + new Date().toISOString().slice(0, 10) + '.xlsx');
    };
  }

  /* ---------------- AI 助手 ---------------- */
  let CHAT = null;

  async function getAIConf() {
    return await kvGet('ai', { endpoint: '', key: '', model: '' });
  }

  async function renderChat(v) {
    const conf = await getAIConf();
    const hist = CHAT || (CHAT = []);
    if (!conf.endpoint || !conf.key) {
      v.innerHTML = `
        <div class="panel">
          <div class="panel-head"><h3>AI 助手</h3></div>
          <div class="hint-box">还没有配置模型接口。本平台不绑定任何厂商 —— 填入任意 <b>OpenAI 兼容</b>接口即可使用（例如 OpenAI、DeepSeek、通义千问、智谱、或公司内部网关的 /v1 地址）。密钥只保存在本机浏览器。</div>
          <div class="row" style="margin-top:6px"><button class="btn green" id="toSet">去设置里配置</button></div>
        </div>`;
      $('toSet').onclick = () => go('settings');
      return;
    }
    v.innerHTML = `
      <div class="panel" style="padding:0;border:none;background:transparent">
        <div class="chat-box">
          <div class="chat-log" id="chatLog"></div>
          <div class="chat-in">
            <textarea id="chatIn" placeholder="问点什么…（Enter 发送，Shift+Enter 换行）"></textarea>
            <button class="btn green" id="chatSend">发送</button>
            <button class="btn" id="chatClear">清空</button>
          </div>
        </div>
        <div class="muted" style="margin-top:10px">模型：${esc(conf.model || '(未填)')} · 接口：${esc(conf.endpoint)}</div>
      </div>`;
    const log = $('chatLog');
    const paint = () => {
      if (!hist.length) {
        log.innerHTML = '<div class="empty">开始对话吧。数据不会自动发送，只有你输入的内容会发给你配置的接口。</div>';
      } else {
        log.innerHTML = hist.map((m) => `<div class="bub ${m.role === 'user' ? 'me' : 'ai'}">${esc(m.content)}</div>`).join('');
        log.scrollTop = log.scrollHeight;
      }
    };
    paint();
    const send = async () => {
      const inp = $('chatIn');
      const text = inp.value.trim();
      if (!text) return;
      inp.value = '';
      hist.push({ role: 'user', content: text });
      paint();
      hist.push({ role: 'assistant', content: '…' });
      paint();
      try {
        const r = await fetch(conf.endpoint.replace(/\/+$/, '') + '/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + conf.key },
          body: JSON.stringify({
            model: conf.model,
            messages: [{ role: 'system', content: '你是 U01H O2 数据平台的助手，回答简洁、准确，用中文。' }].concat(hist.slice(-20, -1)),
          }),
        });
        const j = await r.json();
        const ans = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || JSON.stringify(j).slice(0, 500);
        hist[hist.length - 1] = { role: 'assistant', content: ans };
      } catch (e) {
        hist[hist.length - 1] = { role: 'assistant', content: '请求失败：' + e.message };
      }
      paint();
    };
    $('chatSend').onclick = send;
    $('chatIn').onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    };
    $('chatClear').onclick = () => { CHAT = []; hist.length = 0; renderChat(v); };
  }

  /* ---------------- 设置 ---------------- */
  async function renderSettings(v) {
    const conf = await getAIConf();
    const list = await dsAll();
    const bytes = list.reduce((s, d) => s + (d.size || 0), 0);
    v.innerHTML = `
      <div class="panel">
        <div class="panel-head"><h3>账号</h3></div>
        <div class="kv">
          <div class="k">用户名</div><div>${esc(ACCOUNT ? ACCOUNT.user : '—')}</div>
          <div class="k">创建时间</div><div>${ACCOUNT ? fmtTime(ACCOUNT.createdAt) : '—'}</div>
          <div class="k">登录有效期</div><div>${SESSION_DAYS} 天（本机免登录）</div>
        </div>
        <div class="row" style="margin-top:14px">
          <input class="search" id="s_old" type="password" placeholder="当前密码">
          <input class="search" id="s_new" type="password" placeholder="新密码（≥8 位）">
          <button class="btn green" id="s_pw">修改密码</button>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><h3>AI 接口</h3></div>
        <div class="muted" style="margin-bottom:12px">OpenAI 兼容接口，例如 <b>https://api.deepseek.com/v1</b>、<b>https://api.openai.com/v1</b>。留空则不启用 AI 助手。</div>
        <div class="field"><label>接口地址 (Base URL)</label><input id="s_ep" placeholder="https://api.deepseek.com/v1" value="${esc(conf.endpoint || '')}"></div>
        <div class="field"><label>API Key</label><input id="s_key" type="password" placeholder="sk-..." value="${esc(conf.key || '')}"></div>
        <div class="field"><label>模型名</label><input id="s_model" placeholder="deepseek-chat" value="${esc(conf.model || '')}"></div>
        <div class="row"><button class="btn green" id="s_save">保存</button><span class="muted">仅保存在本机，不会外传</span></div>
      </div>

      <div class="panel">
        <div class="panel-head"><h3>存储与备份</h3></div>
        <div class="kv">
          <div class="k">数据文件</div><div>${list.length} 个 · ${fmtSize(bytes)}</div>
          <div class="k">存储位置</div><div>浏览器 IndexedDB（仅本机、仅本浏览器）</div>
        </div>
        <div class="row" style="margin-top:14px">
          <button class="btn" id="s_backup">导出数据包 (JSON)</button>
          <button class="btn" id="s_import">导入数据包</button>
          <input type="file" id="s_pack" accept=".json,application/json" class="hidden">
          <button class="btn danger" id="s_wipe">清空全部数据</button>
        </div>
        <div class="muted" style="margin-top:10px">换电脑或换浏览器：先在「数据管理」逐个导出 Excel，或在新设备上重新上传。</div>
      </div>`;

    $('s_pw').onclick = async () => {
      const oldp = $('s_old').value, np = $('s_new').value;
      if (!oldp || !np) return toast('请填写当前密码和新密码');
      const h = await hashPw(oldp, ACCOUNT.salt);
      if (h !== ACCOUNT.hash) return toast('当前密码不正确');
      if (np.length < 8) return toast('新密码至少 8 位');
      ACCOUNT.salt = b64(crypto.getRandomValues(new Uint8Array(16)));
      ACCOUNT.hash = await hashPw(np, ACCOUNT.salt);
      await kvSet('account', ACCOUNT);
      await logAdd('修改密码', ACCOUNT.user);
      toast('密码已更新');
      $('s_old').value = ''; $('s_new').value = '';
    };

    $('s_save').onclick = async () => {
      const c = { endpoint: $('s_ep').value.trim(), key: $('s_key').value.trim(), model: $('s_model').value.trim() };
      await kvSet('ai', c);
      await logAdd('更新 AI 配置', c.endpoint || '(空)');
      toast('已保存');
    };

    $('s_backup').onclick = async () => {
      const bak = { exportedAt: new Date().toISOString(), account: { user: ACCOUNT.user, createdAt: ACCOUNT.createdAt }, ai: await getAIConf(), datasets: list.map((d) => ({ name: d.name, rows: d.rows, uploadedAt: d.uploadedAt, sheets: d.sheets })) };
      const blob = new Blob([JSON.stringify(bak)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'O2平台备份_' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    };

    $('s_import').onclick = () => $('s_pack').click();
    $('s_pack').onchange = async () => {
      const f = ($('s_pack').files || [])[0];
      $('s_pack').value = '';
      if (!f) return;
      const tmp = document.createElement('div');
      tmp.id = 'importOut';
      v.insertBefore(tmp, v.firstChild);
      await importPack(f, tmp);
      list.length = 0;
    };

    $('s_wipe').onclick = async () => {
      if (!confirm('清空全部数据（包括账号）？此操作不可撤销，建议先导出备份。')) return;
      if (!confirm('再次确认：真的要清空吗？')) return;
      indexedDB.deleteDatabase(DB_NAME);
      location.reload();
    };
  }

  /* ---------------- 启动 ---------------- */
  function bindShell() {
    $('nav').querySelectorAll('.nav-item').forEach((n) => (n.onclick = () => go(n.dataset.view)));
    $('btnLogout').onclick = async () => {
      await kvDel('session');
      SESSION = null;
      CHAT = null;
      showAuth();
      toast('已退出');
    };
  }

  (async function boot() {
    try {
      await openDB();
      await loadSession();
      bindShell();
      if (SESSION) showApp(); else showAuth();
      const pill = $('storagePill');
      if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        if (est && est.quota) pill.textContent = '本地存储 · 可用 ' + fmtSize(est.quota - (est.usage || 0));
      }
    } catch (e) {
      document.body.innerHTML = '<div style="padding:40px;font-family:sans-serif">初始化失败：' + esc(e.message) + '</div>';
    }
  })();
})();
