export const $=id=>document.getElementById(id);

export function el(tag,text,classes) {
  const node=document.createElement(tag);
  if(text!==undefined) node.textContent=text;
  if(classes) node.className=classes;
  return node;
}

export function metrics(rows) {
  const box=el('dl',undefined,'metrics');
  for (const [name,value] of rows) {
    const row=el('div'); row.append(el('dt',name),el('dd',value,'mono')); box.append(row);
  }
  return box;
}

export function checklist(rows) {
  const list=el('ul',undefined,'inspect-list');
  for (const text of rows) list.append(el('li',text));
  return list;
}
