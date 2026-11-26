export function demo() {
  function layer(id,kind,w,h,x,y,color,options={}) {
    const {rotation=0,radius=0,mask=null,opacity=1,blend='normal',visible=true}=options;
    return {id,shape:{kind,w,h,radius},transform:{x,y,rotation},color,opacity,blend,mask,visible};
  }
  return {id:'orbital-print',width:400,height:236,samples:2,layers:[
    layer('window','rect',314,178,200,118,'#ffffff',{radius:18,visible:false}),
    layer('dark','rect',314,178,200,118,'#21434d',{radius:18,mask:'window'}),
    layer('planet','ellipse',160,160,192,105,'#f6a778',{mask:'window'}),
    layer('shadow','ellipse',174,180,239,89,'#c45660',{mask:'planet',blend:'multiply',opacity:.86}),
    layer('ring','rect',346,25,213,134,'#70d7c0',{radius:12,rotation:-22,mask:'window',blend:'screen',opacity:.75}),
    layer('star-a','diamond',27,31,76,82,'#f8e7b0',{mask:'window'}),
    layer('star-b','diamond',20,27,331,66,'#f8e7b0',{mask:'window'}),
    layer('star-c','diamond',11,17,289,160,'#9ddbad',{mask:'window'}),
  ]};
}

// A small three-frame loop used by the frame/APNG acceptance and the
// “揭幕样例” button. The hidden `cut` layer is the crop edge: it moves in the
// second frame and omits position in the third, which must inherit the move.
export function revealDemo() {
  const layer=(id,kind,w,h,x,y,color,options={})=>({
    id,shape:{kind,w,h,radius:options.radius??0},
    transform:{x,y,rotation:options.rotation??0},color,
    opacity:options.opacity??1,blend:options.blend??'normal',
    mask:options.mask??null,visible:options.visible??true,
  });
  return {
    id:'seal-reveal',width:96,height:96,samples:2,
    layers:[
      layer('cut','ellipse',58,58,33,48,'#ffffff',{visible:false}),
      layer('disc','ellipse',66,66,48,48,'#21434d',{mask:'cut'}),
      layer('orbit','rect',70,12,48,48,'#70d7c0',{radius:6,rotation:-24,mask:'cut',blend:'screen',opacity:.85}),
      layer('gem','diamond',26,32,48,47,'#f6a778',{mask:'cut'}),
      layer('spark','diamond',10,12,66,30,'#f8e7b0',{mask:'cut'}),
    ],
    animation:{
      end:500,
      frames:[
        {at:0},
        {at:120,layers:{cut:{x:63}}},
        {at:370},
      ],
    },
  };
}
