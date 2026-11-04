import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/analytics.js',import.meta.url),'utf8');
function boot(url,referrer=''){
 const location=new URL(url),scripts=[];const context={window:{},location,URL,URLSearchParams,document:{referrer,createElement:()=>({}),head:{append:s=>scripts.push(s)}}};
 vm.runInNewContext(source,context);return {context,scripts,events:context.window.dataLayer};
}
test('analytics loads only on production public pages, never private tools or previews',()=>{
 for(const url of ['https://example.com/','http://terminal.local:4173/','https://sitesbyfern.fern-croxton.workers.dev/monthly-report?token=private','https://sitesbyfern.fern-croxton.workers.dev/api/review?token=private','https://sitesbyfern.fern-croxton.workers.dev/?token=private'])assert.equal(boot(url).scripts.length,0);
 assert.equal(boot('https://sitesbyfern.fern-croxton.workers.dev/services').scripts.length,1);
});
test('tracking excludes query strings, hashes and private referrer paths',()=>{
 const {context,scripts,events}=boot('https://sitesbyfern.fern-croxton.workers.dev/inquire?email=private@example.com&plan=maintained#secret','https://sitesbyfern.fern-croxton.workers.dev/api/report-review?token=private-token');
 const config=Array.from(events.find(e=>e[0]==='config'));
 assert.equal(config[1],'G-G55SW4HLYK');assert.equal(config[2].page_location,'https://sitesbyfern.fern-croxton.workers.dev/inquire');assert.equal(config[2].page_referrer,'https://sitesbyfern.fern-croxton.workers.dev/');
 assert.equal(config[2].allow_google_signals,false);assert.equal(config[2].allow_ad_personalization_signals,false);
 assert.equal(scripts[0].referrerPolicy,'origin');context.window.fernTrackInquiry();
 const data=JSON.stringify(events);for(const secret of ['private@example.com','private-token','#secret','plan='])assert.ok(!data.includes(secret));
 assert.equal(Array.from(events.at(-1))[1],'generate_lead');
});
test('loading analytics twice does not duplicate page views',()=>{
 const {context,scripts}=boot('https://sitesbyfern.fern-croxton.workers.dev/');vm.runInNewContext(source,context);assert.equal(scripts.length,1);assert.equal(context.window.dataLayer.filter(e=>e[0]==='config').length,1);
});
