import { $, el } from './dom.mjs';
import { artifact, decode, get, post } from './api.mjs';
import { mountFields } from './fields.mjs';
import { parseDocument, readFile, updateDocument } from './documents.mjs';
import { refreshVersions } from './versions.mjs';
import { fields, present, mountImport } from './surface.mjs';

const editor=$('document'), status=$('status'), stage=$('stage');
const actions=['demo','freeze','render','import'].map($);
let metadata,busy=false,dispose,url;

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

async function display(document,summary,blob) {
  dispose?.();
  if(url) URL.revokeObjectURL(url);
  url=URL.createObjectURL(blob);
  setDocument(document);
  stage.replaceChildren(); $('inspection').replaceChildren();
  dispose=await present({stage,inspect:$('inspection'),summary,document,blob,url});
}

function showDownload(id) {
  $('download').href=`/api/library/${id}/asset`;
  $('download').hidden=false;
}

async function preview(document) {
  $('download').hidden=true; note('正在生成校样…');
  const {summary,base64}=await post('/api/preview',document);
  await display(document,summary,decode(base64,metadata.asset));
  note('校样已更新');
}

async function loadDemo() {
  const result=await get('/api/demo');
  metadata=result.metadata;
  await preview(result.document);
}

async function listVersions() {
  await refreshVersions($('versions'),id=>task(async()=>{
    const [record,blob]=await Promise.all([get(`/api/library/${id}`),artifact(id)]);
    await display(record.document,record.summary,blob);
    showDownload(id); note(`冻结版本 ${id.slice(0,12)}`);
  }));
}

$('demo').onclick=()=>task(loadDemo);
$('render').onclick=()=>task(()=>preview(parseDocument(editor.value)));
$('freeze').onclick=()=>task(async()=>{
  note('正在冻结…');
  const saved=await post('/api/library',parseDocument(editor.value));
  const [record,blob]=await Promise.all([get(`/api/library/${saved.id}`),artifact(saved.id)]);
  await display(record.document,saved.summary,blob);
  showDownload(saved.id); await listVersions(); note(`${saved.created?'已冻结':'已复用'} ${saved.id.slice(0,12)}`);
});
$('import').onclick=()=>$('file').click();
$('file').onchange=()=>task(async()=>{
  const file=$('file').files[0]; $('file').value='';
  if(file) await preview(await readFile(file));
});
editor.oninput=dirty;
editor.onchange=()=>{
  try {setDocument(parseDocument(editor.value));}
  catch(error) {note(error.message,true);}
};
mountImport?.($('editor-extras'),()=>parseDocument(editor.value),document=>{setDocument(document);dirty();},message=>note(message,true));
$('inspection').append(el('p','等待校样','muted'));
await task(async()=>{await loadDemo();await listVersions();});
