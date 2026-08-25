const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');

const root=path.join(__dirname,'../apps/developer-console/public');

test('developer console exposes labelled authentication and tenant controls on mobile',()=>{
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert.match(html,/viewport-fit=cover/);
  assert.match(html,/class="control-field tenant-field"/);
  assert.match(html,/class="control-field customer-field"/);
  assert.match(html,/class="control-field token-field"/);
  assert.match(html,/aria-label="Developer token"/);
});

test('developer console has touch-friendly phone layouts without horizontal page overflow',()=>{
  const css=fs.readFileSync(path.join(root,'style.css'),'utf8');
  assert.match(css,/@media\(max-width:900px\)/);
  assert.match(css,/@media\(max-width:560px\)/);
  assert.match(css,/html,body\{[^}]*overflow-x:hidden/);
  assert.match(css,/nav\{[^}]*overflow-x:auto/);
  assert.match(css,/\.controls\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/);
  assert.match(css,/form\{position:sticky;bottom:0/);
  assert.match(css,/form textarea\{[^}]*font-size:16px/);
  assert.match(css,/\.two,\.offering-main,\.offering-extra\{grid-template-columns:minmax\(0,1fr\)/);
});

test('developer console continues sending its protected tenant-scoped headers',()=>{
  const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
  assert.match(app,/'x-nova-tenant-id'/);
  assert.match(app,/'x-nova-dev-token'/);
  assert.match(app,/localStorage\.getItem\('novaDevToken'\)/);
});
