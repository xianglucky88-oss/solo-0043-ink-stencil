import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { start } from '../server.mjs';
import { checks } from './product-checks.mjs';

const storage=await mkdtemp(join(tmpdir(),'media-workflow-'));
let server;
async function open() { server=await start({port:0,storage}); }
async function close() { if (server?.listening) await new Promise(resolve=>server.close(resolve)); }
function get(path,options) { return fetch(`http://127.0.0.1:${server.address().port}${path}`,options); }
const send=(path,document)=>get(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(document)});
const read=async(response,status=200)=>{
  const body=await response.json(); assert.equal(response.status,status,JSON.stringify(body).slice(0,240)); return body;
};
try {
  await open();
  const {document,metadata}=await read(await get('/api/demo'));
  const preview=async(doc=document)=>read(await send('/api/preview',doc));
  const rejected=async doc=>read(await send('/api/preview',doc),422);
  const save=async(doc=document,status=201)=>read(await send('/api/library',doc),status);
  const asset=async id=>{
    const response=await get(`/api/library/${id}/asset`);
    assert.equal(response.status,200); assert.equal(response.headers.get('content-type'),metadata.asset);
    return Buffer.from(await response.arrayBuffer());
  };
  const actions={
    import:async()=>{
      assert.equal((await get('/')).status,200);
      assert.match(await (await get('/')).text(),new RegExp(metadata.title));
      await preview();
      const bad=await get('/api/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:'{' });
      await read(bad,400); await rejected({});
    },
    outline:async()=>{
      const inflate=(await import('node:zlib')).inflateSync;
      // 预览接口直接返回轮廓素材（base64 灰度 PNG + 参数块）。
      const result=await read(await send('/api/outline',document));
      assert.ok(result.meta.gridWidth>0 && result.meta.paddingPixels===4);
      const bytes=Buffer.from(result.base64,'base64');
      assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
      assert.match(bytes.toString('latin1'),/ink-outline/);
      // 冻结后同一版本可分别下载彩色 PNG 与轮廓素材。
      const {id}=await save();
      const colorPng=await asset(id);
      const outlineResp=await get(`/api/library/${id}/outline`);
      assert.equal(outlineResp.status,200);
      assert.equal(outlineResp.headers.get('content-type'),'image/png');
      const outlineBytes=Buffer.from(await outlineResp.arrayBuffer());
      assert.deepEqual(outlineBytes,bytes);
      assert.match(outlineResp.headers.get('content-disposition')??'',/outline\.png/);
      // 按块解析：IHDR 为 8 位灰度（色彩类型 0），IDAT 解出的行数与网格一致。
      let offset=8, ihdr=null, idat=[];
      while(offset<outlineBytes.length) {
        const len=outlineBytes.readUInt32BE(offset), type=outlineBytes.toString('ascii',offset+4,offset+8);
        if(type==='IHDR') ihdr=outlineBytes.subarray(offset+8,offset+8+len);
        if(type==='IDAT') idat.push(outlineBytes.subarray(offset+8,offset+8+len));
        offset+=12+len;
        if(type==='IEND') break;
      }
      assert.equal(ihdr[9],0);
      const gridW=ihdr.readUInt32BE(0), gridH=ihdr.readUInt32BE(4);
      assert.equal(gridW,result.meta.gridWidth);
      const raw=inflate(Buffer.concat(idat));
      assert.equal(raw.length,(gridW+1)*gridH);
      // 与彩色 PNG 是两份不同资产。
      assert.notDeepEqual(colorPng,outlineBytes);
      // 未知版本 404。
      await read(await get(`/api/library/${'a'.repeat(64)}/outline`),404);
    },
    freeze:async()=>{
      const [a,b]=await Promise.all([send('/api/library',document),send('/api/library',document)]);
      assert.deepEqual([a.status,b.status].sort(),[200,201]);
      const [first,second]=await Promise.all([a.json(),b.json()]);
      assert.equal(first.id,second.id);
      const rotated=Object.fromEntries(Object.entries(document).reverse());
      assert.equal((await save(rotated,200)).id,first.id);
    },
    download:async()=>{
      const {id}=await save(); const first=await preview();
      assert.equal((await asset(id)).toString('base64'),first.base64);
      await read(await get(`/api/library/${'a'.repeat(64)}/asset`),404);
    },
    reopen:async()=>{
      const {id}=await save(); await close(); await open();
      const record=await read(await get(`/api/library/${id}`));
      assert.equal(record.document.id,document.id);
      assert.equal(record.summary.id,document.id);
      assert.equal((await read(await get('/api/library')))[0].id,id);
    },
    integrity:async()=>{
      const {id}=await save();
      await writeFile(join(storage,`${id}.json`),'{}');
      await read(await get(`/api/library/${id}`),409);
      await read(await get(`/api/library/${id}/asset`),409);
    },
    ...checks({document, preview, rejected}),
  };
  const name=process.argv[2]??'proof';
  assert.ok(Object.hasOwn(actions,name),`Unknown workflow: ${name}`);
  await actions[name](); console.log(`Workflow ${name}: OK`);
} finally {
  await close(); await rm(storage,{force:true,recursive:true});
}
