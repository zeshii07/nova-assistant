const crypto=require('crypto');
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object'){return Object.keys(value).sort().reduce((o,k)=>(o[k]=stable(value[k]),o),{});}return value;}
function fingerprint(scope,payload){return `${scope}:${crypto.createHash('sha256').update(JSON.stringify(stable(payload))).digest('hex').slice(0,32)}`;}
module.exports={fingerprint,stable};
