'use strict';
// Actual display functions, isolated readings and control snapshots; no live writes.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const html = fs.readFileSync('public/control.html', 'utf8');
const workspace = fs.readFileSync('public/js/sensor-workspace.js', 'utf8');
const now = Date.now(), at = new Date(now).toISOString();
function context() {
  const c = { console, Date }; c.window = c;
  vm.createContext(c);
  vm.runInContext(fs.readFileSync('public/js/aircon-state.js', 'utf8'), c);
  return c;
}
function desktopSetting(snapshot,sample={operating_mode:'cool',ac_on:false}) {
  const c=context(); Object.assign(c,{available:true,controlSnapshot:()=>snapshot,modeLabel:()=> 'Not reported',observedModes:{cool:'Cold',fan_only:'Fan Only',heat:'Heat',off:'Off'}});
  const start=workspace.indexOf('function modeSetting('),end=workspace.indexOf('function empty(',start);
  vm.runInContext(workspace.slice(start,end),c);
  return c.modeSetting({latest:sample,fresh:true});
}
function desktopMode(snapshot,sample) { return desktopSetting(snapshot,sample).value; }
const mobile=process.env.ECOTRACK_MOBILE_ROOT || path.resolve('..','EcoTrackAppMobileNew-master-control');
const ts=require(path.join(mobile,'node_modules/typescript'));
const loaded=new Map();
function loadMobile(file) {
  file=path.resolve(mobile,file); if(!path.extname(file))file+='.ts';
  if(loaded.has(file))return loaded.get(file).exports;
  const module={exports:{}};loaded.set(file,module);
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,require:spec=>loadMobile(path.resolve(path.dirname(file),spec)),Date,console},{filename:file});
  return module.exports;
}
const mobileDisplay=loadMobile('src/services/controller-display.ts');
for(const [platform,reading] of [['desktop',desktopMode],['mobile',(snapshot,sample)=>mobileDisplay.airconStateReading({settingsSnapshot:snapshot,operatingMode:sample?.operating_mode,powerFeedback:{value:false,observedAt:at}})]]) {
  test(platform+': Aircon state follows operation mode, independently of power feedback',()=>{
    for(const [mode,label] of [['auto','Auto'],['dry','Dry'],['cool',platform==='desktop'?'Cool':'Cold'],['fan','Fan Only'],['fan_only','Fan Only'],['heat','Heat']]) {
      assert.equal(reading({desired_state:{mode,power:false},commanded_at:at}),label);
    }
    assert.equal(reading({desired_state:{mode:'cool'},commanded_at:'2026-01-01',reported_state:{mode:'heat'},reported_at:at}),'Heat');
    assert.equal(reading({configured_state:{mode:'dry'}}),'Dry');
    assert.equal(reading(null,{operating_mode:null}),'Not reported');
  });
}
test('fan controls display the selected setting without measured rotation',()=>{
  assert.match(html,/executeCommand\('FAN', f\)/);
  assert.match(html,/id="blowerFanSetting"/);
  assert.doesNotMatch(html,/\bRPM\b|LM393|rotation_rpm/i);
  assert.doesNotMatch(workspace,/sensorRotationChart|Airflow Indicator|\bRPM\b/i);
  assert.match(workspace,/Temperature Trend/);
  assert.match(workspace,/AC Mode & Power Setting History/);
  assert.match(html,/Blower Fan Speed/);
});

test('desktop mode source distinguishes requested, reported, configured and remote settings',()=>{
  for (const [field,timeField,source] of [['desired_state','commanded_at','requested'],['reported_state','reported_at','reported'],['configured_state',null,'configured'],['observed_remote_state','observed_remote_at','remote']]) {
    const snapshot={[field]:{mode:'cool'}};if(timeField)snapshot[timeField]=at;
    const display=desktopSetting(snapshot);
    assert.equal(display.value,'Cool');assert.equal(display.source,source);
  }
  assert.equal(desktopSetting(null,{operating_mode:null}).source,null);
});
