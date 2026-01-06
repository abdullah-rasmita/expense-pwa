import { db, makeExpense, makeShoppingItem, makeShoppingList, makeConflict } from "./db.js";
import { nowMs, todayISO, weekStartISO, weekEndISO, monthStartISO, monthEndISO } from "./util.js";

function el(id){ return document.getElementById(id); }

function flash(id, opts={ms:1200}){
  const e = el(id);
  if (!e) return;
  e.classList.remove("flash");
  // trigger reflow
  void e.offsetWidth;
  e.classList.add("flash");
  if (opts.ms !== 0){
    setTimeout(()=>e.classList.remove("flash"), opts.ms);
  }
}

function escapeHtml(s){
  return String(s??"")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function money(n){
  const x = Number(n||0);
  return x.toFixed(2);
}

function sum(nums){
  return nums.reduce((a,b)=>a+Number(b||0),0);
}

export async function refreshConflictBadge(){
  const open = await db.conflicts.toCollection().filter(c => c.status === "open").count();
  const badge = el("conflictBadge");
  if (badge) badge.textContent = String(open);
}

async function categories(){
  // IMPORTANT: don't do equals(null) on indexed keys (IndexedDB keys can't be null).
  return db.categories.toCollection()
    .filter(c => c.deleted_at == null)
    .toArray();
}

function catSelectHtml(cats, selected){
  const opts = cats.map(c=>`<option value="${c.id}" ${c.id===selected?"selected":""}>${escapeHtml(c.name)}</option>`).join("");
  return `<select id="categorySelect">${opts}</select>`;
}

function viewHtmlShell(title, subtitle, bodyHtml){
  return `
    <div class="panel">
      <div class="hrow">
        <div>
          <div class="h1">${escapeHtml(title)}</div>
          <div class="muted">${escapeHtml(subtitle||"")}</div>
        </div>
      </div>
      ${bodyHtml}
    </div>
  `;
}

async function getOrCreateList(period_type, start_date, end_date){
  let list = await db.shopping_lists
    .where("period_type")
    .equals(period_type)
    .filter(l => l.deleted_at == null && l.start_date === start_date && l.end_date === end_date)
    .first();

  if (!list){
    list = makeShoppingList({period_type, start_date, end_date, source:"auto"});
    await db.shopping_lists.put(list);
  }
  return list;
}

async function getItemsForList(list_id){
  const items = await db.shopping_items.where("list_id").equals(list_id).toArray();
  return items.filter(i => i.deleted_at == null);
}

async function renderShopping(period_type){
  const container = el(period_type === "weekly" ? "view-weekly" : "view-monthly");
  if (!container) return;

  const today = todayISO();
  const start = period_type === "weekly" ? weekStartISO(today) : monthStartISO(today);
  const end   = period_type === "weekly" ? weekEndISO(today)   : monthEndISO(today);

  const list = await getOrCreateList(period_type, start, end);
  const items = await getItemsForList(list.id);

  const plannedTotal = sum(items.map(i => i.planned_price));
  const actualTotal  = sum(items.map(i => i.actual_price));

  const rows = items.map(i => `
    <div class="row">
      <label class="chk">
        <input type="checkbox" data-act="toggle" data-id="${i.id}" ${i.checked ? "checked" : ""}/>
        <span>${escapeHtml(i.name)}</span>
      </label>

      <div class="prices">
        <div class="priceBox">
          <div class="lbl">Planned</div>
          <input class="num" inputmode="decimal" data-act="planned" data-id="${i.id}" value="${i.planned_price ?? ""}" placeholder="0"/>
        </div>
        <div class="priceBox">
          <div class="lbl">Actual</div>
          <input class="num" inputmode="decimal" data-act="actual" data-id="${i.id}" value="${i.actual_price ?? ""}" placeholder="0"/>
        </div>
      </div>

      <button class="btn btn-danger sm" data-act="del" data-id="${i.id}">Delete</button>
    </div>
  `).join("");

  container.innerHTML = viewHtmlShell(
    period_type === "weekly" ? "Weekly Shopping" : "Monthly Shopping",
    `${start} → ${end}`,
    `
      <div class="panel2">
        <div class="h2">Add item</div>
        <div class="grid2">
          <input id="${period_type}-name" placeholder="Item name (e.g. milk)" />
          <input id="${period_type}-planned" class="num" inputmode="decimal" placeholder="Planned price" />
          <input id="${period_type}-actual" class="num" inputmode="decimal" placeholder="Actual price (optional)" />
          <button id="${period_type}-add" class="btn btn-primary">Add</button>
        </div>
      </div>

      <div class="panel2">
        <div class="h2">Items</div>
        ${rows || `<div class="muted">No items yet.</div>`}
      </div>

      <div class="panel2">
        <div class="h2">Totals</div>
        <div class="totals">
          <div><span class="muted">Planned:</span> ${money(plannedTotal)}</div>
          <div><span class="muted">Actual:</span> ${money(actualTotal)}</div>
        </div>
      </div>
    `
  );

  // Add
  el(`${period_type}-add`)?.addEventListener("click", async ()=>{
    const name = el(`${period_type}-name`).value.trim();
    const planned = el(`${period_type}-planned`).value.trim();
    const actual  = el(`${period_type}-actual`).value.trim();
    if (!name) return;

    const it = makeShoppingItem({
      list_id: list.id,
      name,
      planned_price: planned === "" ? null : Number(planned),
      actual_price: actual === "" ? null : Number(actual),
      checked: false,
      source: "manual"
    });
    await db.shopping_items.put(it);

    el(`${period_type}-name`).value = "";
    el(`${period_type}-planned`).value = "";
    el(`${period_type}-actual`).value = "";

    await renderShopping(period_type);
  });

  // Actions
  container.querySelectorAll("[data-act]").forEach(node=>{
    const act = node.getAttribute("data-act");
    const id  = node.getAttribute("data-id");

    if (node.tagName === "INPUT"){
      node.addEventListener("change", async ()=>{
        const it = await db.shopping_items.get(id);
        if (!it) return;

        if (act === "toggle"){
          it.checked = node.checked;
        } else if (act === "planned"){
          it.planned_price = node.value === "" ? null : Number(node.value);
        } else if (act === "actual"){
          it.actual_price = node.value === "" ? null : Number(node.value);
        }
        it.updated_at = nowMs();
        await db.shopping_items.put(it);
        if (act === "toggle") await renderShopping(period_type);
      });
    } else {
      node.addEventListener("click", async ()=>{
        if (act === "del"){
          const it = await db.shopping_items.get(id);
          if (!it) return;
          it.deleted_at = nowMs();
          it.updated_at = nowMs();
          await db.shopping_items.put(it);
          await renderShopping(period_type);
        }
      });
    }
  });
}

export async function renderWeekly(){
  await renderShopping("weekly");
}
export async function renderMonthly(){
  await renderShopping("monthly");
}

export async function renderExpenses(){
  const container = el("view-expenses");
  if (!container) return;

  const cats = await categories();
  const catOpts = cats.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");

  const all = await db.expenses.toArray();
  const exps = all.filter(e => e.deleted_at == null).sort((a,b)=> (b.date||"").localeCompare(a.date||""));

  const rows = exps.map(e=>{
    const c = cats.find(x=>x.id===e.category_id);
    return `
      <div class="row">
        <div class="col">
          <div class="strong">${escapeHtml(e.note || "(no note)")}</div>
          <div class="muted">${escapeHtml(e.date)} · ${escapeHtml(c?.name || "Other")}</div>
        </div>
        <div class="amt">${money(e.amount)}</div>
        <button class="btn btn-danger sm" data-expdel="${e.id}">Delete</button>
      </div>
    `;
  }).join("");

  container.innerHTML = viewHtmlShell(
    "Other Expenses",
    "Add ad-hoc expenses with date + category",
    `
      <div class="panel2">
        <div class="h2">Add expense</div>
        <div class="grid3">
          <input id="expDate" type="date" value="${todayISO()}" />
          <select id="expCat">${catOpts}</select>
          <input id="expAmt" class="num" inputmode="decimal" placeholder="Amount" />
          <input id="expNote" placeholder="Note (optional)" />
          <button id="expAdd" class="btn btn-primary">Add</button>
        </div>
      </div>

      <div class="panel2">
        <div class="h2">History</div>
        ${rows || `<div class="muted">No expenses yet.</div>`}
      </div>
    `
  );

  el("expAdd")?.addEventListener("click", async ()=>{
    const date = el("expDate").value || todayISO();
    const category_id = el("expCat").value || cats[0]?.id;
    const amt = el("expAmt").value.trim();
    const note = el("expNote").value.trim();

    if (amt === "") return;

    const ex = makeExpense({date, amount:Number(amt), category_id, note, source:"manual"});
    await db.expenses.put(ex);
    el("expAmt").value = "";
    el("expNote").value = "";
    await renderExpenses();
  });

  container.querySelectorAll("[data-expdel]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const id = btn.getAttribute("data-expdel");
      const ex = await db.expenses.get(id);
      if (!ex) return;
      ex.deleted_at = nowMs();
      ex.updated_at = nowMs();
      await db.expenses.put(ex);
      await renderExpenses();
    });
  });
}

export async function renderSummary(){
  const container = el("view-summary");
  if (!container) return;

  const today = todayISO();
  const startDefault = monthStartISO(today);
  const endDefault = today;

  container.innerHTML = viewHtmlShell(
    "Summary",
    "Includes: Other expenses + Weekly/Monthly actual shopping",
    `
      <div class="panel2">
        <div class="h2">Filter</div>
        <div class="grid3">
          <input id="sumStart" type="date" value="${startDefault}" />
          <input id="sumEnd" type="date" value="${endDefault}" />
          <button id="sumRun" class="btn btn-primary">Update</button>
        </div>
      </div>

      <div class="panel2">
        <div class="h2">Chart</div>
        <div class="chartBox">
          <canvas id="sumChart"></canvas>
        </div>
      </div>

      <div class="panel2">
        <div class="h2">Totals</div>
        <div id="sumTotals" class="muted">Press Update</div>
      </div>
    `
  );

  // Keep one chart instance
  if (!window.__sumChart) window.__sumChart = null;

  async function collectSpending(s, e){
    // 1) Other expenses (date-based)
    const allExp = await db.expenses.toArray();
    const exps = allExp
      .filter(x => x.deleted_at == null)
      .filter(x => x.date >= s && x.date <= e);

    // 2) Shopping actuals (weekly/monthly lists)
    const allLists = await db.shopping_lists.toArray();
    const lists = allLists
      .filter(l => l.deleted_at == null)
      // include lists that overlap range (simple overlap check)
      .filter(l => !(l.end_date < s || l.start_date > e));

    const allItems = await db.shopping_items.toArray();
    const items = allItems.filter(i => i.deleted_at == null);

    // attribute each shopping-item actual to its list.start_date (a stable choice)
    const shoppingEntries = [];
    for (const l of lists){
      const its = items.filter(i => i.list_id === l.id);
      for (const it of its){
        const a = (it.actual_price == null ? null : Number(it.actual_price));
        if (a != null && !Number.isNaN(a) && a > 0){
          shoppingEntries.push({ date: l.start_date, amount: a });
        }
      }
    }

    // Combine
    const combined = [
      ...exps.map(x => ({ date: x.date, amount: Number(x.amount || 0) })),
      ...shoppingEntries
    ];

    return combined;
  }

  async function compute(){
    const s = el("sumStart").value || startDefault;
    const e = el("sumEnd").value || endDefault;

    const entries = await collectSpending(s, e);

    // Aggregate by date
    const byDay = new Map();
    for (const x of entries){
      const d = x.date;
      byDay.set(d, (byDay.get(d) || 0) + Number(x.amount || 0));
    }

    const labels = Array.from(byDay.keys()).sort();
    const values = labels.map(k => byDay.get(k));

    const total = values.reduce((a,b)=>a+b,0);

    const canvas = el("sumChart");
    const ctx = canvas.getContext("2d");

    if (!window.Chart){
      el("sumTotals").innerHTML = `Chart.js not loaded. Total: ${money(total)}`;
      return;
    }

    // Create once, then update (prevents growth + flicker)
    if (!window.__sumChart){
      window.__sumChart = new window.Chart(ctx, {
        type: "line",
        data: {
          labels,
          datasets: [{ label: "Spending", data: values }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false
        }
      });
    } else {
      window.__sumChart.data.labels = labels;
      window.__sumChart.data.datasets[0].data = values;
      window.__sumChart.update();
    }

    el("sumTotals").innerHTML = `
      <div><span class="muted">Range:</span> ${escapeHtml(s)} → ${escapeHtml(e)}</div>
      <div><span class="muted">Entries counted:</span> ${entries.length}</div>
      <div><span class="muted">Total:</span> ${money(total)}</div>
    `;
  }

  // IMPORTANT: avoid duplicate listeners across rerenders
  el("sumRun").onclick = compute;

  await compute();
}

export async function renderSettings(){
  const container = el("view-settings");
  if (!container) return;

  const device = await db.meta.get("device_id");
  container.innerHTML = viewHtmlShell(
    "Settings",
    "Local-first. Use Sync for Drive backup.",
    `
      <div class="panel2">
        <div class="h2">Device</div>
        <div class="muted">Device ID: ${escapeHtml(device?.value || "")}</div>
      </div>
    `
  );
}

export async function renderConflicts(){
  const container = el("view-conflicts");
  if (!container) return;

  const all = await db.conflicts.toArray();
  const open = all.filter(c=>c.status==="open");
  container.innerHTML = viewHtmlShell(
    "Conflicts",
    "Resolve merge conflicts after sync",
    `
      <div class="panel2">
        <div class="h2">Open conflicts</div>
        ${open.length ? `<div class="muted">${open.length} open</div>` : `<div class="muted">No conflicts 🎉</div>`}
      </div>
    `
  );
}

export function toast(msg){
  const t = el("toast");
  if (!t) return;
  t.innerHTML = `<div>${escapeHtml(msg)}</div>`;
  t.classList.remove("hidden");
  flash("toast", {ms:1200});
  setTimeout(()=>t.classList.add("hidden"), 1800);
}

export async function renderAll(){
  await renderWeekly();
  await renderMonthly();
  await renderExpenses();
  await renderSummary();
  await renderSettings();
}
