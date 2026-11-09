(function(root) {
  'use strict';
  const TYPE = 'ac_command_schedule';
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const isSchedule = record => record?.type === TYPE;
  const statusClasses = {
    sent:'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
    queued:'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
    missed:'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
    failed:'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
    skipped:'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    superseded:'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    unconfirmed:'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
  };
  const statusClass = status => Object.hasOwn(statusClasses, String(status).toLowerCase()) ? statusClasses[String(status).toLowerCase()] : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
  const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value);
  function stamp(value) {
    if (!value || !Number.isFinite(Date.parse(value))) return 'Unavailable';
    return new Intl.DateTimeFormat('en-SG',{timeZone:'Asia/Singapore',dateStyle:'medium',timeStyle:'short'}).format(new Date(value)) + ' UTC+08:00';
  }
  function scheduleUrl(record) {
    const s = record?.schedule_event;
    if (!isSchedule(record) || !s || !validId(s.id) || record.event_key !== `ac-schedule:${s.id}` || !validId(s.schedule_id) || !validId(s.node_id)) return null;
    const room = validId(s.room_id) && (!record.room_id || record.room_id === s.room_id) ? `&room=${encodeURIComponent(s.room_id)}` : '';
    return `scheduler.html?view=commands&node=${encodeURIComponent(s.node_id)}&schedule=${encodeURIComponent(s.schedule_id)}${room}`;
  }
  function toMessage(record, readState = {}) {
    if (!isSchedule(record)) return null;
    const s = record.schedule_event && typeof record.schedule_event === 'object' ? record.schedule_event : {};
    const status = ['queued','sent','missed','failed','skipped','superseded','unconfirmed'].includes(s.status) ? s.status : 'unavailable';
    const effective = status === 'sent' && (!s.transmitted_at || !Number.isFinite(Date.parse(s.transmitted_at))) ? 'unconfirmed' : status;
    const label = effective[0].toUpperCase() + effective.slice(1);
    const name = s.device_name || 'Controller unavailable';
    const state = s.intent?.state || {};
    const action = ({turn_on:'Turn on',turn_off:'Turn off',change_settings:'Change settings'})[s.action] || (state.power === 'off' ? 'Turn off' : 'Action unavailable');
    const settings = state.power === 'off' ? [] : [state.mode, state.temp == null ? null : `${state.temp} °C`, state.fan].filter(value => value != null && value !== '');
    const summary = [s.schedule_name || 'Command schedule', action, ...settings].join(' · ');
    const timestamp = s.scheduled_at && Number.isFinite(Date.parse(s.scheduled_at)) ? new Date(s.scheduled_at) : null;
    const parts = timestamp ? Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(timestamp).map(p=>[p.type,p.value])) : null;
    const room = record.room_id && s.room_id && String(record.room_id)!==String(s.room_id) ? '' : (s.room_id || record.room_id || '');
    return {id:record.id,pbId:record.id,type:TYPE,room_id:room,room,node:s.node_id || '',nodes:[name],schedule_event:s,event_key:record.event_key,date:parts ? `${parts.year}-${parts.month}-${parts.day}` : 'Unavailable',time:timestamp ? new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Singapore',hour:'2-digit',minute:'2-digit',hour12:true}).format(timestamp) : 'Unavailable',content:summary,status:label,triggered:record.triggered ?? true,read:Boolean(readState[String(record.id)])};
  }
  function renderDetails(s = {}, record = {}) {
    const state = s.intent?.state || {};
    const sent = s.status === 'sent' && s.transmitted_at && Number.isFinite(Date.parse(s.transmitted_at));
    const status = s.status === 'sent' && !sent ? 'unconfirmed' : (['queued','sent','missed','failed','skipped','superseded','unconfirmed'].includes(s.status) ? s.status : 'unavailable');
    const label = status[0].toUpperCase() + status.slice(1);
    const names = {swing_vertical:'Vertical swing',swing_horizontal:'Horizontal swing',sleep:'Sleep',turbo:'Turbo',eco:'Eco',quiet:'Quiet',display:'Display',clean:'Clean',beep:'Beep'};
    const extras = Object.entries(state).filter(([key,value]) => !['power','mode','temp','fan','special'].includes(key) && (value === 'on' || value === 'off'));
    if (state.special && typeof state.special === 'object') extras.push(...Object.entries(state.special));
    const special = extras.map(([key,value]) => `${names[key] || key.replace(/_/g,' ')} ${value}`).join(', ');
    const action = ({on:'Turn on',off:'Turn off',turn_on:'Turn on',turn_off:'Turn off',change:'Change settings',change_settings:'Change settings'})[s.action] || (state.power === 'off' ? 'Turn off' : 'Unavailable');
    const fields = [['Action',action], ...(state.power === 'off' ? [] : [['Mode',state.mode],['Temperature',state.temp == null ? '' : `${state.temp} °C`],['Fan speed',state.fan],['Special functions',special]])];
    const field = ([key,value]) => `<div class="flex justify-between gap-3"><dt class="text-gray-500 dark:text-gray-400">${escapeHtml(key)}</dt><dd class="font-semibold text-right break-words">${escapeHtml(value || 'Unavailable')}</dd></div>`;
    return `<section class="max-h-[60vh] overflow-y-auto"><h3 class="text-xl font-bold">Scheduled command ${escapeHtml(status)}</h3><span class="inline-flex mt-2 px-3 py-1 rounded-full text-xs font-bold ${statusClass(status)}">${escapeHtml(label)}</span>
      <div class="my-4 p-4 rounded-xl bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-white/10"><strong>${escapeHtml(s.device_name || 'Device unavailable')}</strong><p class="text-sm text-gray-500">${escapeHtml([s.aircon_name,s.room_name].filter(Boolean).join(' · ') || 'Location unavailable')}</p></div>
      <dl class="grid gap-3 border-b border-gray-200 dark:border-white/10 pb-4 text-sm">${field(['Schedule',s.schedule_name])}${field(['Triggered',stamp(s.scheduled_at)])}</dl>
      <dl class="grid sm:grid-cols-2 gap-x-8 gap-y-3 py-4 text-sm">${fields.map(field).join('')}</dl>
      ${sent ? `<p class="rounded-xl p-3 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 text-sm font-semibold">IR command transmitted at ${escapeHtml(stamp(s.transmitted_at))}.</p>` : s.reason ? `<p class="rounded-xl p-3 bg-gray-50 dark:bg-slate-900 text-sm">${escapeHtml(s.reason)}</p>` : ''}
      <p class="mt-3 text-sm text-gray-500">AC operation is not confirmed.</p>${scheduleUrl(record) ? '' : '<p class="mt-4 text-sm">Schedule link unavailable.</p>'}</section>`;
  }

  const api={TYPE,isSchedule,toMessage,renderDetails,scheduleUrl,escapeHtml,statusClass};
  if (typeof module==='object' && module.exports) module.exports=api; else root.EcoTrackScheduleNotifications=api;
})(typeof globalThis==='object'?globalThis:this);
