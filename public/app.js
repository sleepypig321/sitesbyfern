const form=document.querySelector('#project-form');
if(form){
 const status=document.querySelector('#form-status');
 const selectedPlan=new URLSearchParams(location.search).get('plan');
 if(['handover','maintained'].includes(selectedPlan))form.elements.plan.value=selectedPlan;
 window.addEventListener('DOMContentLoaded',()=>{
  const reward=window.fernRewardClaim?.();
  if(reward&&form.elements.reward_code){form.elements.reward_code.value=reward;document.querySelector('#reward-notice').hidden=false;}
 });
 form.addEventListener('submit',async event=>{
  event.preventDefault();const button=form.querySelector('button');button.disabled=true;status.textContent='Sending your project slip…';
  try{const payload=Object.fromEntries(new FormData(form));const response=await fetch('/api/inquiries',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const result=await response.json();if(!response.ok)throw new Error(result.error||'Your slip could not be sent. Please try again.');try{window.fernTrackInquiry?.();}catch{}form.reset();status.textContent='Your project slip is in! Fern will review it, and you’ll receive the decision by email. Reference: '+result.id;}
  catch(error){status.textContent=error.message||'Connection problem. Please try again.';}
  finally{button.disabled=false;}
 });
}
