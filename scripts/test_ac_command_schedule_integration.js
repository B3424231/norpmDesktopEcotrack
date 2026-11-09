'use strict';
// Isolated browser -> actual PostgreSQL RPCs -> worker -> notification UI.
// No account, network service, AC or live database is used.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.ECOTRACK_PLAYWRIGHT || 'playwright');
const {openScheduleDb}=require('./helpers/ac-command-schedule-db');
const root=path.resolve(__dirname,'..'),out=path.join(root,'reports/ac-command-schedules/browser');
(async()=>{
 const f=await openScheduleDb();let browser,server;
 try{
  fs.mkdirSync(out,{recursive:true});
  await f.rows("UPDATE ecotrack_device_state SET latest_ir=jsonb_set(latest_ir,'{state}',(latest_ir->'state') || $1::jsonb)",[f.draft().intent.state]);
  server=http.createServer((_,res)=>res.end('<!doctype html><html><head></head><body></body></html>'));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const page=await browser.newPage({viewport:{width:1460,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.exposeBinding('scheduleRpc',async(_,name,args)=>{
   try{return {data:await f.rpc(name,args),error:null};}catch(e){return {data:null,error:{message:e.message}}}
  });
  await page.goto(origin+'/scheduler.html?view=commands&node=node-1&room=room-1');
  await page.setContent('<html class="dark"><head></head><body class="app-shell"><main style="padding:32px"><h1>Command schedules — isolated verification</h1><div id="manager" class="acs-panel"></div></main></body></html>');
  await page.addStyleTag({path:path.join(root,'public/styles.css')});
  await page.addStyleTag({path:path.join(root,'public/css/ac-command-schedules.css')});
  await page.addScriptTag({path:path.join(root,'public/js/aircon-system.js')});
  await page.evaluate(()=>{window.supabaseClient={rpc:(name,args)=>window.scheduleRpc(name,args)};});
  await page.addScriptTag({path:path.join(root,'public/js/ac-command-schedules.js')});
  await page.evaluate(()=>{window.manager=EcoTrackCommandSchedules.mountManager(document.getElementById('manager'),{roomId:'room-1',nodeId:'node-1'});});
  await page.getByRole('button',{name:'Add schedule'}).click();
  assert.equal(await page.getByLabel('Enable schedule').isChecked(),true,'known receiver settings should permit a complete preset');
  assert.equal(await page.locator('[data-special]').count(),4,'actual server whitelist exposes supported absolute functions');
  await page.screenshot({path:path.join(out,'schedule-editor-dark.png')});
  await page.getByRole('button',{name:'Save schedule'}).click();
  await page.waitForFunction(()=>!document.querySelector('.acs-dialog'));
  const [saved]=await f.rows('SELECT * FROM ac_command_schedules');
  assert.ok(saved.enabled);assert.equal(saved.intent.state.temp,24);
  assert.equal((await f.rows('SELECT * FROM ecotrack_device_commands')).length,0,'save never sends now');
  assert.equal((await f.rows('SELECT * FROM notifications')).length,0);
  await page.screenshot({path:path.join(out,'command-schedules-dark.png')});
  await f.rows("UPDATE ac_command_schedules SET next_run_at='2026-11-02T00:00:00Z' WHERE id=$1",[saved.id]);
  const result=await f.call('ecotrack_private.dispatch_due_ac_command_schedules',['2026-11-02T00:00:10Z',100]);
  assert.equal(result.queued,1);
  const [q]=await f.rows('SELECT * FROM ecotrack_device_commands');
  const [queued]=await f.rows('SELECT * FROM notifications');
  assert.equal(queued.triggered,true);assert.equal(queued.schedule_event.command_id,q.id);
  await f.rows("UPDATE ecotrack_device_commands SET status='completed',claimed_at='2026-11-02T00:00:11Z',acknowledged_at='2026-11-02T00:00:12Z',result=$1 WHERE id=$2",[{success:true,command_id:q.id,aircon_id:q.payload.aircon_id,protocol:q.payload.protocol,delivery_status:'transmitted',state:q.payload.state},q.id]);
  await f.call('ecotrack_private.reconcile_ac_command_schedule_runs',['2026-11-02T00:00:15Z']);
  const [sent]=await f.rows('SELECT * FROM notifications');
  assert.equal(sent.id,queued.id);assert.equal(sent.schedule_event.status,'sent');
  assert.equal((await f.rows('SELECT * FROM telemetry')).length,0);
  assert.equal((await f.rows('SELECT reported_state FROM aircons'))[0].reported_state,null);
  assert.deepEqual(errors,[]);
  await page.evaluate(()=>window.manager.destroy());await page.close();
  const inbox=await browser.newPage({viewport:{width:1460,height:1000}});
  await inbox.goto(origin+'/Notification.html');
  const source=fs.readFileSync(path.join(root,'public/Notification.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
  await inbox.setContent(source);
  await inbox.addStyleTag({path:path.join(root,'public/styles.css')});
  await inbox.addScriptTag({path:path.join(root,'public/vendor/tailwindcss.js')});
  await inbox.evaluate(()=>{tailwind.config={darkMode:'class'};document.documentElement.classList.add('dark');});
  for(const file of ['installation-notifications.js','schedule-notifications.js','notifications.js'])await inbox.addScriptTag({path:path.join(root,'public/js',file)});
  await inbox.evaluate(record=>{
   rooms={'room-1':{id:'room-1',name:'Laboratory',nodes:[]}};selectedRoomId='room-1';
   messages=[EcoTrackScheduleNotifications.toMessage(record,{})];updateMessagesTable();
  },sent);
  await inbox.locator('.viewScheduleNotificationBtn').click();
  assert.match(await inbox.locator('#viewMessageCombined').innerText(),/Scheduled command sent/);
  assert.match(await inbox.locator('#viewMessageCombined').innerText(),/24.*C/);
  assert.match(await inbox.locator('#viewMessageCombined').innerText(),/AC operation is not confirmed/);
  assert.match(await inbox.locator('#scheduleViewLink').getAttribute('href'),new RegExp('schedule='+saved.id));
  const closeBox=await inbox.locator('#closeViewMessageModal').boundingBox();
  const dialogBox=await inbox.locator('#viewMessageModal > div').boundingBox();
  assert.ok(closeBox.x>dialogBox.x+dialogBox.width/2,'notification close control remains on the right');
  await inbox.screenshot({path:path.join(out,'notification-sent-dark.png')});
  await inbox.close();
  fs.writeFileSync(path.join(out,'integration-results.json'),JSON.stringify({passed:true,checks:['actual server capability whitelist and receiver state','browser save through actual RPC','zero immediate command or notification','worker queues one actual AC intent','same notification updates from queued to matching sent receipt','real notification modal uses stored snapshot','zero telemetry or reported power fabrication'],physical_hardware_tested:false,live_database_tested:false},null,2));
  console.log('PASS browser -> actual schedule RPC -> cloud worker -> matching receipt -> actual notification modal');
 }finally{await browser?.close();await new Promise(resolve=>server?server.close(resolve):resolve());await f.dispose();}
})().catch(error=>{console.error(error);process.exitCode=1});


