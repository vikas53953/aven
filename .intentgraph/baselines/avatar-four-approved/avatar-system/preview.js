(() => {
  const art=NetworkCoworkerArt,$=id=>document.getElementById(id),name=role=>role[0].toUpperCase()+role.slice(1);
  for(const role of art.roles){$('gallery').insertAdjacentHTML('beforeend',`<div class="tile">${art.svg(role)}<h3>${name(role)}</h3></div>`);$('sizes').insertAdjacentHTML('beforeend',`<div class="size-row"><span>${name(role)}</span>${art.tokens.sizes.map(size=>art.svg(role,size)).join('')}</div>`);const button=document.createElement('button');button.textContent=name(role);button.dataset.role=role;button.onclick=()=>{selected=role;state='idle';temporary=false;clearTimeout(timer);render();};$('roles').append(button);}
  let selected='cloud',state='idle',temporary=false,timer,visible=true;
  const media=matchMedia('(prefers-reduced-motion: reduce)');
  for(const emotion of art.tokens.states){const button=document.createElement('button');button.textContent=name(emotion);button.dataset.emotionChoice=emotion;button.onclick=()=>selectState(emotion);$('emotions').append(button);}
  function selectState(value){clearTimeout(timer);temporary=false;state=value;render();if(value==='success')timer=setTimeout(()=>{state='idle';render();},1100);}
  function render(){const current=temporary?'hover':state;$('active-art').innerHTML=art.svg(selected);$('active-art').dataset.emotion=current;$('active-art').className=$('animation').checked&&!media.matches&&!document.hidden&&visible?'motion-active':'';$('stage').setAttribute('aria-label',`${name(selected)} expression preview. Hover or focus for a friendly response.`);$('character-name').textContent=name(selected);$('state-label').textContent=`${name(current)} expression`;$('motion-note').textContent=media.matches?'Reduced motion is active. Expressions remain still.':!$('animation').checked?'Animation is off. Expressions remain still.':'Only this preview moves. Hover or focus to greet; Success returns to idle.';document.querySelectorAll('[data-role]').forEach(b=>{if(b.tagName==='BUTTON')b.setAttribute('aria-pressed',String(b.dataset.role===selected));});document.querySelectorAll('[data-emotion-choice]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.emotionChoice===state)));}
  const greet=()=>{if(state==='idle'){temporary=true;render();}},leave=()=>{temporary=false;render();};
  $('stage').onpointerenter=greet;$('stage').onpointerleave=leave;$('stage').onfocus=greet;$('stage').onblur=leave;$('stage').onclick=()=>selectState('hover');
  $('animation').onchange=render;media.addEventListener('change',render);document.addEventListener('visibilitychange',render);
  new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;render();}).observe($('stage'));
  render();
})();
