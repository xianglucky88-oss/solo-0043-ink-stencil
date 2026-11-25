import { el } from './dom.mjs';

export async function probe(url,panel) {
  const image=new Image();image.src=url;await image.decode();
  const canvas=el('canvas',undefined,'raster');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
  canvas.tabIndex=0;canvas.setAttribute('aria-label','像素取样画布');
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
  const output=el('output','', 'mono');
  let x=0,y=0;
  function select(a,b){
    x=Math.max(0,Math.min(canvas.width-1,a));y=Math.max(0,Math.min(canvas.height-1,b));
    const [r,g,blue,alpha]=ctx.getImageData(x,y,1,1).data;
    output.value=`${x}, ${y}  /  RGBA ${r}, ${g}, ${blue}, ${alpha}`;
  }
  canvas.addEventListener('pointermove',event=>{
    const rect=canvas.getBoundingClientRect();
    select(Math.floor((event.clientX-rect.left)*canvas.width/rect.width),Math.floor((event.clientY-rect.top)*canvas.height/rect.height));
  });
  canvas.addEventListener('keydown',event=>{
    const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
    if(delta){event.preventDefault();select(x+delta[0],y+delta[1]);}
  });
  panel.append(canvas);select(Math.floor(canvas.width/2),Math.floor(canvas.height/2));
  return output;
}
