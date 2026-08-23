const fs=require('fs');
const os=require('os');
const path=require('path');
const {spawnSync}=require('child_process');

const gateRoot=fs.mkdtempSync(path.join(os.tmpdir(),'nova-v87-gate-'));
const commands=[
  {args:['--test','tests/sprint51.v87-durable-knowledge-policy-routing.integration.test.js'],data:'acceptance'},
  {args:['--test'],testWorkers:true},
  {args:['scripts/run-conversation-datasets.js'],data:'datasets'},
  {args:['scripts/check.js'],data:'check'},
  {args:['scripts/audit-state-safety.js'],data:'audit'}
];

for(const [index,item] of commands.entries()){
  const env={...process.env,LOG_LEVEL:process.env.LOG_LEVEL||'error'};
  delete env.NOVA_KNOWLEDGE_DATA_DIR;
  delete env.NOVA_OPERATIONAL_DATA_DIR;
  if(item.testWorkers)delete env.NOVA_LOCAL_DATA_DIR;
  else env.NOVA_LOCAL_DATA_DIR=path.join(gateRoot,item.data||String(index));
  const run=spawnSync(process.execPath,item.args,{cwd:path.resolve(__dirname,'..'),env,stdio:'inherit'});
  if(run.error)throw run.error;
  if(run.status!==0)process.exit(run.status||1);
}
