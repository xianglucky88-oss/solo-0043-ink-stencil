async function checked(path, options) {
  const response = await fetch(path,options);
  if (!response.ok) {
    const payload=await response.json().catch(()=>({}));
    throw new Error(payload.error ?? `请求失败 (${response.status})`);
  }
  return response;
}

export async function get(path) {
  return (await checked(path)).json();
}

async function send(path,payload) {
  return (await checked(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})).json();
}

export function post(path,document) {
  return send(path,document);
}

// Preview submissions carry the previous successful submission so the server
// can repaint just the moved-mask region when the edit stays local.
export function preview({base,document}) {
  return send('/api/preview',{base,document});
}

export async function artifact(id) {
  return (await checked(`/api/library/${id}/asset`)).blob();
}

export function decode(base64,type) {
  return new Blob([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],{type});
}
