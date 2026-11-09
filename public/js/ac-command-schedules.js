(function (root) {
  'use strict';
  const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const escape = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const deviceLabel = v => root.ecoDeviceDisplayName?.(v) || v;
  const title = v => String(v || '').replace(/_/g,' ').replace(/^./, c => c.toUpperCase());
  async function rpc(name,args) {
    const client = root.supabaseClient || root.sb;
    if (!client?.rpc) throw new Error('Sign in and connect to Supabase first.');
    const mutation = name !== 'ecotrack_list_ac_command_schedules';
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let query = client.rpc(name, args);
    if (controller && typeof query.abortSignal === 'function') query = query.abortSignal(controller.signal);
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const message = mutation
          ? 'The change could not be confirmed. Close and refresh schedules before retrying.'
          : 'Schedules took too long to load. Please try again.';
        reject(Object.assign(new Error(message), { code: mutation ? 'SCHEDULE_UNCONFIRMED' : 'SCHEDULE_TIMEOUT' }));
        controller?.abort();
      }, 20000);
      Promise.resolve(query).then(value => { clearTimeout(timer); resolve(value); },
        error => { clearTimeout(timer); reject(error); });
    });
    if (mutation && result.status === 0) {
      throw Object.assign(new Error('The change could not be confirmed. Close and refresh schedules before retrying.'), {code:'SCHEDULE_UNCONFIRMED'});
    }
    if (result.error) throw Object.assign(new Error(['PGRST202','PGRST205','42P01'].includes(result.error.code) ? 'Command schedules setup is required.' : result.error.message || 'Command schedules are unavailable.'), {code:result.error.code});
    if (result.data == null) throw new Error('The server did not confirm the request.');
    return result.data;
  }
  const list = node => rpc('ecotrack_list_ac_command_schedules',{p_node_id:node || null});
  const save = (draft,version) => rpc('ecotrack_save_ac_command_schedule',{p_draft:draft,p_expected_version:version ?? null});
  const setAutomation = (binding,enabled,version) => rpc('ecotrack_set_ac_automation',{p_node_id:binding.node_id,p_aircon_id:binding.aircon_id,p_enabled:enabled,p_expected_version:version ?? null});
  const archive = (id,version) => rpc('ecotrack_archive_ac_command_schedule',{p_schedule_id:id,p_expected_version:version});
  function summarize(draft) {
    const selected = (draft.weekdays || []).map(Number).sort((a,b)=>a-b);
    let when = selected.join(',') === '1,2,3,4,5' ? 'Mon-Fri' : selected.length === 7 ? 'Every day' : selected.map(d=>days[d-1]).filter(Boolean).join(', ');
    const match = /^(\d\d):(\d\d)/.exec(draft.local_time || '');
    if (match) { const h=Number(match[1]); when += ` at ${h%12 || 12}:${match[2]} ${h<12?'AM':'PM'}`; }
    const state=draft.intent?.state || {}, parts=[draft.action==='turn_off'?'Off':draft.action==='change_settings'?'Change settings':'On'];
    if (draft.action !== 'turn_off') { if(state.mode) parts.push(title(state.mode)); if(state.temp != null) parts.push(`${state.temp} C`); if(state.fan) parts.push(`${title(state.fan)} fan`); }
    return [when,...parts].filter(Boolean).join(' - ');
  }
  function profileFor(binding) { return binding.profile || {}; }
  function capabilities(binding) {
    const engine=root.EcoTrackAirconSystem?.CapabilityEngine, profile=profileFor(binding);
    if (!engine?.registry || !profile || typeof profile !== 'object') return null;
    const resolved=engine.registry.resolve(profile);
    return resolved?.can_transmit && !resolved.power_toggle ? {engine,resolved,profile} : null;
  }
  function openEditor({binding,schedule,onSaved,onUnconfirmed}) {
    const pinned=structuredClone(binding), cap=capabilities(pinned), prior=document.activeElement;
    return new Promise(resolve => {
      const overlay=document.createElement('div'); overlay.className='acs-overlay';
      const existing=schedule || {}, initial={};
      for(const source of [pinned.cloud_state?.latest_ir?.state,pinned.profile?.configured_state,pinned.profile?.desired_state,existing.intent?.state]) { if(source && typeof source==='object') for(const [key,value] of Object.entries(source)) if(value!==null && value!==undefined) initial[key]=value; }
      const selected=new Set(existing.weekdays || [1,2,3,4,5]);
      const caps=cap?.resolved, modes=caps?.modes || [], fans=Object.keys(caps?.fan_map || {});
      const options=(items,value) => items.map(x=>`<option value="${escape(x)}" ${String(x)===String(value)?'selected':''}>${escape(title(x))}</option>`).join('');
      const action=existing.action || 'turn_on';
      const initialMode=modes.includes(initial.mode) ? initial.mode : modes.find(m=>cap.engine.getControlTemperatureRange(cap.profile,m)?.values.length) || modes[0];
      overlay.innerHTML=`<section class="acs-dialog" role="dialog" aria-modal="true" aria-labelledby="acs-title"><div class="acs-dialog-head"><h2 id="acs-title">${schedule?'Edit schedule':'Add schedule'}</h2><button type="button" data-close aria-label="Close">×</button></div><div class="acs-device"><strong>${escape(deviceLabel(pinned.device_name || pinned.device_id))}</strong><br><span>${escape(pinned.aircon_name || pinned.aircon_id)}</span></div><form><label>Repeat</label><div class="acs-days">${days.map((d,i)=>`<button type="button" data-day="${i+1}" aria-label="${['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][i]}" aria-pressed="${selected.has(i+1)}">${d}</button>`).join('')}</div><label for="acs-time">Time <small>UTC+08:00</small></label><input id="acs-time" type="time" required value="${escape((existing.local_time || '08:00').slice(0,5))}"><label>Action</label><div class="acs-actions">${[['turn_on','Turn on'],['turn_off','Turn off'],['change_settings','Change settings']].map(([v,l])=>`<label><input type="radio" name="action" value="${v}" ${v===action?'checked':''}>${l}</label>`).join('')}</div><div data-settings><div class="acs-fields"><label>Mode<select name="mode">${options(modes,initialMode)}</select></label><label>Temperature<select name="temp"></select></label><label>Fan speed<select name="fan">${options(fans,initial.fan)}</select></label></div><details data-special-functions><summary>Special functions</summary><p>Only verified repeat-safe functions are available.</p><div data-specials></div><p data-special-note hidden>Choose an On or Off value for each special function before enabling.</p></details></div><label class="acs-enable"><input type="checkbox" name="enabled" ${existing.enabled===false?'':'checked'}> Enable schedule</label><p class="acs-hours-note" hidden>Device hours need review. <a href="scheduler.html?room=${encodeURIComponent(pinned.room_id || '')}">Review device hours</a></p><div class="acs-preview" aria-live="polite"></div><p class="acs-note">Starts at the next scheduled time.</p><p class="acs-error" role="alert"></p><footer><button type="button" data-close>Cancel</button><button type="submit" class="acs-primary">Save schedule</button></footer></form></section>`;
      document.body.appendChild(overlay);
      const form=overlay.querySelector('form'), mode=form.elements.mode, temp=form.elements.temp, fan=form.elements.fan, error=overlay.querySelector('.acs-error');
      // A special function must explicitly declare absolute repeat-safe encoding and have a known value.
      const safe=pinned.schedule_safe_absolute || {};
      const allowed=['swing_vertical','swing_horizontal','sleep','turbo','eco','quiet','display','beep'];
      const safeFeatures=allowed.filter(k=>safe[k]===true && caps?.features?.[k]===true);
      overlay.querySelector('[data-specials]').innerHTML=safeFeatures.map(k=>`<label>${escape(title(k))}<select data-special="${k}"><option value="">Choose...</option>${options(['off','on'],initial[k]===true?'on':initial[k]===false?'off':initial[k])}</select></label>`).join('');
      let retainedTemp=initial.temp ?? initial.temperature;
      function temperatures(preferred) { const values=cap?.engine.getControlTemperatureRange(cap.profile,mode.value)?.values || []; const range=cap?.engine.registry.range?.(cap.profile,mode.value); if(values.length){temp.disabled=false;temp.innerHTML=options(values,preferred);if(values.includes(Number(preferred))) temp.value=String(preferred);retainedTemp=Number(temp.value);}else{temp.disabled=true;const fixed=range && range.min===range.max ? range.min : preferred;retainedTemp=Number.isFinite(Number(fixed)) && fixed!=='' && fixed!=null ? Number(fixed) : null;temp.innerHTML=retainedTemp==null?'':options([retainedTemp],retainedTemp);}  const allowedFans=cap?.engine.getCapabilities?.(cap.profile,mode.value)?.fans || fans; const current=fan.value || initial.fan; fan.innerHTML=options(allowedFans,current); }
      temperatures(initial.temp ?? initial.temperature);
      function draft() { const state={power:form.elements.action.value==='turn_off'?'off':'on',mode:mode.value,temp:temp.disabled?retainedTemp:Number(temp.value),fan:fan.value}; delete state.temperature; if(form.elements.action.value!=='turn_off')overlay.querySelectorAll('[data-special]').forEach(el=>{if(el.value)state[el.dataset.special]=el.value;}); return {...(existing.id ? {id:existing.id} : {}),node_id:pinned.node_id,aircon_id:pinned.aircon_id,device_id:pinned.device_id,name:existing.name || 'AC schedule',weekdays:[...selected].sort((a,b)=>a-b),local_time:form.querySelector('#acs-time').value,timezone:'Asia/Singapore',action:form.elements.action.value,enabled:form.elements.enabled.checked,intent:{...(existing.intent || {}),aircon_id:pinned.aircon_id,protocol:caps?.protocol,model:caps?.remote_model ?? null,capability_revision:pinned.profile?.capability_profile?.revision || 0,registry_version:cap?.engine.registry.data.registry_version,state}}; }
      function awake(time) { const parse=value=>{const m=/^(\d{2}):(\d{2})(?::\d{2})?$/.exec(value || '');return m && Number(m[1])<24 && Number(m[2])<60 ? Number(m[1])*60+Number(m[2]) : null;};const w=parse(pinned.wake_time),s=parse(pinned.sleep_time),t=parse(time);if(w==null||s==null||t==null)return false;const span=(s-w+1440)%1440,due=(t-w+1440)%1440;return span===0 || (due>=2 && due+2<span); }
      function update() { const enabled=form.elements.enabled, available=awake(form.querySelector('#acs-time').value);if(!available)enabled.checked=false;enabled.disabled=!available;overlay.querySelector('.acs-hours-note').hidden=available; const d=draft(); overlay.querySelector('[data-settings]').hidden=d.action==='turn_off';overlay.querySelector('[data-special-note]').hidden=d.action==='turn_off' || !d.enabled || [...overlay.querySelectorAll('[data-special]')].every(el=>el.value); const parts=summarize(d).split(' - '); overlay.querySelector('.acs-preview').innerHTML=`<strong>${escape(parts.shift())}</strong><br>${escape(parts.join(' · '))}`; }
      let pending=false, unconfirmed=false;
      function close(value) { if(pending)return; document.removeEventListener('keydown',key); overlay.remove(); prior?.focus?.(); resolve(value); }
      function key(e) { if(e.key==='Escape'){e.preventDefault();close(null);} if(e.key==='Tab'){const items=[...overlay.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary')].filter(x=>x.getClientRects().length); if(!items.length)return; const first=items[0],last=items[items.length-1]; if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}} }
      document.addEventListener('keydown',key); overlay.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>close(null)));
      overlay.querySelectorAll('[data-day]').forEach(b=>b.addEventListener('click',()=>{const n=Number(b.dataset.day); selected.has(n)?selected.delete(n):selected.add(n);b.setAttribute('aria-pressed',String(selected.has(n)));update();}));
      mode.addEventListener('change',()=>{temperatures(temp.value || retainedTemp);update();});temp.addEventListener('change',()=>{retainedTemp=Number(temp.value);}); form.addEventListener('input',update); form.addEventListener('change',update);
      form.addEventListener('submit',async e=>{e.preventDefault(); if(pending || unconfirmed)return; const d=draft(); error.textContent=''; if(!cap){error.textContent='This device needs a supported exact AC profile before scheduling.';return;} if(!d.weekdays.length || !d.local_time){error.textContent='Choose at least one day and a time.';return;} if(d.enabled && d.action!=='turn_off' && [...overlay.querySelectorAll('[data-special]')].some(el=>!el.value)){overlay.querySelector('[data-special-functions]').open=true;error.textContent='Choose On or Off for each special function.';return;} if(!Number.isInteger(d.intent.state.temp) || (!temp.disabled && !cap.engine.validateControlTemperature(cap.profile,d.intent.state.temp,d.intent.state.mode)) || !cap.engine.registry.validateState(cap.profile,d.intent.state).valid){error.textContent='Review the supported mode, whole-degree temperature and fan settings.';return;} pending=true; form.querySelector('[type=submit]').disabled=true; try {const result=await save(d,existing.version ?? null); pending=false; onSaved?.(result); close(result);} catch(err){pending=false; unconfirmed=err.code==='SCHEDULE_UNCONFIRMED'; form.querySelector('[type=submit]').disabled=unconfirmed;error.textContent=err.message || 'Could not save schedule.';if(unconfirmed)onUnconfirmed?.(err);} });
      update(); overlay.querySelector('[data-close]').focus();
    });
  }
  function mountManager(container, context={}) {
    let renderPending=false;
    let mutationUnconfirmed=false;
    let seq=0, destroyed=false, data=null, room=context.roomId || null, node=context.nodeId || null, selected='', page=1, deepLinkHandled=false;
    const pageSize=10;
    async function refresh(quiet=false) {
      const current=++seq;
      if(!quiet)container.innerHTML='<p role="status">Loading command schedules…</p>';
      try {
        const result=await list(node);
        if(destroyed || current!==seq)return;
        if(mutationUnconfirmed && (!Array.isArray(result.devices) || !Array.isArray(result.schedules) || !Array.isArray(result.automation))) {
          throw new Error('Schedules could not be reconciled. Refresh schedules before making another change.');
        }
        const changed=JSON.stringify([data?.devices,data?.schedules,data?.automation]) !==
          JSON.stringify([result.devices,result.schedules,result.automation]);
        data=result;
        renderPending=renderPending || !quiet || changed || mutationUnconfirmed;
        mutationUnconfirmed=false;
        if(renderPending && !document.querySelector('.acs-overlay')){render();renderPending=false;}
        else updateStatus();
      } catch(error) {
        if(!destroyed && current===seq) {
          if(quiet && data)showError(error);
          else container.innerHTML=`<p class="acs-error" role="alert">${escape(error.message)}</p><button type="button" data-retry>Try again</button>`;
        }
      }
    }
    function healthText() {const h=data?.health || {},t=Date.parse(h.last_tick_at);return h.available===true && Number.isFinite(t) && Date.now()-t<120000?'UTC+08:00':'Scheduling unavailable: scheduler health is missing or stale.';}
    function activityMarkup() {return (data?.runs || []).filter(r=>node ? String(r.node_id)===String(node) : room && String(r.room_id)===String(room)).map(r=>`<p><strong>${escape(title(r.status))}</strong> · ${escape(deviceLabel(r.device_name || ''))} · ${escape(r.scheduled_at || '')}${r.reason?' · '+escape(r.reason):''}</p>`).join('') || '<p>No recent activity.</p>';}
    function eligibleDevices() {
      const registered=context.getRegisteredDevices?.(room,node) || [];
      return (data?.devices || []).filter(device => {
        const inContext=node ? String(device.node_id)===String(node) :
          room && String(device.room_id)===String(room);
        const registration=registered.find(row=>String(row.pb_id || row.id)===String(device.node_id));
        return inContext && registration?.device_mode!=='monitoring';
      });
    }
    function updateStatus() {
      const health=container.querySelector('.acs-health');
      const activity=container.querySelector('[data-activity-rows]');
      if(health)health.textContent=healthText();
      if(activity)activity.innerHTML=activityMarkup();
      const devices=eligibleDevices();
      const add=container.querySelector('[data-add]');
      if(add)add.disabled=mutationUnconfirmed || !devices.some(device=>JSON.stringify([device.node_id,device.aircon_id])===selected);
      container.querySelectorAll('[data-auto]').forEach(input=>{
        input.disabled=mutationUnconfirmed || !devices.some(device=>JSON.stringify([device.node_id,device.aircon_id])===input.dataset.auto);
      });
      if(mutationUnconfirmed) {
        container.querySelectorAll('[data-enabled],[data-edit],[data-archive]').forEach(element=>{element.disabled=true;});
        showError(new Error('A previous change could not be confirmed. Refresh schedules before making another change.'));
        if(!container.querySelector('[data-reconcile]')) {
          const retry=document.createElement('button');
          retry.type='button';retry.dataset.reconcile='';retry.textContent='Refresh schedules';
          container.appendChild(retry);
        }
      } else container.querySelector('[data-reconcile]')?.remove();
    }
    function handleMutationError(error) {
      if(error.code==='SCHEDULE_UNCONFIRMED') {
        mutationUnconfirmed=true;
        // A read started before the uncertain outcome cannot reconcile it.
        seq++;
        updateStatus();
      }
      showError(error);
    }
    function edit(binding,schedule) {
      if(mutationUnconfirmed || destroyed)return;
      openEditor({binding,schedule,onSaved:()=>refresh(),onUnconfirmed:handleMutationError}).then(()=>{
        if(renderPending && !destroyed && !document.querySelector('.acs-overlay')){render();renderPending=false;}
      });
    }
    function render() {
      const focused=container.contains(document.activeElement) ? document.activeElement : null;
      const focusId=focused?.id;
      const focusData=focused ? {...focused.dataset} : null;
      const activityFocused=focused?.matches('.acs-activity > summary');
      const activityOpen=container.querySelector('.acs-activity')?.open || false;
      const registered=context.getRegisteredDevices?.(room,node) || [];
      const registrationFor=d=>registered.find(r=>String(r.pb_id || r.id)===String(d.node_id));
      // Only the server's validated bindings can enable command actions. Registry
      // rows explain why a real device is absent without inventing an IR binding.
      const devices=eligibleDevices();
      const unavailable=registered.filter(r=>!devices.some(d=>String(r.pb_id || r.id)===String(d.node_id))).map(r=>{
        const name=r.device_name || r.name || r.id, ir=r.cloud_state?.capabilities?.ir_transmitter;
        const [reason,detail]=r.device_mode==='monitoring' ? ['Monitoring only','is registered for monitoring only.'] : ir===false ? ['IR transmitter unavailable','reports no IR transmitter. Command schedules require an IR transmitter.'] : ir===true ? ['Control binding unavailable','is unavailable for command schedules. Review its controller and AC assignment.'] : ['IR transmitter unconfirmed','has not confirmed IR transmitter support.'];
        return {name:deviceLabel(name),aircon:r.ac_name,reason,detail};
      });
      const unavailableOptions=unavailable.map((d,i)=>`<option value="" disabled ${!devices.length && i===0?'selected':''}>${escape(d.name)}${d.aircon?' - '+escape(d.aircon):''} - ${escape(d.reason)}</option>`).join('');
      const emptyMessage=unavailable.length ? `<strong>No devices are ready for command schedules.</strong>${unavailable.map(d=>`<p>${escape(d.name)} ${escape(d.detail)}</p>`).join('')}` : '<strong>No AC devices in this room</strong><p>Select a room with a controllable AC device.</p><a href="aircons.html">Manage AC Devices</a>';
      if(!devices.some(d=>JSON.stringify([d.node_id,d.aircon_id])===selected)) selected=devices.length ? JSON.stringify([devices[0].node_id,devices[0].aircon_id]) : '';
      const visible=(data.schedules || []).filter(s=>devices.some(d=>d.node_id===s.node_id && d.aircon_id===s.aircon_id) && !s.archived_at);
      const max=Math.max(1,Math.ceil(visible.length/pageSize)); page=Math.min(page,max);
      const healthMessage=healthText();
      container.innerHTML=`<div class="acs-toolbar"><div class="acs-device-field"><label for="acs-binding">AC device</label><select id="acs-binding" ${devices.length?'':'disabled'}>${devices.map(d=>`<option value="${escape(JSON.stringify([d.node_id,d.aircon_id]))}" ${JSON.stringify([d.node_id,d.aircon_id])===selected?'selected':''}>${escape(deviceLabel(d.device_name || d.device_id))} · ${escape(d.aircon_name || d.aircon_id)}</option>`).join('') + unavailableOptions || '<option value="">No AC devices in this room</option>'}</select></div><button type="button" class="acs-primary" data-add ${devices.length?'':'disabled'}>+ Add schedule</button></div><p class="acs-health" role="status">${healthMessage}</p><div class="acs-table-wrap" tabindex="0" role="region" aria-label="Command schedules"><table class="acs-table"><thead><tr><th>Device</th><th>When</th><th>Action</th><th>Enabled</th><th><span class="acs-sr">Actions</span></th></tr></thead><tbody>${visible.slice((page-1)*pageSize,page*pageSize).map(s=>{const d=devices.find(x=>x.node_id===s.node_id&&x.aircon_id===s.aircon_id);const parts=summarize(s).split(' - ');return `<tr><td><strong>${escape(deviceLabel(d?.device_name || d?.device_id))}</strong><br><small>${escape(d?.aircon_name || d?.aircon_id)}</small></td><td>${escape(parts.shift())}</td><td>${escape(parts.join(' · '))}</td><td><label><input type="checkbox" data-enabled="${escape(s.id)}" ${s.enabled?'checked':''}> Enabled</label></td><td><details class="acs-menu"><summary aria-label="Schedule actions">⋮</summary><button type="button" data-edit="${escape(s.id)}">Edit</button><button type="button" data-archive="${escape(s.id)}">Archive</button></details></td></tr>`;}).join('') || `<tr><td class="acs-empty" colspan="5"><div>${devices.length?'<strong>No command schedules yet.</strong>':emptyMessage}</div></td></tr>`}</tbody></table></div><div class="acs-automation">${devices.map(d=>{const a=(data.automation || []).find(x=>x.node_id===d.node_id && x.aircon_id===d.aircon_id);return `<label><input type="checkbox" data-auto="${escape(JSON.stringify([d.node_id,d.aircon_id]))}" ${a?.enabled?'checked':''}> Automation for ${escape(deviceLabel(d.device_name || d.device_id))}</label>`;}).join('')}</div><details class="acs-activity"><summary>Recent activity</summary><div data-activity-rows>${activityMarkup()}</div></details><div class="acs-pagination"><span>Showing ${visible.length} schedules</span><span><button type="button" data-page="-1" ${page===1?'disabled':''}>Previous</button> Page ${page} of ${max} <button type="button" data-page="1" ${page===max?'disabled':''}>Next</button></span></div><p class="acs-error" role="alert"></p>`;
      container.querySelector('.acs-activity').open=activityOpen;
      if(activityFocused)container.querySelector('.acs-activity > summary')?.focus();
      else if(focusId)container.querySelectorAll('[id]').forEach(element=>{
        if(element.id===focusId)element.focus();
      });
      else if(focusData && Object.keys(focusData).length) {
        const element=[...container.querySelectorAll('button,input,summary')].find(candidate=>
          Object.entries(focusData).every(([key,value])=>candidate.dataset[key]===value));
        element?.focus();
      }
      updateStatus();
      const params=new URLSearchParams(root.location.search); const target=params.get('schedule'); if(target && !deepLinkHandled){const item=visible.find(s=>s.id===target); const binding=item&&devices.find(d=>d.node_id===item.node_id&&d.aircon_id===item.aircon_id); if(binding && !mutationUnconfirmed){deepLinkHandled=true;edit(binding,item);}}
    }
    function showError(err){const el=container.querySelector('.acs-error');if(el)el.textContent=err.message || 'Request failed.';}
    container.addEventListener('change',async e=>{if(e.target.id==='acs-binding'){selected=e.target.value;return;}if(mutationUnconfirmed){updateStatus();return;} const key=e.target.dataset.enabled; if(key){const s=data.schedules.find(x=>x.id===key);e.target.disabled=true;try{await save(Object.fromEntries(['id','name','node_id','aircon_id','device_id','weekdays','local_time','timezone','action','intent','enabled'].map(k=>[k,k==='enabled'?e.target.checked:s[k]])),s.version);await refresh();}catch(err){e.target.checked=!e.target.checked;e.target.disabled=false;handleMutationError(err);}return;} const auto=e.target.dataset.auto;if(auto){const binding=eligibleDevices().find(d=>JSON.stringify([d.node_id,d.aircon_id])===auto);if(!binding){e.target.disabled=true;showError(new Error('This device is no longer available. Refresh schedules.'));return;}const a=(data.automation || []).find(x=>x.node_id===binding.node_id&&x.aircon_id===binding.aircon_id);e.target.disabled=true;try{await setAutomation(binding,e.target.checked,a?.version);await refresh();}catch(err){e.target.checked=!e.target.checked;e.target.disabled=false;handleMutationError(err);}} });
    container.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;if(b.hasAttribute('data-retry') || b.hasAttribute('data-reconcile'))return refresh();if(b.hasAttribute('data-page')){page+=Number(b.dataset.page);return render();}if(mutationUnconfirmed){updateStatus();return;} if(b.hasAttribute('data-add')){const binding=eligibleDevices().find(d=>JSON.stringify([d.node_id,d.aircon_id])===selected);if(binding)edit(binding);else{b.disabled=true;showError(new Error('This device is no longer available. Refresh schedules.'));}return;} const id=b.dataset.edit || b.dataset.archive;const s=(data?.schedules || []).find(x=>x.id===id);if(!s)return;const binding=data.devices.find(d=>d.node_id===s.node_id&&d.aircon_id===s.aircon_id);if(b.dataset.edit && binding)edit(binding,s);if(b.dataset.archive){b.disabled=true;try{await archive(s.id,s.version);await refresh();}catch(err){b.disabled=false;handleMutationError(err);}} });
    refresh();
    const poll=setInterval(()=>refresh(true),30000);
    return {setContext(next){room=next.roomId || null;if(Object.hasOwn(next,'nodeId'))node=next.nodeId || null;page=1;refresh();},destroy(){destroyed=true;seq++;clearInterval(poll);container.replaceChildren();}};
  }
  root.EcoTrackCommandSchedules={list,save,setAutomation,archive,openEditor,summarize,mountManager,activityStatus:run=>title(run?.status || 'unknown')};
})(window);
(function(){
  if (typeof document === 'undefined') return;
  const hours=document.getElementById('acs-hours'), commands=document.getElementById('acs-commands');
  if(!hours || !commands)return;
  const tabs=[document.getElementById('acs-hours-tab'),document.getElementById('acs-commands-tab')];
  const params=new URLSearchParams(window.location.search);
  let manager=null, currentRoom=null;
  const room=()=>typeof selectedRoomId === 'undefined' ? null : selectedRoomId;
  function show(index){tabs.forEach((tab,i)=>{tab.setAttribute('aria-selected',String(i===index));tab.tabIndex=i===index?0:-1;});hours.hidden=index!==0;commands.hidden=index!==1;if(index===1&&!manager){currentRoom=room();manager=window.EcoTrackCommandSchedules.mountManager(commands,{roomId:currentRoom,nodeId:params.get('node'),getRegisteredDevices:(roomId,nodeId)=>{
    if(typeof savedRooms==='undefined')return [];
    return nodeId ? Object.values(savedRooms).flatMap(r=>r.nodes || []).filter(r=>String(r.pb_id || r.id)===String(nodeId)) : savedRooms[roomId]?.nodes || [];
  }});}}
  tabs.forEach((tab,i)=>{tab.addEventListener('click',()=>show(i));tab.addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();const other=1-i;show(other);tabs[other].focus();}});});
  show(params.get('view')==='commands'?1:0);
  // A room-tree click is an intentional navigation; asynchronous restoration is not.
  document.getElementById('roomsList')?.addEventListener('click',()=>{setTimeout(()=>{const next=room();if(next!==currentRoom){currentRoom=next;manager?.setContext({roomId:next,nodeId:null});}},0);});
  // A registry refresh may finish after the command tab opens for a remembered room.
  window.addEventListener('scheduler:devices-updated',()=>{currentRoom=room();manager?.setContext({roomId:currentRoom});});
  // Room selection may be restored asynchronously by the existing scheduler.
  const timer=setInterval(()=>{const next=room();if(manager&&next!==currentRoom){currentRoom=next;manager.setContext({roomId:next});}},300);
  window.addEventListener('pagehide',()=>{clearInterval(timer);manager?.destroy();},{once:true});
})();

