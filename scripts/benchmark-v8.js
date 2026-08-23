const {spawnSync}=require('child_process');
const runs=[
 ['v8 knowledge/memory',['node','--test','tests/sprint44.v8-knowledge-memory-intelligence.test.js']],
 ['all tests',['npm','test']],
 ['conversation corpus',['npm','run','test:conversations']],
 ['syntax',['npm','run','check']],
 ['state safety',['node','scripts/audit-state-safety.js']]
];
let failed=false;
for(const [name,cmd] of runs){
 const r=spawnSync(cmd[0],cmd.slice(1),{stdio:'inherit',shell:process.platform==='win32'});
 if(r.status!==0){failed=true;console.error(`FAILED: ${name}`);break;}
}
process.exit(failed?1:0);
