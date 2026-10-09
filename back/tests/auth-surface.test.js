const test=require('node:test'),assert=require('node:assert/strict');
process.env.APP_BASE_URL='https://qubiteapp.online';process.env.SERVICES_SEARCH_BASE_URL='https://search.qubiteapp.online';
const {validateTarget}=require('../src/auth-surface');
test('return addresses allow exact configured origins',()=>{assert.equal(validateTarget('/writing'),'https://qubiteapp.online/writing');assert.equal(validateTarget('https://search.qubiteapp.online/?q=test'),'https://search.qubiteapp.online/?q=test');});
test('return addresses reject phishing, credentials and login loops',()=>{for(const u of ['https://qubiteapp.online.evil.org','javascript:alert(1)','https://friend@search.qubiteapp.online','//evil.org','/auth','/auth/','/auth/login','/services/return'])assert.equal(validateTarget(u),null,u);});

test('native callback keeps full path/query but cannot escape its configured origin',()=>{
 process.env.SERVICES_VIKUNJA_BASE_URL='https://vikunja.qubiteapp.online';
 const {nativeTarget}=require('../src/auth-surface');const uri='/oauth/authorize?state=one&redirect_uri=vikunja-flutter%3A%2F%2Fcallback';
 assert.equal(nativeTarget('vikunja',uri,true),'https://vikunja.qubiteapp.online'+uri);
 for(const v of ['//evil.org/path','/\\evil.org/path','https://evil.org','https://vikunja.qubiteapp.online/', '/path\n'])assert.equal(nativeTarget('vikunja',v,true),null,v);
 assert.equal(nativeTarget('vikunja','https://search.qubiteapp.online'),null);
 assert.equal(validateTarget('https://vikunja.qubiteapp.online/auth'), 'https://vikunja.qubiteapp.online/auth');
});
