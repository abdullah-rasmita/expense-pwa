import Dexie from "https://esm.sh/dexie@4.0.10";
import { uuid, nowMs } from "./util.js";

export const db = new Dexie("expense_pwa_v1");

// Records use:
// - id (uuid)
// - updated_at (ms)
// - deleted_at (ms|null) tombstone
db.version(1).stores({
  meta: "key",
  categories: "id, updated_at, deleted_at, name",
  expenses: "id, date, category_id, updated_at, deleted_at",
  shopping_lists: "id, period_type, start_date, end_date, updated_at, deleted_at",
  shopping_items: "id, list_id, checked, updated_at, deleted_at",
  recurring_series: "id, type, freq, updated_at, deleted_at",
  conflicts: "id, status, detected_at, resolved_at, record_id, reason",
  sync_log: "id, at, conflicts_count"
});

export async function initDb(){
  const device = await db.meta.get("device_id");
  if (!device){
    await db.meta.put({key:"device_id", value: uuid()});
  }
  const cats = await db.categories.where("deleted_at").equals(null).count();
  if (cats === 0){
    const at = nowMs();
    const defaults = ["Groceries","Transport","Bills","Kids","Dining","Health","Other"].map(name=>({
      id: uuid(), name, updated_at: at, deleted_at: null
    }));
    await db.categories.bulkAdd(defaults);
  }
}

export async function getDeviceId(){
  const r = await db.meta.get("device_id");
  return r?.value || "unknown";
}

export function makeExpense({date, amount, category_id, note, source}){
  const at = nowMs();
  return { id: uuid(), date, amount: Number(amount||0), category_id, note: note||"", source: source||"manual",
           updated_at: at, deleted_at: null };
}

export function makeShoppingList({period_type, start_date, end_date, title}){
  const at = nowMs();
  return { id: uuid(), period_type, start_date, end_date, title: title||"", updated_at: at, deleted_at: null };
}

export function makeShoppingItem({list_id, name, qty, unit, planned_price, actual_price, checked, category_id}){
  const at = nowMs();
  return { id: uuid(), list_id, name: name||"", qty: Number(qty||1), unit: unit||"",
           planned_price: planned_price===""? null : Number(planned_price||0),
           actual_price: actual_price===""? null : Number(actual_price||0),
           checked: !!checked,
           category_id: category_id || null,
           updated_at: at, deleted_at: null };
}

export async function touch(table, id){
  await db[table].update(id, {updated_at: nowMs()});
}

export async function softDelete(table, id){
  await db[table].update(id, {deleted_at: nowMs(), updated_at: nowMs()});
}

export async function undelete(table, id){
  await db[table].update(id, {deleted_at: null, updated_at: nowMs()});
}
