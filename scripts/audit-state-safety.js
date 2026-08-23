const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..');const bad=[];
function walk(d){for(const n of fs.readdirSync(d)){const p=path.join(d,n),st=fs.statSync(p);if(st.isDirectory()){if(n!=='node_modules'&&n!=='tests')walk(p);}else if(n.endsWith('.js'))scan(p);}}
function scan(file){const t=fs.readFileSync(file,'utf8'),patterns=[
 {name:'unguarded capabilityState chain',re:/capabilityState\.[A-Za-z_]\w*\./g},
 {name:'unguarded selectedAttributes',re:/\b(?:catalog|commerce|booking|cleaning)\.selectedAttributes\b/g}
];for(const x of patterns)for(const m of t.matchAll(x.re)){const before=t.slice(Math.max(0,m.index-140),m.index+180);if(!before.includes('?.')&&!before.includes('|| {}')&&!before.includes('||{}'))bad.push({file:path.relative(root,file),line:t.slice(0,m.index).split('\n').length,type:x.name});}}
walk(root);
if(bad.length){console.error(JSON.stringify({ok:false,issues:bad},null,2));process.exit(1);}
console.log(JSON.stringify({ok:true,message:'No obvious unsafe capability-state dereferences found.'}));
