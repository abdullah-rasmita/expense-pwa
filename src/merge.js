import { db } from "./db.js";
import { deepCopy, nowMs, uuid } from "./util.js";

/**
 * Record-level merge:
 * - Union by id.
 * - If same id exists in both:
 *   - If one deleted (deleted_at != null) and the other active/edited => delete wins,
 *     store active snapshot as conflict (reason: delete_vs_edit).
 *   - Else if both active and differ => take newer updated_at; store losing snapshot
 *     as conflict (reason: edit_vs_edit).
 *
 * Conflicts are stored as separate records in db.conflicts (status=open).
 * Resolved conflicts remain as history and are not changed by normal UI.
 */

const DATA_TABLES = ["categories","expenses","shopping_lists","shopping_items","recurring_series"];

function normalizeTables(exportObj){
  const t = exportObj?.tables || {};
  const out = {};
  for (const name of DATA_TABLES){
    out[name] = Array.isArray(t[name]) ? t[name] : [];
  }
  return out;
}

function isDeleted(r){ return r && r.deleted_at != null; }

function stableJson(r){
  // remove volatile keys if needed; for now compare full record
  return JSON.stringify(r);
}

function makeConflict({record_kind, record_id, reason, winner, loser, sync_id}){
  const at = nowMs();
  return {
    id: uuid(),
    status: "open",
    detected_at: at,
    resolved_at: null,
    record_kind,
    record_id,
    reason,
    winner_snapshot: deepCopy(winner),
    loser_snapshot: deepCopy(loser),
    sync_id: sync_id || null,
    resolution_action: null,
    resolution_note: ""
  };
}

export async function mergeAndApply({localExport, remoteExport}){
  const sync_id = "sync_" + uuid();
  const local = normalizeTables(localExport);
  const remote = normalizeTables(remoteExport);

  const merged = {};
  const conflicts = [];

  for (const table of DATA_TABLES){
    const a = new Map(local[table].map(r=>[r.id, r]));
    const b = new Map(remote[table].map(r=>[r.id, r]));
    const ids = new Set([...a.keys(), ...b.keys()]);
    const out = [];

    for (const id of ids){
      const L = a.get(id);
      const R = b.get(id);
      if (L && !R){ out.push(L); continue; }
      if (R && !L){ out.push(R); continue; }

      // both exist
      const Ldel = isDeleted(L);
      const Rdel = isDeleted(R);

      if (Ldel && !Rdel){
        // delete vs edit: delete wins, keep deleted (L), store R as conflict
        out.push(L);
        if (stableJson(L) !== stableJson(R)){
          conflicts.push(makeConflict({
            record_kind: table,
            record_id: id,
            reason: "delete_vs_edit",
            winner: L,
            loser: R,
            sync_id
          }));
        }
        continue;
      }
      if (Rdel && !Ldel){
        out.push(R);
        if (stableJson(L) !== stableJson(R)){
          conflicts.push(makeConflict({
            record_kind: table,
            record_id: id,
            reason: "delete_vs_edit",
            winner: R,
            loser: L,
            sync_id
          }));
        }
        continue;
      }

      // both active or both deleted
      if (stableJson(L) === stableJson(R)){
        out.push(L.updated_at >= R.updated_at ? L : R);
        continue;
      }

      // edit_vs_edit (or delete_vs_delete differences)
      const winner = (Number(L.updated_at||0) >= Number(R.updated_at||0)) ? L : R;
      const loser  = (winner === L) ? R : L;
      out.push(winner);
      conflicts.push(makeConflict({
        record_kind: table,
        record_id: id,
        reason: "edit_vs_edit",
        winner,
        loser,
        sync_id
      }));
    }

    merged[table] = out;
  }

  // Apply: write merged data and append conflicts + sync_log entry
  await db.transaction("rw",
    db.categories, db.expenses, db.shopping_lists, db.shopping_items, db.recurring_series,
    db.conflicts, db.sync_log,
    async () => {
      for (const table of DATA_TABLES){
        await db[table].clear();
        if (merged[table].length) await db[table].bulkAdd(merged[table]);
      }
      if (conflicts.length) await db.conflicts.bulkAdd(conflicts);
      await db.sync_log.add({id: sync_id, at: nowMs(), conflicts_count: conflicts.length});
    }
  );

  return { sync_id, conflicts_count: conflicts.length };
}
