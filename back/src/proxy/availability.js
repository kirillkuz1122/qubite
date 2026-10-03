// A Cloudflare-only master may control VPN nodes without being a VPN node itself.
async function available(){
 if(process.env.SERVICES_VPN_ENABLED!=='false')return true;
 const nodes=await require('../db').listProxyServersForAdmin();
 return nodes.some(n=>n.status==='active'&&!['offline','down','error'].includes(n.health_status)&&n.last_heartbeat_at&&Date.now()-Date.parse(n.last_heartbeat_at)<15*60*1000);
}
module.exports={available};
