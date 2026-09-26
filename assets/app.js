/* ============ 考勤数据管理平台 app.js (Supabase 版) ============ */
"use strict";

/* ---------- 工具 ---------- */
const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const pad = n => String(n).padStart(2, "0");
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
const addDays = (ymd, n) => { const d = new Date(ymd + "T00:00:00"); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
const nowCN = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const fmtTs = ts => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const LS = {
  get(k, d) { try { const v = localStorage.getItem("lws_" + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { localStorage.setItem("lws_" + k, JSON.stringify(v)); }
};
function toast(msg, type = "") {
  const t = document.createElement("div");
  t.className = "toast " + type; t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 2600);
}
function addLog(action, detail) {
  const item = { action, detail };
  logs.unshift(item);
  const t = new Date().toISOString();
  SB.insert("ops_logs", { action, detail }).then(rows => { if (rows && rows[0]) item.id = rows[0].id; }).catch(() => {});
  localStorage.setItem("lws_lastUpdate", JSON.stringify(Date.now()));
  $("#updTime").textContent = fmtTs(Date.now());
}

/* ---------- 状态 ---------- */
let attendance = [], groupRules = [], projMap = [], attrition = [], memoryR = [], logs = [];
let sections = [], tasks = [];
let selDate = todayStr();

/* 项目映射 + Group 规则(内存应用) */
function applyMaps(rec) {
  for (const m of projMap) {
    if (m.alias && m.std && (rec.project || "").includes(m.alias)) { rec.project = m.std; break; }
  }
  rec.group_name = "";
  for (const r of groupRules) {
    if (r.key && r.group_name && ((rec.dept || "").includes(r.key) || (rec.project || "").includes(r.key))) { rec.group_name = r.group_name; break; }
  }
}
async function reapplyMaps() {
  const changed = [];
  for (const rec of attendance) {
    const oldP = rec.project, oldG = rec.group_name;
    applyMaps(rec);
    if (rec.project !== oldP || rec.group_name !== oldG) { changed.push(rec); }
  }
  for (const rec of changed) await SB.update("attendance", rec.id, { project: rec.project, group_name: rec.group_name });
  return changed.length;
}

/* ---------- 启动加载 ---------- */
async function loadAll() {
  const [a, g, p, at, m, l, s, t] = await Promise.all([
    SB.select("attendance", "order=start_date.desc"),
    SB.select("group_rules"),
    SB.select("project_map"),
    SB.select("attrition", "order=month.desc"),
    SB.select("memory_report", "order=date.desc"),
    SB.select("ops_logs", "order=time.desc&limit=300"),
    SB.select("board_sections", "order=order_idx.asc"),
    SB.select("board_tasks", "order=created_at.asc")
  ]);
  attendance = a; groupRules = g; projMap = p; attrition = at; memoryR = m; logs = l; sections = s; tasks = t;
  attendance.forEach(applyMaps);
  /* 缓存到 localStorage(离线兜底) */
  LS.set("cache", { attendance, groupRules, projMap, attrition, memoryR, logs, sections, tasks });
}

function showBootError(e) {
  const cached = LS.get("cache", null);
  const d = document.createElement("div");
  d.id = "setupScreen";
  d.innerHTML = `
    <div class="setup-box">
      <div class="setup-logo">⚠️</div>
      <h2>连接 Supabase 失败</h2>
      <p class="setup-sub" style="color:#dc2626">${esc(e.message || e)}</p>
      ${cached ? '<p class="setup-tip">已载入本地缓存数据(只读),联网后刷新可恢复。</p>' : ''}
      <button id="bootRetry" class="setup-btn">重试连接</button>
      <button id="bootReset" class="setup-btn" style="background:#64748b">重新配置连接</button>
    </div>`;
  document.body.appendChild(d);
  if (cached) {
    attendance = cached.attendance || []; groupRules = cached.groupRules || []; projMap = cached.projMap || [];
    attrition = cached.attrition || []; memoryR = cached.memoryR || []; logs = cached.logs || [];
    sections = cached.sections || []; tasks = cached.tasks || [];
    attendance.forEach(applyMaps);
    renderAll();
  }
  $("#bootRetry").addEventListener("click", () => location.reload());
  $("#bootReset").addEventListener("click", () => { localStorage.removeItem("sb_url"); localStorage.removeItem("sb_key"); location.reload(); });
}

/* ---------- Tab 切换 ---------- */
let currentView = "attendance";
function switchView(name) {
  currentView = name;
  $$("#mainTabs .tab").forEach(t => t.classList.toggle("active", t.dataset.view === name));
  $$(".view").forEach(v => v.classList.toggle("active", v.id === "view-" + name));
  if (name === "attendance") renderDash();
  if (name === "board") renderBoard();
  if (name === "window") renderWindow();
  if (name === "attrition") renderAttr();
  if (name === "memory") renderMem();
  if (name === "files") renderFiles();
}
$$("#mainTabs .tab").forEach(t => t.addEventListener("click", () => switchView(t.dataset.view)));

/* ---------- 日出勤表看板 ---------- */
function covers(rec, d) { return rec.start_date <= d && d < addDays(rec.start_date, rec.days); }
function filteredAtt() { return attendance.filter(r => covers(r, selDate)); }

function renderDash() { renderStats(); renderAttTable(); renderDist(); }

function renderStats() {
  const rows = filteredAtt();
  const buckets = [1,2,3,4,5,6].map(n => rows.filter(r => r.days === n).length);
  const uniq = new Set(rows.map(r => r.emp_no)).size;
  const cards = [
    { cls: "total", label: "旷工总人数", val: uniq, sub: `${selDate} 在旷窗口` },
    ...[1,2,3,4,5,6].map((n, i) => ({ cls: "k"+n, label: `旷${n}`, val: buckets[i], sub: uniq ? (buckets[i]/uniq*100).toFixed(0)+"%" : "0%" }))
  ];
  const hasData = rows.length > 0;
  $("#statCards").innerHTML = cards.map(c => `
    <div class="stat-card ${c.cls}">
      <div class="label">${c.label}</div>
      <div class="value">${hasData || c.cls === "total" ? c.val : '<span class="empty-hint">—</span>'}</div>
      <div class="sub">${c.sub}</div>
    </div>`).join("");
}

function recStatus(r) {
  const end = addDays(r.start_date, r.days - 1);
  const t = todayStr();
  if (end < t) return "已结束";
  if (r.start_date > t) return "未开始";
  return "进行中";
}
function statusTag(s) {
  const cls = { "进行中": "tag-ing", "已结束": "tag-end", "未开始": "tag-future" }[s] || "tag-end";
  return `<span class="tag ${cls}">${s}</span>`;
}

function renderAttTable() {
  const rows = filteredAtt().slice().sort((a, b) => b.days - a.days || a.emp_no.localeCompare(b.emp_no));
  $("#attCount").textContent = `${new Set(rows.map(r => r.emp_no)).size} 人 / ${rows.length} 条`;
  $("#attTable tbody").innerHTML = rows.length ? rows.map(r => `
    <tr>
      <td>${esc(r.emp_no)}</td><td>${esc(r.name)}</td><td>${esc(r.dept)}</td>
      <td>${esc(r.group_name || "—")}</td><td>${esc(r.project)}</td><td>${esc(r.start_date)}</td>
      <td><b>${r.days}</b> 天</td>
      <td>${statusTag(recStatus(r))}</td>
      <td><button class="row-del" data-del="${r.id}" title="删除">🗑</button></td>
    </tr>`).join("") : `<tr><td colspan="9" style="text-align:center;color:var(--muted);padding:40px">该日期无旷工窗口数据,可导入Excel或切换日期</td></tr>`;
}

function renderDist() {
  const rows = filteredAtt();
  const byProj = {};
  rows.forEach(r => {
    const p = r.project || "未标注";
    byProj[p] = byProj[p] || [0,0,0,0,0,0];
    if (r.days >= 1 && r.days <= 6) byProj[p][r.days - 1]++;
  });
  const projs = Object.keys(byProj).sort();
  let html = projs.map(p => {
    const c = byProj[p], sum = c.reduce((a,b)=>a+b,0);
    return `<tr><td><b>${esc(p)}</b></td>${c.map(v => `<td>${v || "·"}</td>`).join("")}<td><b>${sum}</b></td></tr>`;
  }).join("");
  if (projs.length) {
    const tot = [0,0,0,0,0,0];
    projs.forEach(p => byProj[p].forEach((v,i)=>tot[i]+=v));
    const grand = tot.reduce((a,b)=>a+b,0);
    html += `<tr style="background:#f0f5fb"><td><b>合计</b></td>${tot.map(v=>`<td><b>${v||"·"}</b></td>`).join("")}<td><b>${grand}</b></td></tr>`;
  } else {
    html = `<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:40px">暂无数据</td></tr>`;
  }
  $("#distTable tbody").innerHTML = html;
}

/* ---------- 旷窗口监控 ---------- */
function renderWindow() {
  const dept = $("#winDept").value, proj = $("#winProj").value, st = $("#winStatus").value, q = $("#winSearch").value.trim().toLowerCase();
  const depts = [...new Set(attendance.map(r => r.dept).filter(Boolean))];
  const projs = [...new Set(attendance.map(r => r.project).filter(Boolean))];
  if ($("#winDept").options.length - 1 !== depts.length)
    $("#winDept").innerHTML = `<option value="">全部部门</option>` + depts.map(d=>`<option ${d===dept?"selected":""}>${esc(d)}</option>`).join("");
  $("#winProj").innerHTML = `<option value="">全部项目</option>` + projs.map(p=>`<option ${p===proj?"selected":""}>${esc(p)}</option>`).join("");
  let rows = attendance.slice();
  if (dept) rows = rows.filter(r => r.dept === dept);
  if (proj) rows = rows.filter(r => r.project === proj);
  if (st) rows = rows.filter(r => recStatus(r) === st);
  if (q) rows = rows.filter(r => (r.emp_no + r.name).toLowerCase().includes(q));
  rows.sort((a,b) => b.start_date.localeCompare(a.start_date) || b.days - a.days);
  $("#winCount").textContent = `${rows.length} 条`;
  $("#winTable tbody").innerHTML = rows.length ? rows.map(r => `
    <tr>
      <td>${esc(r.emp_no)}</td><td>${esc(r.name)}</td><td>${esc(r.dept)}</td><td>${esc(r.group_name || "—")}</td><td>${esc(r.project)}</td>
      <td>${esc(r.start_date)}</td><td>${esc(addDays(r.start_date, r.days - 1))}</td><td><b>${r.days}</b></td>
      <td>${statusTag(recStatus(r))}</td>
      <td><button class="row-del" data-del="${r.id}" title="删除">🗑</button></td>
    </tr>`).join("") : `<tr><td colspan="10" style="text-align:center;color:var(--muted);padding:40px">无匹配记录</td></tr>`;
}

/* ---------- 流失率报表 ---------- */
const rateCell = (a, b) => b > 0 ? (a / b * 100).toFixed(1) + "%" : "—";
function renderAttr() {
  const rows = attrition;
  const months = [...new Set(rows.map(r => r.month))].sort();
  const latest = months[months.length - 1];
  let latestRate = "—", worst = "—", worstVal = -1;
  if (latest) {
    const rs = rows.filter(r => r.month === latest);
    const s = rs.reduce((a,r)=>a+(+r.start_count||0),0), l = rs.reduce((a,r)=>a+(+r.left_count||0),0);
    latestRate = s > 0 ? (l/s*100).toFixed(1)+"%" : "—";
    rs.forEach(r => { const v = (+r.start_count||0) > 0 ? (+r.left_count||0)/(+r.start_count) : 0; if (v > worstVal) { worstVal = v; worst = r.dept; } });
  }
  $("#attCards").innerHTML = `
    <div class="stat-card total"><div class="label">最新月份(${esc(latest || "—")})整体流失率</div><div class="value">${latestRate}</div><div class="sub">全部部门合计</div></div>
    <div class="stat-card k4"><div class="label">最新月流失率最高部门</div><div class="value" style="font-size:22px">${esc(worst)}</div><div class="sub">${worstVal>=0 ? (worstVal*100).toFixed(1)+"%" : "—"}</div></div>
    <div class="stat-card k2"><div class="label">记录条数</div><div class="value">${rows.length}</div><div class="sub">${months.length} 个月份</div></div>`;
  $("#attrTable tbody").innerHTML = rows.length ? rows.map((r, i) => `
    <tr>
      <td><input class="edit-cell" data-f="month" data-i="${i}" value="${esc(r.month)}"></td>
      <td><input class="edit-cell" data-f="dept" data-i="${i}" value="${esc(r.dept)}"></td>
      <td><input class="edit-cell" data-f="start_count" data-i="${i}" value="${esc(r.start_count)}" style="text-align:right"></td>
      <td><input class="edit-cell" data-f="left_count" data-i="${i}" value="${esc(r.left_count)}" style="text-align:right"></td>
      <td class="cell-rate">${rateCell(+r.left_count||0, +r.start_count||0)}</td>
      <td><input class="edit-cell" data-f="note" data-i="${i}" value="${esc(r.note)}"></td>
      <td><button class="row-del" data-attr-del="${r.id}">🗑</button></td>
    </tr>`).join("") : `<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:40px">暂无数据,点击「添加行」或导入Excel</td></tr>`;
}

/* ---------- 内存报表 ---------- */
function renderMem() {
  const rows = memoryR;
  const plan = rows.reduce((a,r)=>a+(+r.plan_count||0),0), act = rows.reduce((a,r)=>a+(+r.actual_count||0),0);
  $("#memCards").innerHTML = `
    <div class="stat-card total"><div class="label">计划总量</div><div class="value">${plan.toLocaleString()}</div><div class="sub">${rows.length} 条记录</div></div>
    <div class="stat-card k1"><div class="label">实际总量</div><div class="value" style="color:#16a34a">${act.toLocaleString()}</div><div class="sub">累计</div></div>
    <div class="stat-card k3"><div class="label">总体达成率</div><div class="value" style="color:#d97706">${plan>0?(act/plan*100).toFixed(1)+"%":"—"}</div><div class="sub">实际 ÷ 计划</div></div>`;
  $("#memTable tbody").innerHTML = rows.length ? rows.map((r, i) => `
    <tr>
      <td><input class="edit-cell" data-f="date" data-i="${i}" value="${esc(r.date)}"></td>
      <td><input class="edit-cell" data-f="project" data-i="${i}" value="${esc(r.project)}"></td>
      <td><input class="edit-cell" data-f="plan_count" data-i="${i}" value="${esc(r.plan_count)}" style="text-align:right"></td>
      <td><input class="edit-cell" data-f="actual_count" data-i="${i}" value="${esc(r.actual_count)}" style="text-align:right"></td>
      <td class="cell-rate">${rateCell(+r.actual_count||0, +r.plan_count||0)}</td>
      <td><input class="edit-cell" data-f="note" data-i="${i}" value="${esc(r.note)}"></td>
      <td><button class="row-del" data-mem-del="${r.id}">🗑</button></td>
    </tr>`).join("") : `<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:40px">暂无数据,点击「添加行」或导入Excel</td></tr>`;
}

/* ---------- 工作看板 (Bảng công việc) ---------- */
const STATUS = { pending: "待处理", processing: "进行中", done: "已完成" };
const STATUS_CLS = { pending: "tag-end", processing: "tag-ing", done: "tag-go" };

function fileNameOf(path) { return path ? path.split("/").pop() : ""; }

function renderBoard() {
  const c = $("#boardContainer");
  if (!sections.length) {
    c.innerHTML = `<div class="empty-inline">还没有栏目,点击上方「＋ 添加栏目」创建第一个工作分类</div>`;
    return;
  }
  c.innerHTML = sections.map(sec => {
    const ts = tasks.filter(t => t.section_id === sec.id);
    return `
    <div class="panel board-sec">
      <div class="panel-head">
        <input class="sec-name" data-sec="${sec.id}" value="${esc(sec.name)}" title="点击修改栏目名">
        <span class="badge">${ts.length} 项</span>
        <button class="row-del" data-sec-del="${sec.id}" title="删除栏目(含其中任务)">🗑</button>
      </div>
      <div class="task-list">
        ${ts.length ? ts.map(t => `
        <div class="task-card">
          <div class="task-line">
            <select class="task-status" data-task="${t.id}">
              ${Object.entries(STATUS).map(([v, lbl]) => `<option value="${v}" ${t.status===v?"selected":""}>${lbl}</option>`).join("")}
            </select>
            <input class="task-title" data-task="${t.id}" value="${esc(t.title)}" placeholder="任务名称">
            <button class="row-del" data-task-del="${t.id}" title="删除任务">🗑</button>
          </div>
          <div class="task-line">
            <input class="task-note" data-task="${t.id}" value="${esc(t.note)}" placeholder="备注 / 给 AI 的要求说明…">
          </div>
          <div class="task-line files-line">
            <span class="file-chip ${t.input_file ? "" : "empty"}">
              📤 给AI: ${t.input_file ? `<a href="${esc(SB.filePublicUrl(t.input_file))}" target="_blank">${esc(fileNameOf(t.input_file))}</a> <button class="chip-btn" data-file-reup="${t.id}" title="更换文件">↻</button>` : "未上传"}
            </span>
            <button class="btn btn-outline btn-sm" data-file-up="${t.id}">📎 上传文件给AI</button>
            <span class="file-chip ${t.output_file ? "" : "empty"}">
              📥 AI完成: ${t.output_file ? `<a href="${esc(SB.filePublicUrl(t.output_file))}" target="_blank">${esc(fileNameOf(t.output_file))}</a>` : "暂无"}
            </span>
          </div>
        </div>`).join("") : `<div class="empty-inline" style="padding:16px">此栏目还没有任务</div>`}
      </div>
      <div class="sec-foot"><button class="btn btn-outline btn-sm" data-task-add="${sec.id}">＋ 添加任务</button></div>
    </div>`;
  }).join("");
}

let uploadTaskId = null;
function pickTaskFile(taskId) { uploadTaskId = taskId; const fi = $("#taskFileInput"); fi.value = ""; fi.click(); }
$("#taskFileInput").addEventListener("change", async () => {
  const f = $("#taskFileInput").files[0];
  if (!f || !uploadTaskId) return;
  toast("正在上传 " + f.name + " …");
  try {
    const path = `input/${uploadTaskId}/${Date.now()}-${f.name}`;
    await SB.uploadFile(path, f);
    const [row] = await SB.update("board_tasks", uploadTaskId, { input_file: path, status: "pending", updated_at: new Date().toISOString() });
    const i = tasks.findIndex(t => t.id === uploadTaskId);
    if (i >= 0) tasks[i] = row;
    addLog("imp", `上传文件给AI: ${f.name}`);
    renderBoard();
    toast("上传成功,AI 会看到这个文件", "ok");
  } catch (e) { toast("上传失败:" + e.message, "err"); }
});

/* ---------- 云端文件 (Storage) ---------- */
async function renderFiles() {
  const grid = $("#filesGrid");
  $("#btnFilesRefresh").textContent = "刷新中…";
  try {
    const [inputs, outputs, roots] = await Promise.all([
      SB.listFiles("input/"), SB.listFiles("output/"), SB.listFiles("")
    ]);
    const row = f => {
      const size = f.metadata ? (f.metadata.size/1024).toFixed(1) + " KB" : "";
      const full = (f.__prefix && f.name.startsWith(f.__prefix)) ? f.name : (f.__prefix || "") + f.name;
      return `<div class="fcard-static"><span class="fname">📄 ${esc(full)}</span><span class="ftag">${size}</span>
        <a class="btn btn-outline btn-sm" href="${esc(SB.filePublicUrl(full))}" target="_blank">打开/下载</a></div>`;
    };
    const withP = (arr, prefix) => arr.filter(f => f.id).map(f => Object.assign(f, { __prefix: prefix }));
    const groups = [
      ["📥 AI 完成的文件 (output/)", withP(outputs, "output/")],
      ["📤 我上传给 AI 的文件 (input/)", withP(inputs, "input/")],
      ["其他文件", withP(roots, "")]
    ].filter(g => g[1].length);
    $("#fileCount").textContent = `${withP(outputs,"").length + withP(inputs,"").length + withP(roots,"").length} 个`;
    grid.innerHTML = groups.length ? groups.map(([label, arr]) => `
      <div class="file-group"><h4>${label}</h4>${arr.map(row).join("")}</div>`).join("")
      : `<div class="empty-inline">📭 云端还没有文件。在看板里上传文件给AI,或让 AI 直接生成文件放进来</div>`;
  } catch (e) {
    grid.innerHTML = `<div class="empty-inline">⚠️ 加载失败: ${esc(e.message)}</div>`;
  }
  $("#btnFilesRefresh").textContent = "刷新列表";
}

/* ---------- Excel 导入/导出 ---------- */
const fileInput = $("#fileInput");
let importTarget = "attendance";
const HEAD_MAP = {
  attendance: {
    emp_no: ["员工编号","工号","员工工号","编号"],
    name: ["姓名","员工姓名"],
    start_date: ["异常日期","开始日期","日期","旷工日期"],
    dept: ["部门","车间","单位"],
    project: ["项目","旷工项目","产线","线体"],
    days: ["连续旷工天数","旷工天数","天数","连续天数","旷工"]
  },
  attrition: {
    month: ["月份","月","统计月份"], dept: ["部门","单位"],
    start_count: ["期初人数","月初人数","期初"], left_count: ["离职人数","离职","流失人数"], note: ["备注","说明"]
  },
  memory: {
    date: ["日期","生产日期"], project: ["项目","产品","型号"],
    plan_count: ["计划数量","计划","目标"], actual_count: ["实际数量","实际","产出"], note: ["备注","说明"]
  }
};
function pickFile(target) { importTarget = target; fileInput.value = ""; fileInput.click(); }
fileInput.addEventListener("change", () => {
  const f = fileInput.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = async ev => {
    try {
      if (typeof XLSX === "undefined") throw new Error("Excel组件未加载");
      const wb = XLSX.read(ev.target.result, { type: "array", cellDates: false });
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
      const res = importTarget === "attendance" ? await importAtt(aoa) : await importGeneric(aoa, importTarget);
      showImportResult(f.name, res);
      addLog("imp", `${f.name} → ${res.ok} 条成功${res.dup ? `,${res.dup} 条重复` : ""}${res.fail ? `,${res.fail} 条失败` : ""}`);
      renderAll();
    } catch (err) { toast("导入失败:" + err.message, "err"); }
  };
  reader.readAsArrayBuffer(f);
});
function findHeaderRow(aoa, fields) {
  const all = Object.values(fields).flat();
  for (let i = 0; i < Math.min(aoa.length, 6); i++) {
    const row = (aoa[i] || []).map(c => String(c).trim().replace(/\s/g, ""));
    if (row.some(c => all.includes(c))) return i;
  }
  return -1;
}
function mapCols(header, fields) {
  const norm = header.map(c => String(c).trim().replace(/\s/g, ""));
  const col = {};
  for (const [key, aliases] of Object.entries(fields)) {
    const idx = norm.findIndex(h => aliases.includes(h));
    if (idx >= 0) col[key] = idx;
  }
  return col;
}
function normDate(v) {
  if (v == null || v === "") return "";
  if (typeof v === "number") { const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`; }
  const s = String(v).trim().replace(/[./年月]/g, "-").replace(/日/g, "");
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  const m2 = s.match(/^(\d{1,2})-(\d{1,2})$/);
  if (m2) { const y = new Date().getFullYear(); return `${y}-${pad(+m2[1])}-${pad(+m2[2])}`; }
  return "";
}
async function importAtt(aoa) {
  const F = HEAD_MAP.attendance;
  const hr = findHeaderRow(aoa, F);
  if (hr < 0) return { ok: 0, dup: 0, fail: 0, errors: ["未识别表头,需包含:员工编号/姓名/异常日期/部门/项目/连续旷工天数"] };
  const col = mapCols(aoa[hr], F);
  const res = { ok: 0, dup: 0, fail: 0, errors: [] };
  const batch = [];
  for (let i = hr + 1; i < aoa.length; i++) {
    const row = aoa[i] || [];
    const get = k => col[k] != null ? String(row[col[k]] ?? "").trim() : "";
    const empNo = get("emp_no");
    if (!empNo) { if (row.some(c => String(c).trim())) res.fail++; continue; }
    const date = normDate(col.start_date != null ? row[col.start_date] : "");
    const days = Math.max(1, Math.min(6, parseInt(get("days")) || 1));
    if (!date) { res.fail++; res.errors.push(`第${i+1}行 ${empNo}: 日期无法解析`); continue; }
    const rec = { emp_no: empNo, name: get("name"), dept: get("dept"), project: get("project"), start_date: date, days, note: "" };
    applyMaps(rec);
    if (attendance.some(a => a.emp_no === rec.emp_no && a.start_date === rec.start_date && a.project === rec.project)) { res.dup++; continue; }
    batch.push(rec); res.ok++;
  }
  if (batch.length) {
    const rows = await SB.insert("attendance", batch);
    attendance.push(...rows);
  }
  return res;
}
async function importGeneric(aoa, kind) {
  const F = HEAD_MAP[kind];
  const hr = findHeaderRow(aoa, F);
  if (hr < 0) return { ok: 0, dup: 0, fail: 0, errors: ["未识别表头:" + Object.values(F).flat().join("/")] };
  const col = mapCols(aoa[hr], F);
  const store = kind === "attrition" ? attrition : memoryR;
  const table = kind === "attrition" ? "attrition" : "memory_report";
  const res = { ok: 0, dup: 0, fail: 0, errors: [] };
  const batch = [];
  for (let i = hr + 1; i < aoa.length; i++) {
    const row = aoa[i] || [];
    const obj = {};
    for (const k of Object.keys(col)) obj[k] = String(row[col[k]] ?? "").trim();
    if (!Object.values(obj).some(v => v)) continue;
    if (kind === "attrition") { if (!obj.month || !obj.dept) { res.fail++; continue; } obj.start_count = +obj.start_count || 0; obj.left_count = +obj.left_count || 0; }
    else { obj.date = normDate(obj.date) || obj.date; if (!obj.project) { res.fail++; continue; } obj.plan_count = +obj.plan_count || 0; obj.actual_count = +obj.actual_count || 0; }
    if (kind === "attrition" && attrition.some(a => a.month === obj.month && a.dept === obj.dept)) { res.dup++; continue; }
    batch.push(obj); res.ok++;
  }
  if (batch.length) {
    const rows = await SB.insert(table, batch);
    store.push(...rows);
  }
  return res;
}
function showImportResult(fname, r) {
  $("#importResult").innerHTML = `
    <div><span class="ok">✔ 成功导入 ${r.ok} 条</span>${r.dup ? ` <span style="color:#d97706">· 跳过重复 ${r.dup} 条</span>` : ""}${r.fail ? ` <span class="err">· 失败 ${r.fail} 条</span>` : ""}</div>
    <div style="color:var(--muted);font-size:13px">文件:${esc(fname)} · 已存入云端数据库 · 已应用项目映射与Group规则</div>
    ${r.errors.length ? `<ul>${r.errors.slice(0, 10).map(e => `<li class="err">${esc(e)}</li>`).join("")}${r.errors.length > 10 ? `<li>…共 ${r.errors.length} 条</li>` : ""}</ul>` : ""}`;
  openModal("modal-import");
}
function exportSheet(name, header, rows) {
  if (typeof XLSX !== "undefined") {
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    XLSX.writeFile(wb, name);
  } else {
    const csv = "\ufeff" + [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = name.replace(/\.xlsx$/, ".csv"); a.click();
  }
}
function exportAtt() {
  const rows = filteredAtt().map(r => [r.emp_no, r.name, r.dept, r.group_name || "", r.project, r.start_date, r.days]);
  exportSheet(`日出勤表_${selDate}.xlsx`, ["员工编号","姓名","部门","Group","旷工项目","异常日期","连续旷工天数"], rows);
  addLog("exp", `导出日出勤表 ${selDate}(${rows.length} 条)`);
  toast(`已导出 ${rows.length} 条明细`, "ok");
}

/* ---------- 弹窗 ---------- */
function openModal(id) { $("#" + id).classList.add("open"); }
function closeModals() { $$(".modal-mask").forEach(m => m.classList.remove("open")); }
$$("[data-modal]").forEach(b => b.addEventListener("click", () => {
  if (b.dataset.modal === "modal-rules") renderRules();
  if (b.dataset.modal === "modal-projmap") renderProjMap();
  if (b.dataset.modal === "modal-logs") renderLogs();
  openModal(b.dataset.modal);
}));
$$("[data-close]").forEach(b => b.addEventListener("click", closeModals));
$$(".modal-mask").forEach(m => m.addEventListener("click", e => { if (e.target === m) closeModals(); }));

function renderRules() {
  $("#rulesTable tbody").innerHTML = groupRules.length ? groupRules.map(r => `
    <tr><td>${esc(r.key)}</td><td><b>${esc(r.group_name)}</b></td>
    <td><button class="row-del" data-rule-del="${r.id}">删除</button></td></tr>`).join("")
    : `<tr><td colspan="3" style="text-align:center;color:var(--muted);padding:24px">暂无规则,导入时不会归属Group</td></tr>`;
}
function renderProjMap() {
  $("#projmapTable tbody").innerHTML = projMap.length ? projMap.map(m => `
    <tr><td>${esc(m.alias)}</td><td><b>${esc(m.std)}</b></td>
    <td><button class="row-del" data-map-del="${m.id}">删除</button></td></tr>`).join("")
    : `<tr><td colspan="3" style="text-align:center;color:var(--muted);padding:24px">暂无映射</td></tr>`;
}
function renderLogs() {
  $("#logList").innerHTML = logs.length ? logs.map(l => `
    <div class="log-item"><span class="log-time">${esc((l.time || "").replace("T", " ").slice(0, 19))}</span><span class="log-action ${l.action}">${{add:"新增",del:"删除",imp:"导入",exp:"导出",init:"初始化",edit:"编辑",clear:"清空"}[l.action] || esc(l.action)}</span><span>${esc(l.detail)}</span></div>`).join("")
    : `<div class="empty-inline">暂无日志</div>`;
}
$("#btnRuleAdd").addEventListener("click", async () => {
  const k = $("#ruleKey").value.trim(), v = $("#ruleVal").value.trim();
  if (!k || !v) return toast("请填写关键字和Group", "err");
  try {
    const [row] = await SB.insert("group_rules", { key: k, group_name: v });
    groupRules.push(row);
    const n = await reapplyMaps();
    $("#ruleKey").value = ""; $("#ruleVal").value = "";
    renderRules(); renderDash(); addLog("add", `Group规则:${k} → ${v}`);
    toast(`规则已添加,重新匹配了 ${n} 条记录`, "ok");
  } catch (e) { toast("保存失败:" + e.message, "err"); }
});
$("#btnMapAdd").addEventListener("click", async () => {
  const a = $("#mapAlias").value.trim(), s = $("#mapStd").value.trim();
  if (!a || !s) return toast("请填写别名和标准项目名", "err");
  try {
    const [row] = await SB.insert("project_map", { alias: a, std: s });
    projMap.push(row);
    const n = await reapplyMaps();
    $("#mapAlias").value = ""; $("#mapStd").value = "";
    renderProjMap(); renderDash(); addLog("add", `项目映射:${a} → ${s}`);
    toast(`映射已添加,重新匹配了 ${n} 条记录`, "ok");
  } catch (e) { toast("保存失败:" + e.message, "err"); }
});
$("#btnClearAll").addEventListener("click", async () => {
  if (!confirm("确定清空云端数据库的全部数据?此操作不可恢复。")) return;
  if (!confirm("再次确认:真的要清空吗?(文件不会被删除)")) return;
  try {
    for (const t of ["board_tasks","board_sections","attendance","group_rules","project_map","attrition","memory_report","ops_logs"])
      await SB.req("DELETE", `/rest/v1/${t}?id=neq.null`);
    attendance = []; groupRules = []; projMap = []; attrition = []; memoryR = []; logs = []; sections = []; tasks = [];
    localStorage.setItem("sb_seeded", "1");
    closeModals(); renderAll();
    toast("云端数据已全部清空", "ok");
  } catch (e) { toast("清空失败:" + e.message, "err"); }
});

/* ---------- 全局点击(删除/编辑委托) ---------- */
document.addEventListener("click", async e => {
  const del = e.target.closest("[data-del]");
  if (del) {
    const id = del.dataset.del;
    const rec = attendance.find(a => a.id === id);
    try {
      await SB.remove("attendance", id);
      attendance = attendance.filter(a => a.id !== id);
      addLog("del", `${rec ? rec.emp_no + " " + rec.name : ""} 的旷工窗口`);
      renderDash(); if (currentView === "window") renderWindow();
    } catch (err) { toast("删除失败:" + err.message, "err"); }
    return;
  }
  const ad = e.target.closest("[data-attr-del]");
  if (ad) {
    try { await SB.remove("attrition", ad.dataset.attrDel); attrition = attrition.filter(r => r.id !== ad.dataset.attrDel); addLog("del", "流失率记录"); renderAttr(); }
    catch (err) { toast("删除失败:" + err.message, "err"); }
    return;
  }
  const md = e.target.closest("[data-mem-del]");
  if (md) {
    try { await SB.remove("memory_report", md.dataset.memDel); memoryR = memoryR.filter(r => r.id !== md.dataset.memDel); addLog("del", "内存报表记录"); renderMem(); }
    catch (err) { toast("删除失败:" + err.message, "err"); }
    return;
  }
  const rd = e.target.closest("[data-rule-del]");
  if (rd) {
    try { await SB.remove("group_rules", rd.dataset.ruleDel); groupRules = groupRules.filter(r => r.id !== rd.dataset.ruleDel); await reapplyMaps(); renderRules(); renderDash(); }
    catch (err) { toast("删除失败:" + err.message, "err"); }
    return;
  }
  const pd = e.target.closest("[data-map-del]");
  if (pd) {
    try { await SB.remove("project_map", pd.dataset.mapDel); projMap = projMap.filter(r => r.id !== pd.dataset.mapDel); await reapplyMaps(); renderProjMap(); renderDash(); }
    catch (err) { toast("删除失败:" + err.message, "err"); }
    return;
  }
  const sd = e.target.closest("[data-sec-del]");
  if (sd) {
    if (!confirm("删除整个栏目及其所有任务?(已上传文件保留在云端)")) return;
    try {
      await SB.remove("board_sections", sd.dataset.secDel);
      sections = sections.filter(s => s.id !== sd.dataset.secDel);
      tasks = tasks.filter(t => t.section_id !== sd.dataset.secDel);
      addLog("del", "工作看板栏目"); renderBoard();
    } catch (err) { toast("删除失败:" + err.message, "err"); }
    return;
  }
  const td = e.target.closest("[data-task-del]");
  if (td) {
    try {
      await SB.remove("board_tasks", td.dataset.taskDel);
      tasks = tasks.filter(t => t.id !== td.dataset.taskDel);
      addLog("del", "看板任务"); renderBoard();
    } catch (err) { toast("删除失败:" + err.message, "err"); }
    return;
  }
  const ta = e.target.closest("[data-task-add]");
  if (ta) {
    try {
      const [row] = await SB.insert("board_tasks", { section_id: ta.dataset.taskAdd, title: "Việc mới(点击改名)", status: "pending", note: "" });
      tasks.push(row); addLog("add", "看板任务"); renderBoard();
      const el = document.querySelector(`.task-title[data-task="${row.id}"]`);
      if (el) { el.focus(); el.select(); }
    } catch (err) { toast("添加失败:" + err.message, "err"); }
    return;
  }
  const fu = e.target.closest("[data-file-up]");
  if (fu) { pickTaskFile(fu.dataset.fileUp); return; }
  const ru = e.target.closest("[data-file-reup]");
  if (ru) { pickTaskFile(ru.dataset.fileReup); return; }
});

/* 看板行内编辑(委托 change) */
document.addEventListener("change", async e => {
  const el = e.target;
  /* 看板 */
  if (el.classList.contains("sec-name")) {
    try { const [row] = await SB.update("board_sections", el.dataset.sec, { name: el.value.trim() || "未命名栏目" }); const i = sections.findIndex(s => s.id === row.id); if (i >= 0) sections[i] = row; el.value = row.name; addLog("edit", "栏目名称"); }
    catch (err) { toast("保存失败:" + err.message, "err"); }
    return;
  }
  if (el.classList.contains("task-status") || el.classList.contains("task-title") || el.classList.contains("task-note")) {
    const id = el.dataset.task;
    const field = el.classList.contains("task-status") ? "status" : el.classList.contains("task-title") ? "title" : "note";
    try {
      const [row] = await SB.update("board_tasks", id, { [field]: el.value, updated_at: new Date().toISOString() });
      const i = tasks.findIndex(t => t.id === id); if (i >= 0) tasks[i] = row;
      addLog("edit", field === "status" ? `任务状态 → ${STATUS[row.status]}` : "任务内容");
    } catch (err) { toast("保存失败:" + err.message, "err"); }
    return;
  }
  /* 流失率/内存 单元格 */
  if (el.dataset.f && el.closest("#attrTable")) {
    const i = +el.dataset.i, rec = attrition[i];
    try { await SB.update("attrition", rec.id, { [el.dataset.f]: el.value }); rec[el.dataset.f] = el.value; LS.set("lastUpdate", Date.now()); renderAttr(); }
    catch (err) { toast("保存失败:" + err.message, "err"); }
    return;
  }
  if (el.dataset.f && el.closest("#memTable")) {
    const i = +el.dataset.i, rec = memoryR[i];
    try { await SB.update("memory_report", rec.id, { [el.dataset.f]: el.value }); rec[el.dataset.f] = el.value; LS.set("lastUpdate", Date.now()); renderMem(); }
    catch (err) { toast("保存失败:" + err.message, "err"); }
    return;
  }
});

/* ---------- 工具栏事件 ---------- */
$("#attDate").addEventListener("change", () => { selDate = $("#attDate").value || todayStr(); renderDash(); });
$("#btnToday").addEventListener("click", () => { selDate = todayStr(); $("#attDate").value = selDate; renderDash(); });
$("#btnRefresh").addEventListener("click", async () => { try { await loadAll(); renderAll(); toast("已从云端刷新", "ok"); } catch (e) { toast("刷新失败:" + e.message, "err"); } });
$("#btnExport").addEventListener("click", exportAtt);
$("#btnImport").addEventListener("click", () => pickFile("attendance"));
$("#btnWinExport").addEventListener("click", () => {
  const dept = $("#winDept").value, proj = $("#winProj").value, st = $("#winStatus").value, q = $("#winSearch").value.trim().toLowerCase();
  let rows = attendance.slice();
  if (dept) rows = rows.filter(r => r.dept === dept);
  if (proj) rows = rows.filter(r => r.project === proj);
  if (st) rows = rows.filter(r => recStatus(r) === st);
  if (q) rows = rows.filter(r => (r.emp_no + r.name).toLowerCase().includes(q));
  exportSheet(`旷窗口监控_${todayStr()}.xlsx`, ["员工编号","姓名","部门","Group","项目","开始日期","结束日期","旷工天数","状态"],
    rows.map(r => [r.emp_no, r.name, r.dept, r.group_name || "", r.project, r.start_date, addDays(r.start_date, r.days - 1), r.days, recStatus(r)]));
  addLog("exp", `导出旷窗口监控(${rows.length} 条)`);
  toast(`已导出 ${rows.length} 条`, "ok");
});
["winDept","winProj","winStatus"].forEach(id => $("#" + id).addEventListener("change", renderWindow));
$("#winSearch").addEventListener("input", renderWindow);
$("#btnAttAdd").addEventListener("click", async () => {
  try {
    const [row] = await SB.insert("attrition", { month: todayStr().slice(0,7), dept: "", start_count: 0, left_count: 0, note: "" });
    attrition.push(row); addLog("add", "流失率记录"); renderAttr();
  } catch (e) { toast("添加失败:" + e.message, "err"); }
});
$("#btnMemAdd").addEventListener("click", async () => {
  try {
    const [row] = await SB.insert("memory_report", { date: todayStr(), project: "", plan_count: 0, actual_count: 0, note: "" });
    memoryR.push(row); addLog("add", "内存报表记录"); renderMem();
  } catch (e) { toast("添加失败:" + e.message, "err"); }
});
$("#btnAttImport").addEventListener("click", () => pickFile("attrition"));
$("#btnMemImport").addEventListener("click", () => pickFile("memory"));
$("#btnAttExport").addEventListener("click", () => {
  exportSheet(`流失率报表_${todayStr()}.xlsx`, ["月份","部门","期初人数","离职人数","流失率","备注"],
    attrition.map(r => [r.month, r.dept, r.start_count, r.left_count, (+r.start_count||0)>0 ? ((+r.left_count||0)/(+r.start_count)*100).toFixed(1)+"%" : "", r.note]));
  addLog("exp", `导出流失率报表(${attrition.length} 条)`); toast("已导出", "ok");
});
$("#btnMemExport").addEventListener("click", () => {
  exportSheet(`内存报表_${todayStr()}.xlsx`, ["日期","项目","计划数量","实际数量","达成率","备注"],
    memoryR.map(r => [r.date, r.project, r.plan_count, r.actual_count, (+r.plan_count||0)>0 ? ((+r.actual_count||0)/(+r.plan_count)*100).toFixed(1)+"%" : "", r.note]));
  addLog("exp", `导出内存报表(${memoryR.length} 条)`); toast("已导出", "ok");
});
["btnLogs","btnAttLogs","btnMemLogs","btnBoardLogs"].forEach(id => { const b = $("#" + id); if (b) b.addEventListener("click", () => { renderLogs(); openModal("modal-logs"); }); });
$("#btnFiles").addEventListener("click", () => switchView("files"));
$("#btnFilesBack").addEventListener("click", () => switchView("attendance"));
$("#btnFilesRefresh").addEventListener("click", renderFiles);
$("#btnSecAdd").addEventListener("click", async () => {
  const name = prompt("栏目名称(可随时修改):", "Đầu mục mới");
  if (name === null) return;
  try {
    const [row] = await SB.insert("board_sections", { name: name.trim() || "Đầu mục mới", order_idx: sections.length });
    sections.push(row); addLog("add", `看板栏目:${row.name}`); renderBoard();
  } catch (e) { toast("添加失败:" + e.message, "err"); }
});
$("#btnBoardRefresh").addEventListener("click", async () => {
  try { await loadAll(); renderBoard(); toast("已刷新", "ok"); } catch (e) { toast("刷新失败:" + e.message, "err"); }
});
$("#sbReset").addEventListener("click", () => {
  if (!confirm("清除本机保存的 Supabase 连接配置?(数据仍在云端,重新填入即可恢复)")) return;
  localStorage.removeItem("sb_url"); localStorage.removeItem("sb_key");
  location.reload();
});

function renderAll() {
  if (currentView === "attendance") renderDash();
  if (currentView === "board") renderBoard();
  if (currentView === "window") renderWindow();
  if (currentView === "attrition") renderAttr();
  if (currentView === "memory") renderMem();
  $("#updTime").textContent = fmtTs(LS.get("lastUpdate", Date.now()));
}

/* ---------- 启动 ---------- */
(async function boot() {
  if (!SB.ready()) { showSetup(); return; }
  $("#attDate").value = selDate;
  $("#footDate").textContent = "今天是 " + todayStr();
  try {
    await loadAll();
    await seedIfEmpty();
    if (localStorage.getItem("sb_seeded") === "1" && attendance.length === 0) await loadAll();
    renderAll();
    $("#updTime").textContent = fmtTs(Date.now());
  } catch (e) {
    showBootError(e);
  }
})();
