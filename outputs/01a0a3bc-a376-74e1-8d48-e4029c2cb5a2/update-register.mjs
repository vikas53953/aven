import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {FileBlob, SpreadsheetFile} from '@oai/artifact-tool';

const dir=fileURLToPath(new URL('.',import.meta.url));
const file=dir+'Aven-UI-UX-Feature-Register.xlsx';
const changes=JSON.parse(await fs.readFile(dir+'register-updates.json','utf8'));
const wb=await SpreadsheetFile.importXlsx(await FileBlob.load(file));
const sheet=wb.worksheets.getItem('Feature register');
const before=await wb.render({sheetName:sheet.name,range:'A10:E17',scale:1,format:'png'});
await fs.writeFile(dir+'register-before-update.png',new Uint8Array(await before.arrayBuffer()));
await fs.copyFile(file,dir+'register-backup-'+Date.now()+'.xlsx');
const ids=sheet.getRange('A11:A125').values.flat();
const heading=String(sheet.getRange('A3').values[0][0]);
if(heading.includes('Current Aven: ux-pipeline-v6.'))sheet.getRange('A3').values=[[heading.replace('Current Aven: ux-pipeline-v6.','Current Aven: ux-pipeline-v7.')]];
if(String(sheet.getRange('A7').values[0][0]).startsWith('All comparison-driven')){
 sheet.getRange('A7').values=[['Implementation pipeline active: fix Needs fix first, then Missing and Partial by dependency. Verified means tested; owner acceptance is separate.']];
}
if(!sheet.getRange('N8').values[0][0]||sheet.getRange('N8').values[0][0]==='Verified'){
 sheet.getRange('N8').values=[['Verified']];
 sheet.getRange('O8').formulas=[['=COUNTIFS(N11:N125,"Verified")']];
}
for(const change of changes){
 const i=ids.indexOf(change.id);
 if(i<0)throw Error('Unknown feature '+change.id);
 const row=i+11;
 for(const [col,value] of Object.entries(change.cells)){
  if(!['D','E','I','K','L','N','O','P'].includes(col))throw Error('Unexpected column '+col);
  sheet.getRange(col+row).values=[[value]];
 }
}
const widths=[10,15,30,17,49,36,36,36,58,10,19,41,65,18,16,46];
for(let row=11;row<=125;row++){
 if(!['Verified','Implemented'].includes(sheet.getRange('N'+row).values[0][0]))continue;
 const values=sheet.getRange('A'+row+':P'+row).values[0];
 const lines=Math.max(...values.map((v,j)=>String(v).split('\n').reduce((sum,line)=>sum+Math.max(1,Math.ceil(line.length/(widths[j]*0.75))),0)));
 sheet.getRange('A'+row+':P'+row).format.rowHeight=Math.max(70,lines*15+12);
}
wb.recalculate();
await (await SpreadsheetFile.exportXlsx(wb)).save(file);
const after=await wb.render({sheetName:sheet.name,range:'I10:P17',scale:1,format:'png'});
await fs.writeFile(dir+'register-progress.png',new Uint8Array(await after.arrayBuffer()));
console.log(JSON.stringify({updated:changes.map(x=>x.id),file}));
