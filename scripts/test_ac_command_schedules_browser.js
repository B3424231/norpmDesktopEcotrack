const assert=require('node:assert/strict'), path=require('node:path'), fs=require('node:fs');
const {chromium}=require(process.env.ECOTRACK_PLAYWRIGHT || 'playwright');
(async()=>{const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});try{

 // A registered device without an IR transmitter remains visible, but cannot schedule commands.
 {
  const page=await browser.newPage(); await page.setContent('<div id="manager"></div>');
  await page.evaluate(()=>{
   window.registered=[{id:'controller',pb_id:'controller',name:'AC device fixture',ac_name:'Aircon Matrix',device_mode:'both',cloud_state:{capabilities:{ir_transmitter:false}}}];
   window.eligible=[];window.calls=[];
   window.supabaseClient={rpc:async(name,args)=>{window.calls.push({name,args});return {data:{devices:window.eligible,schedules:[],automation:[],runs:[],health:{}}}}};
  });
  await page.addScriptTag({path:path.resolve('public/js/ac-command-schedules.js')});
  await page.evaluate(()=>window.manager=window.EcoTrackCommandSchedules.mountManager(document.getElementById('manager'),{roomId:'room-1',getRegisteredDevices:()=>window.registered}));
  await page.locator('#acs-binding').waitFor();
  assert.match(await page.locator('#acs-binding').innerText(),/AC device fixture.*IR transmitter unavailable/);
  assert.equal(await page.locator('#acs-binding').isDisabled(),true);
  assert.equal(await page.getByRole('button',{name:'Add schedule'}).isDisabled(),true);
  assert.match(await page.locator('.acs-empty').innerText(),/reports no IR transmitter/i);
  assert.doesNotMatch(await page.locator('#manager').innerText(),/No AC devices in this room/);
  await page.evaluate(()=>{window.registered[0].device_mode='monitoring';window.registered[0].cloud_state.capabilities.ir_transmitter=true;window.eligible=[{node_id:'controller',aircon_id:'ac',device_id:'hardware',room_id:'room-1',device_name:'AC device fixture'}];window.manager.setContext({roomId:'room-1'});});
  await page.waitForFunction(()=>document.getElementById('acs-binding')?.textContent.includes('Monitoring only'));
  assert.equal(await page.getByRole('button',{name:'Add schedule'}).isDisabled(),true,'Monitoring-only registrations cannot become command bindings');
  await page.evaluate(()=>{window.registered[0].device_mode='both';window.manager.setContext({roomId:'room-1'});});
  await page.waitForFunction(()=>!document.querySelector('[data-add]')?.disabled);
  assert.equal(await page.locator('#acs-binding option:enabled').count(),1,'A server-validated IR binding becomes selectable');
  await page.evaluate(()=>{window.registered=[];window.manager.setContext({roomId:'empty-room'});});
  await page.waitForFunction(()=>document.getElementById('acs-binding')?.textContent.includes('No AC devices in this room'));
  assert.equal(await page.getByRole('button',{name:'Add schedule'}).isDisabled(),true);
  assert.equal(await page.evaluate(()=>window.calls.some(call=>call.name!=='ecotrack_list_ac_command_schedules')),false,'Availability checks only read schedules');
  await page.close(); console.log('PASS registered IR-unavailable, monitoring-only, eligible and empty-room devices');
 }

 // Regression: a retained full-state temperature remains valid when fan mode does not expose a control.
 {
  const page=await browser.newPage(); await page.setContent('<div id="manager"></div>');
  await page.evaluate(()=>{window.saved=[];window.timers=[];window.setInterval=(fn,ms)=>{window.timers.push({fn,ms});return window.timers.length};window.clearInterval=()=>{};
   window.device={node_id:'n',aircon_id:'a',device_id:'d',room_id:'r',device_name:'Device',schedule_safe_absolute:{eco:true},profile:{desired_state:{mode:'fan',temp:24,fan:'auto',eco:'on'},capability_profile:{revision:1}}};
   window.tick=new Date(Date.now()-130000).toISOString();window.calls=[];
   window.supabaseClient={rpc:async(name,args)=>{window.calls.push({name,args});if(name==='ecotrack_list_ac_command_schedules')return {data:{devices:[window.device],schedules:window.saved,automation:[],runs:[{id:'old',schedule_id:'archived',node_id:'n',aircon_id:'a',room_id:'r',status:'sent',device_name:'Archived Device',scheduled_at:'2026-11-02T00:00:00Z'}],health:{available:true,last_tick_at:window.tick}}};if(name==='ecotrack_save_ac_command_schedule'){window.saved=[{...args.p_draft,id:'s',version:1}];return {data:window.saved[0]}};return {data:{ok:true}}}};
   window.EcoTrackAirconSystem={CapabilityEngine:{registry:{resolve:()=>({can_transmit:true,protocol:'P',modes:['fan','cool'],fan_map:{auto:0},features:{eco:true}}),data:{registry_version:'v'},range:(_,mode)=>({min:16,max:30,step:1,controllable:mode!=='fan'}),validateState:(_,state)=>({valid:state.temp===24,errors:[]})},getControlTemperatureRange:(_,mode)=>mode==='fan'?null:{values:[24]},validateControlTemperature:(_,n,mode)=>mode!=='fan'&&n===24}};
  });
  await page.addScriptTag({path:path.resolve('public/js/ac-command-schedules.js')});
  await page.evaluate(()=>window.manager=window.EcoTrackCommandSchedules.mountManager(document.getElementById('manager'),{roomId:'r',nodeId:'n'}));
  await page.getByRole('button',{name:'Add schedule'}).click();
  assert.equal(await page.locator('[data-special="eco"]').count(),1,'server safe metadata should expose known eco');
  assert.equal(await page.getByLabel('Enable schedule').isChecked(),false);
  await page.getByRole('link',{name:'Review device hours'}).waitFor();
  await page.getByText('Turn off',{exact:true}).click(); await page.getByRole('button',{name:'Save schedule'}).click();
  await page.waitForFunction(()=>window.saved.length===1,{timeout:2000});
  assert.equal(await page.evaluate(()=>window.saved[0].intent.state.temp),24);
  assert.equal(await page.evaluate(()=>window.saved[0].enabled),false);
  await page.evaluate(()=>{delete window.device.profile.desired_state.eco;window.device.wake_time='00:00';window.device.sleep_time='00:00';window.EcoTrackCommandSchedules.openEditor({binding:window.device});});
  assert.equal(await page.getByLabel('Enable schedule').isEnabled(),true);
  assert.equal(await page.locator('[data-special=eco]').inputValue(),'');
  await page.getByRole('button',{name:'Cancel'}).click();
  await page.locator('.acs-activity summary').click();
  await page.getByText(/Archived Device/).waitFor({timeout:2000});
  assert.match(await page.locator('.acs-health').innerText(),/unavailable/i);
  assert.ok(await page.evaluate(()=>window.timers.some(t=>t.ms<=60000)),'manager must poll');
  await page.evaluate(()=>{window.tick=new Date().toISOString();window.timers.find(t=>t.ms===30000).fn();});
  await page.waitForFunction(()=>document.querySelector('.acs-health')?.textContent==='UTC+08:00');
  await page.evaluate(()=>window.manager.setContext({roomId:'r'}));
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>window.calls.filter(x=>x.name==='ecotrack_list_ac_command_schedules').at(-1).args.p_node_id),'n');
  await page.close();
 }

 {
  const page=await browser.newPage(); await page.setContent('<div id="manager"></div>');
  await page.addScriptTag({path:path.resolve('public/js/aircon-system.js')});
  await page.evaluate(()=>{window.saved=[];window.supabaseClient={rpc:async(name,args)=>{if(name==='ecotrack_save_ac_command_schedule'){window.saved.push(args.p_draft);return {data:args.p_draft}};return {data:{devices:[],schedules:[],automation:[],runs:[],health:{}}}}};});
  await page.addScriptTag({path:path.resolve('public/js/ac-command-schedules.js')});
  await page.evaluate(()=>{window.EcoTrackCommandSchedules.openEditor({binding:{node_id:'n',aircon_id:'a',device_id:'d',device_name:'Real profile',wake_time:'00:00',sleep_time:'00:00',profile:{protocol_name:'GREE',desired_state:{mode:'fan',temp:24,fan:'auto'},capability_profile:{revision:0}}}});});
  await page.getByText('Turn off',{exact:true}).click();
  await page.getByRole('button',{name:'Save schedule'}).click();
  await page.waitForFunction(()=>window.saved.length===1,null,{timeout:2000});
  assert.equal(await page.evaluate(()=>window.saved[0].intent.state.temp),24);
  console.log('PASS real GREE fan-mode off'); await page.close();
 }

 {
  const page=await browser.newPage();await page.route('http://fixture.local/**',route=>route.fulfill({body:'<html><body></body></html>',contentType:'text/html'}));
  await page.goto('http://fixture.local/scheduler.html?view=commands&node=linked-node&schedule=linked-schedule');
  await page.setContent('<div class="acs-tabs"><button id="acs-hours-tab" role="tab">Device hours</button><button id="acs-commands-tab" role="tab">Command schedules</button></div><div id="roomsList"></div><div id="acs-hours"></div><div id="acs-commands"></div>');
  await page.evaluate(()=>{window.selectedRoomId='other-room';window.calls=[];window.supabaseClient={rpc:async(name,args)=>{window.calls.push(args);return {data:{devices:[{node_id:'linked-node',aircon_id:'a',device_id:'d',room_id:'target-room',device_name:'Linked Device',profile:{}}],schedules:[{id:'linked-schedule',node_id:'linked-node',aircon_id:'a',weekdays:[1],local_time:'08:00',action:'turn_off',intent:{state:{}}}],automation:[],runs:[],health:{}}}}};});
  await page.addScriptTag({path:path.resolve('public/js/ac-command-schedules.js')});
  await page.getByRole('dialog').waitFor({timeout:2000});assert.match(await page.getByRole('dialog').innerText(),/Linked Device/);
  await page.getByRole('button',{name:'Close'}).click();await page.evaluate(()=>window.selectedRoomId='restored-room');
  await page.waitForTimeout(500);assert.equal(await page.evaluate(()=>window.calls.at(-1).p_node_id),'linked-node');
  console.log('PASS deep link survives room restoration');await page.close();
 }

 {
  const page=await browser.newPage();await page.setContent('<div></div>');
  await page.addScriptTag({path:path.resolve('public/js/aircon-system.js')});
  await page.evaluate(()=>{window.saved=[];window.supabaseClient={rpc:async(_,args)=>{window.saved.push(args.p_draft);return {data:args.p_draft}}};window.binding={node_id:'n',aircon_id:'a',device_id:'d',device_name:'TCL',wake_time:'00:00',sleep_time:'00:00',schedule_safe_absolute:{eco:true,swing_vertical:true},profile:{protocol_name:'TCL112AC',desired_state:{eco:null},capability_profile:{revision:0}},cloud_state:{latest_ir:{state:{mode:'cool',temp:24,fan:'auto',eco:'on',swing_vertical:'off'}}}};});
  await page.addScriptTag({path:path.resolve('public/js/ac-command-schedules.js')});
  await page.evaluate(()=>{window.EcoTrackCommandSchedules.openEditor({binding:window.binding});});
  assert.equal(await page.locator('[name=mode]').inputValue(),'cool');
  assert.equal(await page.locator('[name=temp]').inputValue(),'24');
  assert.equal(await page.locator('[data-special=eco]').inputValue(),'on');
  assert.equal(await page.locator('[data-special=swing_vertical]').inputValue(),'off');
  await page.getByRole('button',{name:'Save schedule'}).click();await page.waitForFunction(()=>window.saved.length===1,null,{timeout:2000});
  await page.evaluate(()=>{delete window.binding.cloud_state.latest_ir.state.eco;window.EcoTrackCommandSchedules.openEditor({binding:window.binding});});
  assert.equal(await page.locator('[data-special=eco]').inputValue(),'');
  assert.equal(await page.getByLabel('Enable schedule').isEnabled(),true);
  await page.getByRole('button',{name:'Save schedule'}).click();
  assert.equal(await page.evaluate(()=>window.saved.length),1);
  await page.locator('[data-special=eco]').selectOption('off');
  await page.getByRole('button',{name:'Save schedule'}).click();await page.waitForFunction(()=>window.saved.length===2,null,{timeout:2000});
  await page.evaluate(()=>{window.EcoTrackCommandSchedules.openEditor({binding:window.binding});});
  await page.getByLabel('Enable schedule').uncheck();await page.getByRole('button',{name:'Save schedule'}).click();await page.waitForFunction(()=>window.saved.length===3,null,{timeout:2000});
  assert.equal(await page.evaluate(()=>Object.hasOwn(window.saved[2].intent.state,'eco')),false);
  assert.equal(await page.evaluate(()=>window.saved[2].enabled),false);
  await page.evaluate(()=>{window.EcoTrackCommandSchedules.openEditor({binding:window.binding});});
  await page.getByText('Turn off',{exact:true}).click();await page.getByRole('button',{name:'Save schedule'}).click();await page.waitForFunction(()=>window.saved.length===4,null,{timeout:2000});
  assert.equal(await page.evaluate(()=>Object.hasOwn(window.saved[3].intent.state,'swing_vertical')),false);
  assert.equal(await page.evaluate(()=>window.saved[3].enabled),true);
  console.log('PASS real TCL receiver, unknown specials, disabled draft and off');await page.close();
 }
 for(const width of [1460,390]) for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width,height:900}});
  await page.setContent(`<html class="${theme}"><body><div id="manager"></div></body></html>`);
  await page.addStyleTag({path:path.resolve('public/css/ac-command-schedules.css')});
  await page.evaluate(()=>{
   window.saved=[];window.dispatches=[];window.autoEnabled=true;
   const device={node_id:'node-1',aircon_id:'ac-1',device_id:'hw-1',room_id:'room-1',device_name:'Fixture Controller',aircon_name:'Fixture AC',profile:{desired_state:{mode:'cool',temp:24,fan:'auto'},capability_profile:{revision:1}}};
   window.supabaseClient={rpc:async(name,args)=>{if(name==='ecotrack_list_ac_command_schedules')return {data:{devices:[device],schedules:window.saved,automation:[{node_id:'node-1',aircon_id:'ac-1',enabled:window.autoEnabled,version:1}],runs:[],health:{available:true,last_tick_at:new Date().toISOString()}}};if(name==='ecotrack_save_ac_command_schedule'){const row={...args.p_draft,id:'schedule-1',version:1};window.saved=[row];return {data:row};}if(name==='ecotrack_set_ac_automation'){window.autoEnabled=args.p_enabled;return {data:{enabled:args.p_enabled}};}return {data:{ok:true}};}};
   const resolved={can_transmit:true,protocol:'FIXTURE',remote_model:null,modes:['cool'],fan_map:{auto:0},features:{}};
   window.EcoTrackAirconSystem={CapabilityEngine:{registry:{resolve:()=>resolved,validateState:()=>({valid:true}),data:{registry_version:'fixture'}},getControlTemperatureRange:()=>({values:[23,24,25]}),validateControlTemperature:(_,n)=>[23,24,25].includes(n)}};
  });
  await page.addScriptTag({path:path.resolve('public/js/ac-command-schedules.js')});
  await page.evaluate(()=>window.manager=window.EcoTrackCommandSchedules.mountManager(document.getElementById('manager'),{roomId:'room-1'}));
  await page.getByRole('button',{name:'Add schedule'}).click();
  assert.equal(await page.locator('[data-special-functions]').evaluate(e=>e.open),false);
  await page.getByText('Turn off',{exact:true}).click(); assert.equal(await page.locator('[data-settings]').isVisible(),false);
  await page.getByText('Turn on',{exact:true}).click();
  await page.getByRole('button',{name:'Save schedule'}).click();
  await page.getByRole('cell',{name:'Fixture Controller Fixture AC'}).waitFor();
  assert.equal(await page.evaluate(()=>window.saved.length),1);assert.equal(await page.evaluate(()=>window.dispatches.length),0);
  await page.getByLabel('Automation for Fixture Controller').uncheck();
  assert.equal(await page.evaluate(()=>window.dispatches.length),0);
  await page.evaluate(()=>window.manager.setContext({roomId:'empty-room'}));
  await page.getByText('Select a room with a controllable AC device.',{exact:false}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Add schedule'}).isDisabled(),true);
  console.log(`PASS ${theme} ${width}`);await page.close();
 }
 const page=await browser.newPage();
 const html=fs.readFileSync('public/scheduler.html','utf8');
 const tabMarkup=html.match(/<div class="acs-tabs"[\s\S]*?<p id="schedulerScrollHint"/)[0].replace('<p id="schedulerScrollHint"','<input id="hours-draft" value="draft"><p id="schedulerScrollHint"');
 await page.setContent(tabMarkup+'</p></div><div id="acs-commands" class="acs-panel" hidden></div>');
 await page.evaluate(()=>{window.supabaseClient={rpc:async()=>({data:{devices:[],schedules:[],automation:[],runs:[],health:{}}})};});
 await page.addScriptTag({path:path.resolve('public/js/ac-command-schedules.js')});
 await page.getByRole('tab',{name:'Command schedules'}).click();
 await page.getByRole('tab',{name:'Device hours'}).click();
 assert.equal(await page.locator('#hours-draft').inputValue(),'draft');
 console.log('PASS page tab draft preservation'); await page.close();
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
