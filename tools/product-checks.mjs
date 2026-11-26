import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { normalize } from '../product/document.mjs';
import { renderAnimation } from '../product/animation.mjs';

function pixels(result) {
  const png=Buffer.from(result.base64,'base64');
  assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  const width=png.readUInt32BE(16);const size=png.readUInt32BE(33);
  assert.equal(png.toString('ascii',37,41),'IDAT');
  const raw=inflateSync(png.subarray(41,41+size));
  return (x,y)=>Array.from(raw.subarray(y*(width*4+1)+1+x*4,y*(width*4+1)+5+x*4));
}

const layer=(id,color,options={})=>({id,shape:{kind:'rect',w:20,h:20,radius:0},transform:{x:16,y:16},color,opacity:1,blend:'normal',mask:null,visible:true,...options});
const small=(layers,samples=1)=>({id:'proof',width:32,height:32,samples,layers});

// The acceptance arrangement: starts 0/120/370, end 500 -> holds 120/250/130.
// The hidden `cut` crop layer moves in frame two and omits position in frame
// three, which must inherit the moved crop.
function revealDocument() {
  return {
    id:'reveal',width:32,height:32,samples:2,
    layers:[
      layer('cut','#ffffff',{visible:false,shape:{kind:'rect',w:12,h:12,radius:3},transform:{x:10,y:16}}),
      layer('ink','#f00000',{mask:'cut'}),
    ],
    animation:{end:500,frames:[{at:0},{at:120,layers:{cut:{x:22}}},{at:370}]},
  };
}

function apngTiming(base64) {
  const buffer=Buffer.from(base64,'base64');
  assert.equal(buffer.subarray(1,4).toString('ascii'),'PNG');
  let offset=8; const fctls=[]; let actl;
  while(offset<buffer.length) {
    const length=buffer.readUInt32BE(offset);
    const type=buffer.toString('ascii',offset+4,offset+8);
    const data=buffer.subarray(offset+8,offset+8+length);
    if(type==='acTL') actl={frames:data.readUInt32BE(0),plays:data.readUInt32BE(4)};
    if(type==='fcTL') fctls.push({delay:data.readUInt16BE(20)/(data.readUInt16BE(22)||100)*1000,
      dispose:data[24],blend:data[25],width:data.readUInt32BE(4),height:data.readUInt32BE(8)});
    offset+=12+length;
  }
  return {actl,delays:fctls.map(f=>f.delay),fctls};
}

export function checks({document,preview,rejected}) {
  return {
    proof:async()=>{
      const result=await preview();const get=pixels(result);
      assert.deepEqual(get(0,0),[0,0,0,0]);assert.equal(get(200,118)[3],255);
      assert.ok(result.summary.painted>40_000);assert.ok(result.summary.partial>0);
    },
    transform:async()=>{
      const bar=layer('bar','#ffffff',{shape:{kind:'rect',w:20,h:4},transform:{x:16,y:16,rotation:90}});
      const get=pixels(await preview(small([bar])));
      assert.equal(get(16,8)[3],255);assert.equal(get(8,16)[3],0);
      await rejected(small([{...bar,transform:{x:16,y:16,sx:0}}]));
    },
    masks:async()=>{
      const a=layer('clip','#ffffff',{shape:{kind:'ellipse',w:8,h:8},visible:false}),b=layer('ink','#f00000',{mask:'clip'});
      const get=pixels(await preview(small([a,b])));assert.deepEqual(get(15,15),[240,0,0,255]);assert.equal(get(8,8)[3],0);
      await rejected(small([b,a]));
    },
    blend:async()=>{
      const a=layer('under','#80ffff'), b=layer('over','#80ff00',{blend:'multiply'});
      assert.deepEqual(pixels(await preview(small([a,b])))(15,15),[64,255,0,255]);
      assert.deepEqual(pixels(await preview(small([{...a,visible:false},b])))(15,15),[128,255,0,255]);
      await rejected(small([a,{...b,color:'green'}]));
    },
    sampling:async()=>{
      const a=layer('edge','#f00000',{transform:{x:16.4,y:16}});
      const hi=pixels(await preview(small([a],2)))(6,15);
      assert.deepEqual(hi,[240,0,0,128]);
      assert.equal(pixels(await preview(small([a],1)))(6,15)[3],255);
      await rejected({...document,width:512,height:512,layers:[...document.layers,layer('overbudget','#00ff00')]});
    },
    animation:async()=>{
      const source=revealDocument();
      // Arbitrary order: frame 3, frame 1, frame 3 again must be identical.
      const thirdFirst=await preview({...source,frame:2});
      const first=await preview({...source,frame:0});
      const second=await preview({...source,frame:1});
      const thirdAgain=await preview({...source,frame:2});
      assert.equal(thirdFirst.base64,thirdAgain.base64,'同一帧校样不得随查看顺序变化');
      assert.notEqual(first.base64,thirdFirst.base64);
      assert.equal(second.base64,thirdFirst.base64,'第三帧省略位置，必须继承第二帧的新裁边');

      const p0=pixels(first),p1=pixels(second),p2=pixels(thirdAgain);
      // Old crop region: opaque red in frame one, fully transparent once moved.
      assert.equal(p0(8,16)[3],255);
      assert.deepEqual(p1(8,16),[0,0,0,0]);
      assert.deepEqual(p2(8,16),[0,0,0,0]);
      // New crop region appears after the move.
      assert.equal(p0(18,16)[3],0);
      assert.equal(p1(18,16)[3],255);
      // Diagonal/rounded sub-sample coverage is retained in the moved frames.
      let partial=0;
      const get=p1;
      for(let y=0;y<32;y++) for(let x=0;x<32;x++){const a=get(x,y)[3]; if(a>0&&a<255) partial++;}
      assert.ok(partial>0,'移动后的裁边仍应有子样点半透明像素');

      // The exported looping APNG records 120/250/130 ms and loops forever.
      const normalized=normalize(source);
      const art=renderAnimation(normalized);
      const timing=apngTiming(art.bytes.toString('base64'));
      assert.deepEqual(timing.delays,[120,250,130]);
      assert.equal(timing.actl.frames,3);
      assert.equal(timing.actl.plays,0);
      assert.ok(timing.fctls.every(f=>f.width===32&&f.height===32&&f.blend===0),'每帧须为全画布 SOURCE 帧');

      // Unknown layer, invalid timing and whole-loop over-budget all reject.
      await rejected({...source,animation:{end:100,frames:[{at:0,layers:{ghost:{x:1}}}]}});
      await rejected({...source,animation:{end:100,frames:[{at:10}]}});
      await rejected({...source,animation:{end:500,frames:[{at:0},{at:120},{at:120}]}});
      await rejected({...source,animation:{end:370,frames:[{at:0},{at:120},{at:370}]}});
      await rejected({...source,animation:{end:10001,frames:[{at:0}]}});
      const heavy={...source,width:400,height:236,samples:2,
        layers:Array.from({length:8},(_,i)=>({...layer(`l${i}`,'#ffffff')})),
        animation:{end:500,frames:[{at:0},{at:120},{at:370}]}};
      await rejected(heavy);
    },
  };
}
