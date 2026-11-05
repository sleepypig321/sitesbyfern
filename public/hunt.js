// A playful, browser-local collectible trail. Rewards are reviewed by Fern,
// never automatically applied to a payment or trusted as proof of eligibility.
(() => {
  const ids=['garden','moth','stardust','key','earth'];
  const names={garden:'Secret Garden',moth:'Midnight Visitor',stardust:'Stardust Trail',key:'Hidden Key',earth:'A Better World'};
  const storage='fern-discoveries-v1';
  let discovered=[];try{discovered=JSON.parse(localStorage.getItem(storage)||'[]').filter(id=>ids.includes(id));}catch{}
  discovered=[...new Set(discovered)];
  const root=document.createElement('aside');root.className='fern-collect';root.setAttribute('aria-label','Hidden discoveries');
  root.innerHTML='<button type="button" class="fern-collect-tab" aria-expanded="false" aria-controls="fern-collect-panel">✧ <span class="fern-collect-count">0/5</span><small> secrets</small></button><div class="fern-collect-panel" id="fern-collect-panel" hidden><strong>THE HIDDEN FIVE</strong><p>Five little surprises are hiding across this site. Find them all to unlock 10% off your first invoice.</p><ol class="fern-collect-list"></ol><div class="fern-collect-reward"></div><button type="button" class="fern-collect-close">Close ×</button></div>';
  document.body.append(root);
  const panel=root.querySelector('.fern-collect-panel'),tab=root.querySelector('.fern-collect-tab');
  const open=value=>{panel.hidden=!value;tab.setAttribute('aria-expanded',String(value));};
  tab.addEventListener('click',()=>open(panel.hidden));root.querySelector('.fern-collect-close').addEventListener('click',()=>open(false));
  const rewardCode=()=>{let code;try{code=localStorage.getItem('fern-reward-code');}catch{}if(code)return code;const bytes=crypto.getRandomValues(new Uint8Array(5));code='FERN-'+[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('').toUpperCase();try{localStorage.setItem('fern-reward-code',code);}catch{}return code;};
  function update(){
    root.querySelector('.fern-collect-count').textContent=discovered.length+'/5';
    root.querySelector('.fern-collect-list').innerHTML=ids.map((id,index)=>`<li class="${discovered.includes(id)?'is-found':''}"><span>${discovered.includes(id)?'✦':'○'}</span> ${discovered.includes(id)?names[id]:'Mystery '+(index+1)}</li>`).join('');
    const reward=root.querySelector('.fern-collect-reward');
    reward.innerHTML=discovered.length===5?`<strong>YOU FOUND THE MAGIC ✦</strong><p>You've unlocked a 10% reward for your first Sites by Fern invoice.</p><code>${rewardCode()}</code><a href="/inquire?reward=1">Claim with your inquiry ↗</a><small>One-time reward, pending Fern's confirmation. Not valid on later invoices.</small>`:`<small>${5-discovered.length} ${5-discovered.length===1?'discovery':'discoveries'} left until your reward.</small>`;
  }
  update();
  function announce(id){
    if(discovered.includes(id))return;
    discovered.push(id);try{localStorage.setItem(storage,JSON.stringify(discovered));}catch{}
    update();open(true);root.classList.remove('fern-collect-pulse');void root.offsetWidth;root.classList.add('fern-collect-pulse');
  }
  window.addEventListener('fern-egg-found',event=>{if(ids.includes(event.detail?.id))announce(event.detail.id);});

  const beeMoth='<svg viewBox="0 0 160 110" aria-hidden="true"><path d="M80 48C58 9 13 14 4 42C0 67 33 79 67 67C45 105 75 110 80 85C85 110 115 105 93 67C127 79 160 67 156 42C147 14 102 9 80 48Z" fill="#b7d5b2" stroke="#d9b6bd" stroke-width="2"/><path d="M80 47L80 90M76 50L60 17M84 50L100 17" stroke="#8f7555" stroke-width="3"/><circle cx="41" cy="53" r="9" fill="#635d7e"/><circle cx="119" cy="53" r="9" fill="#635d7e"/></svg>';
  const effects={
    moth:()=>{const el=document.createElement('div');el.className='fern-egg-effect fern-moth-effect';el.innerHTML=beeMoth+'<span>even the night has wings</span>';document.body.append(el);setTimeout(()=>el.remove(),5300);},
    stardust:()=>{const el=document.createElement('div');el.className='fern-egg-effect fern-stars-effect';el.innerHTML=Array.from({length:38},(_,i)=>`<span style="--x:${(i*37)%100}%;--y:${(i*17+9)%95}%;--delay:${(i%8)*.1}s;--s:${8+i%10}px">✦</span>`).join('')+'<p>some things are worth looking closer at</p>';document.body.append(el);setTimeout(()=>el.remove(),5000);},
    key:()=>{const el=document.createElement('div');el.className='fern-egg-effect fern-key-effect';el.innerHTML='<div class="fern-key-reveal">⚿<span>curiosity opens doors</span></div>';document.body.append(el);setTimeout(()=>el.remove(),4800);},
    earth:()=>{const el=document.createElement('div');el.className='fern-egg-effect fern-earth-effect';el.innerHTML='<div class="fern-earth-orbit"></div>'+Array.from({length:24},(_,i)=>`<i style="--x:${(i*41)%100}%;--y:${(i*23+8)%95}%;--delay:${i*.08}s"></i>`).join('')+'<p>small acts travel far</p>';document.body.append(el);setTimeout(()=>el.remove(),5500);}
  };
  document.addEventListener('click',event=>{
    const target=event.target.closest('[data-fern-egg]');if(!target)return;
    const id=target.getAttribute('data-fern-egg');if(!effects[id])return;
    effects[id]();announce(id);
  });
  // The inquiry form uses this verified *browser-local* state as a request,
  // never as an automatically redeemable Stripe coupon.
  window.fernRewardClaim=()=>discovered.length===5?rewardCode():null;
})();
