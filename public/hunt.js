// A playful, browser-local collectible trail. Rewards are reviewed by Fern,
// never automatically applied to a payment or trusted as proof of eligibility.
(() => {
  const ids=['garden','moth','stardust','key','earth'];
  const names={garden:'Secret Garden',moth:'Midnight Visitor',stardust:'Stardust Trail',key:'Hidden Key',earth:'A Better World'};
  const clues={garden:'On any page: click the fern logo seven times.',moth:'My Work: tap the little crescent near my About Me introduction.',stardust:'My Work: tap the tiny star beside the projects heading.',key:'Services: find the small key near “Your accounts. Your business.”',earth:'My Mission: tap the little glimmer beside the Earth story.'};
  const storage='fern-discoveries-v1';
  let discovered=[];try{discovered=JSON.parse(localStorage.getItem(storage)||'[]').filter(id=>ids.includes(id));}catch{}
  discovered=[...new Set(discovered)];
  const root=document.createElement('aside');root.className='fern-collect';root.setAttribute('aria-label','Hidden discoveries');
  root.innerHTML='<button type="button" class="fern-collect-tab" aria-expanded="false" aria-controls="fern-collect-panel">✧ <span class="fern-collect-count">0/5</span><small> secrets</small></button><div class="fern-collect-panel" id="fern-collect-panel" hidden><strong>THE HIDDEN FIVE</strong><p>Find five clickable little details across the website. Follow the clues below to unlock 10% off your <strong>full first invoice</strong>.</p><ol class="fern-collect-list"></ol><div class="fern-collect-reward"></div><button type="button" class="fern-collect-close">Close ×</button></div><dialog class="fern-claim-dialog"><form method="dialog" class="fern-claim-form"><button type="button" class="fern-claim-x" aria-label="Close reward window">×</button><span class="fern-claim-overline">ALL FIVE DISCOVERED</span><h2>You found the magic.</h2><p>Please enter your email to receive your 10% off reward for your full first invoice.</p><label>Email address<input type="email" name="email" autocomplete="email" required maxlength="254" placeholder="you@example.com"></label><button type="submit" class="fern-claim-submit">Get my reward code ↗</button><p class="fern-claim-status" role="status"></p><small>By submitting, you ask Sites by Fern to record this reward and contact you about it. No mailing-list subscription.</small></form></dialog>';
  document.body.append(root);
  const panel=root.querySelector('.fern-collect-panel'),tab=root.querySelector('.fern-collect-tab');
  const open=value=>{panel.hidden=!value;tab.setAttribute('aria-expanded',String(value));};
  tab.addEventListener('click',()=>open(panel.hidden));root.querySelector('.fern-collect-close').addEventListener('click',()=>open(false));
  const rewardCode=()=>{try{return localStorage.getItem('fern-reward-code');}catch{return null;}};
  const claimDialog=root.querySelector('.fern-claim-dialog'),claimForm=root.querySelector('.fern-claim-form');
  const requestEmail=()=>{if(discovered.length===5&&!rewardCode()&&!claimDialog.open)claimDialog.showModal();};
  root.querySelector('.fern-claim-x').addEventListener('click',()=>claimDialog.close());
  claimForm.addEventListener('submit',async event=>{
    event.preventDefault();const status=root.querySelector('.fern-claim-status'),button=root.querySelector('.fern-claim-submit');button.disabled=true;status.textContent='Saving your reward…';
    try{
      const email=claimForm.elements.email.value.trim();const res=await fetch('/api/hunt/claim',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,discoveries:discovered})});
      const data=await res.json();if(!res.ok)throw Error(data.error||'Could not save reward. Please retry.');
      localStorage.setItem('fern-reward-code',data.code);localStorage.setItem('fern-reward-email',email);
      update();claimDialog.close();open(true);
    }catch(error){status.textContent=error.message;}finally{button.disabled=false;}
  });
  function update(){
    root.querySelector('.fern-collect-count').textContent=discovered.length+'/5';
    root.querySelector('.fern-collect-list').innerHTML=ids.map(id=>`<li class="${discovered.includes(id)?'is-found':''}"><span>${discovered.includes(id)?'✦':'○'}</span> <strong>${names[id]}</strong><small>${discovered.includes(id)?'Collected!':clues[id]}</small></li>`).join('');
    const reward=root.querySelector('.fern-collect-reward');
    reward.innerHTML=discovered.length===5?(rewardCode()?`<strong>YOU FOUND THE MAGIC ✦</strong><p>You've unlocked 10% off your first invoice.</p><code>${rewardCode()}</code><a href="/inquire?reward=1">Enter code with your inquiry ↗</a><small>One-time reward, pending Fern's confirmation. Not valid on later invoices.</small>`:'<strong>ALL FIVE FOUND ✦</strong><p>Your reward is waiting.</p><button type="button" class="fern-request-code">Enter your email to claim ↗</button>'):`<small>${5-discovered.length} ${5-discovered.length===1?'discovery':'discoveries'} left until your reward.</small>`;
  }
  update();
  function announce(id){
    if(discovered.includes(id))return;
    discovered.push(id);try{localStorage.setItem(storage,JSON.stringify(discovered));}catch{}
    update();open(true);root.classList.remove('fern-collect-pulse');void root.offsetWidth;root.classList.add('fern-collect-pulse');if(discovered.length===5)requestEmail();
  }
  window.addEventListener('fern-egg-found',event=>{if(ids.includes(event.detail?.id))announce(event.detail.id);});
  root.addEventListener('click',event=>{if(event.target.closest('.fern-request-code'))requestEmail();});
  document.querySelectorAll('[data-open-hunt]').forEach(button=>button.addEventListener('click',()=>open(true)));

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
  window.fernRewardClaim=()=>discovered.length===5?rewardCode():null;
})();
