// Pure proof-session coordinator: no DOM or fetch here, so the ordering and
// staleness rules can be exercised from Node. The host wires transport and view.
//
// Invariants:
//  - every submit snapshots the document at submit time and gets a sequence id;
//  - only the newest in-flight request may replace the displayed proof;
//  - a late or rejected response never overwrites a newer proof or the editor;
//  - `dirty` means the working copy changed after the newest submit, independent
//    of whether that submit has finished.
export function createProofSession({ transport, view }) {
  let seq=0;
  let pendingCount=0;
  const state={
    lastProof:null,      // newest successfully displayed proof
    lastSubmitted:null,  // document captured by the most recent submit
    dirty:false,
    lastError:null,
  };

  function emit(message) {
    view.onStatus({
      message,
      pending:pendingCount>0,
      dirty:state.dirty,
      hasProof:state.lastProof!==null,
      rejected:state.lastError,
    });
  }

  function adopt(result, document) {
    state.lastProof={ document, summary:result.summary, base64:result.base64,
      mode:result.mode, recomputed:result.recomputed??0 };
    view.onProof(state.lastProof);
  }

  // A proof matches the editor only when no request is still running and the
  // working copy has not changed since that exact submission.
  function statusPrefix() {
    if (pendingCount>0) return '校样生成中 · 可继续编辑';
    if (state.dirty) return '工作文档已变更 · 校样待更新';
    return '';
  }

  async function submit(document) {
    const number=++seq;
    pendingCount++;
    state.lastSubmitted=document;
    state.dirty=false;
    state.lastError=null;
    emit(statusPrefix() || '正在生成校样…');
    let result;
    try {
      result=await transport({
        base:state.lastProof===null ? null : state.lastProof.document,
        document,
      });
    } catch (error) {
      pendingCount--;
      if (number!==seq) return; // stale rejection leaves the newest request untouched
      state.lastError=error;
      const prefix=statusPrefix();
      emit(state.lastProof
        ? `${prefix} · 更新被拒绝：${error.message}（画面仍是上一份成功提交，不对应编辑器现稿）`
        : `${prefix} · 更新被拒绝：${error.message}`);
      return;
    }
    pendingCount--;
    if (number!==seq) return; // stale response never overwrites a newer proof
    adopt(result, document);
    state.lastError=null;
    const prefix=statusPrefix();
    emit(prefix ? `${prefix}（已显示本次提交校样）` : '校样已更新');
  }

  function markDirty() {
    state.dirty=true;
    const prefix=statusPrefix();
    if (!prefix) { emit('工作文档已变更 · 校样待更新'); return; }
    emit(state.lastProof
      ? `${prefix}（画面仍为上一份成功提交）`
      : prefix);
  }

  // Demo, imports, freeze and reopening a frozen version replace the session.
  function reset(document, result, message='校样已更新') {
    seq++;
    pendingCount=0;
    state.lastSubmitted=document;
    state.dirty=false;
    state.lastError=null;
    adopt(result, document);
    emit(message);
  }

  return {
    submit, markDirty, reset,
    get state(){ return state; },
    get pending(){ return pendingCount>0; },
  };
}
