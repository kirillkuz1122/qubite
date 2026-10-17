const test=require('node:test'),assert=require('node:assert/strict'),{execFileSync}=require('child_process');
test('Auth uses its own port even when shared environment sets platform PORT',()=>{
 for(const [role,expected]of[['auth',9131],['platform',9130]]){
  const n=execFileSync(process.execPath,['-e',"process.stdout.write(String(require('./back/src/config').PORT))"],{cwd:require('path').join(__dirname,'../..'),env:{...process.env,PORT:'9130',AUTH_PORT:'9131',QUBITE_PROCESS_ROLE:role}}).toString();assert.equal(Number(n),expected);
 }
});
