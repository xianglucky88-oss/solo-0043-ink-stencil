import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { createProofSession } from '../web/proof-session.mjs';

function pixelReader(result) {
  const png=Buffer.from(result.base64,'base64');
  const width=png.readUInt32BE(16);
  const size=png.readUInt32BE(33);
  const raw=inflateSync(png.subarray(41,41+size));
  return { width, get:(x,y)=>Array.from(raw.subarray(y*(width*4+1)+1+x*4,y*(width*4+1)+5+x*4)) };
}

const L=512;
function documentAt(ax,ay,bx,by) {
  return {id:'local-proof',width:L,height:L,samples:2,layers:[
    // Two independent two-step clip chains. The nudged masks are the upstream
    // end of each chain; the static clip masks interpose before the ink layer.
    // Odd 13 px widths plus fractional moves force sub-sampled partial edges.
    {id:'mask-a',shape:{kind:'rect',w:13,h:13,radius:0},transform:{x:ax,y:ay},color:'#00000000',opacity:1,blend:'normal',mask:null,visible:false},
    {id:'clip-a',shape:{kind:'rect',w:13,h:13,radius:0},transform:{x:100,y:100},color:'#00000000',opacity:1,blend:'normal',mask:'mask-a',visible:false},
    {id:'mask-b',shape:{kind:'rect',w:13,h:13,radius:0},transform:{x:bx,y:by},color:'#00000000',opacity:1,blend:'normal',mask:null,visible:false},
    {id:'clip-b',shape:{kind:'rect',w:13,h:13,radius:0},transform:{x:400,y:400},color:'#00000000',opacity:1,blend:'normal',mask:'mask-b',visible:false},
    {id:'ink-a',shape:{kind:'rect',w:L,h:L,radius:0},transform:{x:256,y:256},color:'#3366cc',opacity:1,blend:'normal',mask:'clip-a',visible:true},
    {id:'ink-b',shape:{kind:'rect',w:L,h:L,radius:0},transform:{x:256,y:256},color:'#cc6633',opacity:1,blend:'multiply',mask:'clip-b',visible:true},
  ]};
}

const moved=(document,transform,id)=>document.layers.map(layer=>layer.id===id?{...layer,transform}:layer);

export function incrementalChecks({ send, read }) {
  return {
    incremental:async()=>{
      // Two small hidden masks sit far apart; each edit nudges one by 2.25 px,
      // so every before/after footprint stays inside its own 16x16 box while
      // odd-width masks still produce half-covered sub-sample edges.
      const doc0=documentAt(100,100,400,400);
      const doc1={...doc0,layers:moved(doc0,{x:102.25,y:100},'mask-a')};
      const doc2={...doc1,layers:moved(doc1,{x:402.25,y:400},'mask-b')};
      const quarter=L*L/4;

      // First image is a full render.
      const first=await read(await send('/api/preview',doc0));
      assert.equal(first.mode,'full');
      const firstReader=pixelReader(first);
      assert.ok(first.summary.painted>0);

      // Warm the cache with both submissions as the client would have displayed
      // the first proof before editing again. Previews never hit disk.
      await read(await send('/api/preview',doc1));

      // Two updates submitted back-to-back; the second response may land first.
      // Each carries the most recently successful submission as its base, so the
      // second proof accumulates both edits.
      const envelope=(base,document)=>({base,document});
      const later=send('/api/preview',envelope(doc1,doc2));
      const second=await read(await send('/api/preview',envelope(doc0,doc1)));
      const third=await read(await later);

      assert.equal(second.mode,'incremental');
      assert.equal(third.mode,'incremental');
      // Each move footprint fits its own 16x16 box and stays far apart.
      for (const result of [second,third]) {
        const w=result.region.x1-result.region.x0, h=result.region.y1-result.region.y0;
        assert.ok(w<=16 && h<=16,`region ${w}x${h} exceeds 16x16`);
      }
      assert.ok(second.region.x1<300 && third.region.x0>300,'the two edits are far apart');
      // Sub-samples never multiply the per-pixel count; total stays under 1/4.
      assert.equal(second.recomputed+third.recomputed,
        (second.region.x1-second.region.x0)*(second.region.y1-second.region.y0)
        +(third.region.x1-third.region.x0)*(third.region.y1-third.region.y0));
      assert.ok(second.recomputed+third.recomputed<=quarter,
        `recomputed ${second.recomputed+third.recomputed} > ${quarter}`);

      // The twice-edited proof equals a from-scratch render of that submission.
      const full2=await read(await send('/api/preview',doc2));
      assert.equal(full2.mode,'full');
      assert.deepEqual(third.summary,full2.summary);
      assert.equal(third.base64,full2.base64);

      // Old position uncovered pixels return to transparent; new semi-transparent
      // edge follows the sub-sample grid of the submitted document.
      const r3=pixelReader(third), rFull=pixelReader(full2);
      assert.deepEqual(r3.get(94,100),[0,0,0,0]);
      assert.equal(r3.get(95,100)[3],128,'mask-a new edge is a half-covered sub-sample');
      assert.deepEqual(r3.get(94,100),rFull.get(94,100));
      assert.deepEqual(r3.get(394,400),[0,0,0,0]);
      assert.equal(r3.get(395,400)[3],128,'mask-b new edge is a half-covered sub-sample');
      assert.deepEqual(r3.get(395,400),rFull.get(395,400));
      assert.ok(firstReader.get(94,100)[3]>0,'the first proof still showed the old mask-a area');
      assert.ok(firstReader.get(394,400)[3]>0,'the first proof still showed the old mask-b area');

      // Structural edits cannot stay local: canvas/sampling changes or moving a
      // visible layer fall back to full renders. A missing base is rebuilt and
      // still renders locally when only hidden masks moved.
      const rebuilt=await read(await send('/api/preview',envelope(documentAt(8,8,9,9),doc1)));
      assert.equal(rebuilt.mode,'incremental');
      assert.equal((await read(await send('/api/preview',{...doc2,width:256,height:256}))).mode,'full');
      const visible={...doc2,layers:moved(doc2,{x:103,y:101},'mask-a').map(l=>l.id==='mask-a'?{...l,visible:true}:l)};
      assert.equal((await read(await send('/api/preview',envelope(doc2,visible)))).mode,'full');
      // A plain document (no envelope) always takes the full-render path.
      assert.equal((await read(await send('/api/preview',doc1))).mode,'full');

      await sessionRules();
    },
  };
}

async function sessionRules() {
  const events=[];
  function deferred() {
    let resolve,reject;
    const promise=new Promise((res,rej)=>{resolve=res;reject=rej;});
    return {promise,resolve,reject};
  }
  const queue=[];
  const transport=request=>{ const d=deferred(); queue.push({request,...d}); return d.promise; };
  const proofs=[];
  const session=createProofSession({ transport, view:{
    onProof:proof=>proofs.push(proof),
    onStatus:status=>events.push(status),
  }});

  const docA={id:'a'}, docB={id:'b'}, proofA={summary:{id:'a'},base64:'A'}, proofB={summary:{id:'b'},base64:'B'};
  const first=session.submit(docA);
  const second=session.submit(docB);
  assert.equal(queue.length,2);
  assert.equal(queue[0].request.base,null);
  assert.equal(queue[1].request.base,null); // no successful proof yet
  // Earlier result arrives late: it must not overwrite the newer proof.
  queue[1].resolve(proofB); await second;
  queue[0].resolve(proofA); await first;
  assert.equal(proofs.length,1);
  assert.deepEqual(proofs[0].summary,{id:'b'});

  // A rejected latest request keeps the last successful proof and says so.
  const docC={id:'c'};
  const failing=session.submit(docC);
  queue[2].reject(new Error('422 非法'));
  await failing.catch(()=>{});
  assert.equal(proofs.length,1);
  const rejection=events.at(-1);
  assert.ok(rejection.rejected);
  assert.match(rejection.message,/不对应编辑器现稿/);

  // Dirty edits never replace the proof.
  session.markDirty();
  assert.equal(proofs.length,1);
  assert.match(events.at(-1).message,/上一份成功提交/);

  // Next successful submission uses the last proof as its incremental base.
  const docD={id:'d'};
  const ok=session.submit(docD);
  assert.deepEqual(queue[3].request.base,docB);
  queue[3].resolve({summary:{id:'d'},base64:'D'});
  await ok;
  assert.equal(proofs.length,2);
  assert.equal(session.state.lastProof.document,docD);
  assert.equal(session.state.dirty,false);
}
