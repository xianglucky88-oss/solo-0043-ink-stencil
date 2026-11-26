import { $, el } from './dom.mjs';
import { artifact, decode, get, post, preview } from './api.mjs';
import { mountFields } from './fields.mjs';
import { parseDocument, readFile, updateDocument } from './documents.mjs';
import { refreshVersions } from './versions.mjs';
import { fields, present, mountImport } from './surface.mjs';
import { createProofSession } from './proof-session.mjs';

const editor=$('document'), status=$('status'), stage=$('stage');
// Preview never joins this lock: updates must stay editable while a proof renders.
const actions=['demo','freeze','import'].map($);
let metadata,busy=false,dispose,url;

function note(message,error=false) { status.value=message; status.dataset.error=String(error); }

function dirty() {
  $('download').hidden=true;
  session.markDirty();
}

function setDocument(document) {
  editor.value=JSON.stringify(document,null,2);
  $('document-name').textContent=document.id??'未命名';
  mountFields($('controls'),fields,document,(keys,value)=>{
    try { setDocument(updateDocument(editor.value,keys,value)); dirty(); }
    catch(error) { note(error.message,true); }
  });
}

async function presentProof(proof) {
  dispose?.();
  if(url) URL.revokeObjectURL(url);
  const blob=decode(proof.base64,metadata.asset);
  url=URL.createObjectURL(blob);
  stage.replaceChildren(); $('inspection').replaceChildren();
  dispose=await present({stage,inspect:$('inspection'),summary:proof.summary,document:proof.document,
    blob,url,mode:proof.mode,recomputed:proof.recomputed});
}

const session=createProofSession({
  transport:request=>preview(request),
  view:{
    onProof:proof=>presentProof(proof),
    onStatus:({message,pending,dirty:isDirty,rejected})=>{
      note(message, Boolean(rejected));
      status.dataset.pending=String(pending);
      status.dataset.dirty=String(isDirty);
      // Staying enabled lets the designer submit the next edit while a proof renders.
      $('render').disabled=busy;
    },
  },
});

// Non-preview workflows keep the editor lock so imports and freezes stay atomic.
async function task(fn) {
  if(busy) return;
  busy=true; for(const action of [...actions,$('render')]) action.disabled=true;
  editor.readOnly=true; $('controls').inert=true; $('editor-extras').inert=true;
  try { await fn(); }
  catch(error) { note(error.message,true); }
  finally {
    busy=false; for(const action of actions) action.disabled=false;
    $('render').disabled=false;
    editor.readOnly=false; $('controls').inert=false; $('editor-extras').inert=false;
  }
}

function showDownload(id) {
  $('download').href=`/api/library/${id}/asset`;
  $('download').hidden=false;
}

async function loadDemo() {
  const result=await get('/api/demo');
  metadata=result.metadata;
  const rendered=await post('/api/preview',result.document);
  setDocument(result.document);
  session.reset(result.document,rendered,'样例校样已生成');
}

async function listVersions() {
  await refreshVersions($('versions'),id=>task(async()=>{
    const [record,blob]=await Promise.all([get(`/api/library/${id}`),artifact(id)]);
    setDocument(record.document);
    session.reset(record.document,{summary:record.summary,base64:blobToBase64(blob),mode:'frozen'},`冻结版本 ${id.slice(0,12)}`);
    showDownload(id);
  }));
}

async function blobToBase64(blob) {
  const bytes=new Uint8Array(await blob.arrayBuffer());
  let binary='';
  const chunk=0x8000;
  for(let i=0;i<bytes.length;i+=chunk) binary+=String.fromCharCode(...bytes.subarray(i,i+chunk));
  return btoa(binary);
}

$('demo').onclick=()=>task(loadDemo);
$('render').onclick=()=>{
  // The proof always reflects the document at submit time; later edits simply
  // mark the working copy dirty and can be submitted again immediately.
  let document;
  try { document=parseDocument(editor.value); }
  catch(error) { note(error.message,true); return; }
  $('download').hidden=true;
  session.submit(document);
};
$('freeze').onclick=()=>task(async()=>{
  note('正在冻结…');
  const document=parseDocument(editor.value);
  const saved=await post('/api/library',document);
  const [record,blob]=await Promise.all([get(`/api/library/${saved.id}`),artifact(saved.id)]);
  setDocument(record.document);
  session.reset(record.document,{summary:saved.summary,base64:await blobToBase64(blob),mode:'frozen'},
    `${saved.created?'已冻结':'已复用'} ${saved.id.slice(0,12)}`);
  showDownload(saved.id); await listVersions();
});
$('import').onclick=()=>$('file').click();
$('file').onchange=()=>task(async()=>{
  const file=$('file').files[0]; $('file').value='';
  if(!file) return;
  const document=await readFile(file);
  const rendered=await post('/api/preview',document);
  setDocument(document);
  session.reset(document,rendered,'导入文档校样已生成');
});
editor.oninput=dirty;
editor.onchange=()=>{
  try {setDocument(parseDocument(editor.value));}
  catch(error) {note(error.message,true);}
};
mountImport?.($('editor-extras'),()=>parseDocument(editor.value),document=>{setDocument(document);dirty();},message=>note(message,true));
$('inspection').append(el('p','等待校样','muted'));
await task(async()=>{await loadDemo();await listVersions();});
