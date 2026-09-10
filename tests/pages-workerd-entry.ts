import { digestPagesFile, PagesClient, preflightPagesFiles } from '../app/api/_lib/pages-client';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

const worker = { async fetch(request: Request) {
  const input = await request.json() as { size:number; chunk:number; upload?:boolean; changed?:boolean; fail?:boolean };
  const stream=()=>{let offset=0;return new ReadableStream<Uint8Array>({pull(c){if(offset>=input.size){c.close();return;}const b=new Uint8Array(Math.min(input.chunk,input.size-offset));for(let i=0;i<b.length;i++)b[i]=(offset+i)%251;offset+=b.length;c.enqueue(b);}});};
  let calls=0;
  try {
    preflightPagesFiles([{path:'media/movie.mp4',byteSize:input.size}]);
    const digest=await digestPagesFile('media/movie.mp4',stream(),input.size);
    if(input.upload){
      const fake:typeof fetch=async(_url,init)=>{
        calls++;if(input.fail)return new Response('{"success":false}',{status:503});
        const reader=new Response(init?.body).body!.getReader(), received=sha256.create();let count=0,phase=0,closed=false;
        for(;;){const part=await reader.read();if(part.done)break;const text=new TextDecoder().decode(part.value);
          if(phase===0){if(text!==`[{"key":"${digest.key}","value":"`)throw new Error('wire header mismatch');phase=1;continue;}
          if(text.startsWith('\",\"metadata\"')){if(text!=='\",\"metadata\":{\"contentType\":\"video/mp4\"},\"base64\":true}]')throw new Error('wire footer mismatch');closed=true;continue;}
          const bytes=Uint8Array.from(atob(text),c=>c.charCodeAt(0));count+=bytes.length;received.update(bytes);
        }
        if(count!==input.size || !closed || bytesToHex(received.digest())!==digest.sha256)throw new Error('wire bytes mismatch');
        return Response.json({success:true,result:null});
      };
      await new PagesClient('a'.repeat(32),'fixture','fixture-token',fake).upload({path:'media/movie.mp4',byteSize:input.size,contentType:'video/mp4',sha256:input.changed?'0'.repeat(64):digest.sha256,key:digest.key},stream(),'fixture-jwt');
    }
    return Response.json({ok:true,...digest,calls});
  }catch(e){return Response.json({ok:false,code:(e as {code?:string}).code,calls});}
} };
export default worker;
