import { $, el } from './dom.mjs';
import { artifact, decode, get, post, postRaw } from './api.mjs';
import { mountFields } from './fields.mjs';
import { parseDocument, readSource, updateDocument } from './documents.mjs';
import { refreshVersions } from './versions.mjs';
import { fields, present, mountImport } from './surface.mjs';

const editor=$('document'), status=$('status'), stage=$('stage'), inspection=$('inspection'), download=$('download');
const actions=['demo','freeze','render','import'].map($);
let metadata,busy=false,objectUrl,pristine=null;

function note(message,error=false) { status.value=message; status.dataset.error=String(error); }

function dirty() {
  // Once the text changes, the imported raw bytes no longer represent the draft.
  pristine=null;
  download.hidden=true;
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

function showDownload(id) {
  download.href=`/api/library/${id}/asset`;
  download.hidden=false;
}

// Build the next proof in detached nodes and fully decode its image before
// touching the live page. A rejection here leaves the old canvas, probe,
// layer readings, editor draft and download entry exactly where they were.
async function prepareProof(document,summary,blob) {
  const nextUrl=URL.createObjectURL(blob);
  const stageBuffer=el('div');
  const inspectBuffer=el('div');
  try {
    await present({stage:stageBuffer,inspect:inspectBuffer,summary,document,blob,url:nextUrl});
  } catch(error) {
    URL.revokeObjectURL(nextUrl);
    throw new Error('校样图片无法解码：浏览器不能读取返回的 PNG，已保留原校样与编辑稿',{cause:error});
  }
  return {nextUrl,stageBuffer,inspectBuffer};
}

function commitProof(document,prepared) {
  setDocument(document);
  if(objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl=prepared.nextUrl;
  // The prepared canvas is already decoded and drawn; adoption keeps its bitmap.
  stage.replaceChildren(...prepared.stageBuffer.childNodes);
  inspection.replaceChildren(...prepared.inspectBuffer.childNodes);
}

function decodeProof(base64) {
  try { return decode(base64,metadata?.asset??'image/png'); }
  catch(error) {
    throw new Error('校样图片无法解码：返回的图像数据不是有效 PNG，已保留原校样与编辑稿',{cause:error});
  }
}

// An untouched imported draft is still its original file bytes, so update and
// freeze submit exactly those bytes (same boundary the API judges directly).
function currentSubmission() {
  const document=parseDocument(editor.value);
  if(pristine && editor.value===pristine.text) return {document,bytes:pristine.bytes};
  return {document,bytes:null};
}

async function preview(document,rawBytes=null) {
  note('正在生成校样…');
  const payload=rawBytes?await postRaw('/api/preview',rawBytes):await post('/api/preview',document);
  const prepared=await prepareProof(document,payload.summary,decodeProof(payload.base64));
  commitProof(document,prepared);
  download.hidden=true; // The new proof is not a frozen asset yet; old entry exits only now.
  pristine=rawBytes?{text:editor.value,bytes:rawBytes}:null;
  note('校样已更新');
}

async function loadDemo() {
  const result=await get('/api/demo');
  metadata=result.metadata;
  await preview(result.document);
}

async function openVersion(id) {
  const [record,blob]=await Promise.all([get(`/api/library/${id}`),artifact(id)]);
  const prepared=await prepareProof(record.document,record.summary,blob);
  commitProof(record.document,prepared);
  pristine=null;
  showDownload(id);
  note(`冻结版本 ${id.slice(0,12)}`);
}

async function listVersions() {
  await refreshVersions($('versions'),id=>task(()=>openVersion(id)));
}

$('demo').onclick=()=>task(loadDemo);
$('render').onclick=()=>task(async()=>{
  const {document,bytes}=currentSubmission();
  await preview(document,bytes);
});
$('freeze').onclick=()=>task(async()=>{
  note('正在冻结…');
  const {document,bytes}=currentSubmission();
  const saved=bytes?await postRaw('/api/library',bytes):await post('/api/library',document);
  const [record,blob]=await Promise.all([get(`/api/library/${saved.id}`),artifact(saved.id)]);
  const prepared=await prepareProof(record.document,saved.summary,blob);
  commitProof(record.document,prepared);
  pristine=null;
  showDownload(saved.id);
  await listVersions();
  note(`${saved.created?'已冻结':'已复用'} ${saved.id.slice(0,12)}`);
});
$('import').onclick=()=>$('file').click();
$('file').onchange=()=>task(async()=>{
  const file=$('file').files[0]; $('file').value='';
  if(!file) return;
  // Byte budget, fatal UTF-8 and JSON parsing all happen before any swap;
  // a thrown error is reported by task() with the previous proof intact.
  const {document,bytes}=await readSource(file);
  await preview(document,bytes);
});
editor.oninput=dirty;
editor.onchange=()=>{
  try {setDocument(parseDocument(editor.value));}
  catch(error) {note(error.message,true);}
};
mountImport?.($('editor-extras'),()=>parseDocument(editor.value),document=>{setDocument(document);dirty();},message=>note(message,true));
$('inspection').append(el('p','等待校样','muted'));
await task(async()=>{
  // A decode/network failure of the sample proof must not hide frozen versions.
  try { await loadDemo(); } catch(error) { note(error.message,true); }
  await listVersions();
});
