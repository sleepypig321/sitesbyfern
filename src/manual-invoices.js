import {feeForRevenue} from '../public/report-parser.js';
import {clients} from './billing.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>'$'+(n/100).toFixed(2);
const page=(body,status=200)=>new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Maintenance invoice · Sites by Fern</title><body style="background:#f1e9dc;color:#344532;font:16px/1.6 Arial;max-width:700px;margin:40px auto;padding:24px"><h1>Sites by Fern · Maintenance invoice</h1>${body}</body></html>`,{status,headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'same-origin','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'"}});
export function invoiceChoice(revenue,base){
 const f=feeForRevenue(revenue);
 if(base){
  if(base.verified!==1||base.paid_cents!==3000)throw Error('The existing subscription payment needs reconciliation first.');
  return {kind:'additional',amount:f.additional,label:'Send additional sales invoice — '+money(f.additional),total:f.total};
 }
 return {kind:f.percentage>3000?'percentage':'minimum',amount:f.total,label:f.percentage>3000?'Send 7% sales invoice — '+money(f.total):'Send $30 invoice',total:f.total};
}
function configured(env,client){return env.MANUAL_INVOICES_ENABLED==='true'&&(client.live?env.STRIPE_LIVE_SECRET_KEY?.startsWith('sk_live_'):env.STRIPE_SECRET_KEY?.startsWith('sk_test_'));}
async function stripe(env,client,path,method='GET',data,key){
 const response=await fetch('https://api.stripe.com/v1/'+path,{method,headers:{Authorization:'Bearer '+(client.live?env.STRIPE_LIVE_SECRET_KEY:env.STRIPE_SECRET_KEY),'Stripe-Version':'2026-10-28.endive',...(method==='POST'?{'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':key}:{})},...(method==='POST'?{body:new URLSearchParams(data||{})}:{})});
 if(!response.ok)throw Error('Stripe request failed (HTTP '+response.status+'). The invoice may be saved; retry this review link.');
 return response.json();
}
const safeInvoiceLink=value=>{try{const u=new URL(value);return u.protocol==='https:'&&['invoice.stripe.com','pay.stripe.com'].includes(u.hostname)&&!u.username&&!u.password?u.href:null;}catch{return null;}};
export async function manualInvoicePage(request,env,row){
 const url=new URL(request.url);if(row.status!=='approved')return page('<p>Approve the report before preparing an invoice.</p>',409);
 let client;try{client=clients(env).find(c=>c.id===row.client_id);}catch{return page('<p>The billing client configuration needs attention.</p>',503);}
 if(!client)return page('<p>This client needs a Stripe customer mapping before invoicing.</p>',503);
 const base=await env.DB.prepare('SELECT * FROM billing_base_payments WHERE client_id=? AND month=?').bind(row.client_id,row.month).first();
 let choice;try{choice=invoiceChoice(row.website_cents,base);}catch(error){return page('<p>'+esc(error.message)+'</p>',409);}
 const run=await env.DB.prepare('SELECT * FROM billing_runs WHERE client_id=? AND month=?').bind(row.client_id,row.month).first();
 const mode=client.live?'LIVE — real payment request':'SANDBOX — no real payment';
 if(run&&(!run.billing_model?.startsWith('manual_')||run.revenue_cents!==row.website_cents||run.total_cents!==choice.amount))return page('<p>An existing billing record needs reconciliation. No second invoice will be created.</p>',409);
 if(run?.status==='manual_sent')return page('<p>An invoice was already sent for this month.</p><p>Stripe invoice: '+esc(run.invoice_id)+'</p>');
 if(choice.amount===0)return page('<p>The verified $30 subscription covers this month. Additional amount due: $0.00. No invoice is needed.</p>');
 if(request.method==='GET'){
  const ready=configured(env,client);
  return page(`<p>${esc(row.client_id)} · ${esc(row.month)} · ${mode}</p><p>Approved website sales: ${money(row.website_cents)}.</p><p>${base?'A verified $30 payment is credited.':'The invoice covers the full monthly fee, with a $30 minimum.'}</p><form method="post"><input type="hidden" name="invoice_step" value="preview"><input type="hidden" name="invoice_kind" value="${choice.kind}"><button ${ready?'':'disabled'}>${choice.label}</button></form>${ready?'':'<p>Invoice sending is not configured for this client yet.</p>'}<p>The $30 minimum and 7% are alternatives. Only the applicable amount is offered. No payment is collected automatically.</p>`);
 }
 if(request.headers.get('Origin')!==url.origin)return page('<p>Please use the confirmation page.</p>',403);
 if(!configured(env,client))return page('<p>Invoice sending is not configured for this client yet.</p>',503);
 if(!request.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded'))return page('<p>Invalid form.</p>',400);
 const raw=await request.text();if(raw.length>3000)return page('<p>Form too large.</p>',413);const form=new URLSearchParams(raw);
 if(form.get('invoice_kind')!==choice.kind)return page('<p>The applicable invoice amount changed. Reopen this review link.</p>',409);
 // Read the recipient from Stripe, never from a hidden field supplied by the browser.
 let customer;try{customer=await stripe(env,client,'customers/'+encodeURIComponent(client.customer));}catch(error){return page('<p>'+esc(error.message)+'</p>',502);}
 if(customer.deleted||customer.livemode!==client.live||!customer.email)return page('<p>Check this client’s Stripe customer, email address, and sandbox/live mode before invoicing.</p>',409);
 const confirmation=`<p>${mode}</p><p>Send ${money(choice.amount)} to ${esc(customer.email)} for ${esc(row.month)} maintenance?</p><p>Website sales: ${money(row.website_cents)}. ${base?'The verified $30 payment is already subtracted.':'This is the entire monthly maintenance fee.'}</p>`;
 if(form.get('invoice_step')==='preview')return page(confirmation+`<form method="post"><input type="hidden" name="invoice_step" value="send"><input type="hidden" name="invoice_kind" value="${choice.kind}"><label><input type="checkbox" name="checked_existing" value="yes" required> I checked the agreed service period, customer, tax treatment, and existing invoices/payments. This amount is still due.</label><p><button>Confirm and send ${money(choice.amount)} invoice</button></p></form><p>This emails a payment request. It does not charge a saved card.</p>`);
 if(form.get('invoice_step')!=='send'||form.get('checked_existing')!=='yes')return page('<p>Use the invoice confirmation form.</p>',400);
 // Share the client/month uniqueness guard with scheduled billing.
 if(!run)await env.DB.prepare('INSERT OR IGNORE INTO billing_runs (client_id,month,revenue_cents,total_cents,status,billing_model) VALUES (?,?,?,?,?,?)').bind(row.client_id,row.month,row.website_cents,choice.amount,'manual_creating','manual_'+choice.kind).run();
 const saved=await env.DB.prepare('SELECT * FROM billing_runs WHERE client_id=? AND month=?').bind(row.client_id,row.month).first();
 if(!saved||saved.billing_model!=='manual_'+choice.kind||saved.total_cents!==choice.amount||saved.revenue_cents!==row.website_cents)return page('<p>A different billing record already exists. Reconcile it before retrying.</p>',409);
 if(saved.status==='manual_sent')return page('<p>This month’s invoice was already sent.</p>');
 // Stripe retains idempotency keys for at least 24 hours. Old uncertain operations
 // require reconciliation rather than risking another invoice/item/email.
 if(Date.now()-saved.created_at>23*3600000)return page('<p>This unfinished invoice needs reconciliation in Stripe. Automatic retry has stopped to prevent duplicates.</p>',409);
 const prefix='fern-manual-'+row.client_id+'-'+row.month;
 const mark=async status=>{await env.DB.prepare('UPDATE billing_runs SET status=? WHERE client_id=? AND month=?').bind(status,row.client_id,row.month).run();saved.status=status;};
 try{
  if(!saved.invoice_id){
   const inv=await stripe(env,client,'invoices','POST',{customer:client.customer,auto_advance:'false',collection_method:'send_invoice',days_until_due:'14',pending_invoice_items_behavior:'exclude',discounts:'','metadata[fern_client]':row.client_id,'metadata[fern_month]':row.month,'metadata[fern_report]':row.id},prefix+'-create');
   if(!/^in_\w+$/.test(inv.id))throw Error('Unexpected invoice response.');
   await env.DB.prepare('UPDATE billing_runs SET invoice_id=? WHERE client_id=? AND month=?').bind(inv.id,row.client_id,row.month).run();saved.invoice_id=inv.id;
  }
  if(saved.status==='manual_creating'){
   await stripe(env,client,'invoiceitems','POST',{customer:client.customer,invoice:saved.invoice_id,currency:'usd',amount:String(choice.amount),discountable:'false',description:row.month+' website maintenance'+(base?' — additional amount after $30 paid':' — '+(choice.kind==='minimum'?'$30 minimum':'7% of verified website sales'))},prefix+'-item');await mark('manual_item_added');
  }
  let inv=await stripe(env,client,'invoices/'+encodeURIComponent(saved.invoice_id));
  if(inv.customer!==client.customer||inv.livemode!==client.live||inv.currency!=='usd'||inv.total!==choice.amount||inv.amount_due!==choice.amount||inv.metadata?.fern_report!==row.id)throw Error('Invoice customer or amount differs from the reviewed request. Reconcile it in Stripe before sending.');
  if(inv.status==='draft')inv=await stripe(env,client,'invoices/'+saved.invoice_id+'/finalize','POST',{auto_advance:'false'},prefix+'-finalize');
  if(inv.status!=='open')throw Error('This invoice is no longer open. Check its status in Stripe before sending.');
  const sent=await stripe(env,client,'invoices/'+saved.invoice_id+'/send','POST',{},prefix+'-send');
  await mark('manual_sent');const link=safeInvoiceLink(sent.hosted_invoice_url);
  return page('<p>'+ (client.live?'Invoice sent to ':'Sandbox invoice created for ')+esc(customer.email)+': '+money(choice.amount)+'.</p>'+(client.live?'':'<p>Stripe does not email sandbox invoices. No money was collected.</p>')+(link?'<p><a href="'+esc(link)+'">View Stripe invoice</a></p>':'')+'<p>Stripe invoice: '+esc(saved.invoice_id)+'</p>');
 }catch(error){return page('<p>'+esc(error.message)+'</p><p>Keep this review link to retry safely. Do not create a second invoice manually until the saved Stripe record is checked.</p>',502);}
}
