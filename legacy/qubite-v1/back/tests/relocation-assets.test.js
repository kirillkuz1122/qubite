const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const express=require('express');
// Run only through the source-copy harness; never launch the real legacy app here.
const expected=path.resolve(__dirname,'../../../..');
test('legacy Writing serves shared reference assets after relocation',async()=>{
 const directory=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'qubite-relocation-assets-'));
 process.env.DATABASE_PATH=path.join(directory,'fixture.sqlite');
 process.env.SEED_DEMO_DATA='false';
 const app=express();require('../src/writing').register(app,{requireAuth:(q,s,n)=>n(),getUserById:async()=>null,audit:async()=>{}});
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 try{
  assert.equal(require('../src/config').REPOSITORY_DIR,expected);
  const base='http://127.0.0.1:'+server.address().port;
  for(const [url,file] of [
   ['/writing-assets/highlights.js','integrations/qubite-writing/firefox/highlights.js'],
   ['/writing-assets/linux.py','integrations/qubite-writing/linux.py'],
   ['/writing-assets/guide','docs/legacy-services/writing.md']]){
   const response=await fetch(base+url);assert.equal(response.status,200,url);
   assert.equal(await response.text(),fs.readFileSync(path.join(expected,file),'utf8'),url);
  }
 }finally{await new Promise(resolve=>server.close(resolve));fs.rmSync(directory,{recursive:true,force:true});}
});
