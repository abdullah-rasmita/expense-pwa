import { GOOGLE_CLIENT_ID, DRIVE_BACKUP_FILENAME } from "../config.js";

/**
 * Google Drive appDataFolder backup using:
 * - Google Identity Services OAuth token client (in-browser)
 * - Drive v3 REST via fetch with Bearer token
 *
 * Docs:
 * - appDataFolder guide
 * - GIS JS reference (initTokenClient)
 */
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";

let tokenClient = null;
let accessToken = null;

export function hasToken(){ return !!accessToken; }
export function clearToken(){ accessToken = null; }

export function initGoogleAuth(){
  if (!window.google?.accounts?.oauth2) return false;
  if (tokenClient) return true;

  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: DRIVE_SCOPE,
    callback: (resp) => {
      if (resp?.access_token) accessToken = resp.access_token;
    }
  });
  return true;
}

export async function ensureToken(){
  if (accessToken) return accessToken;
  if (!tokenClient) throw new Error("Google auth not initialized. Did you set GOOGLE_CLIENT_ID in config.js?");
  // request a token (popup)
  await new Promise((resolve, reject) => {
    tokenClient.callback = (resp) => {
      if (resp?.access_token){
        accessToken = resp.access_token;
        resolve();
      } else {
        reject(new Error(resp?.error || "OAuth failed"));
      }
    };
    tokenClient.requestAccessToken({prompt: "consent"});
  });
  return accessToken;
}

async function driveFetch(url, init={}){
  const tok = await ensureToken();
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${tok}`);
  return fetch(url, {...init, headers});
}

export async function findBackupFile(){
  // Search in appDataFolder space
  const q = encodeURIComponent(`name='${DRIVE_BACKUP_FILENAME}' and trashed=false`);
  const url = `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,name,modifiedTime,size)`;
  const r = await driveFetch(url);
  if (!r.ok) throw new Error(`Drive list failed: ${r.status}`);
  const data = await r.json();
  return (data.files && data.files.length) ? data.files[0] : null;
}

export async function downloadBackup(fileId){
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const r = await driveFetch(url);
  if (!r.ok) throw new Error(`Drive download failed: ${r.status}`);
  return r.json();
}

function buildMultipartBody(metadataObj, jsonObj){
  const boundary = "-------expensepwa-" + Math.random().toString(16).slice(2);
  const delimiter = `\r\n--${boundary}\r\n`;
  const close = `\r\n--${boundary}--`;

  const metaPart =
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(metadataObj);

  const dataPart =
    `Content-Type: application/json\r\n\r\n` +
    JSON.stringify(jsonObj);

  const body = delimiter +
    `Content-Disposition: form-data; name="metadata"\r\n` + metaPart +
    delimiter +
    `Content-Disposition: form-data; name="file"\r\n` + dataPart +
    close;

  return {boundary, body};
}

export async function uploadNewBackup(encryptedPayload){
  // Create file in appDataFolder using multipart upload.
  // metadata.parents: ["appDataFolder"]
  const metadata = { name: DRIVE_BACKUP_FILENAME, parents: ["appDataFolder"], mimeType: "application/json" };
  const {boundary, body} = buildMultipartBody(metadata, encryptedPayload);
  const url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime,size";
  const r = await driveFetch(url, {
    method: "POST",
    headers: {"Content-Type": `multipart/related; boundary=${boundary}`},
    body
  });
  if (!r.ok) throw new Error(`Drive upload failed: ${r.status}`);
  return r.json();
}

export async function updateBackup(fileId, encryptedPayload){
  const metadata = { name: DRIVE_BACKUP_FILENAME, mimeType: "application/json" };
  const {boundary, body} = buildMultipartBody(metadata, encryptedPayload);
  const url = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart&fields=id,name,modifiedTime,size`;
  const r = await driveFetch(url, {
    method: "PATCH",
    headers: {"Content-Type": `multipart/related; boundary=${boundary}`},
    body
  });
  if (!r.ok) throw new Error(`Drive update failed: ${r.status}`);
  return r.json();
}
