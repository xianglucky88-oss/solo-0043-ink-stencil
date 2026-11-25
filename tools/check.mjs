import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

function walk(directory) {
  return readdirSync(directory,{withFileTypes:true}).flatMap(item=>{
    const path=join(directory,item.name);
    return item.isDirectory()?walk(path):path.endsWith('.mjs')?[path]:[];
  });
}

const files=['server.mjs',...['server','product','web','tools'].flatMap(walk)];
for(const file of files) {
  const {status,error}=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});
  if(error || status!==0) throw new Error(`Syntax check failed: ${file}`,{cause:error});
}
console.log(`Syntax checked: ${files.length} modules`);
