const http = require('http');

async function test() {
    const token = '41958befbcec9e4e0f81621ad6b5f76a'; // example
    
    // Check what token is in DB
    const db = require('./back/src/db');
    const settings = await db.getSystemSettings();
    console.log("DB token:", settings.maintenance_token);
    
    const httpToken = settings.maintenance_token || token;
    
    const req1 = http.request(`http://127.0.0.1:3000/?owner_bypass=${httpToken}`, (res) => {
        console.log("Req1 status:", res.statusCode);
        console.log("Req1 headers:", res.headers);
        let cookie = res.headers['set-cookie'];
        console.log("Set-Cookie:", cookie);
        
        if (res.statusCode === 302) {
            const req2 = http.request({
                hostname: '127.0.0.1',
                port: 3000,
                path: '/',
                method: 'GET',
                headers: {
                    'Cookie': cookie ? cookie[0].split(';')[0] : ''
                }
            }, (res2) => {
                console.log("Req2 status:", res2.statusCode);
                console.log("Req2 headers:", res2.headers);
                res2.on('data', (d) => {
                    console.log("Req2 body length:", d.length);
                });
            });
            req2.end();
        }
    });
    req1.end();
}
test();
