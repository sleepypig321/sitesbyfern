const $=id=>document.getElementById(id);
const money=cents=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format((cents||0)/100);
const day=time=>new Date(time).toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'});
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const api=async(path,options={})=>{const res=await fetch('/api/admin/'+path,{credentials:'same-origin',...options});const data=await res.json().catch(()=>({}));if(!res.ok)throw Error(data.error||'Could not load your records');return data;};
const post=(path,obj)=>api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(obj)});
let projects=[];
function showWorkspace(signedIn){$('sign-in').hidden=signedIn;$('workspace').hidden=!signedIn;$('logout').hidden=!signedIn;}
function table(id,rows,render,columns){$(id).innerHTML=rows.length?rows.map(render).join(''):`<tr><td colspan="${columns}" class="empty">Nothing recorded yet.</td></tr>`;}
async function refresh(){
 const [summary,inquiries,projectData,receiptData]=await Promise.all([api('overview'),api('inquiries'),api('projects'),api('receipts')]);
 projects=projectData.rows;
 const inquiryCount=summary.inquiries.reduce((n,r)=>n+r.total,0);$('inquiry-count').textContent=inquiryCount;
 $('project-count').textContent=summary.projects.reduce((n,r)=>n+r.total,0);
 const net=summary.receipts.reduce((n,r)=>n+(r.type==='refund'?-r.total:r.total),0);$('income-total').textContent=money(net);
 const clientSales=summary.clientSiteSales.reduce((n,r)=>n+r.cents,0);$('client-sales').textContent=money(clientSales);
 table('inquiry-list',inquiries.rows,r=>`<tr><td>${day(r.created_at)}</td><td>${esc(r.details.business)}</td><td><a href="mailto:${encodeURIComponent(r.email)}">${esc(r.details.name)}</a><small>${esc(r.email)}</small></td><td>${esc(r.details.plan)}</td><td><span class="pill">${esc(r.status)}</span></td></tr>`,5);
 table('project-list',projects,r=>`<tr><td><strong>${esc(r.name)}</strong>${r.url?`<small><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">Open site ↗</a></small>`:''}</td><td>${esc(r.client_name)}</td><td>${r.kind==='managed'?'Managed':'Handover'}</td><td><select class="project-status" aria-label="Status of ${esc(r.name)}" data-id="${esc(r.id)}">${['planned','active','completed','paused'].map(s=>`<option value="${s}" ${r.status===s?'selected':''}>${s}</option>`).join('')}</select><button type="button" class="save-status" data-id="${esc(r.id)}">Save</button></td></tr>`,4);
 $('sale-project').innerHTML='<option value="">Unassigned / other</option>'+projects.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
 table('sales-list',receiptData.rows,r=>{const sign=r.type==='refund'?-1:1;return `<tr><td>${esc(r.date)}</td><td>${esc(r.type)}</td><td>${esc(r.description)}<small>${esc(r.project_name||'No project')}</small></td><td>${money(sign*r.gross_cents)}</td><td>${money(sign*(r.gross_cents-r.sales_tax_cents-r.fee_cents))}</td></tr>`},5);
}
async function boot(){try{const session=await api('session');showWorkspace(session.authenticated);if(session.authenticated)await refresh();}catch(error){$('login-status').textContent=error.message;showWorkspace(false);}}
$('login-form').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget;const status=$('login-status');status.textContent='Signing in…';try{await post('login',{password:form.password.value});form.reset();status.textContent='';showWorkspace(true);await refresh();}catch(error){status.textContent=error.message;}});
$('logout').addEventListener('click',async()=>{try{await post('logout',{});}finally{showWorkspace(false);}});
$('project-form').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,status=form.querySelector('.form-status'),data=Object.fromEntries(new FormData(form));status.textContent='Saving…';try{await post('projects',data);form.reset();status.textContent='Project saved.';await refresh();}catch(error){status.textContent=error.message;}});
$('project-list').addEventListener('click',async event=>{const button=event.target.closest('.save-status');if(!button)return;const id=button.dataset.id;const status=button.closest('td').querySelector('select').value;button.disabled=true;try{await api('projects/'+id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status})});button.textContent='Saved';await refresh();}catch(error){button.textContent=error.message;}finally{button.disabled=false;}});
const toCents=value=>{const n=Number(value);if(!Number.isFinite(n)||n<0||!/^\d+(\.\d{1,2})?$/.test(String(value)))throw Error('Enter valid dollar amounts (up to two decimals).');return Math.round(n*100);};
$('sale-form').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,status=form.querySelector('.form-status'),data=Object.fromEntries(new FormData(form));status.textContent='Saving…';try{await post('receipts',{date:data.date,type:data.type,project_id:data.project_id||null,description:data.description,gross_cents:toCents(data.gross),sales_tax_cents:toCents(data.sales_tax),fee_cents:toCents(data.fee),payment_ref:data.payment_ref});form.reset();form.date.value=new Date().toISOString().slice(0,10);status.textContent='Payment recorded.';await refresh();}catch(error){status.textContent=error.message;}});
const now=new Date().getFullYear();for(let year=now;year>=2025;year--){const opt=document.createElement('option');opt.value=year;opt.textContent=year;$('report-year').append(opt);}
$('sale-form').date.value=new Date().toISOString().slice(0,10);
$('export').addEventListener('click',()=>{window.location.href='/api/admin/export.csv?year='+encodeURIComponent($('report-year').value);});
boot();
