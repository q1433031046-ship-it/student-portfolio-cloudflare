import template from "../_generated/pages-template.json";
import { getBucket, getMediaKv, kvChunkKey, KV_UPLOAD_CHUNK_SIZE } from "./storage";
import { PagesError } from "./pages-client";
import type { PagesFileRow } from "./pages-store";
export { template };
export const PAGES_HEADERS = "/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Content-Security-Policy: default-src 'self'; img-src 'self' data:; media-src 'self'; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n/media/*\n  Cache-Control: public, max-age=31536000, immutable\n/data/*\n  Cache-Control: public, max-age=0, must-revalidate\n/index.html\n  Cache-Control: public, max-age=0, must-revalidate\n";
export function encodeText(text: string) { const b = new TextEncoder().encode(text); let s=""; for(let at=0;at<b.length;at+=4096)s+=String.fromCharCode(...b.subarray(at,at+4096));return btoa(s); }
export function inlineBytes(value: string) { return Uint8Array.from(atob(value), c=>c.charCodeAt(0)); }
export async function openPagesFile(file: PagesFileRow): Promise<ReadableStream<Uint8Array>> {
  if (file.inline_base64 !== null) { const b=inlineBytes(file.inline_base64);return new ReadableStream({start(c){c.enqueue(b);c.close();}}); }
  if (!file.object_key) throw new PagesError("PAGES_MEDIA_MISSING", "冻结媒体缺少引用");
  if (file.storage_backend === "r2") {
    const object = await getBucket().get(file.object_key);
    if (!object || object.size !== file.byte_size || object.httpEtag.trim() !== file.source_etag) { await object?.body.cancel();throw new PagesError("PAGES_MEDIA_CHANGED", "旧媒体内容已变化"); }
    return object.body;
  }
  const kv=getMediaKv(),key=file.object_key;let index=0,bytes=0;
  return new ReadableStream({ async pull(c) {
    const chunk=await kv.get(kvChunkKey(key,index),{type:"arrayBuffer",cacheTtl:60});
    const expected=Math.min(KV_UPLOAD_CHUNK_SIZE,file.byte_size-bytes);
    if(!chunk || chunk.byteLength!==expected){c.error(new PagesError("PAGES_MEDIA_CHANGED","冻结媒体分块缺失或大小不符"));return;}
    index++;bytes+=chunk.byteLength;c.enqueue(new Uint8Array(chunk));if(bytes===file.byte_size)c.close();
  }});
}
export function templateRows(title: string, adminUrl: string) {
  const escape=(s:string)=>s.replaceAll("&","&amp;").replaceAll('"',"&quot;").replaceAll("<","&lt;").replaceAll(">","&gt;");
  return template.files.map(f=>{let base64=f.base64; if(f.path==="index.html")base64=encodeText(new TextDecoder().decode(inlineBytes(base64)).replace("__STATIC_SITE_TITLE__",escape(title)).replace("__WORKER_ADMIN_URL__",escape(adminUrl)));
    return {path:f.path,byte_size:inlineBytes(base64).length,content_type:f.path.endsWith(".html")?"text/html":f.path.endsWith(".css")?"text/css":"application/javascript",inline_base64:base64}; });
}
