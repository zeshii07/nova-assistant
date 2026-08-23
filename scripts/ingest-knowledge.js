#!/usr/bin/env node
const path=require('path');const {DocumentIngestor}=require('../packages/knowledge-ingestion/src/documentIngestor');
(async()=>{
 const [tenantId,file]=process.argv.slice(2);if(!tenantId||!file)throw new Error('Usage: node scripts/ingest-knowledge.js <tenant-id> <file>');
 const ing=new DocumentIngestor();
 const result=await ing.ingestFile({tenantId,filePath:path.resolve(file),tenantsDir:path.join(__dirname,'..','tenants')});
 console.log(JSON.stringify(result,null,2));
})().catch(error=>{console.error(error.message);process.exit(1);});
