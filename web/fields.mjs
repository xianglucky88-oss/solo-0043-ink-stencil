import { el } from './dom.mjs';

export function mountFields(container,fields,value,change) {
  const get=(state,path)=>path.reduce((object,key)=>object?.[key],state);
  container.replaceChildren();
  for(const [label,path,type,options] of fields) {
    const keys=path.split('.'), row=el('div',undefined,'field');
    const title=el('label',label), input=el(type==='select'?'select':'input');
    input.id=`field-${path.replaceAll('.','-')}`; title.htmlFor=input.id;
    if(type==='select') {
      for(const [id,text] of options) { const option=el('option',text); option.value=id; input.append(option); }
    } else {
      input.type=type;
      if(type==='number') [input.min,input.max,input.step]=options;
    }
    const setting=get(value,keys);
    if(type==='checkbox') input.checked=Boolean(setting);
    else input.value=setting??'';
    input.addEventListener('change',()=>{
      const next=type==='checkbox'?input.checked : type==='number'?input.valueAsNumber :
        type==='select'?options.find(([id])=>String(id)===input.value)?.[0] : input.value;
      if(type==='number' && (!input.validity.valid || !Number.isFinite(next))) { input.value=setting; return; }
      change(keys,next);
    });
    row.append(title,input); container.append(row);
  }
}
