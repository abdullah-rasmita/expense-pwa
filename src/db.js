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

  // IMPORTANT: don't do equals(null) on indexed keys (IndexedDB keys can't be null).
  // Use toCollection().filter(...) instead.
  const cats = await db.categories.toCollection()
    .filter(c => c.deleted_at == null)
    .count();

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
  return {
    id: uuid(),
    date,
    amount: Number(amount||0),
    category_id,
    note: note||"",
    source: source||"manual",
    updated_at: at,
    deleted_at: null
  };
}

export function makeShoppingList({period_type, start_date, end_date, source}){
  const at = nowMs();
  return {
    id: uuid(),
    period_type,
    start_date,
    end_date,
    source: source||"manual",
    updated_at: at,
    deleted_at: null
  };
}

export function makeShoppingItem({list_id, name, planned_price, actual_price, checked, source}){
  const at = nowMs();
  return {
    id: uuid(),
    list_id,
    name: name||"",
    planned_price: planned_price==="" ? null : (planned_price==null ? null : Number(planned_price)),
    actual_price: actual_price==="" ? null : (actual_price==null ? null : Number(actual_price)),
    checked: !!checked,
    source: source||"manual",
    updated_at: at,
    deleted_at: null
  };
}

export function makeConflict({record_id, reason, local, remote}){
  const at = nowMs();
  return {
    id: uuid(),
    status: "open",
    detected_at: at,
    resolved_at: null,
    record_id,
    reason,
    local,
    remote
  };
}
