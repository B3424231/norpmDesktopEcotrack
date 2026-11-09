'use strict';
// Actual repair renderer, isolated read/write acknowledgments, blocked external traffic.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/reygay/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..'),pub=path.join(root,'public'),out=path.join(root,'reports/maintenance-repair-20261104/browser');
const source=fs.readFileSync(path.join(pub,'js/maintenance-modal.js'),'utf8').replace(/\r\n/g,'\n');
function part(a,b){const start=source.indexOf(a),end=source.indexOf(b,start+a.length);assert(start>=0&&end>start,a);return source.slice(start,end);}
const code=part('  function isReportSubmittedForVerification(','  function normalizeReport(')+part('  function isRepairReportDone(','  function resolvePhotoUrl(')+part('  function maintenanceDisplayText(','  function maintenanceStateClasses(')+part('  function renderRepDetailModalContent(','  function renderReworkDetailModalContent(');
let server,browser;
(async()=>{
 fs.mkdirSync(out,{recursive:true});server=http.createServer((req,res)=>{if(req.url==='/fixture.html'){res.setHeader('Content-Type','text/html');return res.end('<!doctype html><html><body></body></html>');}const file=path.resolve(pub,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(pub+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.png':'image/png','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const checks=[];
 for(const theme of ['light','dark'])for(const width of [320,768,1024,1440]){
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.request().url().startsWith(base+'/')?r.continue():r.abort());
  await page.setContent(`<!doctype html><html class="${theme==='dark'?'dark':''}"><head><base href="${base}/"><script src="vendor/tailwindcss.js"></script><script>tailwind.config={darkMode:'class'}</script><link rel="stylesheet" href="styles.css"></head><body class="app-shell" style="padding:12px;display:flex;justify-content:center"><div id="dialog"><div id="ecoDetailModalHeader"></div><div id="ecoDetailModalBody" style="overflow:auto"></div></div></body></html>`);
  await page.addScriptTag({url:base+'/js/device-labels.js'});
  await page.addScriptTag({content:code+`
   window.EcoTrackMode={mode:'both'};window.EcoTrackAirconSystem={AirconProfileManager:{getAll:()=>[]}};
   const aircon={id:'asset',nodeId:'node',nodeName:'AC device 04A7AC',airconType:'Window Type (Inverter)',building:'IC building',floor:'Floor 1',room:'Room 1'};
   const fixture={id:'REP-7912',status:'In Progress',parentReportId:'MR-2026-001',staffName:'Rey O. Solamillo',dueDate:'2026-11-04',description:'Inspect the attachment',tasks:['Safety Isolation & Electrical Power Lockout','Diagnostic Inspection & Defect Root-Cause Confirmation','Execute Repair, Part Replacement, or Component Overhaul','System Reassembly, Functional Test, and Telemetry Validation'].map((name,i)=>({id:String(i+1),name,status:'Completed'}))};
   let writes=0,failSave=false,itemOpened=0;const notices=[];
   const getReports=()=>[fixture],getAirconsDatabase=()=>[aircon],findReportById=(rows,id)=>rows.find(r=>r.id===id),resolvePhotoUrl=x=>x;
   const closeDetailModal=()=>{},openDetailModal=()=>{},openChecklistItemModal=()=>{itemOpened++;},cycleRepairStepStatus=()=>{},openImageLightbox=()=>{},refreshPageReportsView=()=>{},showToast=(...x)=>notices.push(x);
   const saveReports=async(rows,updated)=>{writes++;await new Promise(r=>setTimeout(r,20));if(failSave)throw Error('Fixture conflict');Object.assign(fixture,updated);};
   const renderDetailModalContent=()=>renderRepDetailModalContent(fixture,aircon);
   renderDetailModalContent();
  `});
  await page.getByText('Ready to submit',{exact:true}).first().waitFor();assert.equal(await page.locator('#btnVerifyRepOrder').count(),0);
  assert.equal(await page.locator('.eco-repair-step').count(),4);
  assert(await page.locator('.eco-repair-step-copy strong').first().evaluate(el=>getComputedStyle(el).textDecorationLine==='none'));
  assert(await page.locator('.eco-repair-progress>div').evaluate(el=>Math.abs(el.getBoundingClientRect().width-el.parentElement.getBoundingClientRect().width)<1));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await page.locator('.eco-repair-step').first().focus();await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>itemOpened),1);
  await page.evaluate(()=>{fixture.status='For Verification';renderDetailModalContent();});await page.getByRole('button',{name:'Verify repair',exact:true}).waitFor();
  assert(await page.locator('.btn-rep-cycle-step').first().isDisabled());
  await page.screenshot({path:path.join(out,`repair-${theme}-${width}.png`)});
  await page.evaluate(()=>{failSave=true;});await page.locator('#btnVerifyRepOrder').click();await page.waitForFunction(()=>!document.querySelector('#btnVerifyRepOrder').disabled);
  assert.equal(await page.evaluate(()=>fixture.status),'For Verification');assert.equal(await page.evaluate(()=>notices.length),0);
  await page.evaluate(()=>{failSave=false;});await page.locator('#btnVerifyRepOrder').dblclick();await page.getByText('Repair approved by administrator.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>writes),2);
  assert.deepEqual(errors,[]);checks.push({theme,width,status:'PASS',phases:true,failedApprovalRetained:true,singleApproval:true,keyboard:true});await page.close();
 }
 // Full module/public API: rendering a parent must preserve a submitted child's phase.
 for(const state of ['For Verification','Completed']){
  const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.request().url().startsWith(base+'/')?r.continue():r.abort());
  await page.goto(base+'/fixture.html');await page.setContent(`<html class="dark"><head><base href="${base}/"><script src="vendor/tailwindcss.js"></script><script>tailwind.config={darkMode:'class'}</script><link rel="stylesheet" href="styles.css"></head><body class="app-shell"></body></html>`);
  await page.evaluate(childState=>{
   const parent={id:'MR-2026-001',status:'In Progress',type:'Control Inspection',airconId:'unit',staffName:'Fixture technician',tasks:[{id:'1',name:'Attachment inspection',status:'Under Repair',linkedRepairId:'REP-7912'}]};
   const child={id:'REP-7912',status:childState,type:'Corrective Repair',airconId:'unit',parentReportId:parent.id,parentTaskId:'1',tasks:[{id:'step',name:'Repair work',status:'Completed'}]};
   localStorage.setItem('ecoTrack_maintenance_reports',JSON.stringify([parent,child]));
   window.EcoTrackMode={mode:'both'};
  },state);
  await page.addScriptTag({url:base+'/js/device-labels.js'});await page.addScriptTag({url:base+'/js/maintenance-modal.js'});
  await page.evaluate(()=>window.EcoTrackMaintenance.openDetailModal('MR-2026-001'));
  await page.locator('#ecoDetailModalBody').waitFor();
  const text=await page.locator('#ecoDetailModalBody').innerText();
  if(state==='For Verification'){
   assert(!text.includes('ALREADY REPAIRED'));assert(text.includes('Repair for verification'));
   const item=await page.evaluate(()=>window.EcoTrackMaintenance.getReports().find(r=>r.id==='MR-2026-001').tasks[0]);assert.equal(item.status,'For Verification');assert.equal(item.repaired,false);
  }else{
   assert((await page.locator('#ecoDetailModalHeader').innerText()).includes('Ready to submit'));
   assert.equal(await page.evaluate(()=>window.EcoTrackMaintenance.getReports().find(r=>r.id==='MR-2026-001').status),'In Progress');
  }
  assert.deepEqual(errors,[]);await page.screenshot({path:path.join(out,'parent-'+state.replaceAll(' ','-')+'.png')});checks.push({parentChildState:state,fullPublicApi:true,status:'PASS'});await page.close();
 }
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({status:'PASS',checks,liveWrites:false},null,2));console.log('PASS '+checks.length+' actual repair UI/lifecycle scenarios');
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(async()=>{await browser?.close();server?.close();});
