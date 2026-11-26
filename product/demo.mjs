export function demo() {
  function layer(id,kind,w,h,x,y,color,options={}) {
    const {rotation=0,radius=0,mask=null,opacity=1,blend='normal',visible=true,plate=null,overprint=false}=options;
    return {id,shape:{kind,w,h,radius},transform:{x,y,rotation},color,opacity,blend,mask,visible,plate,overprint};
  }
  return {id:'orbital-print',width:400,height:236,samples:2,layers:[
    layer('window','rect',314,178,200,118,'#ffffff',{radius:18,visible:false}),
    layer('dark','rect',314,178,200,118,'#21434d',{radius:18,mask:'window',plate:'a',overprint:false}),
    layer('planet','ellipse',160,160,192,105,'#f6a778',{mask:'window',plate:'b',overprint:false}),
    layer('shadow','ellipse',174,180,239,89,'#c45660',{mask:'planet',blend:'multiply',opacity:.86,plate:'b',overprint:false}),
    layer('ring','rect',346,25,213,134,'#70d7c0',{radius:12,rotation:-22,mask:'window',blend:'screen',opacity:.75,plate:'a',overprint:true}),
    layer('star-a','diamond',27,31,76,82,'#f8e7b0',{mask:'window',plate:'a',overprint:true}),
    layer('star-b','diamond',20,27,331,66,'#f8e7b0',{mask:'window',plate:'b',overprint:true}),
    layer('star-c','diamond',11,17,289,160,'#9ddbad',{mask:'window'}),
  ]};
}
