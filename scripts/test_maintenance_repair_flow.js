'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('public/js/maintenance-modal.js','utf8').replace(/\r\n/g,'\n');
function part(a,b){const start=source.indexOf(a),end=source.indexOf(b,start+a.length);assert(start>=0&&end>start,a);return source.slice(start,end);}
function fixture(){const ctx=vm.createContext({localStorage:{setItem(){}},deduplicateReports:rows=>rows});
 vm.runInContext(part('  function isActualRepairTask(','  function isMockOrTestReport(')+part('  function isReportSubmittedForVerification(','  function normalizeReport(')+part('  function getChildRepairReportsFor(','  function resolvePhotoUrl(')+part('  function syncReportsWithLinkedRepairs(','  function getReportsLocal('),ctx);return ctx;}
const task=(id,repair)=>({id,name:'Repeated task',status:'Completed',verified:true,repaired:!!repair,linkedRepairId:repair});
const child=(id,status,taskId='1')=>({id,type:'Corrective Repair',status,parentReportId:'MR-one',parentTaskId:taskId,tasks:[task('step')]});
test('saved, submitted and approved repair phases stay distinct',()=>{const c=fixture(),r=child('REP-one','In Progress');
 assert.equal(c.isRepairReportDone({...r,status:'For Verification'}),false);
 assert.equal(c.isRepairReportVerified({...r,status:'Completed'}),true);
 assert.equal(c.maintenanceReportPhase(r),'Ready to submit');
 assert.equal(c.maintenanceReportPhase({...r,status:'For Verification'}),'For Verification');
 assert.equal(c.maintenanceReportPhase({...r,status:'Completed'}),'Completed');
 assert.notEqual(c.maintenanceReportPhase({...r,tasks:[]}),'Ready to submit');});
test('submitted child is not repaired; approval does not auto-approve the parent',()=>{const c=fixture(),p={id:'MR-one',status:'In Progress',tasks:[task('1','REP-one')]},r=child('REP-one','For Verification');
 c.syncReportsWithLinkedRepairs([p,r]);assert.equal(p.tasks[0].status,'For Verification');assert.equal(p.tasks[0].repaired,false);assert.equal(p.tasks[0].verified,false);
 r.status='Completed';c.syncReportsWithLinkedRepairs([p,r]);assert.equal(p.tasks[0].status,'Completed');assert.equal(p.tasks[0].repaired,true);assert.notEqual(p.status,'Completed');assert.equal(c.maintenanceReportPhase(p),'Ready to submit');
 p.status='For Verification';c.syncReportsWithLinkedRepairs([p,r]);assert.equal(p.status,'For Verification');
 p.status='Completed';c.syncReportsWithLinkedRepairs([p,r]);assert.equal(p.status,'Completed');});
test('missing link and duplicate names never redirect a task or complete it',()=>{const c=fixture(),p={id:'MR-one',status:'Completed',tasks:[task('1','REP-missing')]},r=child('REP-other','Completed','2');
 c.syncReportsWithLinkedRepairs([p,r]);assert.equal(p.tasks[0].linkedRepairId,'REP-missing');assert.equal(p.tasks[0].repaired,false);assert.notEqual(p.status,'Completed');
 const ambiguous={id:'MR-one',status:'In Progress',tasks:[task('1'),task('2')]};const legacy={...r,parentTaskId:null,parentTaskName:'Repeated task'};
 assert.equal(c.getRepairReportForTask(ambiguous,ambiguous.tasks[0],[ambiguous,legacy]),null);});
test('another active child blocks completion and a rejected child clears approval',()=>{const c=fixture(),p={id:'MR-one',status:'Completed',tasks:[task('1','REP-one'),task('2','REP-two')]},one=child('REP-one','Completed'),two=child('REP-two','In Progress','2');
 c.syncReportsWithLinkedRepairs([p,one,two]);assert.equal(p.status,'Under Repair');assert.equal(p.tasks[0].repaired,true);assert.equal(p.tasks[1].repaired,false);
 one.status='In Progress';c.syncReportsWithLinkedRepairs([p,one,two]);assert.equal(p.tasks[0].verified,false);assert.equal(p.tasks[0].verifiedAt,null);});

test('submitted child cannot select the parent Already Repaired banner',()=>{
 const c={childRepairs:[child('REP-one','For Verification')],activeChildRepairs:[],completedChildRepairs:[],report:{}};
 const statement=source.match(/    const isAllRepairsDone = [^\n]+/)[0];vm.runInNewContext(statement+';this.result=isAllRepairsDone;',c);assert.equal(c.result,false);
});
test('rendering a submitted linked checklist item preserves its phase',()=>{
 const c=fixture();c.task={status:'For Verification',repaired:false,verified:false};c.tChildRepair=child('REP-one','For Verification');
 vm.runInContext(part('          let isTaskRepairDone =','          let badge ='),c);
 assert.equal(c.task.status,'For Verification');assert.equal(c.task.repaired,false);
});
test('actual public maintenance API exposes the phase used by staff rows',()=>{
 const c=fixture(),api=part('  window.EcoTrackMaintenance = {','\n})();');c.window={};
 for(const match of api.matchAll(/:\s*([A-Za-z_$][\w$]*)(?:,|\n)/g))if(!(match[1] in c))c[match[1]]=()=>{};
 vm.runInContext(api,c);assert.equal(typeof c.window.EcoTrackMaintenance.reportPhase,'function');
 assert.equal(c.window.EcoTrackMaintenance.reportPhase(child('REP-ready','In Progress')),'Ready to submit');
});
