import test from 'node:test';
import assert from 'node:assert/strict';
import {adminRoutes} from '../src/admin.js';

const base='https://sitesbyfern.example';
const req=(path,method='GET',body,headers={})=>new Request(base+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});
const db={prepare(){return {bind(){return this;},first:async()=>null,run:async()=>({})};}};
const env={DB:db,ADMIN_LOGIN_PASSWORD:'a distinct password',ADMIN_SESSION_SECRET:'the-long-random-signing-secret-that-is-at-least-32-chars'};

test('admin routes fail closed if secrets are missing',async()=>{
 const result=await adminRoutes(req('/api/admin/session'),{DB:db});
 assert.equal(result.status,503);
});
test('private data cannot be read without authentication',async()=>{
 const result=await adminRoutes(req('/api/admin/projects'),env);
 assert.equal(result.status,401);
});
test('cross-origin login submissions are rejected',async()=>{
 const result=await adminRoutes(req('/api/admin/login','POST',{password:'a distinct password'},{Origin:'https://another.example'}),env);
 assert.equal(result.status,403);
});
test('login only allows correct password and creates secure cookie',async()=>{
 const result=await adminRoutes(req('/api/admin/login','POST',{password:'a distinct password'},{Origin:base}),env);
 assert.equal(result.status,200);
 const cookie=result.headers.get('Set-Cookie');
 assert.match(cookie,/HttpOnly; Secure; SameSite=Strict/);
 const authenticated=await adminRoutes(req('/api/admin/session','GET',null,{Cookie:cookie.split(';')[0]}),env);
 assert.equal((await authenticated.json()).authenticated,true);
});
