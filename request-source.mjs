import {isIP} from 'node:net';
function address(value){
 if(typeof value!=='string'||value.length>64||!isIP(value))return null;
 if(value.toLowerCase().startsWith('::ffff:')&&isIP(value.slice(7))===4)return value.slice(7);
 return isIP(value)===6?new URL('http://['+value+']/').hostname.slice(1,-1):value;
}
// A configured immediate proxy must OVERWRITE this single-value header.
// Ordinary X-Forwarded-For and client-supplied headers are never trusted.
export function clientAddress(req,trustedProxies=process.env.FINGUARD_TRUSTED_PROXIES||''){
 const peer=address(req.socket?.remoteAddress)||'local';
 const trusted=(Array.isArray(trustedProxies)?trustedProxies:String(trustedProxies).split(',')).map(v=>address(v.trim())).filter(Boolean);
 return trusted.includes(peer)?address(req.headers?.['x-finguard-client-ip'])||peer:peer;
}
