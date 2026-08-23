const crypto=require('crypto');
class ReplayService {
  constructor({repository}){this.repository=repository;}
  async record(input){const record={id:`RPL-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,createdAt:new Date().toISOString(),...input};return this.repository.save(record);}
  async get(id){return this.repository.get(id);}
  async list(options){return this.repository.list(options);}
}
module.exports={ReplayService};
