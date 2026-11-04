import {parseClover,moneyCents,feeForRevenue} from './report-parser.js';
const $=id=>document.getElementById(id),money=c=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(c/100);
// Remove capability from the address bar after reading it, before any navigation.
const url=new URL(location.href),token=url.searchParams.get('token')||'';
if(token){url.searchParams.delete('token');history.replaceState(null,'',url.pathname+url.search+url.hash);}
const hasAccess=/^[a-f0-9]{64}$/.test(token);let csv='',summary=null;
if(hasAccess)$('access-note').textContent='Your private link lets you submit a monthly report for Fern to review.';
$('report').addEventListener('change',async()=>{
 summary=null;csv='';$('summary').hidden=true;$('status').textContent='';$('estimate').textContent='';$('website-sales').value='';$('submit').disabled=true;
 const file=$('report').files[0];if(!file)return;
 try{
  if(file.size>200000)throw Error('Please use a CSV smaller than 200 KB.');
  csv=await file.text();summary=parseClover(csv);$('period').textContent='Calendar month: '+summary.month;
  $('totals').replaceChildren();for(const [label,key] of [['Gross sales','gross'],['Discounts','discounts'],['Refunds','refunds'],['Net sales before tax','net'],['Tax (excluded)','tax'],['Amount collected','collected']]){
   const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=money(summary[key]);$('totals').append(dt,dd);
  }
  $('filters').textContent=summary.filters;$('summary').hidden=false;$('submit').disabled=!hasAccess;
 }catch(e){$('status').textContent=e.message;}
});
$('calculate').addEventListener('click',()=>{
 try{const cents=moneyCents($('website-sales').value);if(cents<0||cents>summary.net)throw Error('Website sales must be between $0 and the report’s net sales.');
  const f=feeForRevenue(cents);$('estimate').textContent='Estimate for an enrolled maintenance client\nWebsite sales: '+money(cents)+'\n7%: '+money(f.percentage)+'\nTotal monthly fee: '+money(f.total)+'\nExtra after a verified $30 subscription payment: '+money(f.additional)+'\nThis preview does not create a bill.';
 }catch(e){$('estimate').textContent=e.message;}
});
$('submit').addEventListener('click',async()=>{
 if(!summary||!hasAccess)return;$('submit').disabled=true;$('status').textContent='Sending report…';
 try{const r=await fetch('/api/monthly-reports',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({csv})});const data=await r.json();if(!r.ok)throw Error(data.error||'Report could not be sent.');$('status').textContent=data.message;}
 catch(e){$('status').textContent=e.message;$('submit').disabled=false;}
});
