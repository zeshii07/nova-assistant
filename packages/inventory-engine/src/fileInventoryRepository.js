const { LocalJsonFile } = require("../../storage/src/localJsonFile");

class FileInventoryRepository {
  constructor({ snapshotFile = null } = {}) {
    this.snapshot = new LocalJsonFile(snapshotFile, initialState());
    this.state = normalize(this.snapshot.read());
  }
  readState() { return structuredClone(this.state); }
  writeState(state) { state.updatedAt = new Date().toISOString(); this.state=normalize(state);this.snapshot.write(this.state); return structuredClone(this.state); }
}
function initialState() { return { schemaVersion:"1.0", levels:{}, reservations:{}, movements:[], updatedAt:null }; }
function normalize(value) { return { ...initialState(), ...(value || {}), levels:{...(value?.levels||{})}, reservations:{...(value?.reservations||{})}, movements:[...(value?.movements||[])] }; }
module.exports = { FileInventoryRepository };
