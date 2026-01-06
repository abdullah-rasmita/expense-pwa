export function nowMs(){ return Date.now(); }
export function isoDate(d=new Date()){ return d.toISOString().slice(0,10); }

// ---- Aliases expected by ui.js (ADD THESE) ----
export function todayISO(){ return isoDate(new Date()); }
export function weekStartISO(dateStr){ return startOfWeek(dateStr); }
export function weekEndISO(dateStr){ return endOfWeek(dateStr); }
export function monthStartISO(dateStr){ return startOfMonth(dateStr); }
export function monthEndISO(dateStr){ return endOfMonth(dateStr); }
export function fmtDate(dateStr){ return dateStr; }
// ----------------------------------------------

export function startOfWeek(dateStr){
  const d = new Date(dateStr+"T00:00:00");
  const day = d.getDay(); // 0 Sun
  const diff = (day === 0 ? -6 : 1 - day); // Monday start
  d.setDate(d.getDate() + diff);
  return isoDate(d);
}
export function endOfWeek(dateStr){
  const s = new Date(startOfWeek(dateStr)+"T00:00:00");
  s.setDate(s.getDate()+6);
  return isoDate(s);
}
export function startOfMonth(dateStr){
  const d = new Date(dateStr+"T00:00:00");
  d.setDate(1);
  return isoDate(d);
}
export function endOfMonth(dateStr){
  const d = new Date(dateStr+"T00:00:00");
  d.setMonth(d.getMonth()+1); d.setDate(0);
  return isoDate(d);
}
export function fmtMoney(x){
  const n = Number(x||0);
  return n.toFixed(2);
}
export function uuid(){
  return crypto.randomUUID();
}
export function base64FromBytes(bytes){
  let bin = "";
  const chunk = 0x8000;
  for (let i=0;i<bytes.length;i+=chunk){
    bin += String.fromCharCode(...bytes.subarray(i,i+chunk));
  }
  return btoa(bin);
}
export function bytesFromBase64(b64){
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
  return bytes;
}
export function deepCopy(obj){
  return JSON.parse(JSON.stringify(obj));
}
