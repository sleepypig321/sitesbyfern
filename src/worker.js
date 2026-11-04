import {salesWebhook,prepareMonthlyDrafts,clients} from './billing.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export function validate(input){
 const fields={name:100,email:254,business:150,description:5000,features:3000,timeline:150,domain:100,inspiration:3000,plan:20};const data={};
 for(const [field,max] of Object.entries(fields)){if(typeof input[field]!=='string'&&input[field]!=null)throw Error('Please check your project details.');data[field]=String(input[field]||'').trim();if(data[field].length>max)throw Error('One of your answers is too long.');}
 if(!data.name||!data.business||!data.features||data.description.length<30||!/^\S+@\S+\.\S+$/.test(data.email)||!['handover','maintained'].includes(data.plan)||input.agreement!=='on')throw Error('Please complete the required fields and acknowledge the inquiry terms.');return data;
}
export function deliveryFailure(status, body) {
 const text=String(body).toLowerCase();
 let code='EMAILJS_REJECTED',reason='The email service rejected the request.';
 if(/non.browser|api calls are disabled|server.side.*disabled/.test(text)){code='EMAILJS_SERVER_ACCESS';reason='EmailJS has not enabled requests from the website server.';}
 else if(/private key|accesstoken|access token/.test(text)){code='EMAILJS_PRIVATE_KEY';reason='EmailJS requires its private-key authorization to be configured.';}
 else if(/public key|user.?id|account.*not found/.test(text)){code='EMAILJS_PUBLIC_KEY';reason='EmailJS did not recognize the configured account key.';}
 else if(/service.?id|service.*not found|service.*invalid/.test(text)){code='EMAILJS_SERVICE_ID';reason='EmailJS did not recognize the connected email service.';}
 else if(/template.?id|template.*not found|template.*invalid/.test(text)){code='EMAILJS_TEMPLATE_ID';reason='EmailJS did not recognize the inquiry template.';}
 else if(status===429||/quota|rate.?limit/.test(text)){code='EMAILJS_LIMIT';reason='The email sending limit has been reached.';}
 else if(/oauth|authorization|token.*expired|authentication|outlook/.test(text)){code='EMAILJS_OUTLOOK_AUTH';reason='The Outlook email connection needs attention in EmailJS.';}
 return Object.assign(new Error(reason),{deliveryCode:code,providerStatus:status});
}
export async function sendTemplate(env, templateId, params) {
 const payload = {
  service_id: env.EMAILJS_SERVICE_ID,
  template_id: templateId,
  user_id: env.EMAILJS_PUBLIC_KEY,
  template_params: params
 };
 if (env.EMAILJS_PRIVATE_KEY) payload.accessToken = env.EMAILJS_PRIVATE_KEY;
 const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
  method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)
 });
 if (!response.ok) throw deliveryFailure(response.status,await response.text());
}
export function checkoutFor(env,plan,reference,sandbox=false){
 if(!['handover','maintained'].includes(plan))throw Error('Invalid project package');
 const variable='STRIPE_'+(sandbox?'TEST':'LIVE')+'_'+(plan==='handover'?'HANDOVER':'MAINTAIN')+'_LINK';
 if(!env[variable])return null;
 const link=new URL(env[variable]);
 if(link.protocol!=='https:'||link.hostname!=='buy.stripe.com'||link.username||link.password||link.port)throw Error('Invalid checkout configuration');
 if(link.pathname.startsWith('/test_')!==sandbox)throw Error('Checkout mode mismatch');
 link.searchParams.set('client_reference_id',reference);
 return {url:link.href,sandbox,amount:plan==='handover'?150:100};
}
const wrap=body=>`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="same-origin"><title>Sites by Fern · Project review</title><body style="background:#f1e9dc;color:#344532;font:16px/1.6 Arial;max-width:650px;margin:50px auto;padding:25px;border:1px solid #ad9158"><h1 style="font-family:Georgia">Sites by Fern ❧</h1>${body}</body></html>`;
const page=(body,status=200)=>new Response(wrap(body),{status,headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'same-origin','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'"}});
export default {async scheduled(controller,env,ctx){ctx.waitUntil(prepareMonthlyDrafts(env));},async fetch(request,env){
 const url=new URL(request.url);
 if(!url.pathname.startsWith('/api/'))return env.ASSETS.fetch(request);
 try{
 if(url.pathname.startsWith('/api/billing/webhooks/')&&request.method==='POST'){
  try{clients(env);}catch(error){const known=typeof error.billingConfigCode==='string'&&/^BILLING_CLIENT[A-Z_]+$/.test(error.billingConfigCode);return json({error:known?error.message:'Billing configuration could not be read.',code:known?error.billingConfigCode:'BILLING_CLIENTS_INVALID'},503);}
  if(!env.DB)return json({error:'The billing database binding is missing.',code:'BILLING_DB_MISSING'},503);
  try{return await salesWebhook(request,env,url.pathname.slice('/api/billing/webhooks/'.length));}
  catch(error){
   const storage=/D1_|no such table|SQLITE|database/i.test(String(error?.message||''));
   const code=storage?'BILLING_STORAGE_ERROR':'BILLING_WEBHOOK_ERROR';
   console.error('Billing webhook failed:',code);
   return json({error:storage?'Check the billing migration on the database bound to this Worker.':'The webhook could not be processed.',code},500);
  }
 }
 if(url.pathname==='/api/inquiries'&&request.method==='POST'){
 if(request.headers.get('Origin')!==url.origin)return json({error:'Please submit from the website.'},403);
 if(!env.DB||!env.EMAILJS_PUBLIC_KEY||!env.EMAILJS_SERVICE_ID||!env.EMAILJS_INQUIRY_TEMPLATE_ID||!env.EMAILJS_DECISION_TEMPLATE_ID)return json({error:'The inquiry form is not open yet. Please check back soon.'},503);
 const text=await request.text();if(text.length>18000)return json({error:'Please shorten your inquiry.'},413);
 let input;try{input=JSON.parse(text);}catch{return json({error:'Invalid form data.'},400);}
 if(input.website)return json({id:'received'});
 let data;try{data=validate(input);}catch(error){return json({error:error.message},400);}
 const recent=await env.DB.prepare('SELECT id FROM inquiries WHERE email = ? AND created_at > ? LIMIT 1').bind(data.email,Date.now()-60000).first();
 if(recent)return json({error:'Please wait a minute before sending another inquiry.'},429);
 const id=crypto.randomUUID(),token=crypto.randomUUID()+crypto.randomUUID(),now=Date.now();
 await env.DB.prepare('INSERT INTO inquiries (id,created_at,email,data,token) VALUES (?,?,?,?,?)').bind(id,now,data.email,JSON.stringify(data),token).run();
 const review=`${url.origin}/api/review?token=${token}`;
 const details = [
  ['Website brief', data.description], ['Pages and features', data.features],
  ['Timing', data.timeline || 'Not specified'], ['Domain', data.domain || 'Not specified'],
  ['Design inspiration and notes', data.inspiration || 'None supplied']
 ].map(([label,value])=>label+':\n'+value).join('\n\n');
 const params = {
  name: data.name, email: data.email, business: data.business,
  plan: data.plan==='handover' ? 'Build & handover — $150' : 'Build & maintain — $100 upfront; $30/month or 7% of website sales, whichever is higher',
  details, approve_url: review+'&action=approve', decline_url: review+'&action=decline'
 };
 try{await sendTemplate(env,env.EMAILJS_INQUIRY_TEMPLATE_ID,params);}catch(error){
  await env.DB.prepare('DELETE FROM inquiries WHERE id=?').bind(id).run();
  const code=error.deliveryCode||'EMAIL_TRANSPORT';
  const hint=error.deliveryCode?error.message:'The website could not contact the email service.';
  const status=error.providerStatus?' / HTTP '+error.providerStatus:'';
  console.error('Inquiry email failed:',code,error.providerStatus||'network');
  return json({error:'Email delivery unavailable ('+code+status+'). '+hint+' Your inquiry was not completed.',code},503);
 }
 try{await env.DB.prepare('UPDATE inquiries SET notified=1 WHERE id=?').bind(id).run();}
 catch{console.error('Inquiry notification accepted; database notification flag could not be updated.');}
 return json({id:id.slice(0,8)},201);
 }
 if(url.pathname==='/api/review'&&['GET','POST'].includes(request.method)){
 const token=url.searchParams.get('token')||'',action=url.searchParams.get('action');if(!['approve','decline'].includes(action)||token.length!==72)return page('<p>Invalid review link.</p>',400);
 const row=await env.DB.prepare('SELECT * FROM inquiries WHERE token=?').bind(token).first();if(!row||Date.now()-row.created_at>30*86400000)return page('<p>This review link is invalid or expired.</p>',410);
 const decision=action==='approve'?'approved':'declined';const data=JSON.parse(row.data);
 if(request.method==='GET'){
 if(row.status!=='pending'&&row.status!==decision)return page(`<p>This request has already been ${esc(row.status)}.</p>`,409);
 if(row.client_notified)return page(`<p>This request has been ${esc(row.status)}, and the decision email was sent.</p>`);
 const testCheckout=decision==='approved'?checkoutFor(env,data.plan,row.id,true):null;
 const sandboxControl=testCheckout?'<label style="display:block;padding:14px;border:1px solid #ad9158;margin:18px 0"><input type="checkbox" name="sandbox_checkout" value="1"> Send a SANDBOX TEST checkout link. No real money is collected. Use only for test inquiries.</label>':'';
 return page(`<h2>${action==='approve'?'Approve':'Decline'} ${esc(data.business)}?</h2><p>Requested by ${esc(data.name)} · ${esc(row.email)}</p><p>${esc(data.description)}</p><p>This will record your decision and email the applicant. Approval does not charge them.</p><form method="post">${sandboxControl}<button style="padding:14px 25px;background:#52654d;color:white;border:1px solid #ad9158">Confirm ${action==='approve'?'approval':'decline'}</button></form>`);
 }
 if(request.headers.get('Origin')!==url.origin)return page('<p>Please use the confirmation page.</p>',403);
 if(row.status!=='pending'&&row.status!==decision)return page('<p>A different decision is already recorded.</p>',409);
 let form=new URLSearchParams();
 if(request.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded')){
  const body=await request.text();if(body.length>2048)return page('<p>Invalid confirmation form.</p>',400);
  form=new URLSearchParams(body);
 }
 const sandbox=decision==='approved'&&(row.status==='pending'?form.get('sandbox_checkout')==='1':data._sandboxCheckout===true);
 const checkout=decision==='approved'?checkoutFor(env,data.plan,row.id,sandbox):null;
 if(sandbox&&!checkout)return page('<p>Sandbox checkout is not configured for this package.</p>',503);
 if(decision==='approved')data._sandboxCheckout=sandbox;
 const claimed=await env.DB.prepare("UPDATE inquiries SET status=?, data=? WHERE id=? AND status='pending'").bind(decision,JSON.stringify(data),row.id).run();
 if(!claimed.meta.changes&&row.status==='pending')return page('<p>This decision is being processed. Reload the email link to see its status.</p>',409);
 if(row.client_notified)return page('<p>The decision email was already sent.</p>');
 const subject=(checkout?.sandbox?'[SANDBOX TEST] ':'')+(decision==='approved'?'Your Sites by Fern project is accepted':'Your Sites by Fern project inquiry');
 let message=decision==='approved'
  ? 'Hi '+data.name+',\n\nFern has reviewed your inquiry for '+data.business+' and accepted your project.\n\nThe next step is to confirm the written scope, terms, and payment instructions before work begins. No payment has been collected. You do not need to book a call.\n\nSites by Fern'
  : 'Hi '+data.name+',\n\nThank you for considering Sites by Fern for '+data.business+'. Fern is unable to take on this project at this time. No payment has been taken.\n\nSites by Fern';
 if(checkout){
  message='Hi '+data.name+',\n\n'+(checkout.sandbox?'SANDBOX TEST — this is not a request for real payment.\n\n':'')+
   'Your '+(data.plan==='handover'?'Build & Handover':'Build & Maintain')+' inquiry for '+data.business+' has been approved.\n\n'+
   'The '+(checkout.sandbox?'test ':'')+'checkout below is for the $'+checkout.amount+' one-time build fee. '+
   (data.plan==='maintained'?'Maintenance is separate: $30/month or 7% of website sales, whichever is higher. This checkout does not start a maintenance subscription.\n\n':'\n\n')+
   'Domain, hosting, third-party services, and payment processing costs are separate unless included in your written scope. Confirm the scope and terms before making any real payment.\n\n'+
   (checkout.sandbox?'Use Stripe test card details only. No real money will move.\n\n':'')+'Sites by Fern';
 }
 try{await sendTemplate(env,env.EMAILJS_DECISION_TEMPLATE_ID,{
  to_email: row.email, subject, message,
  action_url: checkout?.url||url.origin,
  action_label: checkout?(checkout.sandbox?'Open sandbox checkout — $'+checkout.amount:'Pay build fee — $'+checkout.amount):'View Sites by Fern'
 });await env.DB.prepare('UPDATE inquiries SET client_notified=1 WHERE id=?').bind(row.id).run();}catch{return page('<p>Your decision is saved, but the email could not be sent. Open this same review link again and confirm to retry delivery.</p>',503);}
 return page(`<p>Project ${decision}. The applicant’s decision email has been sent.</p>`);
 }
 return json({error:'Not found'},404);
 }catch{return json({error:'Something went wrong. Please try again later.'},500);}
}};
