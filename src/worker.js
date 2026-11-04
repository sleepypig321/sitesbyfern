const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export function validate(input){
 const fields={name:100,email:254,business:150,description:5000,features:3000,timeline:150,domain:100,inspiration:3000,plan:20};const data={};
 for(const [field,max] of Object.entries(fields)){if(typeof input[field]!=='string'&&input[field]!=null)throw Error('Please check your project details.');data[field]=String(input[field]||'').trim();if(data[field].length>max)throw Error('One of your answers is too long.');}
 if(!data.name||!data.business||!data.features||data.description.length<30||!/^\S+@\S+\.\S+$/.test(data.email)||!['handover','maintained'].includes(data.plan)||input.agreement!=='on')throw Error('Please complete the required fields and acknowledge the inquiry terms.');return data;
}
async function send(env,to,subject,html){const response=await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'api-key':env.BREVO_API_KEY,'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({sender:{name:'Sites by Fern',email:env.SENDER_EMAIL},replyTo:{email:env.OWNER_EMAIL},to:[{email:to}],subject,htmlContent:html})});if(!response.ok)throw Error('Email delivery unavailable');}
const wrap=body=>`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Sites by Fern · Project review</title><body style="background:#f1e9dc;color:#344532;font:16px/1.6 Arial;max-width:650px;margin:50px auto;padding:25px;border:1px solid #ad9158"><h1 style="font-family:Georgia">Sites by Fern ❧</h1>${body}</body></html>`;
const page=(body,status=200)=>new Response(wrap(body),{status,headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'"}});
export default {async fetch(request,env){
 const url=new URL(request.url);
 if(!url.pathname.startsWith('/api/'))return env.ASSETS.fetch(request);
 try{
 if(url.pathname==='/api/inquiries'&&request.method==='POST'){
 if(request.headers.get('Origin')!==url.origin)return json({error:'Please submit from the website.'},403);
 if(!env.DB||!env.BREVO_API_KEY)return json({error:'The inquiry form is not open yet. Please check back soon.'},503);
 const text=await request.text();if(text.length>18000)return json({error:'Please shorten your inquiry.'},413);
 let input;try{input=JSON.parse(text);}catch{return json({error:'Invalid form data.'},400);}
 if(input.website)return json({id:'received'});
 let data;try{data=validate(input);}catch(error){return json({error:error.message},400);}
 const recent=await env.DB.prepare('SELECT id FROM inquiries WHERE email = ? AND created_at > ? LIMIT 1').bind(data.email,Date.now()-60000).first();
 if(recent)return json({error:'Please wait a minute before sending another inquiry.'},429);
 const id=crypto.randomUUID(),token=crypto.randomUUID()+crypto.randomUUID(),now=Date.now();
 await env.DB.prepare('INSERT INTO inquiries (id,created_at,email,data,token) VALUES (?,?,?,?,?)').bind(id,now,data.email,JSON.stringify(data),token).run();
 const review=`${url.origin}/api/review?token=${token}`;
 const details=Object.entries(data).map(([key,value])=>`<p><strong>${esc(key)}</strong><br>${esc(value).replace(/\n/g,'<br>')}</p>`).join('');
 try{await send(env,env.OWNER_EMAIL,`New project inquiry: ${data.business}`,wrap(`<h2>A new project slip</h2>${details}<p><a href="${review}&action=approve">Approve project</a> &nbsp; <a href="${review}&action=decline">Decline project</a></p><p>Each link opens a confirmation page. Links expire after 30 days. Treat this email as private.</p>`));await env.DB.prepare('UPDATE inquiries SET notified=1 WHERE id=?').bind(id).run();}catch{await env.DB.prepare('DELETE FROM inquiries WHERE id=?').bind(id).run();return json({error:'Email delivery is unavailable, so your inquiry was not completed. Please try again later.'},503);}
 return json({id:id.slice(0,8)},201);
 }
 if(url.pathname==='/api/review'&&['GET','POST'].includes(request.method)){
 const token=url.searchParams.get('token')||'',action=url.searchParams.get('action');if(!['approve','decline'].includes(action)||token.length!==72)return page('<p>Invalid review link.</p>',400);
 const row=await env.DB.prepare('SELECT * FROM inquiries WHERE token=?').bind(token).first();if(!row||Date.now()-row.created_at>30*86400000)return page('<p>This review link is invalid or expired.</p>',410);
 const decision=action==='approve'?'approved':'declined';const data=JSON.parse(row.data);
 if(request.method==='GET'){
 if(row.status!=='pending'&&row.status!==decision)return page(`<p>This request has already been ${esc(row.status)}.</p>`,409);
 if(row.client_notified)return page(`<p>This request has been ${esc(row.status)}, and the decision email was sent.</p>`);
 return page(`<h2>${action==='approve'?'Approve':'Decline'} ${esc(data.business)}?</h2><p>Requested by ${esc(data.name)} · ${esc(row.email)}</p><p>${esc(data.description)}</p><p>This will record your decision and email the applicant. Approval does not charge them.</p><form method="post"><button style="padding:14px 25px;background:#52654d;color:white;border:1px solid #ad9158">Confirm ${action==='approve'?'approval':'decline'}</button></form>`);
 }
 if(request.headers.get('Origin')!==url.origin)return page('<p>Please use the confirmation page.</p>',403);
 if(row.status!=='pending'&&row.status!==decision)return page('<p>A different decision is already recorded.</p>',409);
 const claimed=await env.DB.prepare("UPDATE inquiries SET status=? WHERE id=? AND status='pending'").bind(decision,row.id).run();
 if(!claimed.meta.changes&&row.status==='pending')return page('<p>This decision is being processed. Reload the email link to see its status.</p>',409);
 if(row.client_notified)return page('<p>The decision email was already sent.</p>');
 let message=decision==='approved'?`<h2>Your project has been accepted!</h2><p>Hi ${esc(data.name)}, Fern has reviewed your inquiry for ${esc(data.business)} and would love to move forward.</p><p>The next step is to confirm the written scope, terms, and payment instructions by email before work begins. No payment has been collected. You do not need to book a call.</p>`:`<h2>An update on your project inquiry</h2><p>Hi ${esc(data.name)}, thank you for considering Sites by Fern. Fern is unable to take on this project at this time. No payment has been taken.</p>`;
 try{await send(env,row.email,decision==='approved'?'Your Sites by Fern project is accepted':'Your Sites by Fern project inquiry',wrap(message));await env.DB.prepare('UPDATE inquiries SET client_notified=1 WHERE id=?').bind(row.id).run();}catch{return page('<p>Your decision is saved, but the email could not be sent. Open this same review link again and confirm to retry delivery.</p>',503);}
 return page(`<p>Project ${decision}. The applicant’s decision email has been sent.</p>`);
 }
 return json({error:'Not found'},404);
 }catch{return json({error:'Something went wrong. Please try again later.'},500);}
}};
