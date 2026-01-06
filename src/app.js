// src/app.js
import { ensureSeedData, db } from "./db.js";
import { renderAll } from "./ui.js";
import { runSync } from "./drive_sync.js";

const $ = (id) => document.getElementById(id);

function setStatus(msg) {
  const el = $("statusLine");
  if (el) el.textContent = msg || "";
}

function showError(e) {
  const msg = e?.message || String(e);
  console.error(e);
  setStatus("Error: " + msg);
}

window.addEventListener("error", (e) => showError(e.error || e));
window.addEventListener("unhandledrejection", (e) => showError(e.reason || e));

function normalizeLabel(s) {
  return (s || "").trim().toLowerCase();
}

function setActiveTab(viewKey) {
  const key = normalizeLabel(viewKey);

  // Hide all views
  const allViews = ["weekly", "monthly", "other", "summary", "settings"];
  for (const v of allViews) {
    const el = $(`view-${v}`);
    if (el) el.style.display = (v === key ? "block" : "none");
  }

  // Visual active tab (best effort)
  document.querySelectorAll("button, a").forEach((el) => {
    const t = normalizeLabel(el.textContent);
    if (["weekly", "monthly", "other", "summary", "settings"].includes(t)) {
      el.classList.toggle("active", t === key);
    }
  });
}

async function exportJson() {
  // Dump all tables to JSON and download
  const payload = {
    exported_at: new Date().toISOString(),
    shopping_lists: await db.shopping_lists.toArray(),
    shopping_items: await db.shopping_items.toArray(),
    expenses: await db.expenses.toArray(),
    categories: await db.categories.toArray(),
    sync_meta: await db.sync_meta.toArray(),
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `expense-pwa-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function importJsonFromFile(file) {
  const text = await file.text();
  const data = JSON.parse(text);

  // Basic import: bulkPut everything (your merge/sync still handles conflicts separately)
  // We keep this simple and predictable.
  if (Array.isArray(data.shopping_lists)) await db.shopping_lists.bulkPut(data.shopping_lists);
  if (Array.isArray(data.shopping_items)) await db.shopping_items.bulkPut(data.shopping_items);
  if (Array.isArray(data.expenses)) await db.expenses.bulkPut(data.expenses);
  if (Array.isArray(data.categories)) await db.categories.bulkPut(data.categories);
  if (Array.isArray(data.sync_meta)) await db.sync_meta.bulkPut(data.sync_meta);

  // Re-render
  await renderAll();
}

function wireTopButtonsByText() {
  const btns = Array.from(document.querySelectorAll("button"));

  const findBtn = (label) => btns.find(b => normalizeLabel(b.textContent) === normalizeLabel(label));

  const bSync = findBtn("Sync");
  const bExport = findBtn("Export");
  const bImport = findBtn("Import");

  if (bSync) {
    bSync.addEventListener("click", async () => {
      setStatus("Syncing...");
      try {
        const result = await runSync({ onStatus: setStatus });
        const conflicts = result?.conflicts_count ?? 0;
        const cc = $("conflictsCount");
        if (cc) cc.textContent = String(conflicts);
        setStatus(`Sync done. Conflicts: ${conflicts}`);
        await renderAll();
      } catch (e) {
        showError(e);
      }
    });
  }

  if (bExport) {
    bExport.addEventListener("click", async () => {
      try {
        await exportJson();
        setStatus("Exported.");
      } catch (e) {
        showError(e);
      }
    });
  }

  if (bImport) {
    bImport.addEventListener("click", async () => {
      try {
        const inp = document.createElement("input");
        inp.type = "file";
        inp.accept = "application/json";
        inp.onchange = async () => {
          const f = inp.files?.[0];
          if (!f) return;
          setStatus("Importing...");
          await importJsonFromFile(f);
          setStatus("Imported.");
        };
        inp.click();
      } catch (e) {
        showError(e);
      }
    });
  }
}

function wireTabsByText() {
  const tabs = Array.from(document.querySelectorAll("button, a"))
    .filter(el => ["weekly", "monthly", "other", "summary", "settings"].includes(normalizeLabel(el.textContent)));

  tabs.forEach(el => {
    el.addEventListener("click", (ev) => {
      ev.preventDefault();
      const key = normalizeLabel(el.textContent);
      setActiveTab(key);
    });
  });
}

async function boot() {
  setStatus("Starting...");
  try {
    await ensureSeedData();
    await renderAll();

    // Default view
    setActiveTab("weekly");

    // Wire UI controls
    wireTopButtonsByText();
    wireTabsByText();

    setStatus("Ready");
  } catch (e) {
    showError(e);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
