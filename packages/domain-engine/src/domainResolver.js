class DomainResolver {
  constructor({ schemaRegistry }={}){this.schemaRegistry=schemaRegistry;}
  resolve({tenant, semantic}) {
    const schema=this.schemaRegistry.resolveForTenant(tenant);
    return { domainId:schema.id, schemaVersion:schema.version, entities:schema.entities||[], actions:schema.actions||[], semantics:schema.semantics||{}, semantic };
  }
}
module.exports={DomainResolver};
