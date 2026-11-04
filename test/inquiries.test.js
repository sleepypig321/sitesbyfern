import test from 'node:test';import assert from 'node:assert/strict';import worker,{validate} from '../src/worker.js';
const valid={name:'A Client',business:'A Shop',email:'client@example.com',description:'A small business website with a product catalog.',features:'Home and shop',plan:'maintained',agreement:'on'};
test('validates and normalizes inquiry without allowing arbitrary plans',()=>{assert.equal(validate(valid).plan,'maintained');assert.throws(()=>validate({...valid,plan:'free'}));assert.throws(()=>validate({...valid,agreement:''}));assert.throws(()=>validate({...valid,description:'a'.repeat(5001)}));});
test('refuses foreign-origin submissions before touching storage',async()=>{const response=await worker.fetch(new Request('https://site.example/api/inquiries',{method:'POST',headers:{Origin:'https://evil.example'},body:'{}'}),{});assert.equal(response.status,403);});
test('unconfigured form does not falsely claim submission success',async()=>{const response=await worker.fetch(new Request('https://site.example/api/inquiries',{method:'POST',headers:{Origin:'https://site.example'},body:JSON.stringify(valid)}),{});assert.equal(response.status,503);});
test('opening email approval link cannot change status',async()=>{let writes=0;const row={created_at:Date.now(),data:JSON.stringify(valid),status:'pending',client_notified:0,email:valid.email};const env={DB:{prepare(){return{bind(){return this},async first(){return row},async run(){writes++;}}}}};const response=await worker.fetch(new Request('https://site.example/api/review?token='+('a'.repeat(72))+'&action=approve'),env);assert.equal(response.status,200);assert.match(await response.text(),/method="post"/);assert.equal(writes,0);});

const emailEnv={OWNER_EMAIL:'sitesbyfern@outlook.com',EMAILJS_SERVICE_ID:'sitesbyfern@outlook.com',EMAILJS_PUBLIC_KEY:'test-public-key',EMAILJS_INQUIRY_TEMPLATE_ID:'template_f24q3gm',EMAILJS_DECISION_TEMPLATE_ID:'template_kik3zps'};
test('new inquiry sends the configured owner template with private decision URLs',async t=>{
 let outbound;const statements=[];
 t.mock.method(globalThis,'fetch',async(url,options)=>{assert.equal(url,'https://api.emailjs.com/api/v1.0/email/send');outbound=JSON.parse(options.body);return new Response('OK');});
 const DB={prepare(sql){statements.push(sql);return{bind(){return this},async first(){return null},async run(){return{meta:{changes:1}};}}}};
 const response=await worker.fetch(new Request('https://site.example/api/inquiries',{method:'POST',headers:{Origin:'https://site.example'},body:JSON.stringify(valid)}),{...emailEnv,DB});
 assert.equal(response.status,201);assert.equal(outbound.template_id,'template_f24q3gm');assert.equal(outbound.service_id,emailEnv.EMAILJS_SERVICE_ID);assert.match(outbound.template_params.details,/Pages and features/);assert.match(outbound.template_params.approve_url,/\/api\/review\?token=.+&action=approve$/);assert.match(outbound.template_params.decline_url,/action=decline$/);assert.ok(statements.some(sql=>sql.includes('notified=1')));
});
test('failed EmailJS delivery never reports a completed inquiry',async t=>{
 const statements=[];t.mock.method(globalThis,'fetch',async()=>new Response('Rejected',{status:403}));
 const DB={prepare(sql){statements.push(sql);return{bind(){return this},async first(){return null},async run(){return{meta:{changes:1}};}}}};
 const response=await worker.fetch(new Request('https://site.example/api/inquiries',{method:'POST',headers:{Origin:'https://site.example'},body:JSON.stringify(valid)}),{...emailEnv,DB});
 assert.equal(response.status,503);assert.ok(statements.some(sql=>sql.startsWith('DELETE FROM inquiries')));
});
test('confirmed decline emails the saved applicant using the decision template',async t=>{
 let outbound; t.mock.method(globalThis,'fetch',async(url,options)=>{outbound=JSON.parse(options.body);return new Response('OK');});
 const row={id:'request-1',created_at:Date.now(),email:valid.email,data:JSON.stringify(valid),status:'pending',client_notified:0};
 const DB={prepare(){return{bind(){return this},async first(){return row},async run(){return{meta:{changes:1}};}}}};
 const response=await worker.fetch(new Request('https://site.example/api/review?token='+('a'.repeat(72))+'&action=decline',{method:'POST',headers:{Origin:'https://site.example'}}),{...emailEnv,DB});
 assert.equal(response.status,200);assert.equal(outbound.template_id,'template_kik3zps');assert.equal(outbound.template_params.to_email,valid.email);assert.match(outbound.template_params.message,/unable to take on/);assert.equal(outbound.template_params.action_url,'https://site.example');
});
