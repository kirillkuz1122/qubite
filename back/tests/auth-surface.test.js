const test=require('node:test'),assert=require('node:assert/strict');
process.env.APP_BASE_URL='https://qubiteapp.online';process.env.SERVICES_SEARCH_BASE_URL='https://search.qubiteapp.online';
const {validateTarget}=require('../src/auth-surface');
test('return addresses allow exact configured origins',()=>{assert.equal(validateTarget('/writing'),'https://qubiteapp.online/writing');assert.equal(validateTarget('https://search.qubiteapp.online/?q=test'),'https://search.qubiteapp.online/?q=test');});
test('return addresses reject phishing, credentials and login loops',()=>{for(const u of ['https://qubiteapp.online.evil.org','javascript:alert(1)','https://friend@search.qubiteapp.online','//evil.org','/auth','/auth/','/auth/login','/services/return'])assert.equal(validateTarget(u),null,u);});
