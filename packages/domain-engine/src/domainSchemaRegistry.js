const fs = require('fs');
const path = require('path');
class DomainSchemaRegistry {
  constructor({ domainsDir, logger } = {}) { this.domainsDir=domainsDir; this.logger=logger; this.cache=new Map(); }
  get(domainId='universal') {
    if (this.cache.has(domainId)) return structuredClone(this.cache.get(domainId));
    const file=path.join(this.domainsDir, domainId, 'schema.json');
    const fallback=path.join(this.domainsDir, 'universal', 'schema.json');
    const target=fs.existsSync(file)?file:fallback;
    const schema=JSON.parse(fs.readFileSync(target,'utf8'));
    this.cache.set(domainId,schema); return structuredClone(schema);
  }
  resolveForTenant(tenant) { return this.get(tenant.domain || 'universal'); }
}
module.exports={DomainSchemaRegistry};
