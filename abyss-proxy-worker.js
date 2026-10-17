/**
 * AnimeYT / AbyssPlayer streaming proxy for Cloudflare Workers.
 *
 * Deploy as a separate Worker. This file does not alter the Kino plugin.
 * Routes:
 *   GET /resolve?url=<AbyssPlayer embed URL> -> JSON with a proxied stream URL
 *   GET /stream?url=<validated media URL>&file=<filename> -> MP4 bytes, decrypted on the fly
 *
 * Configure ALLOWED_ORIGINS with the actual media host(s) observed in Abyss metadata.
 */
const PLAYER_ORIGIN = "https://player.abyssplayer.com";
const LIMIT = 65536;
const UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";

export default {
  async fetch(request, env) {
    const reqUrl = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    if (reqUrl.pathname === "/health") return new Response("ok", { headers: corsHeaders() });
    if (reqUrl.pathname === "/selftest") return json({ md5_hola: await md5Hex("hola"), expected: "4d186321c1a7f0f354b297e8914ab240" });
    if (reqUrl.pathname === "/resolve") return resolveRequest(reqUrl, env);
    if (reqUrl.pathname === "/stream") return streamRequest(request, reqUrl, env);
    return new Response("Not found", { status: 404, headers: corsHeaders() });
  }
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Range, Content-Type",
    "Cache-Control": "no-store"
  };
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" } });
}
function allowedHost(host, env) {
  const list = String(env.ALLOWED_ORIGINS || "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
  const h = host.toLowerCase();
  return list.some(entry => entry.startsWith("*.") ? (h.endsWith(entry.slice(1)) && h !== entry.slice(2)) : h === entry);
}
function bytesFromLatin1(s) {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 255;
  return out;
}
function latin1FromBytes(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, Math.min(i + 8192, bytes.length)));
  return out;
}
function b64ToBytes(s) {
  const raw = atob(s);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
function bytesToB64(bytes) {
  let raw = "";
  for (let i = 0; i < bytes.length; i += 8192) raw += String.fromCharCode(...bytes.subarray(i, Math.min(i + 8192, bytes.length)));
  return btoa(raw);
}
async function md5Hex(text) {
  // Web Crypto does not expose MD5; use a compact, local MD5 implementation.
  const bytes = new TextEncoder().encode(text);
  const K = new Uint32Array(64);
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
  const shifts = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
  const len = bytes.length, total = ((len + 8) >>> 6) + 1, padded = new Uint8Array(total * 64);
  padded.set(bytes); padded[len] = 128;
  const dv = new DataView(padded.buffer); dv.setUint32(padded.length - 8, (len * 8) >>> 0, true); dv.setUint32(padded.length - 4, Math.floor(len / 0x20000000), true);
  let a0=0x67452301,b0=0xefcdab89,c0=0x98badcfe,d0=0x10325476;
  for (let off=0; off<padded.length; off+=64) {
    const M=new Uint32Array(16); for(let i=0;i<16;i++) M[i]=dv.getUint32(off+i*4,true);
    let A=a0,B=b0,C=c0,D=d0;
    for(let i=0;i<64;i++) {
      let F,g;
      if(i<16){F=(B&C)|(~B&D);g=i;}
      else if(i<32){F=(D&B)|(~D&C);g=(5*i+1)%16;}
      else if(i<48){F=B^C^D;g=(3*i+5)%16;}
      else {F=C^(B|~D);g=(7*i)%16;}
      const sum=(A+F+K[i]+M[g])>>>0, sh=shifts[i];
      const rot=((sum<<sh)|(sum>>>(32-sh)))>>>0;
      A=D;D=C;C=B;B=(B+rot)>>>0;
    }
    a0=(a0+A)>>>0;b0=(b0+B)>>>0;c0=(c0+C)>>>0;d0=(d0+D)>>>0;
  }
  const out=new Uint8Array(16), ov=new DataView(out.buffer);
  ov.setUint32(0,a0,true);ov.setUint32(4,b0,true);ov.setUint32(8,c0,true);ov.setUint32(12,d0,true);
  return [...out].map(x=>x.toString(16).padStart(2,"0")).join("");
}
function addCounter(iv, blockOffset) {
  const out = new Uint8Array(iv);
  let carry = BigInt(blockOffset);
  for (let i = 15; i >= 0 && carry > 0n; i--) {
    const sum = BigInt(out[i]) + (carry & 255n);
    out[i] = Number(sum & 255n);
    carry = (carry >> 8n) + (sum >> 8n);
  }
  return out;
}
async function cryptCtr(bytes, keyText, offset = 0) {
  // Abyss uses the 32 ASCII hex characters as AES-256 key; IV/counter is its first 16 ASCII bytes.
  const keyBytes = new TextEncoder().encode(keyText);
  if (keyBytes.length !== 32) throw new Error("AES key must be 32 ASCII bytes");
  const iv = keyBytes.slice(0,16);
  const counter = addCounter(iv, Math.floor(offset / 16));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-CTR" }, false, ["decrypt"]);
  const input = offset % 16 ? new Uint8Array(bytes.length + (offset % 16)) : bytes;
  if (offset % 16) input.set(bytes, offset % 16);
  const result = new Uint8Array(await crypto.subtle.decrypt({ name:"AES-CTR", counter, length:64 }, key, input));
  return offset % 16 ? result.slice(offset % 16) : result;
}
async function resolveRequest(u, env) {
  const embed = u.searchParams.get("url");
  if (!embed) return json({ error: "missing url" }, 400);
  let page;
  try { page = new URL(embed); } catch { return json({ error: "invalid url" }, 400); }
  if (page.hostname !== "player.abyssplayer.com" || !page.pathname || page.protocol !== "https:") return json({ error: "only AbyssPlayer embed URLs are accepted" }, 400);
  const r = await fetch(page.href, { headers: { "User-Agent": UA, "Referer": PLAYER_ORIGIN + "/" } });
  if (!r.ok) return json({ error: "Abyss page HTTP " + r.status }, 502);
  const html = await r.text();
  const m = /const\s+datas\s*=\s*"([^"]+)"/.exec(html);
  if (!m) return json({ error: "datas payload not found" }, 502);
  let data;
  try { data = JSON.parse(latin1FromBytes(b64ToBytes(m[1]))); } catch { return json({ error: "datas payload decode failed" }, 502); }
  if (!data || !data.media || !data.user_id || !data.slug || !data.md5_id) return json({ error: "datas fields missing" }, 502);
  const mediaKey = await md5Hex(String(data.user_id) + ":" + String(data.slug) + ":" + String(data.md5_id));
  let mediaJson;
  try {
    const plain = await cryptCtr(bytesFromLatin1(String(data.media)), mediaKey, 0);
    mediaJson = JSON.parse(latin1FromBytes(plain));
  } catch { return json({ error: "media decrypt/JSON parse failed" }, 502); }
  const sources = mediaJson && mediaJson.mp4 && mediaJson.mp4.sources;
  if (!Array.isArray(sources) || !sources.length) return json({ error: "no mp4 sources" }, 502);
  const source = sources.find(x => x && x.url && x.path) || sources[0];
  if (!source || !source.url || !source.path) return json({ error: "source URL/path missing" }, 502);
  const sourceBase = String(source.url).replace(/\/+$/, "");
  const sourcePath = String(source.path).replace(/^\/+/, "");
  let mediaUrl;
  try { mediaUrl = new URL(sourceBase + "/" + sourcePath); } catch { return json({ error: "invalid media URL" }, 502); }
  if (mediaUrl.protocol !== "https:" || !allowedHost(mediaUrl.hostname, env)) return json({ error: "media host not allowlisted: " + mediaUrl.hostname, needsAllowlist: true }, 403);
  const file = mediaUrl.pathname.split("/").filter(Boolean).pop();
  if (!file) return json({ error: "filename missing" }, 502);
  const proxyUrl = new URL("/stream", u.origin);
  proxyUrl.searchParams.set("url", mediaUrl.href);
  proxyUrl.searchParams.set("file", file);
  return json({ url: proxyUrl.href, mime: "video/mp4", label: "AbyssPlayer" });
}
function parseRange(h) {
  if (!h) return null;
  const m = /^bytes=(\d+)-(\d*)$/i.exec(h.trim());
  if (!m) return null;
  return { start: Number(m[1]), end: m[2] ? Number(m[2]) : null };
}
async function streamRequest(request, u, env) {
  const raw = u.searchParams.get("url"), file = u.searchParams.get("file");
  if (!raw || !file) return new Response("missing url/file", { status: 400, headers: corsHeaders() });
  let upstream;
  try { upstream = new URL(raw); } catch { return new Response("invalid url", { status: 400, headers: corsHeaders() }); }
  if (upstream.protocol !== "https:" || !allowedHost(upstream.hostname, env)) return new Response("host not allowlisted", { status: 403, headers: corsHeaders() });
  if (upstream.pathname.split("/").filter(Boolean).pop() !== file) return new Response("filename mismatch", { status: 400, headers: corsHeaders() });
  const key = await md5Hex(file);
  const range = request.headers.get("Range");
  const headers = { "User-Agent": UA, "Referer": PLAYER_ORIGIN + "/", "Origin": PLAYER_ORIGIN };
  if (range) headers.Range = range;
  const upstreamResponse = await fetch(upstream.href, { method: request.method, headers, redirect: "follow" });
  if (!(upstreamResponse.ok || upstreamResponse.status === 206)) return new Response("upstream HTTP " + upstreamResponse.status, { status: upstreamResponse.status, headers: corsHeaders() });
  const outHeaders = new Headers(corsHeaders());
  for (const h of ["Accept-Ranges","Content-Length","Content-Range","Last-Modified","ETag"]) {
    const v = upstreamResponse.headers.get(h); if (v) outHeaders.set(h,v);
  }
  outHeaders.set("Content-Type", "video/mp4");
  outHeaders.set("Cache-Control", "no-store");
  if (request.method === "HEAD") return new Response(null, { status: upstreamResponse.status, headers: outHeaders });
  const parsed = parseRange(range);
  const start = parsed ? parsed.start : 0;
  if (start >= LIMIT) return new Response(upstreamResponse.body, { status: upstreamResponse.status, headers: outHeaders });
  if (!upstreamResponse.body) return new Response(null, { status: upstreamResponse.status, headers: outHeaders });
  const reader = upstreamResponse.body.getReader();
  const first = [];
  let size = 0;
  const need = parsed ? Math.min(LIMIT - start, parsed.end == null ? LIMIT : parsed.end - start + 1) : LIMIT;
  try {
    while (size < need) {
      const part = await reader.read();
      if (part.done) break;
      first.push(part.value); size += part.value.length;
    }
  } catch { return new Response("failed reading encrypted MP4 header", { status: 502, headers: corsHeaders() }); }
  const encrypted = new Uint8Array(size);
  let off = 0; for (const p of first) { encrypted.set(p,off); off += p.length; }
  let decrypted;
  try { decrypted = await cryptCtr(encrypted, key, start); }
  catch { return new Response("MP4 decrypt failed", { status: 502, headers: corsHeaders() }); }
  const body = new ReadableStream({
    start(controller) {
      if (decrypted.length) controller.enqueue(decrypted);
      (async () => {
        try {
          while (true) { const x = await reader.read(); if (x.done) break; controller.enqueue(x.value); }
          controller.close();
        } catch (e) { controller.error(e); }
      })();
    },
    cancel() { try { reader.cancel(); } catch {} }
  });
  return new Response(body, { status: upstreamResponse.status, headers: outHeaders });
}
