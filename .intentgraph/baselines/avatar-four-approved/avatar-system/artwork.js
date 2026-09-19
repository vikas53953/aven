/* Authorized vector recreation of the supplied raster. Pending owner visual approval.
   One geometry source for standalone SVG, browser preview and React components. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.NetworkCoworkerArt=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const roles=['cloud','router','firewall','switch'];
  const tokens={amber:'#FAAE54',face:'#16302C',viewBox:'0 0 100 100',sizes:[24,48,96],states:['idle','hover','listening','thinking','success']};
  // Soft rounded feet, pill eyes and an open curved smile are shared family geometry.
  const paths={
    cloud:{body:'<path d="M25 75C13 75 6 67 6 57S14 40 25 40h2C29 28 38 21 50 21s22 8 24 20c12-1 20 7 20 17s-8 17-20 17Z"/>',appendages:'',feet:'M39 75v9m22-9v9',eyesY:46,mouthY:61},
    router:{body:'<path d="M32 34h36c8 0 13 6 15 14l3 13c3 10-2 17-12 17H26c-10 0-15-7-12-17l3-13c2-8 7-14 15-14Z"/>',appendages:'<path class="cw-antenna left" d="m33 35-6-19"/><path class="cw-antenna right" d="m67 35 6-19"/>',feet:'M38 78v8m24-8v8',eyesY:44,mouthY:60,detail:'<circle cx="36" cy="70" r="2"/><circle cx="50" cy="71" r="2"/><circle cx="64" cy="70" r="2"/>'},
    firewall:{body:'<path d="m25 27 22-8a10 10 0 0 1 6 0l22 8q5 2 5 7v15c0 19-11 29-30 37-19-8-30-18-30-37V34q0-5 5-7Z"/>',appendages:'',feet:'M40 79v8m20-8v8',eyesY:43,mouthY:59,brows:'<path d="M36 36h8m12 0h8"/>'},
    switch:{body:'<path d="M29 27h42l12 11v27q0 8-8 8H25q-8 0-8-8V38Z"/>',appendages:'<path d="M17 45H10v10h7m66-10h7v10h-7" stroke-linejoin="round"/>',feet:'M39 74v12m22-12v12',eyesY:37,mouthY:53,detail:'<rect x="24" y="63" width="8" height="5" rx="2"/><rect x="36" y="63" width="8" height="5" rx="2"/><rect x="48" y="63" width="8" height="5" rx="2"/><rect x="60" y="63" width="8" height="5" rx="2"/><rect x="72" y="63" width="5" height="5" rx="2"/>'}
  };
  function inner(role,size=96){
    if(!roles.includes(role))throw new Error('Unknown coworker role: '+role);
    const p=paths[role],y=p.eyesY,m=p.mouthY;
    return `<g data-part="character" class="cw-character" fill="${tokens.amber}" stroke-linecap="round" stroke-linejoin="round"><g data-part="feet" stroke="${tokens.amber}" stroke-width="5.5" fill="none"><path d="${p.feet}"/></g><g data-part="appendages" class="cw-appendages" fill="${tokens.amber}" stroke="${tokens.amber}" stroke-width="5.5">${p.appendages}</g><g data-part="body">${p.body}</g><g data-part="details" fill="${tokens.face}"${Number(size)<=24?' display="none"':''}>${p.detail||''}</g><g data-part="eyebrows" fill="none" stroke="${tokens.face}" stroke-width="3.2">${p.brows||''}</g><g data-part="eyes" class="cw-eyes" fill="${tokens.face}"><g class="cw-open-eyes"><rect x="39" y="${y}" width="6.5" height="10" rx="3.25"/><rect x="55" y="${y}" width="6.5" height="10" rx="3.25"/></g><g class="cw-happy-eyes" fill="none" stroke="${tokens.face}" stroke-width="3"><path d="M38 ${y+7}q4-8 9 0m7 0q4-8 9 0"/></g></g><g data-part="mouth" class="cw-mouth" fill="none" stroke="${tokens.face}" stroke-width="3.2"><path class="cw-smile" d="M44 ${m}q6 6 12 0"/><path class="cw-big-smile" d="M42 ${m-1}q8 10 16 0"/></g></g>`;
  }
  function svg(role,size=96){const n=Number(size);if(!Number.isFinite(n)||n<1)throw new Error('Invalid size');return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${tokens.viewBox}" width="${n}" height="${n}" class="cw-avatar" data-role="${role}" aria-hidden="true"><style>.cw-happy-eyes,.cw-big-smile{display:none}</style>${inner(role,n)}</svg>`;}
  return {roles,tokens,inner,svg};
});
