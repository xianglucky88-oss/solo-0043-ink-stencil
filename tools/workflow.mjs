import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { start } from '../server.mjs';
import { checks } from './product-checks.mjs';
import { mergeDocuments } from '../product/merge.mjs';

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
  const mergeWorkflow=async()=>{
    const layer=(id,mask=null)=>({id,shape:{kind:'rect',w:20,h:20,radius:0},transform:{x:50,y:50},color:'#ff0000',opacity:1,blend:'normal',mask,visible:true});
    const fixture=()=>({
      target:{id:'target',width:100,height:100,samples:1,layers:[layer('same')]},
      source:{id:'source',width:100,height:100,samples:2,layers:[
        layer('shared'),layer('masked','shared'),layer('same','masked'),layer('mark','same'),
      ]},
    });
    const {target,source}=fixture();
    const merged=mergeDocuments(target,source,{ids:['mark'],sourceRect:[0,0,100,100],targetRect:[0,0,50,100]});
    assert.deepEqual(merged.layers.map(row=>row.id),['same','shared','masked','same-2','mark']);
    assert.equal(merged.layers.at(-1).mask,'same-2');
    assert.equal(merged.layers.find(row=>row.id==='shared').visible,false);
    const apiFixture=fixture();
    const response=await read(await send('/api/merge',{...apiFixture,ids:['mark'],sourceRect:[0,0,100,100],targetRect:[0,0,50,100]}));
    assert.equal(response.document.layers.length,5);
    assert.equal(response.document.samples,1);
    const budget=fixture();
    budget.target={width:512,height:512,samples:2,layers:Array.from({length:16},(_,i)=>layer(`full-${i}`))};
    await read(await send('/api/merge',{...budget,ids:['mark'],sourceRect:[0,0,100,100],targetRect:[0,0,50,100]}),422);
  };
  const actions={
    merge:mergeWorkflow,
    mark:mergeWorkflow,
    marks:mergeWorkflow,
    alignment:mergeWorkflow,
    transfer:mergeWorkflow,
    'merge-marks':mergeWorkflow,
    'merge-layers':mergeWorkflow,
    'import-layers':mergeWorkflow,
    import:async()=>{
      assert.equal((await get('/')).status,200);
      assert.match(await (await get('/')).text(),new RegExp(metadata.title));
      await preview();
      const bad=await get('/api/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:'{' });
      await read(bad,400); await rejected({});
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
