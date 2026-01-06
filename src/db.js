// src/db.js
import Dexie from "https://cdn.jsdelivr.net/npm/dexie@4.0.10/dist/dexie.mjs";

export const db = new Dexie("expense_pwa_db_v1");

db.version(1).stores({
  shopping_lists: "id, period_type, start_date, end_date, updated_at, deleted_at",
  shopping_items: "id, list_id, name, planned_price, actual_price, checked, updated_at, deleted_at",
  expenses: "id, date, amount, category, note, updated_at, deleted_at",
  categories: "id, name, updated_at, deleted_at",
  sync_meta: "key"
});

export async function ensureSeedData() {
  // Seed default categories if none exist (ignoring deleted items)
  const allCats = await db.categories.toArray();
  const aliveCount = allCats.filter(c => c.deleted_at == null).length;

  if (aliveCount === 0) {
    const now = Date.now();
    const defaults = [
      "Groceries",
      "Transport",
      "Food",
      "Bills",
      "Kids",
      "Health",
      "Shopping",
      "Education",
      "Entertainment",
      "Other"
    ].map((name, i) => ({
      id: `cat-${i}-${now}`,
      name,
      updated_at: now,
      deleted_at: null
    }));
    await db.categories.bulkPut(defaults);
  }

  // Seed sync meta if missing
  const meta = await db.sync_meta.get("meta");
  if (!meta) {
    await db.sync_meta.put({
      key: "meta",
      last_sync_at: 0,
      device_id: crypto.randomUUID ? crypto.randomUUID() : `dev-${Math.random()}`,
    });
  }
}
