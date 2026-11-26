export function demo() {
  function layer(id,kind,w,h,x,y,color,options={}) {
    const {rotation=0,radius=0,mask=null,masks=[],opacity=1,blend='normal',visible=true}=options;
    return {id,shape:{kind,w,h,radius},transform:{x,y,rotation},color,opacity,blend,mask,masks,visible};
  }
  const clip=id=>({id,operation:'intersect'});
  return {id:'orbital-print',width:400,height:236,samples:2,layers:[
    layer('window','rect',314,178,200,118,'#ffffff',{radius:18,visible:false}),
    layer('dark','rect',314,178,200,118,'#21434d',{radius:18,masks:[clip('window')]}),
    layer('planet','ellipse',160,160,192,105,'#f6a778',{masks:[clip('window'),{id:'crater',operation:'subtract'}]}),
    layer('shadow','ellipse',174,180,239,89,'#c45660',{mask:'planet',blend:'multiply',opacity:.86}),
    layer('ring','rect',346,25,213,134,'#70d7c0',{radius:12,rotation:-22,masks:[clip('window'),{id:'beam',operation:'union'}],blend:'screen',opacity:.75}),
    layer('star-a','diamond',27,31,76,82,'#f8e7b0',{mask:'window'}),
    layer('star-b','diamond',20,27,331,66,'#f8e7b0',{mask:'window'}),
    layer('star-c','diamond',11,17,289,160,'#9ddbad',{mask:'window'}),
    // 裁边图层集中在堆栈顶部，按 ID 引用，与画面叠放顺序无关。
    layer('crater','ellipse',34,26,176,92,'#000000',{visible:false}),
    layer('beam','diamond',46,120,348,118,'#ffffff00',{opacity:0}),
  ]};
}
