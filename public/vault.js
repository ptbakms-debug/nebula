/* Enkripsi ujung-ke-ujung untuk data akun NEBULA.
   Kunci data (DEK) acak 256-bit mengenkripsi seluruh data (AES-GCM).
   DEK dibungkus dua kali: dengan frasa sandi (PBKDF2) dan dengan kode pemulihan.
   Server hanya melihat bungkusan dan data terenkripsi. */
(function(root){
'use strict';
const te=new TextEncoder(), td=new TextDecoder();
const subtle=()=>root.crypto.subtle;
const ITER_PW=600000, ITER_RK=100000, ITER_MIN=100000, ITER_MAX=1000000;
const CROCK='0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function b64(u8){ let s=''; for(let i=0;i<u8.length;i+=0x8000) s+=String.fromCharCode.apply(null,u8.subarray(i,i+0x8000)); return btoa(s); }
function ub64(s){ const bin=atob(s), u=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i); return u; }
const rnd=n=>root.crypto.getRandomValues(new Uint8Array(n));
const aad=(uid,p)=>te.encode('nebula2|'+uid+'|'+p);

async function kdf(secret,salt,iter){
  if(!(iter>=ITER_MIN&&iter<=ITER_MAX)) throw new Error('bad-iter');
  const m=await subtle().importKey('raw',te.encode(secret),'PBKDF2',false,['deriveKey']);
  return subtle().deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations:iter},m,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
async function aesEnc(key,bytes,ad){
  const iv=rnd(12);
  const ct=new Uint8Array(await subtle().encrypt({name:'AES-GCM',iv,additionalData:ad},key,bytes));
  return {i:b64(iv),c:b64(ct)};
}
async function aesDec(key,o,ad){
  if(!o||typeof o.i!=='string'||typeof o.c!=='string') throw new Error('bad-blob');
  return new Uint8Array(await subtle().decrypt({name:'AES-GCM',iv:ub64(o.i),additionalData:ad},key,ub64(o.c)));
}
const importDek=raw=>subtle().importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);

function newRecoveryCode(){
  const b=rnd(20); let bits=0, val=0, out='';
  for(const x of b){
    val=((val<<8)|x)&0xfffff; bits+=8;
    while(bits>=5){ out+=CROCK[(val>>>(bits-5))&31]; bits-=5; }
    val&=(1<<bits)-1;
  }
  return out.match(/.{4}/g).join('-');
}
function normRecovery(code){
  const s=String(code||'').toUpperCase().replace(/[^0-9A-Z]/g,'').replace(/O/g,'0').replace(/[IL]/g,'1');
  if(!/^[0-9A-HJKMNP-TV-Z]{32}$/.test(s)) throw new Error('bad-code');
  return s;
}

async function wrap(uid,purpose,secret,iter,raw){
  const s=rnd(16), k=await kdf(secret,s,iter), o=await aesEnc(k,raw,aad(uid,purpose));
  return {s:b64(s),n:iter,i:o.i,c:o.c};
}
async function unwrap(uid,purpose,secret,w){
  if(!w||typeof w.s!=='string') throw new Error('bad-wrap');
  const k=await kdf(secret,ub64(w.s),w.n);
  return aesDec(k,w,aad(uid,purpose));
}

async function create(uid,pass){
  const raw=rnd(32), code=newRecoveryCode();
  const w={pw:await wrap(uid,'w-pw',pass,ITER_PW,raw), rk:await wrap(uid,'w-rk',normRecovery(code),ITER_RK,raw)};
  return {dek:await importDek(raw), w, recovery:code};
}
async function unlockPw(uid,w,pass){ return importDek(await unwrap(uid,'w-pw',pass,w&&w.pw)); }
async function recover(uid,w,code,newPass){
  const raw=await unwrap(uid,'w-rk',normRecovery(code),w&&w.rk);
  return {dek:await importDek(raw), w:{pw:await wrap(uid,'w-pw',newPass,ITER_PW,raw), rk:w.rk}};
}
async function changePass(uid,w,cur,next){
  const raw=await unwrap(uid,'w-pw',cur,w&&w.pw);
  return {pw:await wrap(uid,'w-pw',next,ITER_PW,raw), rk:w.rk};
}
async function newRecovery(uid,w,pass){
  const raw=await unwrap(uid,'w-pw',pass,w&&w.pw), code=newRecoveryCode();
  return {w:{pw:w.pw, rk:await wrap(uid,'w-rk',normRecovery(code),ITER_RK,raw)}, recovery:code};
}
const seal=(uid,dek,obj)=>aesEnc(dek,te.encode(JSON.stringify(obj)),aad(uid,'data'));
async function open(uid,dek,blob){ return JSON.parse(td.decode(await aesDec(dek,blob,aad(uid,'data')))); }

/* Gabung dua versi data: item lokal menang bila id sama; item yang hanya ada di server ditambahkan.
   Batas: item yang dihapus di satu perangkat bisa muncul kembali. */
function merge(remote,local){
  const R=remote||{}, L=local||{}, out=Object.assign({},L);
  ['tasks','tx','checks','goals'].forEach(k=>{
    const lo=Array.isArray(L[k])?L[k]:[], re=Array.isArray(R[k])?R[k]:[], ids=new Set(lo.map(x=>x&&x.id));
    out[k]=lo.concat(re.filter(x=>x&&x.id!=null&&!ids.has(x.id)));
  });
  const lr=Array.isArray(L.refl)?L.refl:[], rr=Array.isArray(R.refl)?R.refl:[], ds=new Set(lr.map(x=>x&&x.date));
  out.refl=lr.concat(rr.filter(x=>x&&x.date&&!ds.has(x.date)));
  out.demo=!!(L.demo&&R.demo);
  return out;
}

/* Kunci non-extractable bisa disimpan di IndexedDB untuk "ingat di perangkat ini". */
function db(){ return new Promise((res,rej)=>{ const r=indexedDB.open('nebula-keys',1); r.onupgradeneeded=()=>r.result.createObjectStore('k'); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
async function idbDo(mode,fn){
  try{ const d=await db(); return await new Promise((res,rej)=>{ const q=fn(d.transaction('k',mode).objectStore('k')); q.onsuccess=()=>res(q.result===undefined?null:q.result); q.onerror=()=>rej(q.error); }); }
  catch(e){ return null; }
}
const kget=uid=>idbDo('readonly',s=>s.get(uid));
const kset=(uid,key)=>idbDo('readwrite',s=>s.put(key,uid));
const kdel=uid=>idbDo('readwrite',s=>s.delete(uid));

root.NebulaVault={create,unlockPw,recover,changePass,newRecovery,seal,open,merge,normRecovery,kget,kset,kdel,ITER_PW};
})(typeof window!=='undefined'?window:globalThis);
