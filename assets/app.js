/* ============ 考勤数据管理平台 app.js ============ */
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
  logs.unshift({ time: nowCN(), action, detail });
  logs = logs.slice(0, 300);
  LS.set("logs", logs);
  LS.set("lastUpdate", Date.now());
  $("#updTime").textContent = fmtTs(LS.get("lastUpdate", Date.now()));
}
function fmtTs(ts) { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; }

/* ---------- 数据模型 ---------- */
let attendance = LS.get("attendance", null);
let groupRules = LS.get("groupRules", null);
let projMap    = LS.get("projMap", null);
let attrition  = LS.get("attrition", null);
let memory     = LS.get("memory", null);
let logs       = LS.get("logs", []);

/* 示例数据(首次打开自动载入,可在操作日志里清空) */
function seedAll() {
  if (LS.get("seeded", false)) {
    attendance = attendance || [];
    groupRules = groupRules || [];
    projMap = projMap || [];
    attrition = attrition || [];
    memory = memory || [];
    return;
  }
  const T = todayStr();
  const people = [ // [编号,姓名,部门,项目,起始日偏移,连续天数]
    ["G10231","张伟","制造一部","A1线-P01客户",0,3], ["G10245","李娜","制造一部","A1线-P01客户",0,1],
    ["G10312","王强","制造二部","B2线-P02客户",0,6], ["G10318","刘敏","制造二部","B2线-P02客户",1,4],
    ["G10402","陈杰","品质部","C3线-P03客户",0,2],   ["G10415","杨洋","品质部","C3线-P03客户",2,5],
    ["G10533","赵磊","设备部","D4线-P04客户",0,1],   ["G10540","黄霞","设备部","A1线-P01客户",3,2],
    ["G10611","周涛","制造一部","B2线-P02客户",1,6], ["G10625","吴静","制造二部","C3线-P03客户",0,3],
    ["G10701","徐鹏","仓储部","D4线-P04客户",4,1],   ["G10719","孙丽","仓储部","A1线-P01客户",0,2],
    ["G10823","马超","制造一部","C3线-P03客户",5,4], ["G10830","朱婷","制造二部","D4线-P04客户",2,1],
    ["G10901","胡军","品质部","B2线-P02客户",0,5],   ["G10914","林芳","设备部","C3线-P03客户",1,2],
    ["G11022","郑凯","制造一部","D4线-P04客户",0,4], ["G11035","王雪","制造二部","A1线-P01客户",6,3]
  ];
  attendance = people.map(p => ({ id: uid(), empNo: p[0], name: p[1], dept: p[2], project: p[3], date: addDays(T, -p[4]), days: p[5], group: "" }));
  groupRules = [
    { id: uid(), key: "一部", group: "G1" }, { id: uid(), key: "二部", group: "G2" },
    { id: uid(), key: "品质", group: "G3" }, { id: uid(), key: "设备", group: "G4" },
    { id: uid(), key: "仓储", group: "G5" }
  ];
  projMap = [
    { id: uid(), alias: "A1", std: "A1线-P01客户" }, { id: uid(), alias: "B2", std: "B2线-P02客户" },
    { id: uid(), alias: "C3", std: "C3线-P03客户" }, { id: uid(), alias: "D4", std: "D4线-P04客户" }
  ];
  attrition = [
    { id: uid(), month: "2026-06", dept: "制造一部", start: 320, left: 18, note: "" },
    { id: uid(), month: "2026-06", dept: "制造二部", start: 280, left: 22, note: "" },
    { id: uid(), month: "2026-07", dept: "制造一部", start: 315, left: 12, note: "旺季前稳定" },
    { id: uid(), month: "2026-07", dept: "制造二部", start: 265, left: 25, note: "" },
    { id: uid(), month: "2026-08", dept: "制造一部", start: 310, left: 9,  note: "" },
    { id: uid(), month: "2026-08", dept: "制造二部", start: 258, left: 31, note: "月底集中离职" }
  ];
  memory = [];
  for (let i = 4; i >= 0; i--) {
    const d = addDays(T, -i);
    memory.push({ id: uid(), date: d, project: "DDR5-8G", plan: 12000, actual: 11400 + i * 130, note: "" });
    memory.push({ id: uid(), date: d, project: "eMMC-64G", plan: 8000, actual: 8210 - i * 90, note: "" });
  }
  logs = [{ time: nowCN(), action: "初始化", detail: "载入示例数据(可删除,可导入真实数据覆盖)" }];
  LS.set("attendance", attendance);
  LS.set("groupRules", groupRules);
  LS.set("projMap", projMap);
  LS.set("attrition", attrition);
  LS.set("memory", memory);
  LS.set("logs", logs);
  LS.set("seeded", true);
  LS.set("lastUpdate", Date.now());
}
seedAll();

const saveAtt = () => { LS.set("attendance", attendance); };
const saveRules = () => LS.set("groupRules", groupRules);
const saveMap = () => LS.set("projMap", projMap);
const saveAttr = () => LS.set("attrition", attrition);
const saveMem = () => LS.set("memory", memory);

/* 项目映射 + Group 规则应用 */
function applyMaps(rec) {
  for (const m of projMap) {
    if (m.alias && m.std && (rec.project || "").includes(m.alias)) { rec.project = m.std; break; }
  }
  rec.group = "";
  for (const r of groupRules) {
    if (r.key && r.group && ((rec.dept || "").includes(r.key) || (rec.project || "").includes(r.key))) { rec.group = r.group; break; }
  }
}
attendance.forEach(applyMaps);

/* ---------- Tab 切换 ---------- */
let currentView = "attendance";
function switchView(name) {
  currentView = name;
  $$("#mainTabs .tab").forEach(t => t.classList.toggle("active", t.dataset.view === name));
  $$(".view").forEach(v => v.classList.toggle("active", v.id === "view-" + name));
  if (name === "attendance") renderDash();
  if (name === "window") renderWindow();
  if (name === "attrition") renderAttr();
  if (name === "memory") renderMem();
  if (name === "files") renderFiles();
}
$$("#mainTabs .tab").forEach(t => t.addEventListener("click", () => switchView(t.dataset.view)));

/* ---------- 日出勤表看板 ---------- */
let selDate = todayStr();
function covers(rec, d) { return rec.date <= d && d < addDays(rec.date, rec.days); }
function filteredAtt() { return attendance.filter(r => covers(r, selDate)); }

function renderDash() {
  renderStats();
  renderAttTable();
  renderDist();
}

function renderStats() {
  const rows = filteredAtt();
  const buckets = [1,2,3,4,5,6].map(n => rows.filter(r => r.days === n).length);
  const uniq = new Set(rows.map(r => r.empNo)).size;
  const cards = [
    { cls: "total", label: "旷工总人数", val: uniq, sub: `${selDate} 在旷窗口` },
    ...[1,2,3,4,5,6].map((n, i) => ({
      cls: "k" + n, label: `旷${n}`, val: buckets[i],
      sub: uniq ? (buckets[i] / uniq * 100).toFixed(0) + "%" : "0%"
    }))
  ];
  const hasData = rows.length > 0;
  $("#statCards").innerHTML = cards.map(c => `
    <div class="stat-card ${c.cls}">
      <div class="label">${c.label}</div>
      <div class="value">${hasData || c.cls === "total" ? c.val : '<span class="empty-hint">—</span>'}</div>
      <div class="sub">${c.sub}</div>
    </div>`).join("");
}

function renderAttTable() {
  const rows = filteredAtt().slice().sort((a, b) => b.days - a.days || a.empNo.localeCompare(b.empNo));
  $("#attCount").textContent = `${new Set(rows.map(r => r.empNo)).size} 人 / ${rows.length} 条`;
  $("#attTable tbody").innerHTML = rows.length ? rows.map(r => `
    <tr>
      <td>${esc(r.empNo)}</td><td>${esc(r.name)}</td><td>${esc(r.dept)}</td>
      <td>${esc(r.group || "—")}</td><td>${esc(r.project)}</td><td>${esc(r.date)}</td>
      <td><b>${r.days}</b> 天</td>
      <td>${statusTag(recStatus(r))}</td>
      <td><button class="row-del" data-del="${r.id}" title="删除">🗑</button></td>
    </tr>`).join("") : `<tr><td colspan="9" style="text-align:center;color:var(--muted);padding:40px">该日期无旷工窗口数据,可导入Excel或切换日期</td></tr>`;
}

function recStatus(r) {
  const end = addDays(r.date, r.days - 1);
  const t = todayStr();
  if (end < t) return "已结束";
  if (r.date > t) return "未开始";
  return "进行中";
}
function statusTag(s) {
  const cls = { "进行中": "tag-ing", "已结束": "tag-end", "未开始": "tag-future" }[s] || "tag-end";
  return `<span class="tag ${cls}">${s}</span>`;
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
  const keep = (sel, opts) => { $("#winDept").innerHTML = `<option value="">全部部门</option>` + opts[0].map(d=>`<option ${d===sel?"selected":""}>${esc(d)}</option>`).join(""); };
  if ($("#winDept").options.length - 1 !== depts.length) keep(dept, [depts]);
  $("#winProj").innerHTML = `<option value="">全部项目</option>` + projs.map(p=>`<option ${p===proj?"selected":""}>${esc(p)}</option>`).join("");
  let rows = attendance.slice();
  if (dept) rows = rows.filter(r => r.dept === dept);
  if (proj) rows = rows.filter(r => r.project === proj);
  if (st) rows = rows.filter(r => recStatus(r) === st);
  if (q) rows = rows.filter(r => (r.empNo + r.name).toLowerCase().includes(q));
  rows.sort((a,b) => b.date.localeCompare(a.date) || b.days - a.days);
  $("#winCount").textContent = `${rows.length} 条`;
  $("#winTable tbody").innerHTML = rows.length ? rows.map(r => `
    <tr>
      <td>${esc(r.empNo)}</td><td>${esc(r.name)}</td><td>${esc(r.dept)}</td><td>${esc(r.group || "—")}</td><td>${esc(r.project)}</td>
      <td>${esc(r.date)}</td><td>${esc(addDays(r.date, r.days - 1))}</td><td><b>${r.days}</b></td>
      <td>${statusTag(recStatus(r))}</td>
      <td><button class="row-del" data-del="${r.id}" title="删除">🗑</button></td>
    </tr>`).join("") : `<tr><td colspan="10" style="text-align:center;color:var(--muted);padding:40px">无匹配记录</td></tr>`;
}
["winDept","winProj","winStatus"].forEach(id => $("#" + id).addEventListener("change", renderWindow));
$("#winSearch").addEventListener("input", renderWindow);

/* ---------- 流失率报表 ---------- */
function rateCell(a, b) { return b > 0 ? (a / b * 100).toFixed(1) + "%" : "—"; }
function renderAttr() {
  const rows = attrition;
  const months = [...new Set(rows.map(r => r.month))].sort();
  const latest = months[months.length - 1];
  let latestRate = "—", worst = "—", worstVal = -1;
  if (latest) {
    const rs = rows.filter(r => r.month === latest);
    const s = rs.reduce((a,r)=>a+(+r.start||0),0), l = rs.reduce((a,r)=>a+(+r.left||0),0);
    latestRate = s > 0 ? (l/s*100).toFixed(1)+"%" : "—";
    rs.forEach(r => { const v = (+r.start||0) > 0 ? (+r.left||0)/(+r.start) : 0; if (v > worstVal) { worstVal = v; worst = r.dept; } });
  }
  $("#attCards").innerHTML = `
    <div class="stat-card total"><div class="label">最新月份(${esc(latest || "—")})整体流失率</div><div class="value">${latestRate}</div><div class="sub">全部部门合计</div></div>
    <div class="stat-card k4"><div class="label">最新月流失率最高部门</div><div class="value" style="font-size:22px">${esc(worst)}</div><div class="sub">${worstVal>=0 ? (worstVal*100).toFixed(1)+"%" : "—"}</div></div>
    <div class="stat-card k2"><div class="label">记录条数</div><div class="value">${rows.length}</div><div class="sub">${months.length} 个月份</div></div>`;
  $("#attrTable tbody").innerHTML = rows.length ? rows.map((r, i) => `
    <tr>
      <td><input class="edit-cell" data-f="month" data-i="${i}" value="${esc(r.month)}"></td>
      <td><input class="edit-cell" data-f="dept" data-i="${i}" value="${esc(r.dept)}"></td>
      <td><input class="edit-cell" data-f="start" data-i="${i}" value="${esc(r.start)}" style="text-align:right"></td>
      <td><input class="edit-cell" data-f="left" data-i="${i}" value="${esc(r.left)}" style="text-align:right"></td>
      <td class="cell-rate">${rateCell(+r.left||0, +r.start||0)}</td>
      <td><input class="edit-cell" data-f="note" data-i="${i}" value="${esc(r.note)}"></td>
      <td><button class="row-del" data-attr-del="${r.id}">🗑</button></td>
    </tr>`).join("") : `<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:40px">暂无数据,点击「添加行」或导入Excel</td></tr>`;
}
$("#attrTable").addEventListener("change", e => {
  const el = e.target; if (!el.dataset.f) return;
  const i = +el.dataset.i;
  attrition[i][el.dataset.f] = el.value;
  saveAttr(); LS.set("lastUpdate", Date.now());
  renderAttr();
});

/* ---------- 内存报表 ---------- */
function renderMem() {
  const rows = memory;
  const plan = rows.reduce((a,r)=>a+(+r.plan||0),0), act = rows.reduce((a,r)=>a+(+r.actual||0),0);
  $("#memCards").innerHTML = `
    <div class="stat-card total"><div class="label">计划总量</div><div class="value">${plan.toLocaleString()}</div><div class="sub">${rows.length} 条记录</div></div>
    <div class="stat-card k1"><div class="label">实际总量</div><div class="value" style="color:#16a34a">${act.toLocaleString()}</div><div class="sub">累计</div></div>
    <div class="stat-card k3"><div class="label">总体达成率</div><div class="value" style="color:#d97706">${plan>0?(act/plan*100).toFixed(1)+"%":"—"}</div><div class="sub">实际 ÷ 计划</div></div>`;
  $("#memTable tbody").innerHTML = rows.length ? rows.map((r, i) => `
    <tr>
      <td><input class="edit-cell" data-f="date" data-i="${i}" value="${esc(r.date)}"></td>
      <td><input class="edit-cell" data-f="project" data-i="${i}" value="${esc(r.project)}"></td>
      <td><input class="edit-cell" data-f="plan" data-i="${i}" value="${esc(r.plan)}" style="text-align:right"></td>
      <td><input class="edit-cell" data-f="actual" data-i="${i}" value="${esc(r.actual)}" style="text-align:right"></td>
      <td class="cell-rate">${rateCell(+r.actual||0, +r.plan||0)}</td>
      <td><input class="edit-cell" data-f="note" data-i="${i}" value="${esc(r.note)}"></td>
      <td><button class="row-del" data-mem-del="${r.id}">🗑</button></td>
    </tr>`).join("") : `<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:40px">暂无数据,点击「添加行」或导入Excel</td></tr>`;
}
$("#memTable").addEventListener("change", e => {
  const el = e.target; if (!el.dataset.f) return;
  const i = +el.dataset.i;
  memory[i][el.dataset.f] = el.value;
  saveMem(); LS.set("lastUpdate", Date.now());
  renderMem();
});

/* ---------- Excel 导入/导出 ---------- */
const fileInput = $("#fileInput");
let importTarget = "attendance";

const HEAD_MAP = {
  attendance: {
    empNo: ["员工编号","工号","员工工号","编号"],
    name: ["姓名","员工姓名"],
    date: ["异常日期","开始日期","日期","旷工日期"],
    dept: ["部门","车间","单位"],
    project: ["项目","旷工项目","产线","线体"],
    days: ["连续旷工天数","旷工天数","天数","连续天数","旷工"]
  },
  attrition: {
    month: ["月份","月","统计月份"],
    dept: ["部门","单位"],
    start: ["期初人数","月初人数","期初"],
    left: ["离职人数","离职","流失人数"],
    note: ["备注","说明"]
  },
  memory: {
    date: ["日期","生产日期"],
    project: ["项目","产品","型号"],
    plan: ["计划数量","计划","目标"],
    actual: ["实际数量","实际","产出"],
    note: ["备注","说明"]
  }
};

function pickFile(target) {
  importTarget = target;
  fileInput.value = "";
  fileInput.click();
}
fileInput.addEventListener("change", () => {
  const f = fileInput.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      if (typeof XLSX === "undefined") throw new Error("Excel组件未加载(assets/xlsx.full.min.js)");
      const wb = XLSX.read(ev.target.result, { type: "array", cellDates: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
      const res = importTarget === "attendance" ? importAtt(aoa) : importTarget === "attrition" ? importGeneric(aoa, "attrition") : importGeneric(aoa, "memory");
      showImportResult(f.name, res);
      addLog("imp", `${f.name} → ${res.ok} 条成功${res.dup ? `,${res.dup} 条重复` : ""}${res.fail ? `,${res.fail} 条失败` : ""}`);
      renderAll();
    } catch (err) {
      toast("导入失败:" + err.message, "err");
    }
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
function importAtt(aoa) {
  const F = HEAD_MAP.attendance;
  const hr = findHeaderRow(aoa, F);
  if (hr < 0) return { ok: 0, dup: 0, fail: 0, errors: ["未识别表头,需包含:员工编号/姓名/异常日期/部门/项目/连续旷工天数"] };
  const col = mapCols(aoa[hr], F);
  const res = { ok: 0, dup: 0, fail: 0, errors: [] };
  for (let i = hr + 1; i < aoa.length; i++) {
    const row = aoa[i] || [];
    const get = k => col[k] != null ? String(row[col[k]] ?? "").trim() : "";
    const empNo = get("empNo");
    if (!empNo) { if (row.some(c => String(c).trim())) res.fail++; continue; }
    const date = normDate(col.date != null ? row[col.date] : "");
    const days = Math.max(1, Math.min(6, parseInt(get("days")) || 1));
    if (!date) { res.fail++; res.errors.push(`第${i+1}行 ${empNo}: 日期无法解析`); continue; }
    const rec = { id: uid(), empNo, name: get("name"), dept: get("dept"), project: get("project"), date, days, group: "" };
    const dup = attendance.some(a => a.empNo === rec.empNo && a.date === rec.date && a.project === rec.project);
    if (dup) { res.dup++; continue; }
    applyMaps(rec);
    attendance.push(rec); res.ok++;
  }
  saveAtt();
  return res;
}
function importGeneric(aoa, kind) {
  const F = HEAD_MAP[kind];
  const hr = findHeaderRow(aoa, F);
  if (hr < 0) return { ok: 0, dup: 0, fail: 0, errors: ["未识别表头:" + Object.values(F).flat().join("/")] };
  const col = mapCols(aoa[hr], F);
  const store = kind === "attrition" ? attrition : memory;
  const res = { ok: 0, dup: 0, fail: 0, errors: [] };
  for (let i = hr + 1; i < aoa.length; i++) {
    const row = aoa[i] || [];
    const obj = {};
    for (const k of Object.keys(col)) obj[k] = String(row[col[k]] ?? "").trim();
    if (!Object.values(obj).some(v => v)) continue;
    if (kind === "attrition") { if (!obj.month || !obj.dept) { res.fail++; continue; } obj.start = +obj.start || 0; obj.left = +obj.left || 0; }
    else { obj.date = normDate(obj.date) || obj.date; if (!obj.project) { res.fail++; continue; } obj.plan = +obj.plan || 0; obj.actual = +obj.actual || 0; }
    obj.id = uid(); obj.note = obj.note || "";
    if (kind === "attrition" && attrition.some(a => a.month === obj.month && a.dept === obj.dept)) { res.dup++; continue; }
    store.push(obj); res.ok++;
  }
  kind === "attrition" ? saveAttr() : saveMem();
  return res;
}
function showImportResult(fname, r) {
  $("#importResult").innerHTML = `
    <div><span class="ok">✔ 成功导入 ${r.ok} 条</span>${r.dup ? ` <span style="color:#d97706">· 跳过重复 ${r.dup} 条</span>` : ""}${r.fail ? ` <span class="err">· 失败 ${r.fail} 条</span>` : ""}</div>
    <div style="color:var(--muted);font-size:13px">文件:${esc(fname)} · 已应用项目映射与Group规则</div>
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
  const rows = filteredAtt().map(r => [r.empNo, r.name, r.dept, r.group || "", r.project, r.date, r.days]);
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
    <tr><td>${esc(r.key)}</td><td><b>${esc(r.group)}</b></td>
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
    <div class="log-item"><span class="log-time">${esc(l.time)}</span><span class="log-action ${l.action}">${{add:"新增",del:"删除",imp:"导入",exp:"导出",init:"初始化",edit:"编辑",clear:"清空"}[l.action] || esc(l.action)}</span><span>${esc(l.detail)}</span></div>`).join("")
    : `<div class="empty-inline">暂无日志</div>`;
}
$("#btnRuleAdd").addEventListener("click", () => {
  const k = $("#ruleKey").value.trim(), v = $("#ruleVal").value.trim();
  if (!k || !v) return toast("请填写关键字和Group", "err");
  groupRules.push({ id: uid(), key: k, group: v });
  saveRules(); attendance.forEach(applyMaps); saveAtt();
  $("#ruleKey").value = ""; $("#ruleVal").value = "";
  renderRules(); addLog("add", `Group规则:${k} → ${v}`); toast("规则已添加并重新应用", "ok");
});
$("#btnMapAdd").addEventListener("click", () => {
  const a = $("#mapAlias").value.trim(), s = $("#mapStd").value.trim();
  if (!a || !s) return toast("请填写别名和标准项目名", "err");
  projMap.push({ id: uid(), alias: a, std: s });
  saveMap(); attendance.forEach(applyMaps); saveAtt();
  $("#mapAlias").value = ""; $("#mapStd").value = "";
  renderProjMap(); addLog("add", `项目映射:${a} → ${s}`); toast("映射已添加并重新应用", "ok");
});
$("#btnClearAll").addEventListener("click", () => {
  if (!confirm("确定清空全部数据(含示例数据和日志)?此操作不可恢复。")) return;
  if (!confirm("再次确认:真的要清空吗?")) return;
  ["attendance","groupRules","projMap","attrition","memory","logs","lastUpdate","seeded"].forEach(k => localStorage.removeItem("lws_" + k));
  attendance = []; groupRules = []; projMap = []; attrition = []; memory = []; logs = [];
  LS.set("seeded", true); LS.set("logs", []); logs = [];
  closeModals(); renderAll();
  addLog("clear", "清空全部数据");
  toast("已全部清空", "ok");
});

/* ---------- 源文件视图 ---------- */
async function renderFiles() {
  const grid = $("#filesGrid");
  $("#btnFilesRefresh").textContent = "刷新中…";
  try {
    const d = await (await fetch("./files.json?ts=" + Date.now())).json();
    $("#fileCount").textContent = `${(d.files || []).length} 个`;
    grid.innerHTML = (d.files || []).length ? d.files.map(f => {
      const ext = (f.name.match(/\.([a-z0-9]+)$/i) || [])[1] || "";
      const icons = { xlsx:"📊", xls:"📊", csv:"📊", pdf:"📕", doc:"📄", docx:"📄", html:"🌐", png:"🖼️", jpg:"🖼️", txt:"📝", zip:"🗜️" };
      return `<a class="fcard" href="${esc(f.path)}" target="_blank">
        <div class="ficon">${icons[ext.toLowerCase()] || "📎"}</div>
        <div style="min-width:0"><div class="fname">${esc(f.name)}</div>
        ${f.note ? `<div class="fnote">${esc(f.note)}</div>` : ""}
        <div class="ftags"><span class="ftag">${(ext || "file").toUpperCase()}</span>${f.size ? `<span class="ftag">${esc(f.size)}</span>` : ""}${f.date ? `<span class="ftag">${esc(f.date)}</span>` : ""}</div></div></a>`;
    }).join("") : `<div class="empty-inline">📭 暂无源文件,对 AI 助手说「把文件放到工作区」即可上传</div>`;
  } catch (e) {
    grid.innerHTML = `<div class="empty-inline">⚠️ files.json 加载失败</div>`;
  }
  $("#btnFilesRefresh").textContent = "刷新列表";
}

/* ---------- 全局事件 ---------- */
document.addEventListener("click", e => {
  const del = e.target.closest("[data-del]");
  if (del) {
    const id = del.dataset.del;
    const rec = attendance.find(a => a.id === id);
    attendance = attendance.filter(a => a.id !== id);
    saveAtt(); addLog("del", `${rec ? rec.empNo + " " + rec.name : id} 的旷工窗口`);
    renderDash(); renderWindow();
    return;
  }
  const ad = e.target.closest("[data-attr-del]");
  if (ad) { attrition = attrition.filter(r => r.id !== ad.dataset.attrDel); saveAttr(); addLog("del", "流失率记录"); renderAttr(); return; }
  const md = e.target.closest("[data-mem-del]");
  if (md) { memory = memory.filter(r => r.id !== md.dataset.memDel); saveMem(); addLog("del", "内存报表记录"); renderMem(); return; }
  const rd = e.target.closest("[data-rule-del]");
  if (rd) { groupRules = groupRules.filter(r => r.id !== rd.dataset.ruleDel); saveRules(); attendance.forEach(applyMaps); saveAtt(); renderRules(); return; }
  const pd = e.target.closest("[data-map-del]");
  if (pd) { projMap = projMap.filter(r => r.id !== pd.dataset.mapDel); saveMap(); attendance.forEach(applyMaps); saveAtt(); renderProjMap(); return; }
});

$("#attDate").addEventListener("change", () => { selDate = $("#attDate").value || todayStr(); renderDash(); });
$("#btnToday").addEventListener("click", () => { selDate = todayStr(); $("#attDate").value = selDate; renderDash(); });
$("#btnRefresh").addEventListener("click", () => { renderDash(); toast("已刷新", "ok"); });
$("#btnExport").addEventListener("click", exportAtt);
$("#btnImport").addEventListener("click", () => pickFile("attendance"));
$("#btnWinExport").addEventListener("click", () => {
  const dept = $("#winDept").value, proj = $("#winProj").value, st = $("#winStatus").value, q = $("#winSearch").value.trim().toLowerCase();
  let rows = attendance.slice();
  if (dept) rows = rows.filter(r => r.dept === dept);
  if (proj) rows = rows.filter(r => r.project === proj);
  if (st) rows = rows.filter(r => recStatus(r) === st);
  if (q) rows = rows.filter(r => (r.empNo + r.name).toLowerCase().includes(q));
  exportSheet(`旷窗口监控_${todayStr()}.xlsx`, ["员工编号","姓名","部门","Group","项目","开始日期","结束日期","旷工天数","状态"],
    rows.map(r => [r.empNo, r.name, r.dept, r.group || "", r.project, r.date, addDays(r.date, r.days - 1), r.days, recStatus(r)]));
  addLog("exp", `导出旷窗口监控(${rows.length} 条)`);
  toast(`已导出 ${rows.length} 条`, "ok");
});
$("#btnAttAdd").addEventListener("click", () => { attrition.push({ id: uid(), month: todayStr().slice(0,7), dept: "", start: 0, left: 0, note: "" }); saveAttr(); renderAttr(); });
$("#btnMemAdd").addEventListener("click", () => { memory.push({ id: uid(), date: todayStr(), project: "", plan: 0, actual: 0, note: "" }); saveMem(); renderMem(); });
$("#btnAttImport").addEventListener("click", () => pickFile("attrition"));
$("#btnMemImport").addEventListener("click", () => pickFile("memory"));
$("#btnAttExport").addEventListener("click", () => {
  exportSheet(`流失率报表_${todayStr()}.xlsx`, ["月份","部门","期初人数","离职人数","流失率","备注"],
    attrition.map(r => [r.month, r.dept, r.start, r.left, (+r.start||0)>0 ? ((+r.left||0)/(+r.start)*100).toFixed(1)+"%" : "", r.note]));
  addLog("exp", `导出流失率报表(${attrition.length} 条)`); toast("已导出", "ok");
});
$("#btnMemExport").addEventListener("click", () => {
  exportSheet(`内存报表_${todayStr()}.xlsx`, ["日期","项目","计划数量","实际数量","达成率","备注"],
    memory.map(r => [r.date, r.project, r.plan, r.actual, (+r.plan||0)>0 ? ((+r.actual||0)/(+r.plan)*100).toFixed(1)+"%" : "", r.note]));
  addLog("exp", `导出内存报表(${memory.length} 条)`); toast("已导出", "ok");
});
["btnLogs","btnAttLogs","btnMemLogs"].forEach(id => $("#" + id).addEventListener("click", () => { renderLogs(); openModal("modal-logs"); }));
$("#btnFiles").addEventListener("click", () => switchView("files"));
$("#btnFilesBack").addEventListener("click", () => switchView("attendance"));
$("#btnFilesRefresh").addEventListener("click", renderFiles);

function renderAll() {
  if (currentView === "attendance") renderDash();
  if (currentView === "window") renderWindow();
  if (currentView === "attrition") renderAttr();
  if (currentView === "memory") renderMem();
  $("#updTime").textContent = fmtTs(LS.get("lastUpdate", Date.now()));
}

/* ---------- 初始化 ---------- */
(function init() {
  $("#attDate").value = selDate;
  $("#footDate").textContent = "今天是 " + todayStr();
  $("#updTime").textContent = fmtTs(LS.get("lastUpdate", Date.now()));
  renderDash();
})();
