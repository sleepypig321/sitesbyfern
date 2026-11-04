import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {parseClover,csvRows,moneyCents,feeForRevenue} from '../public/report-parser.js';
import {reportRoutes} from '../src/reports.js';
// Synthetic fixture. The uploaded business report is never committed.
function sample(){
 const rows=[['Sales Report'],['Thu, Oct 1, 2026 at 12:00 AM  - Sat, Oct 31, 2026 at 11:59 PM '],['Filters: none'],['Net sales','$3,100.00'],['Sales'],['','Total',...Array.from({length:31},(_,i)=>'Oct '+(i+1))]];
 for(const [name,total,daily] of [['Gross sales','$3,410.00','$110.00'],['Discounts','-$310.00','-$10.00'],['Refunds','$0.00','$0.00'],['Net sales','$3,100.00','$100.00'],['Taxes','$310.00','$10.00'],['Amount collected','$3,410.00','$110.00']])rows.push([name,total,...Array(31).fill(daily)]);
 return rows.map(r=>r.map(v=>'"'+v.replaceAll('"','""')+'"').join(',')).join('\r\n');
}
function setup(){
 const db=new DatabaseSync(':memory:');for(const f of ['002_billing.sql','003_monthly_reports.sql'])db.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));
 const wrap=sql=>({bind(...args){const s=db.prepare(sql);return {first:async()=>s.get(...args),run:async()=>s.run(...args)};}});
 const env={OWNER_EMAIL:'owner@example.com',DB:{prepare:wrap,async batch(statements){db.exec('BEGIN');try{const r=[];for(const s of statements)r.push(await s.run());db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}}};
 const token='a'.repeat(64);db.prepare('INSERT INTO report_access (client_id,token) VALUES (?,?)').run('shop',token);return {db,env,token};
}
const submit=(env,token,send=async()=>{})=>reportRoutes(new Request('https://example.com/api/monthly-reports',{method:'POST',headers:{Origin:'https://example.com',Authorization:'Bearer '+token},body:JSON.stringify({csv:sample()})}),env,send);
test('Clover monthly totals reconcile without adding summary and daily totals twice',()=>{
 const s=parseClover(sample());assert.equal(s.net,310000);assert.equal(s.tax,31000);assert.equal(s.websiteRevenue,null);assert.equal(s.month,'2026-10');
 assert.deepEqual(feeForRevenue(100000),{revenue:100000,percentage:7000,total:7000,additional:4000});assert.equal(feeForRevenue(0).additional,0);
});
test('CSV handles BOM, quoted commas and CRLF; rejects malformed and incomplete reports',()=>{
 assert.equal(parseClover('\uFEFF'+sample()).net,310000);assert.deepEqual(csvRows('"a,b","c"\r\n'),[['a,b','c']]);
 assert.throws(()=>csvRows('"unterminated'));assert.throws(()=>moneyCents('=1+1'));assert.throws(()=>moneyCents('$1,23.00'));assert.throws(()=>moneyCents('1.001'));
 assert.throws(()=>parseClover(sample().replace('Oct 31, 2026','Oct 30, 2026')),/complete calendar month/);
 assert.throws(()=>parseClover(sample().replace('$3,410.00','$3,411.00')),/daily amounts/);
});
test('only private access links can submit, uploads are pending and duplicate months rejected',async()=>{
 const {db,env,token}=setup();assert.equal((await submit(env,'b'.repeat(64))).status,403);
 let sends=0;assert.equal((await submit(env,token,async()=>{sends++;})).status,201);
 assert.equal(sends,1);assert.equal(db.prepare('SELECT status FROM monthly_reports').get().status,'pending');
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM billing_reviews').get().n,0);
 assert.equal((await submit(env,token)).status,409);
});
test('opening a review never approves it; foreign-origin confirmation is refused',async()=>{
 const {db,env,token}=setup();await submit(env,token);const r=db.prepare('SELECT * FROM monthly_reports').get();const url='https://example.com/api/report-review?token='+r.review_token+'&action=approve';
 assert.equal((await reportRoutes(new Request(url),env)).status,200);assert.equal(db.prepare('SELECT status FROM monthly_reports').get().status,'pending');
 assert.equal((await reportRoutes(new Request(url,{method:'POST',headers:{Origin:'https://other.example'}}),env)).status,403);
});
test('review records only evidenced website revenue, including zero store-only sample revenue',async()=>{
 const {db,env,token}=setup();await submit(env,token);const r=db.prepare('SELECT * FROM monthly_reports').get();
 const url='https://example.com/api/report-review?token='+r.review_token+'&action=approve';
 const response=await reportRoutes(new Request(url,{method:'POST',headers:{Origin:'https://example.com','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({website_amount:'0.00',evidence:'Store-only sample; no online sales.',verified:'yes'})}),env);
 assert.equal(response.status,200);const review=db.prepare('SELECT * FROM billing_reviews').get();assert.equal(review.revenue_cents,0);assert.equal(review.source,'csv');
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM billing_base_payments').get().n,0);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM billing_runs').get().n,0);
});
test('approval refuses revenue above the source total',async()=>{
 const {db,env,token}=setup();await submit(env,token);const r=db.prepare('SELECT * FROM monthly_reports').get();
 const response=await reportRoutes(new Request('https://example.com/api/report-review?token='+r.review_token+'&action=approve',{method:'POST',headers:{Origin:'https://example.com','Content-Type':'application/x-www-form-urlencoded'},body:'website_amount=99999.00&evidence=checked&verified=yes'}),env);
 assert.equal(response.status,400);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM billing_reviews').get().n,0);
});
