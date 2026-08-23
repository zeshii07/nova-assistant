#!/usr/bin/env node
const fs=require('fs');const path=require('path');
const {UniversalTenantOnboardingService}=require('../packages/tenant-onboarding/src/universalTenantOnboardingService');
const file=process.argv[2];if(!file){console.error('Usage: node scripts/onboard-tenant.js <tenant-spec.json>');process.exit(1);}
const spec=JSON.parse(fs.readFileSync(path.resolve(file),'utf8'));
const service=new UniversalTenantOnboardingService({tenantsDir:path.join(__dirname,'..','tenants')});
console.log(JSON.stringify(service.create(spec),null,2));
