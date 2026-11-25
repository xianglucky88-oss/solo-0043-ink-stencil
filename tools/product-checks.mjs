import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';

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
  };
}
