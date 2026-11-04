import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{checkoutFor} from '../src/worker.js';
const links={STRIPE_TEST_HANDOVER_LINK:'https://buy.stripe.com/test_handover',STRIPE_TEST_MAINTAIN_LINK:'https://buy.stripe.com/test_maintain'};
const email={EMAILJS_SERVICE_ID:'fixture',EMAILJS_PUBLIC_KEY:'fixture',EMAILJS_DECISION_TEMPLATE_ID:'fixture'};
const data={name:'Test Client',business:'Test Shop',plan:'maintained'};
test('sandbox links stay separate from live checkout and attach only an inquiry reference',()=>{
 assert.equal(checkoutFor(links,'handover','request-1'),null);
 assert.equal(checkoutFor(links,'handover','request-1',true).amount,150);
 const link=checkoutFor(links,'maintained','request-2',true);
 assert.equal(link.amount,100);assert.equal(new URL(link.url).searchParams.get('client_reference_id'),'request-2');
 assert.throws(()=>checkoutFor({STRIPE_LIVE_HANDOVER_LINK:links.STRIPE_TEST_HANDOVER_LINK},'handover','r'));
 assert.throws(()=>checkoutFor({STRIPE_TEST_HANDOVER_LINK:'https://other.example/test_pay'},'handover','r',true));
});
function fixture(){
 let saved;
 const row={id:'request-5',created_at:Date.now(),email:'test@example.com',data:JSON.stringify(data),status:'pending',client_notified:0};
 const DB={prepare(sql){return{bind(...values){if(sql.startsWith('UPDATE inquiries SET status='))saved=JSON.parse(values[1]);return this},async first(){return row},async run(){return{meta:{changes:1}};}}}};
 return{DB,get saved(){return saved}};
}
const review='https://site.example/api/review?token='+('a'.repeat(72))+'&action=approve';
test('sandbox checkbox is unchecked on the confirmation page',async()=>{
 const f=fixture();const response=await worker.fetch(new Request(review),{...links,DB:f.DB});
 const html=await response.text();assert.match(html,/name="sandbox_checkout" value="1"/);assert.ok(!html.includes(' checked'));
});
test('explicit sandbox approval sends the matching test link and remembers the choice',async t=>{
 let outbound;t.mock.method(globalThis,'fetch',async(url,options)=>{outbound=JSON.parse(options.body);return new Response('OK')});
 const f=fixture();const response=await worker.fetch(new Request(review,{method:'POST',headers:{Origin:'https://site.example','Content-Type':'application/x-www-form-urlencoded'},body:'sandbox_checkout=1'}),{...email,...links,DB:f.DB});
 assert.equal(response.status,200);assert.equal(f.saved._sandboxCheckout,true);
 assert.match(outbound.template_params.subject,/SANDBOX TEST/);
 assert.match(outbound.template_params.action_url,/test_maintain\?client_reference_id=request-5/);
 assert.match(outbound.template_params.message,/does not start a maintenance subscription/);
});
test('ordinary approval cannot accidentally send a sandbox checkout',async t=>{
 let outbound;t.mock.method(globalThis,'fetch',async(url,options)=>{outbound=JSON.parse(options.body);return new Response('OK')});
 const f=fixture();const response=await worker.fetch(new Request(review,{method:'POST',headers:{Origin:'https://site.example','Content-Type':'application/x-www-form-urlencoded'},body:''}),{...email,...links,DB:f.DB});
 assert.equal(response.status,200);assert.equal(f.saved._sandboxCheckout,false);
 assert.equal(outbound.template_params.action_url,'https://site.example');assert.ok(!outbound.template_params.subject.includes('SANDBOX'));
});
