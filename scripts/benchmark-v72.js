const {spawnSync}=require('node:child_process');
const gates=[
 ['Consistency & recovery contracts',['--test','tests/v7.2.consistency-recovery.test.js']],
 ['v7 persistence contracts',['--test','tests/v7.persistence-benchmark.contract.test.js']],
 ['Full automated regression suite',['--test']]
];
for(const [name,args] of gates){console.log(`\n=== ${name} ===`);const r=spawnSync(process.execPath,args,{stdio:'inherit',env:{...process.env,NOVA_STORAGE_MODE:'memory'}});if(r.status!==0){console.error(`FAILED: ${name}`);process.exit(r.status||1);}}
console.log('\nNOVA v7.2 BENCHMARK: PASS');
