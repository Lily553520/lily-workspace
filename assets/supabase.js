/* ============ Supabase REST client + setup + seed ============ */
"use strict";

const SB = {
  url: localStorage.getItem("sb_url") || "",
  key: localStorage.getItem("sb_key") || "",
  ready() { return !!(this.url && this.key); },
  h(extra) {
    const h = { apikey: this.key, Authorization: "Bearer " + this.key, "Content-Type": "application/json" };
    return Object.assign(h, extra || {});
  },
  async req(method, path, body, prefer) {
    const headers = this.h(prefer ? { Prefer: prefer } : null);
    const r = await fetch(this.url + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) {
      let msg = "HTTP " + r.status;
      try { const j = await r.json(); msg = j.message || j.error_description || msg; } catch (e) {}
      throw new Error(msg);
    }
    const ct = r.headers.get("content-type") || "";
    return ct.includes("json") ? r.json() : r.text();
  },
  /* table CRUD */
  async select(table, qs) { return this.req("GET", `/rest/v1/${table}?select=*${qs ? "&" + qs : ""}`); },
  async insert(table, rows) { return this.req("POST", `/rest/v1/${table}`, rows, "return=representation"); },
  async update(table, id, patch) { return this.req("PATCH", `/rest/v1/${table}?id=eq.${id}`, patch, "return=representation"); },
  async remove(table, id) { return this.req("DELETE", `/rest/v1/${table}?id=eq.${id}`); },
  /* storage */
  async uploadFile(path, file) {
    const h = this.h(); delete h["Content-Type"];
    h["x-upsert"] = "true";
    const r = await fetch(`${this.url}/storage/v1/object/files/${path}`, { method: "POST", headers: h, body: file });
    if (!r.ok) throw new Error("Upload failed: HTTP " + r.status);
    return path;
  },
  async listFiles(prefix) {
    return this.req("POST", "/storage/v1/object/list/files", { prefix: prefix || "", limit: 200, sortBy: { column: "created_at", order: "desc" } });
  },
  filePublicUrl(path) { return `${this.url}/storage/v1/object/public/files/${path}`; },
  async removeFile(path) { return this.req("DELETE", `/storage/v1/object/files/${path}`); }
};

/* ---------- setup screen ---------- */
function showSetup() {
  const d = document.createElement("div");
  d.id = "setupScreen";
  d.innerHTML = `
    <div class="setup-box">
      <div class="setup-logo">📊</div>
      <h2>考勤数据管理平台</h2>
      <p class="setup-sub">首次使用:填入 Supabase 连接信息(仅存本机浏览器)</p>
      <label>Project URL</label>
      <input id="setupUrl" placeholder="https://xxxx.supabase.co" spellcheck="false">
      <label>Publishable / anon key</label>
      <textarea id="setupKey" rows="3" placeholder="sb_publishable_... 或 eyJ..." spellcheck="false"></textarea>
      <button id="setupGo" class="setup-btn">保存并进入平台</button>
      <p class="setup-err" id="setupErr"></p>
      <p class="setup-tip">这两个值来自 Supabase → Project Settings → API。<br>它们是公开密钥,非密码; secret/service_role 密钥请勿填入。</p>
    </div>`;
  document.body.appendChild(d);
  $("#setupGo").addEventListener("click", () => {
    const u = $("#setupUrl").value.trim().replace(/\/+$/, "");
    const k = $("#setupKey").value.trim();
    const err = $("#setupErr");
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(u)) { err.textContent = "URL 格式不对,应为 https://xxxx.supabase.co"; return; }
    if (k.length < 20) { err.textContent = "Key 看起来太短,请完整粘贴"; return; }
    localStorage.setItem("sb_url", u);
    localStorage.setItem("sb_key", k);
    location.reload();
  });
}

/* ---------- demo seed (chạy 1 lần khi bảng rỗng) ---------- */
async function seedIfEmpty() {
  try {
    const att = await SB.select("attendance", "limit=1");
    const flag = localStorage.getItem("sb_seeded") === "1";
    if (att.length > 0 || flag) return;
    const T = todayStr();
    const people = [
      ["G10231","张伟","制造一部","A1线-P01客户",0,3],["G10245","李娜","制造一部","A1线-P01客户",0,1],
      ["G10312","王强","制造二部","B2线-P02客户",0,6],["G10318","刘敏","制造二部","B2线-P02客户",1,4],
      ["G10402","陈杰","品质部","C3线-P03客户",0,2],["G10415","杨洋","品质部","C3线-P03客户",2,5],
      ["G10533","赵磊","设备部","D4线-P04客户",0,1],["G10540","黄霞","设备部","A1线-P01客户",3,2],
      ["G10611","周涛","制造一部","B2线-P02客户",1,6],["G10625","吴静","制造二部","C3线-P03客户",0,3],
      ["G10701","徐鹏","仓储部","D4线-P04客户",4,1],["G10719","孙丽","仓储部","A1线-P01客户",0,2],
      ["G10823","马超","制造一部","C3线-P03客户",5,4],["G10830","朱婷","制造二部","D4线-P04客户",2,1],
      ["G10901","胡军","品质部","B2线-P02客户",0,5],["G10914","林芳","设备部","C3线-P03客户",1,2],
      ["G11022","郑凯","制造一部","D4线-P04客户",0,4],["G11035","王雪","制造二部","A1线-P01客户",6,3]
    ];
    await SB.insert("attendance", people.map(p => ({
      emp_no: p[0], name: p[1], dept: p[2], project: p[3],
      start_date: addDays(T, -p[4]), days: p[5], note: ""
    })));
    await SB.insert("group_rules", [
      { key: "一部", group_name: "G1" },{ key: "二部", group_name: "G2" },
      { key: "品质", group_name: "G3" },{ key: "设备", group_name: "G4" },{ key: "仓储", group_name: "G5" }
    ]);
    await SB.insert("project_map", [
      { alias: "A1", std: "A1线-P01客户" },{ alias: "B2", std: "B2线-P02客户" },
      { alias: "C3", std: "C3线-P03客户" },{ alias: "D4", std: "D4线-P04客户" }
    ]);
    await SB.insert("attrition", [
      { month: "2026-06", dept: "制造一部", start_count: 320, left_count: 18, note: "" },
      { month: "2026-06", dept: "制造二部", start_count: 280, left_count: 22, note: "" },
      { month: "2026-07", dept: "制造一部", start_count: 315, left_count: 12, note: "旺季前稳定" },
      { month: "2026-07", dept: "制造二部", start_count: 265, left_count: 25, note: "" },
      { month: "2026-08", dept: "制造一部", start_count: 310, left_count: 9, note: "" },
      { month: "2026-08", dept: "制造二部", start_count: 258, left_count: 31, note: "月底集中离职" }
    ]);
    const mem = [];
    for (let i = 4; i >= 0; i--) {
      const d = addDays(T, -i);
      mem.push({ date: d, project: "DDR5-8G", plan_count: 12000, actual_count: 11400 + i * 130, note: "" });
      mem.push({ date: d, project: "eMMC-64G", plan_count: 8000, actual_count: 8210 - i * 90, note: "" });
    }
    await SB.insert("memory_report", mem);
    const secs = await SB.insert("board_sections", [
      { name: "Báo cáo chấm công", order_idx: 0 },
      { name: "Phân tích dữ liệu", order_idx: 1 },
      { name: "Công việc khác", order_idx: 2 }
    ]);
    if (secs && secs.length >= 3) {
      await SB.insert("board_tasks", [
        { section_id: secs[0].id, title: "Tổng hợp dữ liệu nghỉ việc tuần này", status: "pending", note: "AI tính giúp tỷ lệ nghỉ việc theo bộ phận" },
        { section_id: secs[1].id, title: "Phân tích nghỉ việc liên tiếp tháng 9", status: "processing", note: "Đọc file Excel đính kèm, xuất bảng thống kê" },
        { section_id: secs[2].id, title: "Xuất báo cáo Excel mẫu", status: "done", note: "File hoàn thành đính kèm bên dưới" }
      ]);
    }
    await SB.insert("ops_logs", [{ action: "初始化", detail: "首次连接 Supabase,自动载入示例数据" }]);
    localStorage.setItem("sb_seeded", "1");
  } catch (e) {
    console.warn("seed skipped:", e.message);
  }
}
