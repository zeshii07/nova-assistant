// Tests must never inherit production/provider settings from a developer's
// .env file. Node's test runner can execute files in parallel processes, so a
// shared .nova-data directory also corrupts otherwise unrelated conversations
// on Windows (concurrent atomic renames fail with EPERM).
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');

const worker=String(process.env.NODE_TEST_CONTEXT||'main').replace(/[^a-z0-9_-]/gi,'-');
const token=`${process.pid}-${worker}-${crypto.randomBytes(6).toString('hex')}`;
const root=path.join(os.tmpdir(),`nova-tests-${token}`);

process.env.NOVA_TEST_NOW='2026-08-20T12:00:00Z';
process.env.NOVA_NLU_MODE='off';
process.env.NOVA_LOCAL_DATA_DIR=root;
process.env.NOVA_KNOWLEDGE_DATA_DIR=path.join(root,'tenant-knowledge');
process.env.NOVA_OPERATIONAL_DATA_DIR=path.join(root,'tenant-operational');
process.env.LOG_LEVEL='error';
