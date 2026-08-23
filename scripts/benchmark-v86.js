const fs=require('fs');
const os=require('os');
const path=require('path');
const {spawnSync}=require('child_process');

const dataRoot=fs.mkdtempSync(path.join(os.tmpdir(),'nova-v86-gate-'));
const env={...process.env,NOVA_LOCAL_DATA_DIR:dataRoot,LOG_LEVEL:process.env.LOG_LEVEL||'error'};
const commands=[
  [process.execPath,['--test','tests/sprint50.v86-cross-tenant-workflow-quality.integration.test.js']],
  [process.execPath,['--test']],
  [process.execPath,['scripts/run-conversation-datasets.js']],
  [process.execPath,['scripts/check.js']],
  [process.execPath,['scripts/audit-state-safety.js']]
];
for(const [command,args] of commands){
  const run=spawnSync(command,args,{cwd:path.resolve(__dirname,'..'),env,stdio:'inherit'});
  if(run.error)throw run.error;
  if(run.status!==0)process.exit(run.status||1);
}
