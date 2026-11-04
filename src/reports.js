import {manualInvoicePage} from './manual-invoices.js';
import {parseClover,moneyCents,feeForRevenue} from '../public/report-parser.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dollars=c=>'$'+(c/100).toFixed(2);
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
async function notifyReport(env,sendTemplate,origin,row){
 const summary=JSON.parse(row.summary),review=origin+'/api/report-review?token='+row.review_token;
 await sendTemplate(env,env.EMAILJS_DECISION_TEMPLATE_ID,{
  to_email:env.OWNER_EMAIL,
  subject:'Monthly sales report ready for review — '+row.client_id+' — '+row.month,
  message:'A monthly sales report has been uploaded.\n\nClient: '+row.client_id+'\nMonth: '+row.month+'\nReported net sales: '+dollars(summary.net)+'\n\nWebsite-only revenue still needs verification. This is a monthly sales report review, not a project application. Opening the review does not approve a project, start a subscription, or collect payment.',
  action_url:review+'&action=approve',action_label:'Review monthly sales report'
 });
 await env.DB.prepare('UPDATE monthly_reports SET notified=2 WHERE id=?').bind(row.id).run();
}
const page=(body,status=200)=>new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Monthly report review · Sites by Fern</title><body style="background:#f1e9dc;color:#344532;font:16px/1.6 Arial;max-width:700px;margin:40px auto;padding:24px"><h1>Sites by Fern · Monthly report</h1>${body}</body></html>`,{status,headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'same-origin','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'"}});
export async function reportRoutes(request,env,sendTemplate){
 const url=new URL(request.url);
 if(url.pathname==='/api/monthly-reports'&&request.method==='POST'){
  if(request.headers.get('Origin')!==url.origin)return json({error:'Please submit from the website.'},403);
  const token=request.headers.get('Authorization')?.replace(/^Bearer /,'')||'';
  if(!/^[a-f0-9]{64}$/.test(token))return json({error:'Open the private report link supplied by Fern.'},403);
  const client=await env.DB.prepare('SELECT * FROM report_access WHERE token=? AND active=1').bind(token).first();
  if(!client)return json({error:'This report link is invalid or inactive.'},403);
  const raw=await request.text();if(raw.length>220000)return json({error:'Use a CSV smaller than 200 KB.'},413);
  let csv,summary;try{({csv}=JSON.parse(raw));summary=parseClover(csv);}catch(error){return json({error:error.message},400);}
  const existing=await env.DB.prepare('SELECT * FROM monthly_reports WHERE client_id=? AND month=?').bind(client.client_id,summary.month).first();
  if(existing){
   if(existing.status==='pending'&&existing.notified<2&&existing.csv===csv){
    try{await notifyReport(env,sendTemplate,url.origin,existing);}catch{return json({error:'The report is saved, but its review email could not be resent.'},503);}
    return json({id:existing.id,message:'Your saved report is unchanged. The corrected monthly-report review email has been sent. No invoice or payment has been created.'});
   }
   return json({error:'A report for this month is already saved. Ask Fern to review or replace it.'},409);
  }
  const id=crypto.randomUUID(),reviewToken=crypto.randomUUID()+crypto.randomUUID();
  await env.DB.prepare('INSERT INTO monthly_reports (id,client_id,month,created_at,summary,csv,review_token) VALUES (?,?,?,?,?,?,?)').bind(id,client.client_id,summary.month,Date.now(),JSON.stringify(summary),csv,reviewToken).run();
  try{
   await notifyReport(env,sendTemplate,url.origin,{id,client_id:client.client_id,month:summary.month,summary:JSON.stringify(summary),review_token:reviewToken});
  }catch{console.error('Monthly report saved; owner notification requires retry.');}
  return json({id,message:'Report saved for review. No invoice or payment has been created.'},201);
 }
 if(url.pathname!=='/api/report-review')return null;
 if(!['GET','POST'].includes(request.method))return page('<p>Method not allowed.</p>',405);
 const token=url.searchParams.get('token')||'',action=url.searchParams.get('action');
 if(token.length!==72||!['approve','decline'].includes(action))return page('<p>Invalid review link.</p>',400);
 const row=await env.DB.prepare('SELECT * FROM monthly_reports WHERE review_token=?').bind(token).first();
 if(!row||Date.now()-row.created_at>30*86400000)return page('<p>This report link is invalid or expired.</p>',410);
 if(row.status==='approved'&&url.searchParams.get('invoice')==='1')return await manualInvoicePage(request,env,row);
 if(row.status!=='pending')return page('<p>This report has already been '+esc(row.status)+'.</p>'+(row.status==='approved'?'<p><a href="'+esc(url.pathname+'?token='+token+'&action=approve&invoice=1')+'">Review invoice options</a></p>':''));
 const s=JSON.parse(row.summary);
 if(url.searchParams.get('download')==='1'&&request.method==='GET')return new Response(row.csv,{headers:{'Content-Type':'text/csv;charset=utf-8','Content-Disposition':'attachment; filename="monthly-sales-report.csv"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 if(request.method==='GET'){
  const approve=action==='approve';
  return page(`<h2>${esc(row.client_id)} · ${esc(s.month)}</h2><p>Net sales: ${dollars(s.net)}. Taxes: ${dollars(s.tax)}. Refunds: ${dollars(s.refunds)}.</p><p>${esc(s.filters)}. This summary does not establish which sales came from the maintained website.</p><p><a href="${esc(url.pathname+url.search+'&download=1')}">Download source CSV</a></p><form method="post">${approve?'<p><label>Verified website net sales for this month, excluding tax and refunds ($)<br><input name="website_amount" inputmode="decimal" required></label></p><p><label>Evidence for the website-only amount<br><textarea name="evidence" required maxlength="2000"></textarea></label></p><p><label><input name="verified" type="checkbox" value="yes" required> I checked the source period and website-only revenue evidence.</label></p>':''}<button>${approve?'Approve reviewed revenue':'Decline report'}</button></form><p>Approval records revenue for later billing review. It does not charge the client or assume their $30 subscription has been paid.</p>`);
 }
 if(request.headers.get('Origin')!==url.origin)return page('<p>Please use the confirmation page.</p>',403);
 if(!request.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded'))return page('<p>Invalid form.</p>',400);
 const body=await request.text();if(body.length>5000)return page('<p>Form too large.</p>',413);const form=new URLSearchParams(body);
 const billed=await env.DB.prepare('SELECT month FROM billing_runs WHERE client_id=? AND month=?').bind(row.client_id,row.month).first();
 if(billed)return page('<p>A billing run already exists for this month. Reconcile it before changing the report.</p>',409);
 if(action==='decline'){
  await env.DB.prepare("UPDATE monthly_reports SET status='declined' WHERE id=? AND status='pending'").bind(row.id).run();return page('<p>Report declined. No billing record was approved.</p>');
 }
 let cents;try{cents=moneyCents(form.get('website_amount')||'');}catch{return page('<p>Enter a valid website sales amount.</p>',400);}
 if(cents<0||cents>s.net||form.get('verified')!=='yes'||!form.get('evidence')?.trim()||form.get('evidence').length>2000)return page('<p>Check the website amount and supporting evidence. Website revenue cannot exceed reported net sales.</p>',400);
 // Both writes are atomic. The reviewed CSV replaces, rather than adds to, webhook revenue.
 await env.DB.batch([
  env.DB.prepare("UPDATE monthly_reports SET status='approved',website_cents=?,evidence=? WHERE id=? AND status='pending'").bind(cents,form.get('evidence').trim(),row.id),
  env.DB.prepare("INSERT INTO billing_reviews (client_id,month,revenue_cents,approved,source) SELECT client_id,month,website_cents,1,'csv' FROM monthly_reports WHERE id=? AND status='approved' AND website_cents=? AND evidence=? ON CONFLICT(client_id,month) DO UPDATE SET revenue_cents=excluded.revenue_cents,approved=1,source='csv'").bind(row.id,cents,form.get('evidence').trim())
 ]);
 const fee=feeForRevenue(cents);
 return page('<p>Website revenue approved: '+dollars(cents)+'. Total monthly maintenance: '+dollars(fee.total)+'.</p><p>Additional amount after a verified $30 subscription payment: '+dollars(fee.additional)+'. No payment was collected.</p><p><a href="'+esc(url.pathname+'?token='+token+'&action=approve&invoice=1')+'">Review invoice options</a></p>');
}
