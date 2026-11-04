import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {monthlyFee,previousMonth,verifySignature,salesWebhook,prepareMonthlyDrafts} from '../src/billing.js';
const c={id:'shop',customer:'cus_test',webhookSecret:'whsec_example',startMonth:'2026-01',live:false,enabled:true};
function setup(){const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../migrations/002_billing.sql',import.meta.url),'utf8'));db.exec(readFileSync(new URL('../migrations/003_monthly_reports.sql',import.meta.url),'utf8'));db.prepare('INSERT INTO billing_base_payments VALUES (?,?,?,?,?)').run('shop','2026-10','in_base',3000,1);return {db,env:{BILLING_CLIENTS:JSON.stringify([c]),DB:{prepare(sql){return {bind(...args){const s=db.prepare(sql);return {first:async()=>s.get(...args),run:async()=>s.run(...args)};}};}}}};}
async function signed(raw,secret=c.webhookSecret,time=Math.floor(Date.now()/1000)){
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const bytes=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(time+'.'+raw));
 return 't='+time+',v1='+Buffer.from(bytes).toString('hex');
}
function event(overrides={}){return {id:'evt_1',type:'checkout.session.completed',created:Date.UTC(2026,9,15)/1000,livemode:false,data:{object:{id:'cs_1',metadata:{sites_by_fern_client_id:'shop'},mode:'payment',payment_status:'paid',currency:'usd',amount_total:10700,total_details:{amount_tax:700}}},...overrides};}
async function deliver(env,e){const raw=JSON.stringify(e);return salesWebhook(new Request('https://example.com/api/billing/webhooks/shop',{method:'POST',body:raw,headers:{'Stripe-Signature':await signed(raw)}}),env,'shop');}
test('monthly minimum and 7% use exact cent rounding',()=>{
 assert.equal(monthlyFee(0).total,3000);assert.equal(monthlyFee(30000).total,3000);
 assert.equal(monthlyFee(100000).total,7000);assert.equal(monthlyFee(500050).total,35004);
 assert.throws(()=>monthlyFee(-1));assert.throws(()=>monthlyFee(1.5));
 assert.equal(previousMonth(new Date('2027-01-05T00:00:00Z')),'2026-12');
});
test('signature accepts authentic bytes and rejects tampering, wrong secrets and old events',async()=>{
 const raw='{"ok":true}',header=await signed(raw);
 assert.equal(await verifySignature(raw,header,c.webhookSecret),true);
 assert.equal(await verifySignature(raw+' ',header,c.webhookSecret),false);
 assert.equal(await verifySignature(raw,header,'whsec_wrong'),false);
 assert.equal(await verifySignature(raw,await signed(raw,c.webhookSecret,1),c.webhookSecret),false);
});
test('verified sales exclude tax and deduplicate by checkout session across event types',async()=>{
 const {db,env}=setup();assert.equal((await deliver(env,event())).status,200);
 await deliver(env,event({id:'evt_2',type:'checkout.session.async_payment_succeeded'}));
 assert.equal(db.prepare('SELECT SUM(revenue_cents) AS n FROM billing_sales').get().n,10000);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM billing_sales').get().n,1);
});
test('unrelated, unpaid and wrong-mode payments are never counted',async()=>{
 const {db,env}=setup();const e=event();e.data.object.metadata={};await deliver(env,e);
 const unpaid=event();unpaid.data.object.payment_status='unpaid';await deliver(env,unpaid);
 assert.equal((await deliver(env,event({livemode:true}))).status,400);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM billing_sales').get().n,0);
});
test('refunds and unsupported currencies hold billing for reconciliation',async()=>{
 const {db,env}=setup();await deliver(env,event({id:'evt_refund',type:'charge.refunded'}));
 const e=event();e.data.object.currency='eur';await deliver(env,e);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM billing_holds').get().n,2);
});
test('draft generation is off by default and rejects live credentials',async()=>{
 await prepareMonthlyDrafts({});await assert.rejects(()=>prepareMonthlyDrafts({BILLING_DRAFTS_ENABLED:'true',STRIPE_SECRET_KEY:'sk_live_example'}));
});
test('reviewed month creates only the extra above a paid $30 subscription',async()=>{
 const {db,env}=setup();env.BILLING_DRAFTS_ENABLED='true';env.STRIPE_SECRET_KEY='sk_test_example';
 const paid=event();paid.data.object.amount_total=100700;await deliver(env,paid);
 const now=new Date('2026-11-04T00:00:00Z');const original=globalThis.fetch;const calls=[];
 globalThis.fetch=async(url,options)=>{calls.push({url,options,body:new URLSearchParams(options.body)});return Response.json({id:url.endsWith('/invoices')?'in_test':'ii_test'});};
 try{
  await prepareMonthlyDrafts(env,now);assert.equal(calls.length,0);
  db.prepare('INSERT INTO billing_reviews (client_id,month,revenue_cents,approved) VALUES (?,?,?,1)').run('shop','2026-10',100000);
  await prepareMonthlyDrafts(env,now);await prepareMonthlyDrafts(env,now);
  assert.equal(calls.length,2);assert.equal(calls[0].body.get('auto_advance'),'false');
  assert.equal(calls[0].body.get('pending_invoice_items_behavior'),'exclude');
  assert.equal(calls[1].body.get('invoice'),'in_test');assert.equal(calls[1].body.get('amount'),'4000');
  assert.equal(db.prepare('SELECT status FROM billing_runs').get().status,'ready');
 }finally{globalThis.fetch=original;}
});
test('changed ledger invalidates approval; unresolved refunds block drafts',async()=>{
 const {db,env}=setup();env.BILLING_DRAFTS_ENABLED='true';env.STRIPE_SECRET_KEY='sk_test_example';
 await deliver(env,event());db.prepare('INSERT INTO billing_reviews (client_id,month,revenue_cents,approved) VALUES (?,?,?,1)').run('shop','2026-10',0);
 await prepareMonthlyDrafts(env,new Date('2026-11-04'));assert.equal(db.prepare('SELECT COUNT(*) AS n FROM billing_runs').get().n,0);
 db.prepare('UPDATE billing_reviews SET revenue_cents=10000').run();await deliver(env,event({type:'charge.refunded'}));
 await prepareMonthlyDrafts(env,new Date('2026-11-04'));assert.equal(db.prepare('SELECT COUNT(*) AS n FROM billing_runs').get().n,0);
});
test('a failed item request retries against the saved invoice with the same idempotency key',async()=>{
 const {db,env}=setup();Object.assign(env,{BILLING_DRAFTS_ENABLED:'true',STRIPE_SECRET_KEY:'sk_test_example'});
 const paid=event();paid.data.object.amount_total=100700;await deliver(env,paid);db.prepare('INSERT INTO billing_reviews (client_id,month,revenue_cents,approved) VALUES (?,?,?,1)').run('shop','2026-10',100000);
 const original=globalThis.fetch;const keys=[];let invoiceCalls=0,fail=true;
 globalThis.fetch=async(url,options)=>{
  if(url.endsWith('/invoices')){invoiceCalls++;return Response.json({id:'in_saved'});}
  keys.push(options.headers['Idempotency-Key']);if(fail){fail=false;throw Error('Connection lost');}
  assert.equal(new URLSearchParams(options.body).get('invoice'),'in_saved');return Response.json({id:'ii_saved'});
 };
 try{await assert.rejects(()=>prepareMonthlyDrafts(env,new Date('2026-11-04')));await prepareMonthlyDrafts(env,new Date('2026-11-04'));assert.equal(invoiceCalls,1);assert.equal(keys[0],keys[1]);}
 finally{globalThis.fetch=original;}
});
test('an unresolved run beyond the safe retry window never calls Stripe',async()=>{
 const {db,env}=setup();Object.assign(env,{BILLING_DRAFTS_ENABLED:'true',STRIPE_SECRET_KEY:'sk_test_example'});
 db.prepare('INSERT INTO billing_reviews (client_id,month,revenue_cents,approved) VALUES (?,?,?,1)').run('shop','2026-10',0);
 db.prepare('INSERT INTO billing_runs (client_id,month,revenue_cents,total_cents,status,created_at) VALUES (?,?,?,?,?,?)').run('shop','2026-10',0,3000,'creating',1);
 const original=globalThis.fetch;globalThis.fetch=()=>{assert.fail('Unsafe retry');};
 try{await prepareMonthlyDrafts(env,new Date('2026-11-04'));}finally{globalThis.fetch=original;}
});

test('client registry accepts the supplied configuration and trims copy whitespace',async()=>{
 const {clients}=await import('../src/billing.js');
 const row={id:'fern-test',customer:'cus_VZHidJimosd4IK',webhookSecret:' whsec_example ',startMonth:'2026-11',live:false,enabled:true};
 assert.equal(clients({BILLING_CLIENTS:JSON.stringify([row])})[0].webhookSecret,'whsec_example');
 assert.equal(clients({BILLING_CLIENTS:[row]})[0].customer,row.customer);
});
test('configuration diagnostics identify fields without revealing the supplied secret',async()=>{
 const {clients}=await import('../src/billing.js');
 const row={id:'fern-test',customer:'cus_VZHidJimosd4IK',webhookSecret:'whsec_private_fixture',startMonth:'2026-11',live:false};
 for(const [value,code] of [[undefined,'BILLING_CLIENTS_MISSING'],['not json','BILLING_CLIENTS_JSON'],['{}','BILLING_CLIENTS_ARRAY'],[JSON.stringify([{...row,live:'false'}]),'BILLING_CLIENT_MODE'],[JSON.stringify([{...row,startMonth:'November'}]),'BILLING_CLIENT_MONTH']]){
  assert.throws(()=>clients({BILLING_CLIENTS:value}),e=>e.billingConfigCode===code&&!e.message.includes(row.webhookSecret));
 }
});

test('existing fern_test sandbox tag maps only to the configured fern-test fixture',async()=>{
 const {saleFrom}=await import('../src/billing.js');
 const session={id:'cs_existing',metadata:{sites_by_fern_client_id:'fern_test'},mode:'payment',payment_status:'paid',currency:'usd',amount_total:10000,total_details:{amount_tax:0}};
 const e={type:'checkout.session.completed',created:1793821069,livemode:false,data:{object:session}};
 const client={id:'fern-test',live:false};
 assert.equal(saleFrom(e,client).cents,10000);
 assert.equal(saleFrom({...e,livemode:true},{...client,live:true}),null);
 assert.equal(saleFrom(e,{id:'another-client',live:false}),null);
 assert.equal(saleFrom(e,{...client,live:true}),null);
});

test('small revenue produces no additional invoice; unverified base payment blocks billing',async()=>{
 const {db,env}=setup();Object.assign(env,{BILLING_DRAFTS_ENABLED:'true',STRIPE_SECRET_KEY:'sk_test_example'});
 await deliver(env,event());db.prepare('INSERT INTO billing_reviews (client_id,month,revenue_cents,approved) VALUES (?,?,?,1)').run('shop','2026-10',10000);
 const old=globalThis.fetch;globalThis.fetch=()=>assert.fail('No extra invoice is due');
 try{
  db.prepare('UPDATE billing_base_payments SET verified=0').run();
  await prepareMonthlyDrafts(env,new Date('2026-11-04'));assert.equal(db.prepare('SELECT COUNT(*) AS n FROM billing_runs').get().n,0);
  db.prepare('UPDATE billing_base_payments SET verified=1').run();
  await prepareMonthlyDrafts(env,new Date('2026-11-04'));assert.equal(db.prepare('SELECT total_cents FROM billing_runs').get().total_cents,0);
 }finally{globalThis.fetch=old;}
});
test('approved CSV is authoritative and is never added to webhook revenue',async()=>{
 const {db,env}=setup();Object.assign(env,{BILLING_DRAFTS_ENABLED:'true',STRIPE_SECRET_KEY:'sk_test_example'});
 await deliver(env,event());db.prepare("INSERT INTO billing_reviews (client_id,month,revenue_cents,approved,source) VALUES (?,?,?,1,'csv')").run('shop','2026-10',100000);
 const old=globalThis.fetch;const amounts=[];
 globalThis.fetch=async(url,options)=>{if(url.endsWith('/invoiceitems'))amounts.push(new URLSearchParams(options.body).get('amount'));return Response.json({id:'in_csv'});};
 try{await prepareMonthlyDrafts(env,new Date('2026-11-04'));assert.deepEqual(amounts,['4000']);}
 finally{globalThis.fetch=old;}
});
