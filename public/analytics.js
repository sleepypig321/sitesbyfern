(()=>{
 const measurementId='G-G55SW4HLYK';
 const productionOrigin='https://sitesbyfern.fern-croxton.workers.dev';
 const routes=new Map([['/','/'],['/index.html','/'],['/services','/services'],['/services.html','/services'],['/inquire','/inquire'],['/inquire.html','/inquire']]);
 const path=routes.get(location.pathname);
 // Do not initialize on previews, private tools, or capability-bearing URLs.
 if(location.origin!==productionOrigin||!path||new URLSearchParams(location.search).has('token')||window.fernAnalyticsInitialized)return;
 window.fernAnalyticsInitialized=true;
 const pageLocation=productionOrigin+path;
 let referrer='';
 try{const u=new URL(document.referrer);if(['https:','http:'].includes(u.protocol))referrer=u.origin+(u.origin===productionOrigin?(routes.get(u.pathname)||'/'):'/');}catch{}
 window.dataLayer=window.dataLayer||[];
 window.gtag=function(){window.dataLayer.push(arguments);};
 const settings={page_location:pageLocation,page_referrer:referrer,allow_google_signals:false,allow_ad_personalization_signals:false};
 window.gtag('js',new Date());
 window.gtag('set',settings);
 window.gtag('config',measurementId,{...settings,send_page_view:true});
 // Call only after the inquiry API accepts the submission. No form values,
 // inquiry IDs, email addresses, tokens or payment details are included.
 window.fernTrackInquiry=()=>window.gtag('event','generate_lead',{method:'project_inquiry',page_location:pageLocation,page_referrer:referrer});
 const script=document.createElement('script');script.async=true;script.src='https://www.googletagmanager.com/gtag/js?id='+measurementId;script.referrerPolicy='origin';document.head.append(script);
})();
