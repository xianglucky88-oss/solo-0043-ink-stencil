import { $, el } from './dom.mjs';
import { artifact, decode, get, post } from './api.mjs';
import { mountFields } from './fields.mjs';
import { parseDocument, readFile, updateDocument } from './documents.mjs';
import { refreshVersions } from './versions.mjs';
import { fields, present, mountImport } from './surface.mjs';

const editor=$('document'), status=$('status'), stage=$('stage');
const actions=['demo','reveal-demo','freeze','render','import'].map($);
let metadata,busy=false,dispose,url;
let activeFrame=null, apngUrl=null, lastView=null;

function note(message,error=false) { status.value=message; status.dataset.error=String(error); }

function dirty() {
  $('download').hidden=true;
  note('工作文档已变更 · 校样待更新');
}

function setDocument(document) {
  editor.value=JSON.stringify(document,null,2);
  $('document-name').textContent=document.id??'未命名';
  mountFields($('controls'),fields,document,(keys,value)=>{
    try { setDocument(updateDocument(editor.value,keys,value)); dirty(); }
    catch(error) { note(error.message,true); }
  });
}

async function task(fn) {
  if(busy) return;
  busy=true; for(const action of actions) action.disabled=true;
  editor.readOnly=true; $('controls').inert=true; $('editor-extras').inert=true;
  try { await fn(); }
  catch(error) { note(error.message,true); }
  finally {
    busy=false; for(const action of actions) action.disabled=false;
    editor.readOnly=false; $('controls').inert=false; $('editor-extras').inert=false;
  }
}

function replaceApngUrl(next) {
  if(apngUrl) URL.revokeObjectURL(apngUrl);
  apngUrl=next;
}

async function display(document,summary,blob) {
  dispose?.();
  if(url) URL.revokeObjectURL(url);
  url=URL.createObjectURL(blob);
  lastView={document,summary,blob};
  setDocument(document);
  stage.replaceChildren(); $('inspection').replaceChildren();
  dispose=await present({
    stage,inspect:$('inspection'),summary,document,blob,url,
    activeFrame,apngUrl,
    onFrame:index=>task(()=>selectFrame(index)),
    onExport:()=>task(exportApng),
  });
}

function showDownload(id) {
  $('download').href=`/api/library/${id}/asset`;
  $('download').hidden=false;
}

async function preview(document) {
  $('download').hidden=true;
  note('正在生成校样…');
  const result=await post('/api/preview',document);
  activeFrame=Number.isInteger(result.frame)?result.frame:null;
  if(result.apng) replaceApngUrl(URL.createObjectURL(decode(result.apng,result.type||'image/apng')));
  await display(document,result.summary,decode(result.base64,metadata.asset));
  note('校样已更新');
}

async function selectFrame(index) {
  const document=parseDocument(editor.value);
  note(`正在直接生成第 ${index+1} 帧校样…`);
  const result=await post('/api/preview',{...document,frame:index});
  activeFrame=index;
  await display(document,result.summary,decode(result.base64,'image/png'));
  note(`第 ${index+1} 帧校样 · 起点 ${result.at} ms · 文件保持 ${result.hold} ms；可任意顺序选帧`);
}

async function exportApng() {
  const working=parseDocument(editor.value);
  note('正在按整段帧安排渲染并编码 APNG…');
  const result=await post('/api/apng',working);
  if(!result?.base64) throw new Error('APNG 导出缺少文件数据');
  replaceApngUrl(URL.createObjectURL(decode(result.base64,result.type||'image/apng')));
  const stem=working.id?String(working.id):'ink-stencil';
  const anchor=window.document.createElement('a');
  anchor.href=apngUrl;
  anchor.download=`${stem}-loop.apng`;
  window.document.body.append(anchor); anchor.click();
  setTimeout(()=>anchor.remove(), 4000);
  if(lastView) await display(lastView.document,lastView.summary,lastView.blob);
  note(`已导出 ${result.frameCount} 帧透明 APNG · 保持 ${result.delays.join(' / ')} ms · 无限循环，未冻结版本`);
}

async function loadDemo() {
  const result=await get('/api/demo');
  metadata=result.metadata;
  activeFrame=null; replaceApngUrl(null);
  await preview(result.document);
}

async function loadRevealDemo() {
  note('正在载入循环揭幕三帧样例…');
  const result=await get('/api/demo/reveal');
  metadata ??= result.metadata;
  activeFrame=null; replaceApngUrl(null);
  await preview(result.document);
}

async function listVersions() {
  await refreshVersions($('versions'),id=>task(async()=>{
    const [record,blob]=await Promise.all([get(`/api/library/${id}`),artifact(id)]);
    activeFrame=null; replaceApngUrl(null);
    await display(record.document,record.summary,blob);
    showDownload(id); note(`冻结版本 ${id.slice(0,12)}`);
  }));
}

$('demo').onclick=()=>task(loadDemo);
$('reveal-demo').onclick=()=>task(loadRevealDemo);
$('render').onclick=()=>task(()=>preview(parseDocument(editor.value)));
$('freeze').onclick=()=>task(async()=>{
  note('正在冻结…');
  const saved=await post('/api/library',parseDocument(editor.value));
  const [record,blob]=await Promise.all([get(`/api/library/${saved.id}`),artifact(saved.id)]);
  activeFrame=null; replaceApngUrl(null);
  await display(record.document,saved.summary,blob);
  showDownload(saved.id); await listVersions(); note(`${saved.created?'已冻结':'已复用'} ${saved.id.slice(0,12)}`);
});
$('import').onclick=()=>$('file').click();
$('file').onchange=()=>task(async()=>{
  const file=$('file').files[0]; $('file').value='';
  if(file) { activeFrame=null; replaceApngUrl(null); await preview(await readFile(file)); }
});
editor.oninput=dirty;
editor.onchange=()=>{
  try {setDocument(parseDocument(editor.value));}
  catch(error) {note(error.message,true);}
};
mountImport?.($('editor-extras'),()=>parseDocument(editor.value),document=>{setDocument(document);dirty();},message=>note(message,true));
$('inspection').append(el('p','等待校样','muted'));
await task(async()=>{await loadDemo();await listVersions();});
