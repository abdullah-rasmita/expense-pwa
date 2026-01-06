(function () {
  const s = (msg) => {
    const el = document.getElementById("statusLine");
    if (el) el.textContent = msg;
  };
  s("app.js loaded");
  document.addEventListener("DOMContentLoaded", () => s("DOM ready"));
})();
window.addEventListener("error", (e) => {
  const el = document.getElementById("statusLine");
  if (el) el.textContent = "Error: " + (e?.message || "unknown");
  console.error(e);
});
window.addEventListener("unhandledrejection", (e) => {
  const el = document.getElementById("statusLine");
  if (el) el.textContent = "Error: " + (e?.reason?.message || e?.reason || "promise");
  console.error(e);
});
import { APP_NAME } from "../config.js";
import { initDb, db } from "./db.js";
import { exportAll, downloadJson, downloadCsvExpenses, importAll } from "./export_import.js";
import { encryptJson, decryptJson } from "./crypto.js";
import { initGoogleAuth, findBackupFile, downloadBackup, uploadNewBackup, updateBackup } from "./drive.js";
import { mergeAndApply } from "./merge.js";
import { renderAll, renderConflicts, refreshConflictBadge, toast } from "./ui.js";

function setStatus(text){
  document.getElementById("statusLine").textContent = text;
}

function showView(key){
  const map = {
    weekly: "view-weekly",
    monthly: "view-monthly",
    expenses: "view-expenses",
    summary: "view-summary",
    settings: "view-settings",
    conflicts: "view-conflicts",
  };
  for (const id of Object.values(map)){
    document.getElementById(id).classList.add("hidden");
  }
  document.getElementById(map[key]).classList.remove("hidden");

  document.querySelectorAll(".tab").forEach(t=>t.classList.remove("active"));
  const tab = document.querySelector(`.tab[data-tab="${key}"]`);
  if (tab) tab.classList.add("active");
}

function bindTabs(){
  document.querySelectorAll(".tab").forEach(btn=>{
    btn.onclick = async ()=>{
      const k = btn.getAttribute("data-tab");
      showView(k);
      if (k === "conflicts") await renderConflicts();
    };
  });
}

async function registerSW(){
  if (!("serviceWorker" in navigator)) return;
  try{
    await navigator.serviceWorker.register("./sw.js", {scope:"./"});
  }catch(e){
    // Ignore; app still works online
  }
}

async function promptFile(accept=".json"){
  return new Promise((resolve) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = accept;
    inp.onchange = () => resolve(inp.files?.[0] || null);
    inp.click();
  });
}

async function readJsonFile(file){
  const text = await file.text();
  return JSON.parse(text);
}

async function doExport(){
  const all = await exportAll();
  const ok = downloadJson(`expense_backup_${Date.now()}.json`, all);
  toast(ok ? "Exported JSON" : "Export cancelled");
}

async function doImport(){
  const f = await promptFile(".json");
  if (!f) return;
  const obj = await readJsonFile(f);
  await importAll(obj);
  toast("Imported");
  await renderAll();
  await refreshConflictBadge();
}

async function doSync(){
  // Manual sync:
  // 1) Ask passphrase (remembered for this session)
  // 2) Fetch remote encrypted backup (appDataFolder), decrypt
  // 3) Export local, merge, apply
  // 4) Export merged, encrypt, upload/update
  if (!initGoogleAuth()){
    toast("Google auth library not loaded yet. Try again.");
    return;
  }

  const passphrase = await getSessionPassphrase();
  if (!passphrase) return;

  setStatus("Syncing…");
  const localExport = await exportAll();

  let remoteExport = null;
  let remoteFile = null;
  try{
    remoteFile = await findBackupFile();
    if (remoteFile){
      const enc = await downloadBackup(remoteFile.id);
      remoteExport = await decryptJson(enc, passphrase);
    }
  }catch(e){
    setStatus("Sync failed");
    toast(`Sync: remote read/decrypt failed: ${e.message}`);
    return;
  }

  // If no remote yet, just upload local
  if (!remoteExport){
    try{
      const enc = await encryptJson(localExport, passphrase);
      await uploadNewBackup(enc);
      setStatus("Sync complete");
      const c = await refreshConflictBadge();
      toast(`Sync complete. Conflicts: ${c} <a href="#" id="goConf">Review</a>`, {ms:0});
      wireToastReview();
      return;
    }catch(e){
      setStatus("Sync failed");
      toast(`Sync upload failed: ${e.message}`);
      return;
    }
  }

  // Merge record-level and apply to local DB
  let result;
  try{
    result = await mergeAndApply({localExport, remoteExport});
  }catch(e){
    setStatus("Sync failed");
    toast(`Merge failed: ${e.message}`);
    return;
  }

  // Upload merged export
  try{
    const mergedExport = await exportAll();
    const enc = await encryptJson(mergedExport, passphrase);
    if (remoteFile) await updateBackup(remoteFile.id, enc);
    else await uploadNewBackup(enc);
  }catch(e){
    setStatus("Sync partial");
    toast(`Merged locally, but upload failed: ${e.message}`);
    return;
  }

  setStatus("Sync complete");
  await renderAll();
  const open = await refreshConflictBadge();
  toast(`Sync complete. Conflicts: ${open} <a href="#" id="goConf">Review</a>`, {ms:0});
  wireToastReview();
}

function wireToastReview(){
  const a = document.getElementById("goConf");
  if (a){
    a.onclick = (ev)=>{
      ev.preventDefault();
      showView("conflicts");
      renderConflicts();
      document.getElementById("toast").classList.add("hidden");
    };
  }
}

// Session passphrase memory (not persisted)
let sessionPass = null;
async function getSessionPassphrase(){
  if (sessionPass) return sessionPass;

  const pass = prompt("Enter passphrase for Drive backup (remembered for this session):");
  if (!pass) return null;
  sessionPass = pass;
  return sessionPass;
}

async function doExportWithCsv(){
  const all = await exportAll();
  downloadJson(`expense_backup_${Date.now()}.json`, all);
  await downloadCsvExpenses(`expenses_${Date.now()}.csv`);
  toast("Exported JSON + CSV");
}

function bindTopButtons(){
  document.getElementById("btnExport").onclick = async ()=>{
    const choice = confirm("Export JSON + CSV? (Cancel = JSON only)");
    if (choice) await doExportWithCsv();
    else await doExport();
  };
  document.getElementById("btnImport").onclick = doImport;
  document.getElementById("btnSync").onclick = doSync;
  document.getElementById("btnConflicts").onclick = async ()=>{
    showView("conflicts");
    await renderConflicts();
  };
}

(async function main(){
  document.title = APP_NAME;
  await registerSW();
  bindTabs();
  bindTopButtons();
  showView("weekly");

  await initDb();
  await renderAll();
  await refreshConflictBadge();

  setStatus("Ready");
})();
