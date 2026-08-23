const fs=require('fs');
const os=require('os');
const path=require('path');
const {spawnSync}=require('child_process');

// Every release-gate run gets an isolated durable-data root. This preserves
// local-persistence behavior without allowing a prior test run to affect it.
const dataRoot=fs.mkdtempSync(path.join(os.tmpdir(),'nova-v85-gate-'));
const env={...process.env,NOVA_LOCAL_DATA_DIR:dataRoot};
const commands=[
  [process.execPath,['--test','tests/sprint49.v85-tenant-aware-compound-understanding.integration.test.js']],
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
