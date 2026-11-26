import { get } from './api.mjs';
import { el } from './dom.mjs';

export async function refreshVersions(container,open) {
  const versions=await get('/api/library');
  if(!versions.length) { container.replaceChildren(el('p','暂无冻结版本','note')); return; }
  container.replaceChildren(...versions.map(({id,time})=>{
    const row=el('div',undefined,'version-row');
    const button=el('button',undefined,'version');
    button.type='button'; button.title=id;
    button.append(el('span',id.slice(0,12),'mono'),el('time',new Date(time).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})));
    button.addEventListener('click',()=>open(id));
    const tile=document.createElement('a');
    tile.className='version-tile mono';
    tile.href=`/api/library/${id}/tile`;
    tile.title=`下载 ${id.slice(0,12)} 的重复铺贴小图`;
    tile.textContent='铺贴图';
    tile.setAttribute('download',`ink-stencil-${id.slice(0,12)}-tile.png`);
    row.append(button,tile);
    return row;
  }));
}
