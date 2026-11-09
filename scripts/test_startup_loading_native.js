'use strict';
// Actual Electron/main window lifecycle with only backend readiness deferred.
// Fresh profiles, public .invalid configuration, blocked networking, no real backend.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'reports/notification-release-20261103/startup/native');
fs.mkdirSync(out,{recursive:true});
if(!process.versions.electron){
 const {spawnSync}=require('node:child_process');const results=[];
 for(const scenario of ['handoff','failure','cancel','cancel-main']){
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'ecotrack-startup-transition-'));
  const env={...process.env,ECOTRACK_USER_DATA_PATH:profile,ECOTRACK_STARTUP_CASE:scenario};delete env.ELECTRON_RUN_AS_NODE;
  const result=spawnSync(require('electron'),[__filename,'--noerrdialogs'],{cwd:root,env,windowsHide:true,encoding:'utf8',timeout:30000});
  fs.writeFileSync(path.join(out,scenario+'.log'),result.stdout+result.stderr);
  process.stdout.write(result.stdout);if(result.status!==0){process.stderr.write(result.stderr);process.exitCode=1;break;}
  results.push({scenario,status:'PASS'});
 }
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({status:process.exitCode?'FAIL':'PASS',checks:results,liveDataAccessed:false},null,2));
}else{
 const {app,BrowserWindow,dialog,session}=require('electron');const scenario=process.env.ECOTRACK_STARTUP_CASE;
 Object.defineProperty(app,'isPackaged',{value:true});
 require('dotenv').config=()=>({parsed:{}});
 for(const key of Object.keys(process.env))if(/^(?:SUPABASE_|EXPO_PUBLIC_SUPABASE_)/.test(key))delete process.env[key];
 process.env.SUPABASE_URL='https://startup-test.invalid';process.env.SUPABASE_ANON_KEY='sb_publishable_startup_test';delete process.env.BACKEND_URL;
 const created=[],errors=[];let releaseBackend,rejectBackend,releaseMain,backendStarted=false,stops=0,quits=0;
 const backend=new Promise((resolve,reject)=>{releaseBackend=resolve;rejectBackend=reject;});
 const modulePath=require.resolve('../src/backend-runtime');require.cache[modulePath]={id:modulePath,filename:modulePath,loaded:true,exports:{startBackend:()=>{backendStarted=true;return backend;}}};
 dialog.showErrorBox=(title,message)=>errors.push({title,message});
 app.quit=()=>{quits++;app.emit('before-quit',{preventDefault(){}});};
 app.on('browser-window-created',(_event,window)=>{
  created.push(window);
  if(scenario==='cancel-main' && created.length===2){
   const load=window.loadURL.bind(window);
   window.loadURL=(...args)=>new Promise((resolve,reject)=>{releaseMain=()=>load(...args).then(resolve,reject);});
  }
 });
 app.once('ready',()=>session.defaultSession.webRequest.onBeforeRequest((details,callback)=>callback({cancel:/^https?:|^wss?:/i.test(details.url)})));
 require('../src/main.js');
 const waitFor=async(test,label)=>{const end=Date.now()+15000;while(Date.now()<end){if(await test())return;await new Promise(r=>setTimeout(r,25));}throw Error('Timed out: '+label);};
 app.whenReady().then(async()=>{
  await waitFor(()=>backendStarted,'backend initialization');
  assert.equal(created.length,1,'A startup window must exist while backend readiness is pending');
  const startup=created[0];await waitFor(()=>startup.webContents.getURL().endsWith('/startup.html'),'startup page');
  if(startup.webContents.isLoading())await new Promise(r=>startup.webContents.once('did-finish-load',r));
  const preferences=startup.webContents.getLastWebPreferences();assert.equal(preferences.contextIsolation,true);assert.equal(preferences.nodeIntegration,false);assert.equal(preferences.sandbox,true);assert(!preferences.preload);
  assert.equal(await startup.webContents.executeJavaScript('typeof window.electron'),'undefined');
  assert.equal(await startup.webContents.executeJavaScript('document.querySelector("[role=progressbar]").hasAttribute("aria-valuenow")'),false);
  app.emit('second-instance');assert.equal(created.length,1,'A second launch cannot create the main renderer before readiness');
  if(scenario==='cancel'){
   startup.close();await waitFor(()=>quits>0,'startup cancellation');
   process.env.BACKEND_URL='http://127.0.0.1:56111';releaseBackend({stop(){stops++;}});
   await new Promise(r=>setImmediate(r));assert.equal(created.length,1);assert.equal(stops,1);
  }else if(scenario==='cancel-main'){
   process.env.BACKEND_URL='http://127.0.0.1:56111';releaseBackend({stop(){stops++;}});
   await waitFor(()=>created.length===2&&releaseMain,'hidden main creation');const main=created[1];assert.equal(main.isVisible(),false);
   startup.close();await waitFor(()=>startup.isDestroyed(),'loader close before main paint');
   assert(quits>0,'Closing startup must cancel even after a hidden main renderer exists');
   await releaseMain();assert.equal(main.isVisible(),false,'A cancelled main renderer cannot appear after loading');
  }else if(scenario==='failure'){
   rejectBackend(Error('Isolated startup failure'));await waitFor(()=>quits>0,'startup error exit');
   assert.deepEqual(errors,[{title:'EcoTrack could not start',message:'Isolated startup failure'}]);assert.equal(created.length,1);
  }else{
   await waitFor(()=>startup.isVisible(),'startup first paint');
   fs.writeFileSync(path.join(out,'startup-loading.png'),(await startup.webContents.capturePage()).toPNG());
   process.env.BACKEND_URL='http://127.0.0.1:56111';releaseBackend({stop(){stops++;}});
   await waitFor(()=>created.length===2,'main window creation');const main=created[1];
   await waitFor(()=>startup.isDestroyed()&&main.isVisible()&&!main.webContents.isLoading(),'ready handoff');
   assert.match(main.webContents.getURL(),/login\.html\?resume=1$/);
   assert.equal(await main.webContents.executeJavaScript('window.electron.env.BACKEND_URL'),'http://127.0.0.1:56111');
   assert.equal(BrowserWindow.getAllWindows().length,1);assert.equal(quits,0,'Closing the loader during handoff must not quit the app');
   app.emit('second-instance');assert.equal(created.length,2);assert.equal(errors.length,0);
  }
  console.log('PASS startup '+scenario+': real isolated renderer/window lifecycle');app.exit(0);
 }).catch(error=>{console.error(error.stack);app.exit(1);});
}
