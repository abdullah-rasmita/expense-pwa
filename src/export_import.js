import { db } from "./db.js";
import { nowMs } from "./util.js";

export async function exportAll(){
  const tables = ["meta","categories","expenses","shopping_lists","shopping_items","recurring_series","conflicts","sync_log"];
  const out = { v: 1, exported_at: nowMs(), tables: {} };
  for (const t of tables){
    out.tables[t] = await db[t].toArray();
  }
  return out;
}

export function downloadJson(filename, obj){
  const blob = new Blob([JSON.stringify(obj, null, 2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function csvFromExpenses(expenses, categoriesById){
  const header = ["date","amount","category","note","source","updated_at","deleted_at","id"];
  const lines = [header.join(",")];
  for (const e of expenses){
    const cat = categoriesById.get(e.category_id)?.name || "";
    const row = [
      e.date,
      (e.amount ?? ""),
      escapeCsv(cat),
      escapeCsv(e.note||""),
      e.source||"",
      e.updated_at||"",
      e.deleted_at||"",
      e.id||""
    ];
    lines.push(row.join(","));
  }
  return lines.join("\n");
}

function escapeCsv(s){
  const x = String(s ?? "");
  if (/[",\n]/.test(x)){
    return '"' + x.replaceAll('"','""') + '"';
  }
  return x;
}

export async function downloadCsvExpenses(filename="expenses.csv"){
  const expenses = await db.expenses.toArray();
  const categories = await db.categories.toArray();
  const by = new Map(categories.map(c=>[c.id,c]));
  const csv = csvFromExpenses(expenses, by);
  const blob = new Blob([csv], {type:"text/csv"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// Import replaces local DB with imported tables (used for manual restore).
// For Drive sync restore we use merge logic in merge.js
export async function importAll(exportObj){
  if (!exportObj || exportObj.v !== 1) throw new Error("Unsupported import file");
  const t = exportObj.tables || {};
  await db.transaction("rw", db.tables, async () => {
    for (const table of Object.keys(t)){
      if (!db[table]) continue;
      await db[table].clear();
      if (Array.isArray(t[table]) && t[table].length){
        await db[table].bulkAdd(t[table]);
      }
    }
  });
}
