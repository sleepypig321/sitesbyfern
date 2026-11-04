// USD, calendar-month billing. This module creates reviewable drafts only.
export function monthlyFee(cents) {
 if(!Number.isSafeInteger(cents)||cents<0)throw Error('Invalid revenue');
 const percentage=Number((BigInt(cents)*7n+50n)/100n);
 return {revenue:cents,percentage,total:Math.max(3000,percentage)};
}
export function previousMonth(now=new Date()) {
 return new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-1,1)).toISOString().slice(0,7);
}
export async function verifySignature(raw,header,secret,now=Date.now()) {
 const parts=(header||'').split(',').map(p=>p.split('='));
 const timestamp=parts.find(p=>p[0]==='t')?.[1];
 if(!/^\d+$/.test(timestamp||'')||Math.abs(now/1000-Number(timestamp))>300)return false;
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const digest=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(timestamp+'.'+raw));
 const expected=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
 return parts.filter(p=>p[0]==='v1').some(([,sig])=>{
  if(!/^[a-f0-9]{64}$/.test(sig||''))return false;
  let diff=0;for(let i=0;i<64;i++)diff|=sig.charCodeAt(i)^expected.charCodeAt(i);return diff===0;
 });
}
export function clients(env) {
 const fail=(code,message)=>{throw Object.assign(new Error(message),{billingConfigCode:code});};
 if(env.BILLING_CLIENTS==null||env.BILLING_CLIENTS==='')fail('BILLING_CLIENTS_MISSING','BILLING_CLIENTS is not available to this deployed Worker.');
 let rows;
 try{rows=typeof env.BILLING_CLIENTS==='string'?JSON.parse(env.BILLING_CLIENTS):env.BILLING_CLIENTS;}
 catch{fail('BILLING_CLIENTS_JSON','BILLING_CLIENTS could not be parsed as JSON.');}
 if(!Array.isArray(rows))fail('BILLING_CLIENTS_ARRAY','BILLING_CLIENTS must contain an array.');
 if(!rows.length)fail('BILLING_CLIENTS_EMPTY','BILLING_CLIENTS contains no clients.');
 const ids=new Set();
 return rows.map((row,index)=>{
  const prefix='Client entry '+(index+1)+': ';
  if(!row||typeof row!=='object'||Array.isArray(row))fail('BILLING_CLIENT_OBJECT',prefix+'expected an object.');
  const c={...row};
  for(const field of ['id','customer','webhookSecret','startMonth'])if(typeof c[field]==='string')c[field]=c[field].trim();
  if(typeof c.id!=='string'||!/^[a-z0-9_-]{1,60}$/.test(c.id)||ids.has(c.id))fail('BILLING_CLIENT_ID',prefix+'id is missing, invalid, or duplicated.');
  if(typeof c.customer!=='string'||!/^cus_\w+$/.test(c.customer))fail('BILLING_CLIENT_CUSTOMER',prefix+'customer must be a Stripe customer ID starting with cus_.');
  if(typeof c.webhookSecret!=='string'||!/^whsec_\S+$/.test(c.webhookSecret))fail('BILLING_CLIENT_SIGNING_SECRET',prefix+'webhookSecret must be a signing secret starting with whsec_.');
  if(typeof c.startMonth!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(c.startMonth))fail('BILLING_CLIENT_MONTH',prefix+'startMonth must use YYYY-MM.');
  if(typeof c.live!=='boolean')fail('BILLING_CLIENT_MODE',prefix+'live must be true or false without quotes.');
  if(c.enabled!==undefined&&typeof c.enabled!=='boolean')fail('BILLING_CLIENT_ENABLED',prefix+'enabled must be true or false without quotes.');
  ids.add(c.id);return c;
 });
}
export function saleFrom(event,client) {
 if(!['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type))return null;
 const s=event.data.object;
 if(s.metadata?.sites_by_fern_client_id!==client.id||s.mode!=='payment'||s.payment_status!=='paid')return null;
 if(s.currency!=='usd'||!Number.isSafeInteger(s.amount_total)||!Number.isSafeInteger(s.total_details?.amount_tax)||s.amount_total<s.total_details.amount_tax)throw Error('Revenue needs review');
 if(typeof s.id!=='string'||!Number.isInteger(event.created))throw Error('Invalid event');
 return {id:s.id,cents:s.amount_total-s.total_details.amount_tax,month:new Date(event.created*1000).toISOString().slice(0,7)};
}
export async function salesWebhook(request,env,id) {
 const client=clients(env).find(c=>c.id===id);
 if(!client)return new Response('Not found',{status:404});
 const raw=await request.text();if(raw.length>1000000)return new Response('Too large',{status:413});
 if(!await verifySignature(raw,request.headers.get('Stripe-Signature'),client.webhookSecret))return new Response('Invalid signature',{status:400});
 let event;try{event=JSON.parse(raw);}catch{return new Response('Invalid event',{status:400});}
 if(event.livemode!==client.live)return new Response('Wrong mode',{status:400});
 // Refunds/disputes can arrive before their checkout event. Hold the whole client
 // rather than risk billing tax or refunded sales without an exact reconciliation.
 const uncertain=['charge.refunded','charge.dispute.created','refund.created','refund.updated','refund.failed'];
 if(uncertain.includes(event.type)){
  await env.DB.prepare('INSERT OR IGNORE INTO billing_holds (client_id,event_id,reason) VALUES (?,?,?)').bind(id,event.id,'Refund/dispute reconciliation required').run();
 } else {
  let sale;
  try{sale=saleFrom(event,client);}catch{
   await env.DB.prepare('INSERT OR IGNORE INTO billing_holds (client_id,event_id,reason) VALUES (?,?,?)').bind(id,event.id,'Unsupported sale/currency; reconcile before invoicing').run();
   return new Response('Recorded for review');
  }
  if(sale)await env.DB.prepare('INSERT OR IGNORE INTO billing_sales (client_id,session_id,month,revenue_cents,event_id) VALUES (?,?,?,?,?)').bind(id,sale.id,sale.month,sale.cents,event.id).run();
 }
 return new Response('Received');
}
async function stripe(env,path,data,key) {
 const response=await fetch('https://api.stripe.com/v1/'+path,{method:'POST',headers:{Authorization:'Bearer '+env.STRIPE_SECRET_KEY,'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':key},body:new URLSearchParams(data)});
 if(!response.ok)throw Error('Stripe billing request failed: '+response.status);
 return response.json();
}
export async function prepareMonthlyDrafts(env,now=new Date()) {
 if(env.BILLING_DRAFTS_ENABLED!=='true')return;
 if(!env.STRIPE_SECRET_KEY?.startsWith('sk_test_'))throw Error('Draft pilot requires a Stripe test secret key');
 const month=previousMonth(now);
 for(const client of clients(env)){
  if(client.live||!client.enabled||client.startMonth>month)continue;
  // A human must verify webhook coverage and the monthly ledger before a draft.
  const review=await env.DB.prepare('SELECT * FROM billing_reviews WHERE client_id=? AND month=?').bind(client.id,month).first();
  if(!review||review.approved!==1)continue;
  const hold=await env.DB.prepare('SELECT event_id FROM billing_holds WHERE client_id=? LIMIT 1').bind(client.id).first();if(hold)continue;
  const existing=await env.DB.prepare('SELECT * FROM billing_runs WHERE client_id=? AND month=?').bind(client.id,month).first();
  if(existing?.status==='ready')continue;
  const revenue=await env.DB.prepare('SELECT COALESCE(SUM(revenue_cents),0) AS cents FROM billing_sales WHERE client_id=? AND month=?').bind(client.id,month).first();
  const fee=monthlyFee(revenue.cents);
  if(review.revenue_cents!==fee.revenue)continue; // An event arriving after approval invalidates it.
  if(!existing){
   await env.DB.prepare('INSERT OR IGNORE INTO billing_runs (client_id,month,revenue_cents,total_cents,status) VALUES (?,?,?,?,?)').bind(client.id,month,fee.revenue,fee.total,'creating').run();
  }
  const run=await env.DB.prepare('SELECT * FROM billing_runs WHERE client_id=? AND month=?').bind(client.id,month).first();
  // Never change an invoice's frozen amount during a retry.
  if(run.revenue_cents!==fee.revenue||run.total_cents!==fee.total)continue;
  const prefix='fern-'+client.id+'-'+month;
  if(!run.invoice_id){
   // If an API result was lost, do not retry past Stripe's idempotency retention.
   if(Date.now()-run.created_at>23*3600000)continue;
   const invoice=await stripe(env,'invoices',{customer:client.customer,auto_advance:'false',collection_method:'send_invoice',days_until_due:'14',pending_invoice_items_behavior:'exclude','metadata[fern_client]':client.id,'metadata[fern_month]':month},prefix+'-invoice');
   await env.DB.prepare('UPDATE billing_runs SET invoice_id=? WHERE client_id=? AND month=?').bind(invoice.id,client.id,month).run();run.invoice_id=invoice.id;
  }
  if(Date.now()-run.created_at>23*3600000)continue;
  await stripe(env,'invoiceitems',{customer:client.customer,invoice:run.invoice_id,currency:'usd',amount:String(fee.total),discountable:'false',description:month+' website maintenance: greater of $30 or 7% of $'+(fee.revenue/100).toFixed(2)+' qualifying sales'},prefix+'-item');
  await env.DB.prepare("UPDATE billing_runs SET status='ready' WHERE client_id=? AND month=?").bind(client.id,month).run();
 }
}
