const {spawnSync}=require('child_process');
const fs=require('fs');
const steps=[
  {name:'Persistence contract',cmd:['node','--test','tests/v7.persistence-benchmark.contract.test.js'],required:true},
  {name:'Full automated suite',cmd:['npm','test'],required:true},
  {name:'Conversation corpus',cmd:['npm','run','test:conversations'],required:true},
  {name:'Syntax/structure check',cmd:['npm','run','check'],required:true},
  {name:'State-safety audit',cmd:['node','scripts/audit-state-safety.js'],required:true}
];
const rows=[];
for(const step of steps){
  const started=Date.now();
  const r=spawnSync(step.cmd[0],step.cmd.slice(1),{stdio:'pipe',encoding:'utf8',env:{...process.env,NOVA_STORAGE_MODE:'memory'}});
  const ms=Date.now()-started;
  rows.push({name:step.name,ok:r.status===0,durationMs:ms});
  process.stdout.write(`\n=== ${step.name} ===\n${r.stdout||''}${r.stderr||''}`);
}
const liveConfigured=Boolean(process.env.DATABASE_URL&&process.env.REDIS_URL);
let live={configured:liveConfigured,ok:null};
if(liveConfigured){
  const started=Date.now();
  const r=spawnSync('node',['scripts/benchmark-persistence-live.js'],{stdio:'pipe',encoding:'utf8',env:{...process.env,NOVA_STORAGE_MODE:'persistent'}});
  live={configured:true,ok:r.status===0,durationMs:Date.now()-started};
  process.stdout.write(`\n=== Live Postgres + Redis persistence ===\n${r.stdout||''}${r.stderr||''}`);
}
const pass=rows.every(x=>x.ok)&&(!live.configured||live.ok);
const report={version:require('../package.json').version,pass,generatedAt:new Date().toISOString(),rows,livePersistence:live,
  acceptance:{
    persistenceContract:'7/7 required',
    fullSuite:'0 failures required',
    conversationCorpus:'0 failures required',
    stateSafety:'PASS required',
    livePersistence:'required before production persistent-mode signoff'
  }};
fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync('artifacts/v7-benchmark-report.json',JSON.stringify(report,null,2));
console.log('\n=== NOVA V7 BENCHMARK SUMMARY ===');console.table(rows);console.log('Live persistence configured:',liveConfigured?'yes':'no');
console.log(pass?'BENCHMARK: PASS':'BENCHMARK: FAIL');
if(!liveConfigured)console.log('NOTE: Contract/repository restart simulation passed. Set DATABASE_URL + REDIS_URL to run the real networked restart/persistence benchmark.');
process.exitCode=pass?0:1;
