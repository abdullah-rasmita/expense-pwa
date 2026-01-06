import { db, makeExpense, makeShoppingItem, makeShoppingList, softDelete, touch } from "./db.js";
import { isoDate, startOfWeek, endOfWeek, startOfMonth, endOfMonth, fmtMoney, nowMs } from "./util.js";

export function toast(msg, opts={}){
  const el = document.getElementById("toast");
  el.innerHTML = msg;
  el.classList.remove("hidden");
  if (opts.ms !== 0){
    setTimeout(()=>el.classList.add("hidden"), opts.ms ?? 4200);
  }
}

export async function refreshConflictBadge(){
  const n = await db.conflicts.where("status").equals("open").count();
  document.getElementById("conflictBadge").textContent = String(n);
  return n;
}

export async function renderAll(){
  await renderWeekly();
  await renderMonthly();
  await renderExpenses();
  await renderSummary();
  await renderSettings();
}

async function categories(){
  return db.categories.where("deleted_at").equals(null).toArray();
}

function catSelectHtml(cats, selected){
  const opts = cats.map(c=>`<option value="${c.id}" ${c.id===selected?"selected":""}>${escapeHtml(c.name)}</option>`).join("");
  return `<select id="categorySelect">${opts}</select>`;
}

function escapeHtml(s){
  return String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
}

// ------------------ Weekly ------------------
export async function renderWeekly(){
  const view = document.getElementById("view-weekly");
  const today = isoDate();
  const ws = startOfWeek(today), we = endOfWeek(today);
  let list = await db.shopping_lists.where({period_type:"weekly", start_date: ws, end_date: we}).first();
  if (!list){
    list = makeShoppingList({period_type:"weekly", start_date: ws, end_date: we, title: `Week ${ws}`});
    await db.shopping_lists.add(list);
  }

  const cats = await categories();
  const items = await db.shopping_items.where({list_id: list.id}).toArray();
  const alive = items.filter(x=>x.deleted_at==null);

  const plannedTotal = alive.reduce((s,x)=>s+(x.planned_price||0)*(x.qty||1),0);
  const actualTotal  = alive.reduce((s,x)=>s+((x.checked? (x.actual_price ?? x.planned_price ?? 0) : 0)*(x.qty||1)),0);

  view.innerHTML = `
    <div class="card">
      <div class="row">
        <div>
          <div class="title">Weekly shopping</div>
          <div class="small">${ws} → ${we}</div>
        </div>
        <div class="pill warn">Planned $${fmtMoney(plannedTotal)}</div>
        <div class="pill ok">Actual $${fmtMoney(actualTotal)}</div>
      </div>
      <hr/>
      <div class="row">
        <div>
          <label>Item</label>
          <input id="wName" placeholder="e.g., Chicken" />
        </div>
        <div>
          <label>Qty</label>
          <input id="wQty" type="number" value="1" min="0" step="1" />
        </div>
        <div>
          <label>Planned price</label>
          <input id="wPlanned" type="number" placeholder="0.00" step="0.01" />
        </div>
        <div>
          <label>Category</label>
          ${catSelectHtml(cats, cats[0]?.id)}
        </div>
        <div style="flex:0 0 auto">
          <label>&nbsp;</label>
          <button id="btnAddW" class="btn">Add</button>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="title">Items</div>
      <div class="list">
        ${alive.map(x=>itemRowHtml(x,cats)).join("") || `<div class="small">No items yet.</div>`}
      </div>
    </div>
  `;

  view.querySelector("#btnAddW").onclick = async ()=>{
    const name = view.querySelector("#wName").value.trim();
    if (!name) return toast("Please enter item name");
    const qty = Number(view.querySelector("#wQty").value||1);
    const planned_price = view.querySelector("#wPlanned").value;
    const category_id = view.querySelector("#categorySelect").value || null;
    const it = makeShoppingItem({list_id:list.id, name, qty, planned_price, checked:false, category_id});
    await db.shopping_items.add(it);
    toast("Added");
    await renderWeekly();
    await refreshConflictBadge();
  };

  // item handlers
  for (const x of alive){
    const chk = view.querySelector(`#chk-${x.id}`);
    const act = view.querySelector(`#act-${x.id}`);
    const del = view.querySelector(`#del-${x.id}`);
    chk.onchange = async ()=>{
      await db.shopping_items.update(x.id, {checked: chk.checked, updated_at: nowMs()});
      toast(chk.checked ? "Checked" : "Unchecked");
      await renderWeekly();
    };
    act.onchange = async ()=>{
      const v = act.value;
      await db.shopping_items.update(x.id, {actual_price: v===""? null : Number(v), updated_at: nowMs()});
      await renderWeekly();
    };
    del.onclick = async ()=>{
      await softDelete("shopping_items", x.id);
      toast("Deleted item");
      await renderWeekly();
    };
  }
}

function itemRowHtml(x, cats){
  const cat = cats.find(c=>c.id===x.category_id)?.name || "";
  const checked = x.checked ? "checked" : "";
  const actual = x.actual_price ?? "";
  const planned = x.planned_price ?? "";
  return `
    <div class="item">
      <input id="chk-${x.id}" type="checkbox" ${checked}/>
      <div class="grow">
        <div><b>${escapeHtml(x.name)}</b> <span class="pill">${escapeHtml(cat)}</span></div>
        <div class="meta">qty ${x.qty||1} • planned $${fmtMoney(planned)}</div>
      </div>
      <div style="width:120px">
        <label>Actual</label>
        <input id="act-${x.id}" type="number" value="${escapeHtml(actual)}" step="0.01" placeholder="" />
      </div>
      <button id="del-${x.id}" class="btn">Delete</button>
    </div>
  `;
}

// ------------------ Monthly ------------------
export async function renderMonthly(){
  const view = document.getElementById("view-monthly");
  const today = isoDate();
  const ms = startOfMonth(today), me = endOfMonth(today);
  let list = await db.shopping_lists.where({period_type:"monthly", start_date: ms, end_date: me}).first();
  if (!list){
    list = makeShoppingList({period_type:"monthly", start_date: ms, end_date: me, title: `Month ${ms.slice(0,7)}`});
    await db.shopping_lists.add(list);
  }
  const cats = await categories();
  const items = await db.shopping_items.where({list_id: list.id}).toArray();
  const alive = items.filter(x=>x.deleted_at==null);

  const plannedTotal = alive.reduce((s,x)=>s+(x.planned_price||0)*(x.qty||1),0);
  const actualTotal  = alive.reduce((s,x)=>s+((x.checked? (x.actual_price ?? x.planned_price ?? 0) : 0)*(x.qty||1)),0);

  view.innerHTML = `
    <div class="card">
      <div class="row">
        <div>
          <div class="title">Monthly shopping</div>
          <div class="small">${ms} → ${me}</div>
        </div>
        <div class="pill warn">Planned $${fmtMoney(plannedTotal)}</div>
        <div class="pill ok">Actual $${fmtMoney(actualTotal)}</div>
      </div>
      <hr/>
      <div class="row">
        <div>
          <label>Item</label>
          <input id="mName" placeholder="e.g., Diapers" />
        </div>
        <div>
          <label>Qty</label>
          <input id="mQty" type="number" value="1" min="0" step="1" />
        </div>
        <div>
          <label>Planned price</label>
          <input id="mPlanned" type="number" placeholder="0.00" step="0.01" />
        </div>
        <div>
          <label>Category</label>
          ${catSelectHtml(cats, cats[0]?.id)}
        </div>
        <div style="flex:0 0 auto">
          <label>&nbsp;</label>
          <button id="btnAddM" class="btn">Add</button>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="title">Items</div>
      <div class="list">
        ${alive.map(x=>itemRowHtml2(x,cats)).join("") || `<div class="small">No items yet.</div>`}
      </div>
    </div>
  `;

  view.querySelector("#btnAddM").onclick = async ()=>{
    const name = view.querySelector("#mName").value.trim();
    if (!name) return toast("Please enter item name");
    const qty = Number(view.querySelector("#mQty").value||1);
    const planned_price = view.querySelector("#mPlanned").value;
    const category_id = view.querySelector("#categorySelect").value || null;
    const it = makeShoppingItem({list_id:list.id, name, qty, planned_price, checked:false, category_id});
    await db.shopping_items.add(it);
    toast("Added");
    await renderMonthly();
  };

  for (const x of alive){
    const chk = view.querySelector(`#mchk-${x.id}`);
    const act = view.querySelector(`#mact-${x.id}`);
    const del = view.querySelector(`#mdel-${x.id}`);
    chk.onchange = async ()=>{
      await db.shopping_items.update(x.id, {checked: chk.checked, updated_at: nowMs()});
      await renderMonthly();
    };
    act.onchange = async ()=>{
      const v = act.value;
      await db.shopping_items.update(x.id, {actual_price: v===""? null : Number(v), updated_at: nowMs()});
      await renderMonthly();
    };
    del.onclick = async ()=>{
      await softDelete("shopping_items", x.id);
      await renderMonthly();
    };
  }
}

function itemRowHtml2(x, cats){
  const cat = cats.find(c=>c.id===x.category_id)?.name || "";
  const checked = x.checked ? "checked" : "";
  const actual = x.actual_price ?? "";
  const planned = x.planned_price ?? "";
  return `
    <div class="item">
      <input id="mchk-${x.id}" type="checkbox" ${checked}/>
      <div class="grow">
        <div><b>${escapeHtml(x.name)}</b> <span class="pill">${escapeHtml(cat)}</span></div>
        <div class="meta">qty ${x.qty||1} • planned $${fmtMoney(planned)}</div>
      </div>
      <div style="width:120px">
        <label>Actual</label>
        <input id="mact-${x.id}" type="number" value="${escapeHtml(actual)}" step="0.01" placeholder="" />
      </div>
      <button id="mdel-${x.id}" class="btn">Delete</button>
    </div>
  `;
}

// ------------------ Expenses ------------------
export async function renderExpenses(){
  const view = document.getElementById("view-expenses");
  const cats = await categories();
  const today = isoDate();
  const ex = await db.expenses.orderBy("date").reverse().toArray();
  const alive = ex.filter(x=>x.deleted_at==null);

  view.innerHTML = `
    <div class="card">
      <div class="title">Other expenses</div>
      <div class="row">
        <div>
          <label>Date</label>
          <input id="eDate" type="date" value="${today}" />
        </div>
        <div>
          <label>Amount</label>
          <input id="eAmt" type="number" step="0.01" placeholder="0.00" />
        </div>
        <div>
          <label>Category</label>
          <select id="eCat">${cats.map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")}</select>
        </div>
        <div>
          <label>Note</label>
          <input id="eNote" placeholder="e.g., lunch, taxi, etc." />
        </div>
        <div style="flex:0 0 auto">
          <label>&nbsp;</label>
          <button id="btnAddE" class="btn">Add</button>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="row">
        <div class="title">Recent</div>
        <div class="small">Tap amount to edit. Delete keeps a tombstone so sync can merge safely.</div>
      </div>
      <div class="list">
        ${alive.slice(0,50).map(e=>expenseRow(e,cats)).join("") || `<div class="small">No expenses yet.</div>`}
      </div>
    </div>
  `;

  view.querySelector("#btnAddE").onclick = async ()=>{
    const date = view.querySelector("#eDate").value || today;
    const amount = view.querySelector("#eAmt").value;
    if (!amount) return toast("Enter amount");
    const category_id = view.querySelector("#eCat").value;
    const note = view.querySelector("#eNote").value.trim();
    const e = makeExpense({date, amount, category_id, note, source:"manual"});
    await db.expenses.add(e);
    toast("Added expense");
    await renderExpenses();
  };

  for (const e of alive.slice(0,50)){
    const amt = view.querySelector(`#amt-${e.id}`);
    const del = view.querySelector(`#edel-${e.id}`);
    amt.onchange = async ()=>{
      await db.expenses.update(e.id, {amount: Number(amt.value||0), updated_at: nowMs()});
      toast("Updated");
      await renderExpenses();
    };
    del.onclick = async ()=>{
      await softDelete("expenses", e.id);
      toast("Deleted (kept for sync)");
      await renderExpenses();
    };
  }
}

function expenseRow(e,cats){
  const cat = cats.find(c=>c.id===e.category_id)?.name || "";
  return `
    <div class="item">
      <div class="grow">
        <div><b>${escapeHtml(e.note||"(no note)")}</b> <span class="pill">${escapeHtml(cat)}</span></div>
        <div class="meta">${e.date} • source ${escapeHtml(e.source||"manual")}</div>
      </div>
      <div style="width:120px">
        <label>Amount</label>
        <input id="amt-${e.id}" type="number" step="0.01" value="${escapeHtml(e.amount)}"/>
      </div>
      <button id="edel-${e.id}" class="btn">Delete</button>
    </div>
  `;
}

// ------------------ Summary ------------------
let chartLine = null;
let chartBar = null;

export async function renderSummary(){
  const view = document.getElementById("view-summary");
  const cats = await categories();
  const today = isoDate();
  const fromDefault = startOfMonth(today);
  const toDefault = today;

  view.innerHTML = `
    <div class="card">
      <div class="title">Summary</div>
      <div class="row">
        <div>
          <label>From</label>
          <input id="sFrom" type="date" value="${fromDefault}" />
        </div>
        <div>
          <label>To</label>
          <input id="sTo" type="date" value="${toDefault}" />
        </div>
        <div>
          <label>Category</label>
          <select id="sCat">
            <option value="">All</option>
            ${cats.map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")}
          </select>
        </div>
        <div>
          <label>Group</label>
          <select id="sGroup">
            <option value="day">Daily</option>
            <option value="week">Weekly</option>
            <option value="month">Monthly</option>
          </select>
        </div>
        <div style="flex:0 0 auto">
          <label>&nbsp;</label>
          <button id="btnRunSummary" class="btn">Update</button>
        </div>
      </div>
      <div class="small">This includes: manual expenses + checked shopping items (weekly/monthly).</div>
    </div>

    <div class="card">
      <div class="title">Time series</div>
      <canvas id="chartLine" height="140"></canvas>
    </div>

    <div class="card">
      <div class="title">By category</div>
      <canvas id="chartBar" height="160"></canvas>
    </div>

    <div id="summaryTable" class="card"></div>
  `;

  const run = async ()=>{
    const from = view.querySelector("#sFrom").value;
    const to = view.querySelector("#sTo").value;
    const cat = view.querySelector("#sCat").value || null;
    const group = view.querySelector("#sGroup").value;

    const series = await buildSeries({from,to,category_id:cat,group, cats});
    drawCharts(series, cats);
    renderTable(view.querySelector("#summaryTable"), series, cats);
  };

  view.querySelector("#btnRunSummary").onclick = run;
  await run();
}

async function buildSeries({from,to,category_id,group,cats}){
  // 1) Manual expenses (alive)
  const manual = (await db.expenses.where("date").between(from, to, true, true).toArray())
    .filter(x=>x.deleted_at==null)
    .filter(x=>!category_id || x.category_id===category_id)
    .map(x=>({date:x.date, amount:Number(x.amount||0), category_id:x.category_id, source:"manual"}));

  // 2) Checked shopping items -> treat as expenses on "list end_date" (or today if missing)
  const lists = await db.shopping_lists.where("start_date").belowOrEqual(to).toArray();
  const listMap = new Map(lists.map(l=>[l.id,l]));
  const items = (await db.shopping_items.toArray())
    .filter(x=>x.deleted_at==null && x.checked)
    .map(x=>{
      const l = listMap.get(x.list_id);
      const date = l?.end_date || isoDate();
      const unitPrice = (x.actual_price ?? x.planned_price ?? 0);
      const amount = Number(unitPrice) * Number(x.qty||1);
      return {date, amount, category_id: x.category_id || null, source: l?.period_type || "list"};
    })
    .filter(x=>x.date>=from && x.date<=to)
    .filter(x=>!category_id || x.category_id===category_id);

  const all = [...manual, ...items];

  // Group key
  const buckets = new Map(); // key -> amount
  for (const r of all){
    const key = bucketKey(r.date, group);
    buckets.set(key, (buckets.get(key)||0) + r.amount);
  }

  const keys = Array.from(buckets.keys()).sort();
  const points = keys.map(k=>({x:k, y: buckets.get(k)||0}));

  // Category totals
  const catTotals = new Map();
  for (const r of all){
    const k = r.category_id || "uncat";
    catTotals.set(k, (catTotals.get(k)||0) + r.amount);
  }

  return {from,to,group, points, catTotals, total: all.reduce((s,r)=>s+r.amount,0), count: all.length};
}

function bucketKey(dateStr, group){
  const d = new Date(dateStr+"T00:00:00");
  if (group==="day") return dateStr;
  if (group==="month") return dateStr.slice(0,7); // YYYY-MM
  // week: ISO-like Monday-week key
  const day = d.getDay();
  const diff = (day===0 ? -6 : 1-day);
  d.setDate(d.getDate()+diff);
  return d.toISOString().slice(0,10);
}

function drawCharts(series, cats){
  const lineCtx = document.getElementById("chartLine");
  const barCtx = document.getElementById("chartBar");

  if (chartLine) chartLine.destroy();
  if (chartBar) chartBar.destroy();

  chartLine = new Chart(lineCtx, {
    type: "line",
    data: {
      labels: series.points.map(p=>p.x),
      datasets: [{ label: "Total", data: series.points.map(p=>p.y) }]
    },
    options: {
      responsive:true,
      plugins:{legend:{display:true}},
      scales:{y:{beginAtZero:true}}
    }
  });

  const labels = [];
  const data = [];
  for (const [catId, amt] of series.catTotals.entries()){
    const name = catId==="uncat" ? "Uncategorized" : (cats.find(c=>c.id===catId)?.name || "Unknown");
    labels.push(name);
    data.push(amt);
  }

  chartBar = new Chart(barCtx, {
    type: "bar",
    data: { labels, datasets: [{ label: "By category", data }] },
    options: { responsive:true, plugins:{legend:{display:true}}, scales:{y:{beginAtZero:true}} }
  });
}

function renderTable(el, series, cats){
  el.innerHTML = `
    <div class="row">
      <div class="title">Totals</div>
      <div class="pill ok">$${fmtMoney(series.total)}</div>
      <div class="pill">${series.count} records</div>
    </div>
    <div class="small">Range: ${series.from} → ${series.to} • Group: ${series.group}</div>
  `;
}

// ------------------ Settings ------------------
export async function renderSettings(){
  const view = document.getElementById("view-settings");
  const cats = await categories();

  view.innerHTML = `
    <div class="card">
      <div class="title">Categories</div>
      <div class="row">
        <div>
          <label>New category</label>
          <input id="cNew" placeholder="e.g., School" />
        </div>
        <div style="flex:0 0 auto">
          <label>&nbsp;</label>
          <button id="btnAddCat" class="btn">Add</button>
        </div>
      </div>
      <hr/>
      <div class="list">
        ${cats.map(c=>`
          <div class="item">
            <div class="grow"><b>${escapeHtml(c.name)}</b></div>
            <button class="btn" data-delcat="${c.id}">Delete</button>
          </div>`).join("")}
      </div>
      <div class="small">Deleting a category keeps a tombstone (safe for sync).</div>
    </div>

    <div class="card">
      <div class="title">Safety</div>
      <div class="small">Sync uses record-level merge. Delete wins vs edit; edited version is stored in Conflicts for restore.</div>
    </div>
  `;

  view.querySelector("#btnAddCat").onclick = async ()=>{
    const name = view.querySelector("#cNew").value.trim();
    if (!name) return toast("Enter category name");
    await db.categories.add({id: crypto.randomUUID(), name, updated_at: nowMs(), deleted_at:null});
    toast("Added category");
    await renderSettings();
  };

  for (const btn of view.querySelectorAll("[data-delcat]")){
    btn.onclick = async ()=>{
      const id = btn.getAttribute("data-delcat");
      await softDelete("categories", id);
      toast("Deleted category");
      await renderSettings();
    };
  }
}

// ------------------ Conflicts ------------------
export async function renderConflicts(){
  const view = document.getElementById("view-conflicts");
  const open = await db.conflicts.where("status").equals("open").toArray();

  view.innerHTML = `
    <div class="card">
      <div class="row">
        <div class="title">Conflicts</div>
        <div class="pill warn">${open.length} open</div>
      </div>
      <div class="small">Default behavior: keep the winner already applied. You can restore or duplicate the losing snapshot.</div>
    </div>
    ${open.map(c=>conflictCard(c)).join("") || `<div class="card"><div class="small">No open conflicts 🎉</div></div>`}
  `;

  for (const c of open){
    const keep = view.querySelector(`#keep-${c.id}`);
    const restore = view.querySelector(`#restore-${c.id}`);
    const dup = view.querySelector(`#dup-${c.id}`);

    keep.onclick = async ()=>resolveConflict(c, "keep_winner");
    restore.onclick = async ()=>resolveConflict(c, "restore_loser");
    dup.onclick = async ()=>resolveConflict(c, "duplicate_loser");
  }
}

function conflictCard(c){
  return `
    <div class="card">
      <div class="row">
        <div>
          <div><b>${escapeHtml(c.record_kind)}</b> • ${escapeHtml(c.reason)}</div>
          <div class="small">Record: <code>${escapeHtml(c.record_id)}</code></div>
        </div>
        <span class="pill warn">OPEN</span>
      </div>
      <hr/>
      <details>
        <summary class="small">Show details</summary>
        <pre class="small" style="white-space:pre-wrap">${escapeHtml(JSON.stringify({winner:c.winner_snapshot, loser:c.loser_snapshot}, null, 2))}</pre>
      </details>
      <div class="row" style="margin-top:10px">
        <button id="keep-${c.id}" class="btn">Keep current</button>
        <button id="restore-${c.id}" class="btn btn-warn">Restore losing</button>
        <button id="dup-${c.id}" class="btn">Duplicate losing</button>
      </div>
      <div class="small">Once resolved, it is locked (only changeable via History mode in a future upgrade).</div>
    </div>
  `;
}

async function resolveConflict(c, action){
  // Apply resolution, then mark conflict resolved.
  if (action === "restore_loser"){
    await applySnapshot(c.record_kind, c.loser_snapshot);
  } else if (action === "duplicate_loser"){
    const copy = {...c.loser_snapshot, id: crypto.randomUUID(), updated_at: nowMs(), deleted_at: null};
    await db[c.record_kind].put(copy);
  }
  await db.conflicts.update(c.id, {status:"resolved", resolved_at: nowMs(), resolution_action: action});
  toast("Conflict resolved");
  await refreshConflictBadge();
  await renderConflicts();
}

async function applySnapshot(kind, snap){
  if (!snap?.id) return;
  // Put winner into its table (overwrite), ensure updated_at bump
  const patched = {...snap, updated_at: nowMs()};
  await db[kind].put(patched);
}
