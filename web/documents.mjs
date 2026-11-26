export const UPLOAD_LIMIT = 6 * 1024 * 1024;

export function parseDocument(text) {
  let value;
  try { value=JSON.parse(text); }
  catch { throw new Error('源文档不是有效的 JSON'); }
  if(!value || Array.isArray(value) || typeof value!=='object') throw new Error('源文档必须是 JSON 对象');
  return value;
}

// Admission mirrors server/request-body.mjs exactly: strict byte budget and a
// fatal UTF-8 decode, so a corrupted byte anywhere (including attached prose)
// is rejected before the document can reach proofing.
export function decodeSourceBytes(bytes) {
  const buffer=bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if(buffer.byteLength>UPLOAD_LIMIT) {
    throw new Error(`源文档超过 6 MiB（文档超过上传上限，最多 ${UPLOAD_LIMIT} 字节），已按原文件字节拒绝`);
  }
  let text;
  try {
    text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);
  } catch {
    throw new Error('源文档不是有效的 UTF-8 JSON：正文不是有效的 UTF-8 JSON，附带信息中的文本编码已损坏');
  }
  return parseDocument(text);
}

export async function readSource(file) {
  const bytes=new Uint8Array(await file.arrayBuffer());
  const document=decodeSourceBytes(bytes);
  return {document,bytes};
}

export async function readFile(file) {
  return (await readSource(file)).document;
}

export function updateDocument(text,path,value) {
  const document=parseDocument(text);
  let target=document;
  for(const key of path.slice(0,-1)) {
    if(!target[key] || typeof target[key]!=='object') throw new Error('源文档缺少可编辑参数');
    target=target[key];
  }
  target[path.at(-1)]=value;
  return document;
}
