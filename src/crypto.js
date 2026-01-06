import { base64FromBytes, bytesFromBase64 } from "./util.js";

// Proven / standard primitives available in WebCrypto:
// - PBKDF2 for key derivation
// - AES-GCM for authenticated encryption
//
// Payload format: {v, kdf, iter, salt, iv, ct}
const KDF = "PBKDF2";
const HASH = "SHA-256";
const ITER = 210000; // reasonably strong; tune if needed (mobile perf)
const KEY_LEN = 256;

function strToBytes(s){ return new TextEncoder().encode(s); }
function bytesToStr(b){ return new TextDecoder().decode(b); }

async function deriveKey(passphrase, saltBytes){
  const keyMaterial = await crypto.subtle.importKey(
    "raw", strToBytes(passphrase), {name: KDF}, false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {name: KDF, salt: saltBytes, iterations: ITER, hash: HASH},
    keyMaterial,
    {name: "AES-GCM", length: KEY_LEN},
    false,
    ["encrypt","decrypt"]
  );
}

export async function encryptJson(obj, passphrase){
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);

  const plaintext = strToBytes(JSON.stringify(obj));
  const ct = new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM", iv}, key, plaintext));

  return {
    v: 1,
    kdf: KDF,
    hash: HASH,
    iter: ITER,
    salt: base64FromBytes(salt),
    iv: base64FromBytes(iv),
    ct: base64FromBytes(ct),
  };
}

export async function decryptJson(payload, passphrase){
  if (!payload || payload.v !== 1) throw new Error("Unsupported encrypted payload version");
  const salt = bytesFromBase64(payload.salt);
  const iv = bytesFromBase64(payload.iv);
  const ct = bytesFromBase64(payload.ct);

  const key = await deriveKey(passphrase, salt);
  const pt = new Uint8Array(await crypto.subtle.decrypt({name:"AES-GCM", iv}, key, ct));
  return JSON.parse(bytesToStr(pt));
}
