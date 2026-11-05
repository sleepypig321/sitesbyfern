// Owner-only operations. Credentials are Cloudflare Worker secrets, never client code.
const response=(value,status=200,headers={})=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const validDate=s=>/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(s)&&!Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const text=(value,max=200)=>typeof value==='string'?value.trim().slice(0,max):'';
const currency=cents=>(cents/100).toFixed(2);
const crypt=async(secret,value)=>{
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signed=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(value));
 return [...new Uint8Array(signed)].map(x=>x.toString(16).padStart(2,'0')).join('');
};
const equal=(a,b)=>{if(a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0;};
const cookie=request=>(request.headers.get('Cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('fern_admin='))?.slice(11)||'';
const authenticated=async(request,env)=>{
 const token=cookie(request),parts=token.split('.');if(parts.length!==2)return false;
 const [timestamp,signature]=parts;if(!/^\d{13}$/.test(timestamp)||Date.now()-Number(timestamp)>8*3600000||Number(timestamp)>Date.now()+60000)return false;
 return equal(signature,await crypt(env.ADMIN_SESSION_SECRET,'fern-owner:'+timestamp));
};
const sameOrigin=(request,url)=>request.headers.get('Origin')===url.origin;
const jsonBody=async request=>{if(!(request.headers.get('Content-Type')||'').startsWith('application/json'))throw Error('Expected JSON');const body=await request.text();if(body.length>12000)throw Error('Request too large');return JSON.parse(body);};
const queryYear=url=>{const year=url.searchParams.get('year')||String(new Date().getUTCFullYear());if(!/^20\d{2}$/.test(year))throw Error('Invalid report year');return year;};
const csvCell=value=>'"'+String(value??'').replace(/"/g,'""')+'"';

export async function adminRoutes(request,env){
 const url=new URL(request.url),path=url.pathname,method=request.method;
 if(!path.startsWith('/api/admin/'))return null;
 if(!env.ADMIN_LOGIN_PASSWORD||!env.ADMIN_SESSION_SECRET||env.ADMIN_SESSION_SECRET.length<32)return response({error:'Owner login is not configured.'},503);
 if(!env.DB)return response({error:'Database unavailable.'},503);
 if(path==='/api/admin/login'&&method==='POST'){
  if(!sameOrigin(request,url))return response({error:'Forbidden'},403);
  let body;try{body=await jsonBody(request);}catch{return response({error:'Invalid login request'},400);}
  const attemptKey=await crypt(env.ADMIN_SESSION_SECRET,request.headers.get('CF-Connecting-IP')||'unknown');
  const recent=await env.DB.prepare('SELECT count,until FROM admin_login_limits WHERE key=?').bind(attemptKey).first();
  if(recent?.count>=5&&recent.until>Date.now())return response({error:'Too many attempts. Try again in 15 minutes.'},429);
  const supplied=typeof body.password==='string'&&body.password.length<=512?body.password:'';
  const suppliedEmail=typeof body.email==='string'?body.email.trim().toLowerCase():'';
  const ownerEmail=(env.OWNER_EMAIL||'sitesbyfern@outlook.com').trim().toLowerCase();
  const valid=equal(await crypt(env.ADMIN_SESSION_SECRET,supplied),await crypt(env.ADMIN_SESSION_SECRET,env.ADMIN_LOGIN_PASSWORD))&&suppliedEmail===ownerEmail;
  if(!valid){const until=recent?.until>Date.now()?recent.until:Date.now()+15*60000;const count=recent?.until>Date.now()?recent.count+1:1;
   await env.DB.prepare('INSERT INTO admin_login_limits (key,count,until) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count,until=excluded.until').bind(attemptKey,count,until).run();return response({error:'Incorrect login details.'},401);}
  await env.DB.prepare('DELETE FROM admin_login_limits WHERE key=?').bind(attemptKey).run();
  const timestamp=String(Date.now()),sig=await crypt(env.ADMIN_SESSION_SECRET,'fern-owner:'+timestamp);
  return response({authenticated:true},200,{'Set-Cookie':`fern_admin=${timestamp}.${sig}; HttpOnly; Secure; SameSite=Strict; Path=/api/admin; Max-Age=28800`});
 }
 if(path==='/api/admin/session'&&method==='GET')return response({authenticated:await authenticated(request,env)});
 if(!await authenticated(request,env))return response({error:'Sign in required.'},401);
 if(path==='/api/admin/logout'&&method==='POST'){
  if(!sameOrigin(request,url))return response({error:'Forbidden'},403);
  return response({authenticated:false},200,{'Set-Cookie':'fern_admin=; HttpOnly; Secure; SameSite=Strict; Path=/api/admin; Max-Age=0'});
 }
 if(path==='/api/admin/overview'&&method==='GET'){
  const [inquiries,projects,receipts,managed]=await Promise.all([
   env.DB.prepare('SELECT status,COUNT(*) AS total FROM inquiries GROUP BY status').all(),
   env.DB.prepare('SELECT status,COUNT(*) AS total FROM admin_projects GROUP BY status').all(),
   env.DB.prepare('SELECT type,COALESCE(SUM(gross_cents-sales_tax_cents-fee_cents),0) AS total FROM admin_receipts GROUP BY type').all(),
   env.DB.prepare('SELECT client_id,month,SUM(revenue_cents) AS cents FROM billing_sales GROUP BY client_id,month ORDER BY month DESC LIMIT 12').all()
  ]);
  return response({inquiries:inquiries.results,projects:projects.results,receipts:receipts.results,clientSiteSales:managed.results});
 }
 if(path==='/api/admin/inquiries'&&method==='GET'){
  const result=await env.DB.prepare('SELECT id,created_at,email,data,status,notified,client_notified FROM inquiries ORDER BY created_at DESC LIMIT 200').all();
  return response({rows:result.results.map(({data,...row})=>({...row,details:JSON.parse(data)}))});
 }
 if(path==='/api/admin/projects'&&method==='GET')return response({rows:(await env.DB.prepare('SELECT * FROM admin_projects ORDER BY created_at DESC LIMIT 500').all()).results});
 if(path==='/api/admin/receipts'&&method==='GET')return response({rows:(await env.DB.prepare('SELECT r.*,p.name AS project_name FROM admin_receipts r LEFT JOIN admin_projects p ON r.project_id=p.id ORDER BY r.date DESC,r.created_at DESC LIMIT 500').all()).results});
 if(path==='/api/admin/export.csv'&&method==='GET'){
  let year;try{year=queryYear(url);}catch{return response({error:'Invalid year'},400);}
  const result=await env.DB.prepare('SELECT r.*,p.name AS project_name,p.client_name FROM admin_receipts r LEFT JOIN admin_projects p ON r.project_id=p.id WHERE r.date>=? AND r.date<? ORDER BY r.date,r.created_at').bind(year+'-01-01',(Number(year)+1)+'-01-01').all();
  const lines=[['Date','Type','Client','Project','Description','Gross USD','Sales tax USD','Processing fees USD','Net received USD','Payment reference'].map(csvCell).join(',')];
  for(const row of result.results){const sign=row.type==='refund'?-1:1;lines.push([row.date,row.type,row.client_name||'',row.project_name||'',row.description,currency(row.gross_cents*sign),currency(row.sales_tax_cents*sign),currency(row.fee_cents*sign),currency((row.gross_cents-row.sales_tax_cents-row.fee_cents)*sign),row.payment_ref||''].map(csvCell).join(','));}
  return new Response('\uFEFF'+lines.join('\r\n')+'\r\n',{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="sites-by-fern-sales-${year}.csv"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 }
 if(['POST','PATCH'].includes(method)&&!sameOrigin(request,url))return response({error:'Forbidden'},403);
 if(path.startsWith('/api/admin/projects/')&&method==='PATCH'){
  const id=path.slice('/api/admin/projects/'.length);if(!/^[\da-f-]{36}$/.test(id))return response({error:'Invalid project'},400);
  let data;try{data=await jsonBody(request);}catch{return response({error:'Invalid update'},400);}
  if(!['planned','active','completed','paused'].includes(data.status))return response({error:'Invalid status'},400);
  const changed=await env.DB.prepare('UPDATE admin_projects SET status=? WHERE id=?').bind(data.status,id).run();
  return changed.meta?.changes?response({updated:true}):response({error:'Project not found'},404);
 }
 if(path==='/api/admin/projects'&&method==='POST'){
  let data;try{data=await jsonBody(request);}catch{return response({error:'Invalid project'},400);}
  const name=text(data.name,140),client=text(data.client_name,140),email=text(data.client_email,254),kind=data.kind,status=data.status;
  const website=text(data.url,500);
  if(website){try{const parsed=new URL(website);if(!['https:','http:'].includes(parsed.protocol)||parsed.username||parsed.password)throw Error();}catch{return response({error:'Use a valid website URL'},400);}}
  if(!name||!client||!['handover','managed'].includes(kind)||!['planned','active','completed','paused'].includes(status)||email&&!/^\S+@\S+\.\S+$/.test(email))return response({error:'Check project details'},400);
  const id=crypto.randomUUID();await env.DB.prepare('INSERT INTO admin_projects(id,created_at,name,client_name,client_email,url,kind,status,notes) VALUES (?,?,?,?,?,?,?,?,?)').bind(id,Date.now(),name,client,email,website,kind,status,text(data.notes,2000)).run();return response({id},201);
 }
 if(path==='/api/admin/receipts'&&method==='POST'){
  let data;try{data=await jsonBody(request);}catch{return response({error:'Invalid receipt'},400);}
  const date=text(data.date,10),type=data.type,description=text(data.description,500),reference=text(data.payment_ref,140);
  const cents=['gross_cents','sales_tax_cents','fee_cents'].map(k=>data[k]);
  if(!validDate(date)||!['income','refund'].includes(type)||!description||cents.some(n=>!Number.isSafeInteger(n)||n<0)||cents[1]+cents[2]>cents[0])return response({error:'Check sale amounts and date'},400);
  const project=data.project_id||null;if(project){const found=await env.DB.prepare('SELECT id FROM admin_projects WHERE id=?').bind(project).first();if(!found)return response({error:'Unknown project'},400);}
  const id=crypto.randomUUID();await env.DB.prepare('INSERT INTO admin_receipts(id,created_at,date,project_id,type,description,gross_cents,sales_tax_cents,fee_cents,payment_ref) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(id,Date.now(),date,project,type,description,...cents,reference).run();return response({id},201);
 }
 return response({error:'Not found'},404);
}
