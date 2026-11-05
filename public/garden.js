// Seven taps on the fern mark reveal a hidden morning-glory garden.
(() => {
  const key = 'fern-garden-taps';
  const colors = [
    ['#7b77d9','#ddd1ff'],['#dc75a8','#ffd6e8'],['#527fc9','#c8e6ff'],
    ['#cf7183','#ffd0c8'],['#7b5dbb','#dcd0fb'],['#f7f1e5','#ffeaca'],
    ['#a376d6','#e0cbff'],['#df91b4','#f7d9ea']
  ];
  let clearing;
  const flower = (index, palette) => {
    const [dark,light] = palette;
    const petals = Array.from({length:5},(_,i)=>`<path d="M 0 0 C -24 -21 -43 -60 0 -70 C 40 -59 25 -20 0 0 Z" transform="rotate(${i*72})" fill="url(#glory-${index})" stroke="${dark}" stroke-opacity=".28" stroke-width="1.1"/>`).join('');
    return `<svg viewBox="-84 -84 168 168" role="presentation" focusable="false"><defs><radialGradient id="glory-${index}" cx="50%" cy="65%" r="72%"><stop offset="0" stop-color="#fff8cd"/><stop offset=".22" stop-color="${light}"/><stop offset=".77" stop-color="${dark}"/><stop offset="1" stop-color="${light}"/></radialGradient></defs><g>${petals}<path d="M0 -26 Q9 -8 25 -8 Q11 2 15 20 Q0 11 -15 20 Q-11 3 -25 -8 Q-8 -10 0 -26Z" fill="#fff1c1" opacity=".75"/><circle r="8" fill="#fff5c8"/><circle r="3" fill="#e7b95b"/></g></svg>`;
  };
  const bee = `<svg viewBox="0 0 92 66" focusable="false" aria-hidden="true"><ellipse cx="34" cy="18" rx="21" ry="13" transform="rotate(-25 34 18)" fill="#f6fbfa" fill-opacity=".78" stroke="#d6e2e0"/><ellipse cx="57" cy="17" rx="20" ry="12" transform="rotate(28 57 17)" fill="#f6fbfa" fill-opacity=".8" stroke="#d6e2e0"/><ellipse cx="46" cy="40" rx="28" ry="17" fill="#eabf5a" stroke="#6a503a" stroke-width="2"/><path d="M35 24Q43 40 35 55 M49 23Q57 40 49 56" stroke="#4d4036" stroke-width="8" fill="none"/><circle cx="21" cy="38" r="12" fill="#4f443a"/><circle cx="18" cy="35" r="2.5" fill="white"/><path d="M74 41L86 36L75 46Z" fill="#715943"/></svg>`;
  function bloom(){
    document.querySelector('.fern-secret-garden')?.remove();
    clearTimeout(clearing);
    const garden=document.createElement('div');garden.className='fern-secret-garden';garden.setAttribute('role','status');garden.setAttribute('aria-label','A secret garden of colorful morning glories blooms, and bees fly among them.');
    const spots=[[8,18,118],[19,70,145],[35,27,105],[54,79,130],[78,23,154],[90,71,120],[5,86,96],[64,12,111],[42,92,128],[95,42,101],[26,44,124],[71,61,112]];
    garden.innerHTML=spots.map(([x,y,size],i)=>`<div class="fern-secret-flower" style="--x:${x}%;--y:${y}%;--size:${size}px;--delay:${(i%5)*.12}s;--tilt:${(i%2?-1:1)*(8+i*5)}deg">${flower(i,colors[i%colors.length])}</div>`).join('')+
      Array.from({length:5},(_,i)=>`<div class="fern-secret-bee" style="--flight:${i};--delay:${i*.28}s;--top:${16+i*14}%;">${bee}</div>`).join('')+
      '<div class="fern-garden-whisper">you found the garden <span>✿</span></div>';
    document.body.append(garden);
    clearing=setTimeout(()=>garden.remove(),11000);
  }
  document.addEventListener('click',event=>{
    const mark=event.target.closest('header a.brand, footer a.brand, .project-panel .fern-emblem');
    if(!mark||event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    let saved={count:0,at:0};try{saved=JSON.parse(sessionStorage.getItem(key)||'{}');}catch{}
    const now=Date.now(),count=(now-(saved.at||0)>6000?0:(saved.count||0))+1;
    try{sessionStorage.setItem(key,JSON.stringify({count:count===7?0:count,at:now}));}catch{}
    if(count===7){event.preventDefault();bloom();}
    else if(location.pathname==='/'||location.pathname==='/index.html')event.preventDefault();
  });
})();
