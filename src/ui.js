// src/ui.js
import { db } from "./db.js";
import { fmtDate, todayISO, weekStartISO, weekEndISO, monthStartISO, monthEndISO, parseISO } from "./util.js";
import { runSync } from "./drive_sync.js";

const $ = (id) => document.getElementById(id);

function setStatus(msg) {
  const el = $("statusLine");
  if (el) el.textContent = msg || "";
}

function esc(s) {
  return (s ?? "").toString()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function categories() {
  // IMPORTANT: don't query equals(null) on an indexed key — IndexedDB keys can't be null.
  const all = await db.categories.toArray();
  return all.filter(c => c.deleted_at == null).sort((a,b) => (a.name||"").localeCompare(b.name||""));
}

async function getOrCreateList(period_type, start_date, end_date) {
  let list = await db.shopping_lists
    .where("period_type")
    .equals(period_type)
    .filter(l => l.deleted_at == null && l.start_date === start_date && l.end_date === end_date)
    .first();

  if (!list) {
    const now = Date.now();
    list = {
      id: crypto.randomUUID(),
      period_type,
      start_date,
      end_date,
      updated_at: now,
      deleted_at: null
    };
    await db.shopping_lists.put(list);
  }
  return list;
}

async function getListItems(list_id) {
  // list_id is indexed, use equals(list_id)
  return db.shopping_items.where("list_id").equals(list_id).toArray();
}

async function upsertShoppingItem(item) {
  const now = Date.now();
  item.updated_at = now;
  if (item.deleted_at === undefined) item.deleted_at = null;
  await db.shopping_items.put(item);
}

async function softDeleteShoppingItem(id) {
  const item = await db.shopping_items.get(id);
  if (!item) return;
  item.deleted_at = Date.now();
  item.updated_at = Date.now();
  await db.shopping_items.put(item);
}

async function upsertExpense(exp) {
  const now = Date.now();
  exp.updated_at = now;
  if (exp.deleted_at === undefined) exp.deleted_at = null;
  await db.expenses.put(exp);
}

async function softDeleteExpense(id) {
  const exp = await db.expenses.get(id);
  if (!exp) return;
  exp.deleted_at = Date.now();
  exp.updated_at = Date.now();
  await db.expenses.put(exp);
}

async function renderWeekly() {
  const view = $("view-weekly");
  if (!view) return;

  const ws = weekStartISO(todayISO());
  const we = weekEndISO(todayISO());
  const list = await getOrCreateList("weekly", ws, we);
  const itemsAll = await getListItems(list.id);
  const items = itemsAll.filter(x => x.deleted_at == null);

  const rows = items.map(it => `
    <div class="row">
      <label class="chk">
        <input type="checkbox" data-action="toggleChecked" data-id="${it.id}" ${it.checked ? "checked" : ""}/>
        <span>${esc(it.name)}</span>
      </label>
      <div class="prices">
        <div class="priceBox">
          <div class="lbl">Planned</div>
          <input class="num" inputmode="decimal" data-action="editPlanned" data-id="${it.id}" value="${it.planned_price ?? ""}" placeholder="0"/>
        </div>
        <div class="priceBox">
          <div class="lbl">Actual</div>
          <input class="num" inputmode="decimal" data-action="editActual" data-id="${it.id}" value="${it.actual_price ?? ""}" placeholder="0"/>
        </div>
      </div>
      <button class="btn danger sm" data-action="deleteItem" data-id="${it.id}">Delete</button>
    </div>
  `).join("");

  const plannedSum = items.reduce((a,b)=>a+(Number(b.planned_price)||0),0);
  const actualSum  = items.reduce((a,b)=>a+(Number(b.actual_price)||0),0);

  view.innerHTML = `
    <div class="panel">
      <div class="hrow">
        <div>
          <div class="h1">Weekly Shopping</div>
          <div class="muted">${ws} → ${we}</div>
        </div>
      </div>

      <div class="panel2">
        <div class="h2">Add item</div>
        <div class="grid2">
          <input id="wk-name" placeholder="Item name (e.g., milk)" />
          <input id="wk-planned" class="num" inputmode="decimal" placeholder="Planned price" />
          <input id="wk-actual" class="num" inputmode="decimal" placeholder="Actual price (optional)" />
          <button id="wk-add" class="btn primary">Add</button>
        </div>
      </div>

      <div class="panel2">
        <div class="h2">Items</div>
        ${rows || `<div class="muted">No items yet.</div>`}
      </div>

      <div class="panel2">
        <div class="h2">Totals</div>
        <div class="totals">
          <div><span class="muted">Planned:</span> ${plannedSum.toFixed(2)}</div>
          <div><span class="muted">Actual:</span> ${actualSum.toFixed(2)}</div>
        </div>
      </div>
    </div>
  `;

  $("wk-add")?.addEventListener("click", async () => {
    const name = $("wk-name").value.trim();
    const planned = $("wk-planned").value.trim();
    const actual = $("wk-actual").value.trim();
    if (!name) return;

    await upsertShoppingItem({
      id: crypto.randomUUID(),
      list_id: list.id,
      name,
      planned_price: planned === "" ? null : Number(planned),
      actual_price: actual === "" ? null : Number(actual),
      checked: false,
      deleted_at: null
    });

    $("wk-name").value = "";
    $("wk-planned").value = "";
    $("wk-actual").value = "";
    await renderWeekly();
  });

  view.querySelectorAll("[data-action]").forEach(el => {
    el.addEventListener("change", async (e) => {
      const action = el.getAttribute("data-action");
      const id = el.getAttribute("data-id");
      const it = await db.shopping_items.get(id);
      if (!it) return;

      if (action === "toggleChecked") {
        it.checked = el.checked;
        await upsertShoppingItem(it);
        await renderWeekly();
      }
      if (action === "editPlanned") {
        it.planned_price = el.value === "" ? null : Number(el.value);
        await upsertShoppingItem(it);
      }
      if (action === "editActual") {
        it.actual_price = el.value === "" ? null : Number(el.value);
        await upsertShoppingItem(it);
      }
    });

    el.addEventListener("click", async () => {
      const action = el.getAttribute("data-action");
      const id = el.getAttribute("data-id");
      if (action === "deleteItem") {
        await softDeleteShoppingItem(id);
        await renderWeekly();
      }
    });
  });
}

async function renderMonthly() {
  const view = $("view-monthly");
  if (!view) return;

  const ms = monthStartISO(todayISO());
  const me = monthEndISO(todayISO());
  const list = await getOrCreateList("monthly", ms, me);
  const itemsAll = await getListItems(list.id);
  const items = itemsAll.filter(x => x.deleted_at == null);

  const rows = items.map(it => `
    <div class="row">
      <label class="chk">
        <input type="checkbox" data-action="toggleChecked" data-id="${it.id}" ${it.checked ? "checked" : ""}/>
        <span>${esc(it.name)}</span>
      </label>
      <div class="prices">
        <div class="priceBox">
          <div class="lbl">Planned</div>
          <input class="num" inputmode="decimal" data-action="editPlanned" data-id="${it.id}" value="${it.planned_price ?? ""}" placeholder="0"/>
        </div>
        <div class="priceBox">
          <div class="lbl">Actual</div>
          <input class="num" inputmode="decimal" data-action="editActual" data-id="${it.id}" value="${it.actual_price ?? ""}" placeholder="0"/>
        </div>
      </div>
      <button class="btn danger sm" data-action="deleteItem" data-id="${it.id}">Delete</button>
    </div>
  `).join("");

  const plannedSum = items.reduce((a,b)=>a+(Number(b.planned_price)||0),0);
  const actualSum  = items.reduce((a,b)=>a+(Number(b.actual_price)||0),0);

  view.innerHTML = `
    <div class="panel">
      <div class="hrow">
        <div>
          <div class="h1">Monthly Shopping</div>
          <div class="muted">${ms} → ${me}</div>
        </div>
      </div>

      <div class="panel2">
        <div class="h2">Add item</div>
        <div class="grid2">
          <input id="mo-name" placeholder="Item name (e.g., rice)" />
          <input id="mo-planned" class="num" inputmode="decimal" placeholder="Planned price" />
          <input id="mo-actual" class="num" inputmode="decimal" placeholder="Actual price (optional)" />
          <button id="mo-add" class="btn primary">Add</button>
        </div>
      </div>

      <div class="panel2">
        <div class="h2">Items</div>
        ${rows || `<div class="muted">No items yet.</div>`}
      </div>

      <div class="panel2">
        <div class="h2">Totals</div>
        <div class="totals">
          <div><span class="muted">Planned:</span> ${plannedSum.toFixed(2)}</div>
          <div><span class="muted">Actual:</span> ${actualSum.toFixed(2)}</div>
        </div>
      </div>
    </div>
  `;

  $("mo-add")?.addEventListener("click", async () => {
    const name = $("mo-name").value.trim();
    const planned = $("mo-planned").value.trim();
    const actual = $("mo-actual").value.trim();
    if (!name) return;

    await upsertShoppingItem({
      id: crypto.randomUUID(),
      list_id: list.id,
      name,
      planned_price: planned === "" ? null : Number(planned),
      actual_price: actual === "" ? null : Number(actual),
      checked: false,
      deleted_at: null
    });

    $("mo-name").value = "";
    $("mo-planned").value = "";
    $("mo-actual").value = "";
    await renderMonthly();
  });

  view.querySelectorAll("[data-action]").forEach(el => {
    el.addEventListener("change", async () => {
      const action = el.getAttribute("data-action");
      const id = el.getAttribute("data-id");
      const it = await db.shopping_items.get(id);
      if (!it) return;

      if (action === "toggleChecked") {
        it.checked = el.checked;
        await upsertShoppingItem(it);
        await renderMonthly();
      }
      if (action === "editPlanned") {
        it.planned_price = el.value === "" ? null : Number(el.value);
        await upsertShoppingItem(it);
      }
      if (action === "editActual") {
        it.actual_price = el.value === "" ? null : Number(el.value);
        await upsertShoppingItem(it);
      }
    });

    el.addEventListener("click", async () => {
      const action = el.getAttribute("data-action");
      const id = el.getAttribute("data-id");
      if (action === "deleteItem") {
        await softDeleteShoppingItem(id);
        await renderMonthly();
      }
    });
  });
}

async function renderOther() {
  const view = $("view-other");
  if (!view) return;

  const cats = await categories();
  const all = await db.expenses.toArray();
  const exps = all.filter(e => e.deleted_at == null)
                  .sort((a,b) => (b.date||"").localeCompare(a.date||""));

  const catOpts = cats.map(c => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join("");

  const rows = exps.map(e => `
    <div class="row">
      <div class="col">
        <div class="strong">${esc(e.note || "(no note)")}</div>
        <div class="muted">${esc(e.date)} · ${esc(e.category || "Other")}</div>
      </div>
      <div class="amt">${Number(e.amount||0).toFixed(2)}</div>
      <button class="btn danger sm" data-action="delExp" data-id="${e.id}">Delete</button>
    </div>
  `).join("");

  view.innerHTML = `
    <div class="panel">
      <div class="h1">Other Expenses</div>

      <div class="panel2">
        <div class="h2">Add expense</div>
        <div class="grid3">
          <input id="ex-date" type="date" value="${todayISO()}" />
          <select id="ex-cat">
            ${catOpts}
          </select>
          <input id="ex-amt" class="num" inputmode="decimal" placeholder="Amount" />
          <input id="ex-note" placeholder="Note (optional)" />
          <button id="ex-add" class="btn primary">Add</button>
        </div>
      </div>

      <div class="panel2">
        <div class="h2">History</div>
        ${rows || `<div class="muted">No expenses yet.</div>`}
      </div>
    </div>
  `;

  $("ex-add")?.addEventListener("click", async () => {
    const date = $("ex-date").value || todayISO();
    const category = $("ex-cat").value || "Other";
    const amt = $("ex-amt").value.trim();
    const note = $("ex-note").value.trim();

    if (amt === "") return;

    await upsertExpense({
      id: crypto.randomUUID(),
      date,
      category,
      amount: Number(amt),
      note,
      deleted_at: null
    });

    $("ex-amt").value = "";
    $("ex-note").value = "";
    await renderOther();
  });

  view.querySelectorAll('[data-action="delExp"]').forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      await softDeleteExpense(id);
      await renderOther();
    });
  });
}

async function renderSummary() {
  const view = $("view-summary");
  if (!view) return;

  const cats = await categories();
  const catNames = cats.map(c => c.name);

  // default date range = this month
  const startDefault = monthStartISO(todayISO());
  const endDefault = todayISO();

  view.innerHTML = `
    <div class="panel">
      <div class="h1">Summary</div>

      <div class="panel2">
        <div class="h2">Filter</div>
        <div class="grid3">
          <input id="sum-start" type="date" value="${startDefault}" />
          <input id="sum-end" type="date" value="${endDefault}" />
          <select id="sum-cat">
            <option value="">All categories</option>
            ${catNames.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join("")}
          </select>
          <button id="sum-run" class="btn primary">Update</button>
        </div>
      </div>

      <div class="panel2">
        <div class="h2">Charts</div>
        <canvas id="sum-chart" height="140"></canvas>
      </div>

      <div class="panel2">
        <div class="h2">Totals</div>
        <div id="sum-totals" class="muted">Press Update</div>
      </div>
    </div>
  `;

  async function computeAndDraw() {
    const s = $("sum-start").value || startDefault;
    const e = $("sum-end").value || endDefault;
    const cat = $("sum-cat").value || "";

    const all = await db.expenses.toArray();
    const exps = all.filter(x => x.deleted_at == null)
                    .filter(x => x.date >= s && x.date <= e)
                    .filter(x => !cat || (x.category || "Other") === cat)
                    .sort((a,b)=>a.date.localeCompare(b.date));

    // Aggregate by day
    const byDay = new Map();
    for (const x of exps) {
      const key = x.date;
      byDay.set(key, (byDay.get(key) || 0) + (Number(x.amount)||0));
    }

    const labels = Array.from(byDay.keys());
    const values = labels.map(k => byDay.get(k));

    // Lazy import Chart.js from CDN (if already loaded, reuse)
    if (!window.Chart) {
      await import("https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js");
    }

    const ctx = $("sum-chart").getContext("2d");
    if (window.__sumChart) {
      window.__sumChart.destroy();
      window.__sumChart = null;
    }

    window.__sumChart = new window.Chart(ctx, {
      type: "line",
      data: { labels, datasets: [{ label: "Expense", data: values }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { maxRotation: 0, autoSkip: true } }
        }
      }
    });

    const total = values.reduce((a,b)=>a+b,0);
    $("sum-totals").innerHTML = `
      <div><span class="muted">Range:</span> ${esc(s)} → ${esc(e)}</div>
      <div><span class="muted">Count:</span> ${exps.length}</div>
      <div><span class="muted">Total:</span> ${total.toFixed(2)}</div>
    `;
  }

  $("sum-run")?.addEventListener("click", computeAndDraw);
  await computeAndDraw();
}

async function renderSettings() {
  const view = $("view-settings");
  if (!view) return;

  const meta = await db.sync_meta.get("meta");
  const last = meta?.last_sync_at ? new Date(meta.last_sync_at).toLocaleString() : "Never";

  view.innerHTML = `
    <div class="panel">
      <div class="h1">Settings</div>
      <div class="panel2">
        <div class="h2">Sync</div>
        <div class="muted">Last sync: ${esc(last)}</div>
        <div class="muted">Device ID: ${esc(meta?.device_id || "")}</div>
        <div class="hrow" style="margin-top:10px;">
          <button id="btn-sync" class="btn primary">Sync now</button>
        </div>
        <div class="muted" style="margin-top:8px;">
          Data is stored locally (IndexedDB). Sync backs up encrypted data to your Google Drive appDataFolder.
        </div>
      </div>
    </div>
  `;

  $("btn-sync")?.addEventListener("click", async () => {
    setStatus("Syncing...");
    try {
      const result = await runSync({ onStatus: setStatus });
      const conflicts = result?.conflicts_count ?? 0;
      $("conflictsCount").textContent = String(conflicts);
      setStatus(`Sync done. Conflicts: ${conflicts}`);
    } catch (e) {
      console.error(e);
      setStatus(`Sync error: ${e?.message || e}`);
    }
  });
}

export async function renderAll() {
  try {
    await renderWeekly();
    await renderMonthly();
    await renderOther();
    await renderSummary();
    await renderSettings();
    setStatus("Ready");
  } catch (e) {
    console.error(e);
    setStatus(`Error: ${e?.message || e}`);
  }
}
