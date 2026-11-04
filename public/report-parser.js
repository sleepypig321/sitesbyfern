export function csvRows(text){
 if(typeof text!=='string'||text.length>200000)throw Error('Please use a CSV smaller than 200 KB.');
 text=text.replace(/^\uFEFF/,'');const rows=[];let row=[],cell='',quoted=false,closed=false;
 for(let i=0;i<text.length;i++){
  const ch=text[i];
  if(quoted){if(ch==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=ch;continue;}
  if(ch==='"'){if(cell||closed)throw Error('Invalid CSV quoting.');quoted=true;continue;}
  if(ch===','||ch==='\n'||ch==='\r'){
   row.push(cell);cell='';closed=false;
   if(ch!==','){if(ch==='\r'&&text[i+1]==='\n')i++;if(row.some(v=>v.trim()))rows.push(row);row=[];}continue;
  }
  if(closed)throw Error('Invalid CSV quoting.');cell+=ch;
 }
 if(quoted)throw Error('Unclosed CSV quote.');
 row.push(cell);if(row.some(v=>v.trim()))rows.push(row);return rows;
}
export function moneyCents(value){
 let v=String(value).trim(),negative=false;
 if(v.startsWith('-')){negative=true;v=v.slice(1);}if(v.startsWith('$'))v=v.slice(1);
 if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{2})?$/.test(v))throw Error('An amount is missing or is not a valid USD value.');
 const [whole,fraction='00']=v.replaceAll(',','').split('.');const amount=Number(whole)*100+Number(fraction);
 if(!Number.isSafeInteger(amount))throw Error('An amount is too large.');return negative?-amount:amount;
}
export function feeForRevenue(cents){
 if(!Number.isSafeInteger(cents)||cents<0)throw Error('Website revenue must be a non-negative amount.');
 const percentage=Number((BigInt(cents)*7n+50n)/100n);
 return {revenue:cents,percentage,total:Math.max(3000,percentage),additional:Math.max(0,percentage-3000)};
}
export function parseClover(text){
 const rows=csvRows(text),months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
 if(rows.some(r=>r.some(v=>/^[=+@]/.test(v.trim())||(/^\-/.test(v.trim())&&!/^\-\$?[\d,.]+$/.test(v.trim())))))throw Error('The report contains a spreadsheet formula or unsupported cell value.');
 if(rows[0]?.[0]?.trim()!=='Sales Report')throw Error('This importer currently accepts Clover Sales Report CSV files.');
 const period=rows[1]?.join(',')||'';
 const dates=[...period.matchAll(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}), (\d{4}) at (\d{1,2}:\d{2} [AP]M)/g)];
 if(dates.length!==2)throw Error('The report date range could not be read.');
 const [,m1,d1,y1,t1]=dates[0],[,m2,d2,y2,t2]=dates[1],monthIndex=months.indexOf(m1);
 const days=new Date(Date.UTC(Number(y1),monthIndex+1,0)).getUTCDate();
 if(y1!==y2||m1!==m2||Number(d1)!==1||Number(d2)!==days||t1!=='12:00 AM'||t2!=='11:59 PM')throw Error('Export one complete calendar month, from the first day through the last day.');
 const section=rows.findIndex(r=>r.length===1&&r[0].trim()==='Sales');
 const header=rows[section+1];if(section<0||header?.[1]!=='Total'||header.length!==days+2)throw Error('The daily sales columns do not cover the full month.');
 for(let i=0;i<days;i++)if(header[i+2]!==m1+' '+(i+1))throw Error('A daily sales column is missing or duplicated.');
 const entries={};
 for(const r of rows.slice(section+2)){
  if(r.length!==header.length)break;
  const label=r[0].trim().toLowerCase();if(entries[label])throw Error('A sales total is duplicated.');
  const values=r.slice(1).map(moneyCents);if(values[0]!==values.slice(1).reduce((a,b)=>a+b,0))throw Error('A monthly total does not match its daily amounts.');entries[label]=values;
 }
 for(const name of ['gross sales','discounts','refunds','net sales','taxes','amount collected'])if(!entries[name])throw Error('Missing sales row: '+name+'.');
 const n=name=>entries[name][0];
 if(n('gross sales')<0||n('discounts')>0||n('refunds')>0||n('net sales')<0||n('taxes')<0)throw Error('Unusual signed amounts require manual review.');
 if(n('gross sales')+n('discounts')+n('refunds')!==n('net sales'))throw Error('Gross sales, discounts and refunds do not reconcile to net sales.');
 if(n('net sales')+n('taxes')!==n('amount collected'))throw Error('Collected amounts do not reconcile to net sales and tax.');
 const summary=rows.slice(0,section).find(r=>r[0].trim()==='Net sales');
 if(!summary||moneyCents(summary[1])!==n('net sales'))throw Error('The summary and daily net sales do not match.');
 return {month:y1+'-'+String(monthIndex+1).padStart(2,'0'),gross:n('gross sales'),discounts:n('discounts'),refunds:n('refunds'),net:n('net sales'),tax:n('taxes'),collected:n('amount collected'),filters:rows.find(r=>r[0]?.startsWith('Filters:'))?.[0]||'Not specified',websiteRevenue:null};
}
