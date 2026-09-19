function renderTechnicalAtlas(data) {
  const make=(tag,text,cls)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e;};
  const root=document.getElementById('technical-atlas');
  root.append(make('div','Architecture workshop · '+data.revision,'eyebrow'),make('h2','From source code to customer deployment'),make('p','Choose a topic. Current behavior is verified from source; production recommendations and the BGP example are proposed.'));
  const nav=make('div',null,'topic-nav');nav.setAttribute('role','group');nav.setAttribute('aria-label','Architecture topics');root.append(nav);
  const panels=[];
  for(const [i,section] of data.sections.entries()) {
    const button=make('button',section.title);button.type='button';button.setAttribute('aria-pressed',String(i===0));button.setAttribute('aria-controls','topic-'+section.id);nav.append(button);
    const panel=make('section',null,'topic-panel');panel.id='topic-'+section.id;panel.hidden=i!==0;panel.append(make('h2',section.title),make('p',section.lead,'topic-lead'));
    if(section.id==='production') {
      panel.append(make('div','Proposed topology · nothing in this box is a deployment claim','eyebrow'));
      const flow=make('div',null,'trust-flow');
      data.productionFlow.forEach(([title,body])=>{const card=make('div',null,'trust-card');card.append(make('b',title),make('p',body));flow.append(card);});panel.append(flow);
    }
    if(section.id==='intent') {
      const ribbon=make('div',null,'intent-ribbon');
      ['Your request','Visible interpretation','Scoped context','Model selects tool','Actual evidence','Review or continue'].forEach((text,i)=>{const tile=make('span',(i+1)+'. '+text);ribbon.append(tile);});panel.append(ribbon);
    }
    for(const [title,body] of section.items) {const item=make('details'),summary=make('summary',title);item.append(summary,make('p',body));panel.append(item);}
    const expand=make('button','Expand all in this topic');expand.type='button';expand.onclick=()=>{const items=[...panel.querySelectorAll('details')],open=items.some(d=>!d.open);items.forEach(d=>d.open=open);expand.textContent=open?'Collapse all in this topic':'Expand all in this topic';};panel.append(expand);
    root.append(panel);panels.push(panel);
    button.onclick=()=>{panels.forEach(p=>p.hidden=p!==panel);[...nav.children].forEach(b=>b.setAttribute('aria-pressed',String(b===button)));};
  }
}
