const {LocalJsonFile}=require('../../storage/src/localJsonFile');
class MemoryStateRepository {
  constructor({snapshotFile=null}={}) {
    this.snapshot=new LocalJsonFile(snapshotFile,{states:{}});
    const data=this.snapshot.read();this.states=new Map(Object.entries(data.states||{}));
  }
  persist(){this.snapshot.write({states:Object.fromEntries(this.states)});}
  async get(conversationId) { const value = this.states.get(conversationId); return value ? structuredClone(value) : null; }
  async save(state) { this.states.set(state.conversationId, structuredClone(state));this.persist(); return structuredClone(state); }
  async delete(conversationId) { const ok=this.states.delete(conversationId);this.persist();return ok; }
  async clear() { this.states.clear();this.persist(); }
}
module.exports = { MemoryStateRepository };
