#!/usr/bin/env node
// CLI only: existing owner is never replaced. The password is chosen through a one-use link.
const crypto=require('crypto');
const d=require('../src/db');const s=require('../src/security');const services=require('../src/services');
(async()=>{
 const email=s.normalizeEmail(process.argv[2]||process.env.INITIAL_OWNER_EMAIL),login=s.normalizeLogin(process.argv[3]||'kirill');
 if(!/^\S+@\S+\.\S+$/.test(email)||!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(login))throw Error('Usage: node back/scripts/invite-owner.js <email> [login]');
 await d.initializeDatabase({seedDemoData:false});const existingOwner=await d.getOwnerUser();
 if(existingOwner)throw Error('Owner already exists. No account or password was changed.');
 if(await d.findUserByLoginOrEmail(email)||await d.findUserByLoginOrEmail(login))throw Error('Account already exists; use set-owner.js after verifying its identity.');
 const pw=await s.hashPassword(crypto.randomBytes(48).toString('hex'));
 const u=await d.createUser({uid:s.makeUid(),login,loginNormalized:login,email,emailNormalized:email,role:'user',passwordHash:pw.hash,passwordSalt:pw.salt,emailVerifiedAt:new Date().toISOString()});
 await d.setOwnerUser(u.id);console.log(JSON.stringify({login,...await services.invite(u.id)}));process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
