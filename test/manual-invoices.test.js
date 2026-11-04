import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {invoiceChoice,manualInvoicePage} from '../src/manual-invoices.js';
function setup(revenue=0,base=false){
 const db=new DatabaseSync(':memory:');for(const f of ['002_billing.sql','003_monthly_reports.sql'])db.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));
 const env={MANUAL_INVOICES_ENABLED:'true',STRIPE_SECRET_KEY:'sk_test_mock',BILLING_CLIENTS:JSON.stringify([{id:'shop',source:'csv',customer:'cus_test',startMonth:'2026-10',live:false}]),DB:{prepare(sql){return {bind(...args){const s=db.prepare(sql);return {first:async()=>s.get(...args),run:async()=>s.run(...args)};}};}}};
 if(base)db.prepare('INSERT INTO billing_base_payments VALUES (?,?,?,?,1)').run('shop','2026-10','in_base',3000);
 const row={id:'report_1',client_id:'shop',month:'2026-10',status:'approved',website_cents:revenue};return {db,env,row};
}
const req=(body,origin='https://example.com')=>new Request('https://example.com/api/report-review?invoice=1',{...(body?{method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)}:{})});
function mockStripe({failSend=false}={}){
 const calls=[],cache=new Map();let invoice=null,failed=false;
 const fetcher=async(url,options)=>{
  calls.push({url,options});const key=options.headers['Idempotency-Key'];
  if(key&&cache.has(key))return Response.json(cache.get(key));
  let value;const data=new URLSearchParams(options.body);
  if(url.endsWith('/customers/cus_test'))value={id:'cus_test',email:'client@example.com',livemode:false};
  else if(url.endsWith('/invoices')){invoice={id:'in_test',customer:'cus_test',livemode:false,currency:'usd',total:0,amount_due:0,status:'draft',metadata:{fern_report:data.get('metadata[fern_report]')}};value={...invoice};}
  else if(url.endsWith('/invoiceitems')){invoice.total=invoice.amount_due=Number(data.get('amount'));value={id:'ii_test'};}
  else if(url.endsWith('/finalize')){invoice.status='open';value={...invoice};}
  else if(url.endsWith('/send')){value={...invoice,hosted_invoice_url:'https://invoice.stripe.com/i/test'};if(key)cache.set(key,value);if(failSend&&!failed){failed=true;throw Error('Connection lost after send');}}
  else if(url.endsWith('/invoices/in_test'))value={...invoice};
  else throw Error('Unexpected Stripe URL '+url);
  if(key)cache.set(key,value);return Response.json(value);
 };return {calls,fetcher};
}
test('invoice choice enforces the higher fee and credits a verified base payment',()=>{
 assert.equal(invoiceChoice(0).kind,'minimum');assert.equal(invoiceChoice(0).amount,3000);
 assert.equal(invoiceChoice(100000).kind,'percentage');assert.equal(invoiceChoice(100000).amount,7000);
 assert.equal(invoiceChoice(100000,{paid_cents:3000,verified:1}).amount,4000);
 assert.equal(invoiceChoice(0,{paid_cents:3000,verified:1}).amount,0);
 assert.throws(()=>invoiceChoice(100000,{paid_cents:3000,verified:0}));
});
test('GET and preview show amounts without creating or sending invoices',async()=>{
 const {env,row}=setup();const mock=mockStripe(),old=globalThis.fetch;globalThis.fetch=mock.fetcher;
 try{
  assert.match(await (await manualInvoicePage(req(),env,row)).text(),/Send \$30 invoice/);assert.equal(mock.calls.length,0);
  const r=await manualInvoicePage(req({invoice_kind:'minimum',invoice_step:'preview'}),env,row);
  assert.match(await r.text(),/client@example.com/);assert.equal(mock.calls.length,1);assert.equal(mock.calls[0].options.method,'GET');
 }finally{globalThis.fetch=old;}
});
test('confirmed minimum invoice is sent once without automatic card collection',async()=>{
 const {env,row,db}=setup();const mock=mockStripe(),old=globalThis.fetch;globalThis.fetch=mock.fetcher;
 try{
  const form={invoice_kind:'minimum',invoice_step:'send',checked_existing:'yes'};
  assert.equal((await manualInvoicePage(req(form),env,row)).status,200);
  const count=mock.calls.length;await manualInvoicePage(req(form),env,row);assert.equal(mock.calls.length,count);
  assert.equal(db.prepare('SELECT status FROM billing_runs').get().status,'manual_sent');
  const creation=mock.calls.find(c=>c.url.endsWith('/invoices'));const data=new URLSearchParams(creation.options.body);
  assert.equal(data.get('auto_advance'),'false');assert.equal(data.get('collection_method'),'send_invoice');
  assert.equal(data.get('pending_invoice_items_behavior'),'exclude');
  assert.equal(new URLSearchParams(mock.calls.find(c=>c.url.endsWith('/invoiceitems')).options.body).get('amount'),'3000');
 }finally{globalThis.fetch=old;}
});
test('a 7% invoice cannot be reduced to the minimum through form tampering',async()=>{
 const {env,row}=setup(100000);const old=globalThis.fetch;globalThis.fetch=()=>assert.fail('No request should be made');
 try{assert.equal((await manualInvoicePage(req({invoice_kind:'minimum',invoice_step:'send',checked_existing:'yes'}),env,row)).status,409);}
 finally{globalThis.fetch=old;}
});
test('a verified base payment produces a $40 balance, and a zero balance sends nothing',async()=>{
 const {env,row}=setup(100000,true);const mock=mockStripe(),old=globalThis.fetch;globalThis.fetch=mock.fetcher;
 try{
  assert.equal((await manualInvoicePage(req({invoice_kind:'additional',invoice_step:'send',checked_existing:'yes'}),env,row)).status,200);
  assert.equal(new URLSearchParams(mock.calls.find(c=>c.url.endsWith('/invoiceitems')).options.body).get('amount'),'4000');
  const zero=setup(0,true),count=mock.calls.length;assert.match(await (await manualInvoicePage(req(),zero.env,zero.row)).text(),/No invoice is needed/);assert.equal(mock.calls.length,count);
 }finally{globalThis.fetch=old;}
});
test('lost send result retries with the same saved invoice and idempotency key',async()=>{
 const {env,row}=setup(100000);const mock=mockStripe({failSend:true}),old=globalThis.fetch;globalThis.fetch=mock.fetcher;
 try{
  const form={invoice_kind:'percentage',invoice_step:'send',checked_existing:'yes'};
  assert.equal((await manualInvoicePage(req(form),env,row)).status,502);assert.equal((await manualInvoicePage(req(form),env,row)).status,200);
  assert.equal(mock.calls.filter(c=>c.url.endsWith('/invoices')).length,1);assert.equal(mock.calls.filter(c=>c.url.endsWith('/invoiceitems')).length,1);
  const sends=mock.calls.filter(c=>c.url.endsWith('/send'));assert.equal(sends.length,2);assert.equal(sends[0].options.headers['Idempotency-Key'],sends[1].options.headers['Idempotency-Key']);
 }finally{globalThis.fetch=old;}
});
test('foreign origin, missing confirmation and live mode with test keys cannot send',async()=>{
 const {env,row}=setup();const old=globalThis.fetch;let count=0;globalThis.fetch=async()=>{count++;return Response.json({email:'client@example.com',livemode:false});};
 try{
  assert.equal((await manualInvoicePage(req({invoice_kind:'minimum',invoice_step:'send'},'https://evil.example'),env,row)).status,403);assert.equal(count,0);
  assert.equal((await manualInvoicePage(req({invoice_kind:'minimum',invoice_step:'send'}),env,row)).status,400);
  const entry=JSON.parse(env.BILLING_CLIENTS);entry[0].live=true;env.BILLING_CLIENTS=JSON.stringify(entry);
  assert.equal((await manualInvoicePage(req({invoice_kind:'minimum',invoice_step:'send',checked_existing:'yes'}),env,row)).status,503);
 }finally{globalThis.fetch=old;}
});
