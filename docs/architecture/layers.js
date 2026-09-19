function renderLayerBlueprint(data){
 const host=document.getElementById('layer-blueprint');if(!data.blueprint)return;
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
 host.append(el('div','Aven · reference-aligned architecture','eyebrow'),el('h2','Your network coworker, layer by layer'),el('p','Adapted from your Netrok architecture. Each block separates current implementation from future integrations.'));
 const grid=el('div',null,'blueprint-grid');host.append(grid);
 const side=(title,items)=>{const s=el('aside',null,'blueprint-side');s.append(el('h3',title));items.forEach(t=>s.append(el('p',t)));return s;};
 grid.append(side('Enterprise foundations',data.blueprint.foundations));const center=el('div',null,'blueprint-center');grid.append(center);
 data.blueprint.bands.forEach((band,i)=>{const section=el('section',null,'blueprint-band band-'+i);section.append(el('h3',band.name));const row=el('div',null,'blueprint-cells');for(const [title,status,body] of band.items){const card=el('details');card.append(el('summary',title+' · '+status),el('p',body));row.append(card);}section.append(row);center.append(section);if(i<data.blueprint.bands.length-1)center.append(el('div','↕ requests, events and evidence','arrow'));});grid.append(side('External ecosystem',data.blueprint.ecosystem));
 const roadmap=el('div',null,'roadmap');host.append(el('h3','Delivery order'),roadmap);data.blueprint.milestones.forEach(([title,status,body])=>{const r=el('div',null,'trust-card');r.append(el('b',title+' · '+status),el('p',body));roadmap.append(r);});
}
