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

export function checks({document,preview,rejected,save}) {
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
      // 旧的单遮罩文档：前序相交、隐藏遮罩不着色，行为保持不变。
      const a=layer('clip','#ffffff',{shape:{kind:'ellipse',w:8,h:8},visible:false}),b=layer('ink','#f00000',{mask:'clip'});
      const get=pixels(await preview(small([a,b])));assert.deepEqual(get(15,15),[240,0,0,255]);assert.equal(get(8,8)[3],0);
      // 新写法的单遮罩与旧字符串等价。
      const again=await preview(small([a,{...b,mask:null,masks:[{id:'clip',operation:'intersect'}]}]));
      assert.deepEqual(pixels(again)(15,15),[240,0,0,255]);
      // 遮罩可引用堆栈任意位置：裁边层移到被裁图层上方，裁边关系不变。
      const forward=pixels(await preview(small([{...b,mask:null,masks:[{id:'clip',operation:'intersect'}]},a])));
      assert.deepEqual(forward(15,15),[240,0,0,255]);assert.equal(forward(8,8)[3],0);
      // 透明色、零不透明度、隐藏都不能让轮廓消失。
      const ghost=layer('ghost','#ffffff00',{shape:{kind:'ellipse',w:8,h:8},opacity:0,visible:false});
      const cut=layer('cut','#f00000',{mask:null,masks:[{id:'ghost',operation:'intersect'}]});
      const ghosted=pixels(await preview(small([ghost,cut])));
      assert.deepEqual(ghosted(15,15),[240,0,0,255]);assert.equal(ghosted(8,8)[3],0);
      // 两倍采样、拼接缝正好经过像素中心：并集不得漏出半透明圈。
      const left=layer('left-mask','#ffffff',{shape:{kind:'rect',w:16,h:20,radius:0},transform:{x:8,y:16},visible:false});
      const right=layer('right-mask','#ffffff',{shape:{kind:'rect',w:16,h:20,radius:0},transform:{x:24,y:16},visible:false});
      const unioned=layer('union-ink','#f00000',{mask:null,masks:[{id:'left-mask',operation:'intersect'},{id:'right-mask',operation:'union'}]});
      assert.deepEqual(pixels(await preview(small([left,right,unioned],2)))(16,15),[240,0,0,255]);
      // 扣孔经过像素中心：保留原色，只在真正被扣除的子样点上得到正确的半透明边。
      const plate=layer('plate','#0000ff',{shape:{kind:'rect',w:9,h:20,radius:0},transform:{x:15.5,y:16},visible:false});
      const hole=layer('hole','#ffffff',{shape:{kind:'rect',w:15,h:20,radius:0},transform:{x:24,y:16},visible:false});
      const drilled=layer('drilled','#0000ff',
        {mask:null,masks:[{id:'plate',operation:'intersect'},{id:'hole',operation:'subtract'}]});
      assert.deepEqual(pixels(await preview(small([plate,hole,drilled],2)))(16,15),[0,0,255,128]);
      // 调整画面层叠顺序只改着色遮盖，不重接裁边关系。
      const reordered=pixels(await preview(small([hole,plate,drilled],2)));
      assert.deepEqual(reordered(16,15),[0,0,255,128]);
      // 找不到的遮罩、自引用与成环关系：预览与冻结都拒绝，不拿未裁画面顶上。
      const missing=small([{...b,mask:'nope'}]);
      await rejected(missing); await save(missing,422);
      const self=small([{...b,mask:'ink'}]);
      await rejected(self); await save(self,422);
      const ringA=layer('ring-a','#f00000',{mask:'ring-b'}), ringB=layer('ring-b','#00ff00',{mask:'ring-a'});
      const cyclic=small([ringA,ringB]);
      await rejected(cyclic); await save(cyclic,422);
      await rejected(small([a,{...b,mask:'clip',masks:[{id:'clip',operation:'intersect'}]}]));
      await rejected(small([a,{...b,mask:null,masks:[
        {id:'clip',operation:'intersect'},{id:'clip',operation:'union'},{id:'clip',operation:'subtract'}]}]));
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
