// Private local IPC preserves notifications/support when the bot is a separate process.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { DATABASE_PATH } = require('./config');
const EVENTS = new Set(['audit', 'support:new', 'chat:new', 'message', 'tg:reply']);
function socket(role) {
 if (!['platform','bot'].includes(role)) throw new Error('Unknown event process');
 return path.join(process.env.QUBITE_EVENT_SOCKET_DIR || path.dirname(DATABASE_PATH), `events-${role}.sock`);
}
function send(role, type, payload) {
 if (!EVENTS.has(type)) return Promise.reject(new Error('Unknown event'));
 const data = JSON.stringify({type,payload});
 if (Buffer.byteLength(data)>65536) return Promise.reject(new Error('Event too large'));
 return new Promise((resolve,reject)=>{
  const req=http.request({socketPath:socket(role),method:'POST',path:'/events',headers:{'Content-Length':Buffer.byteLength(data),'Content-Type':'application/json'}},res=>{
   res.resume();res.on('end',()=>res.statusCode===204?resolve():reject(new Error('Event rejected')));
  });
  req.setTimeout(3000,()=>req.destroy(new Error('Event timeout')));req.on('error',reject);req.end(data);
 });
}
function relay(role,type,payload) { send(role,type,payload).catch(()=>console.warn('[IPC] Local event delivery unavailable:',type)); }
async function listen(role, handler) {
 const name=socket(role);fs.mkdirSync(path.dirname(name),{recursive:true});
 // Refuse to replace a live listener. Stale sockets can be left by an interrupted process.
 await new Promise((resolve,reject)=>{
  const client=require('net').connect(name,()=>{client.destroy();reject(new Error('Event listener already running'));});
  client.on('error',e=>e.code==='ENOENT'||e.code==='ECONNREFUSED'?resolve():reject(e));
 });
 if(fs.existsSync(name))fs.unlinkSync(name);
 const server=http.createServer((req,res)=>{
  if(req.method!=='POST'||req.url!=='/events'){res.writeHead(404).end();return;}
  let raw='',bytes=0;
  req.on('data',chunk=>{bytes+=chunk.length;if(bytes>65536){res.writeHead(413).end();req.destroy();}else raw+=chunk;});
  req.on('end',async()=>{
   if(res.writableEnded)return;
   try{const event=JSON.parse(raw);if(!EVENTS.has(event.type)||!event.payload||typeof event.payload!=='object'){res.writeHead(400).end();return;}
    await handler(event.type,event.payload);res.writeHead(204).end();
   }catch{res.writeHead(400).end();}
  });
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(name,()=>{fs.chmodSync(name,0o600);resolve();});});
 return server;
}
module.exports={listen,send,relay,socket};
