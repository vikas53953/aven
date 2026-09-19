/* Original network mascots. Generated locally; no remote image service. */
(() => {
  const styles=['router','switch','firewall','mesh','cloud','rack','wireless','fiber'];
  const colors=['#45c9b0','#69a9f4','#a387ed','#ec709b','#f4a754','#ec6a58','#c5d46a','#a8b9c8'];
  const hash=text=>[...String(text)].reduce((n,c)=>(Math.imul(n,31)+c.charCodeAt(0))>>>0,7);
  function config(agent={}) {
    const seed=hash(agent.id||agent.name||'companion'),a=agent.avatar||{};
    return {style:styles.includes(a.style)?a.style:styles[seed%styles.length],color:/^#[0-9a-f]{6}$/i.test(a.color||'')?a.color:colors[seed%colors.length],seed:Number(a.seed)||0,image:/^data:image\/(png|jpeg|webp);base64,/.test(a.image||'')?a.image:''};
  }
  function svg(a) {
    const shapes={
      router:'<path d="M27 36 21 15M73 36l6-21" stroke-width="6"/><rect x="13" y="32" width="74" height="48" rx="18"/><path d="M29 69h9m8 0h9m8 0h9" stroke="#17292c" stroke-width="4"/>',
      switch:'<path d="m20 24 60 0 10 15v38H10V39Z" stroke-linejoin="round"/><path d="M25 67h7m8 0h7m8 0h7m8 0h7" stroke="#17292c" stroke-width="6"/>',
      firewall:'<path d="M50 9 84 23v30c0 19-15 31-34 39C31 84 16 72 16 53V23Z"/><path d="M28 65h44M34 74h32M39 65v9m22-9v9" stroke="#17292c" stroke-width="3"/>',
      mesh:'<path d="m50 14 30 18v36L50 86 20 68V32Z"/><path d="M21 32 8 24m71 8 13-8M21 68 8 78m71-10 13 10" fill="none" stroke-width="4"/><g stroke="none"><circle cx="8" cy="22" r="6"/><circle cx="92" cy="22" r="6"/><circle cx="8" cy="80" r="6"/><circle cx="92" cy="80" r="6"/></g>',
      cloud:'<path d="M25 78C1 78 1 40 23 39 24 15 57 9 70 32 99 27 109 72 78 78Z"/><path d="M36 79v9m28-9v9" fill="none" stroke-width="5"/>',
      rack:'<rect x="21" y="10" width="58" height="81" rx="16"/><path d="M30 65h40m-40 13h40" stroke="#17292c" stroke-width="3"/><circle cx="64" cy="70" r="2" fill="#17292c" stroke="none"/>',
      wireless:'<rect x="20" y="34" width="60" height="51" rx="24"/><path d="M35 24q15-13 30 0M25 13q25-19 50 0" stroke-width="5" fill="none"/><path d="M44 74h12" stroke="#17292c" stroke-width="4"/>',
      fiber:'<rect x="16" y="27" width="68" height="54" rx="26"/><path d="M34 27V16m16 11V8m16 19V16" fill="none" stroke-width="4"/><circle cx="34" cy="13" r="5"/><circle cx="50" cy="7" r="5"/><circle cx="66" cy="13" r="5"/><path d="M30 68q20 8 40 0" stroke="#17292c" stroke-width="3" fill="none"/>'
    };
    const shift=(a.seed%3)-1;
    return `<svg viewBox="0 0 100 100" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><g fill="${a.color}" stroke="${a.color}" stroke-linecap="round" stroke-width="2">${shapes[a.style]}</g><g fill="#17292c" transform="translate(${shift} 0)"><rect x="36" y="44" width="7" height="12" rx="3.5"/><rect x="57" y="44" width="7" height="12" rx="3.5"/></g></svg>`;
  }
  function make(size='small',agent={}) {
    const a=config(agent),node=document.createElement('span');node.className=`network-avatar avatar-${size}`;node.setAttribute('aria-hidden','true');
    if(a.image){const img=document.createElement('img');img.src=a.image;img.alt='';node.append(img);}else node.innerHTML=svg(a);
    return node;
  }
  function generate(prompt,previous={}) {
    const seed=hash(prompt+' '+Date.now()),name=styles.find(s=>prompt.toLowerCase().includes(s));
    return {style:name||styles[seed%styles.length],color:colors[(seed>>>5)%colors.length],seed,image:''};
  }
  async function upload(file) {
    if(!file||!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('Choose a PNG, JPEG or WebP image.');
    if(file.size>2*1024*1024)throw Error('Choose an image smaller than 2 MB.');
    const bitmap=await createImageBitmap(file).catch(()=>{throw Error('This image could not be read. Try another file.');});
    const canvas=document.createElement('canvas');canvas.width=canvas.height=192;const ctx=canvas.getContext('2d');const scale=Math.max(192/bitmap.width,192/bitmap.height),w=bitmap.width*scale,h=bitmap.height*scale;ctx.drawImage(bitmap,(192-w)/2,(192-h)/2,w,h);bitmap.close();return canvas.toDataURL('image/webp',.86);
  }
  window.AvenAvatars={styles,colors,config,make,generate,upload};
})();
