export function parseDocument(text) {
  let value;
  try { value=JSON.parse(text); }
  catch { throw new Error('源文档不是有效的 JSON'); }
  if(!value || Array.isArray(value) || typeof value!=='object') throw new Error('源文档必须是 JSON 对象');
  return value;
}

export async function readFile(file) {
  if(file.size>6*1024*1024) throw new Error('源文档超过 6 MiB');
  return parseDocument(await file.text());
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
