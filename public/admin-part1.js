const $=s=>document.querySelector(s),KES=n=>new Intl.NumberFormat('en-KE',{style:'currency',currency:'KES',maximumFractionDigits:0}).format(Number(n)||0),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state={user:null,students:[],reportStudents:[],applications:[],attendance:[],staff:[],reports:[],attendanceDate:new Date().toISOString().slice(0,10),view:'overview',search:'',notice:'',paymentOpen:false};
const names={overview:'Overview',students:'Students',attendance:'Attendance',fees:'Fees',staff:'Staff',reports:'Parent reports',library:'Library',admissions:'Admissions'};
const todayText=new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
const feeTag=s=>s.balance_kes<=0?'<span class="tag t-paid"> paid</span>':s.paid_kes>0?'<span class="tag t-partial">Partial</span>':'<span class="tag t-owing">Owing</span>';
const attendanceTag=status=>status?`<span class="tag t-${esc(status)}">${esc(status)}</span>`:'<span class="note">Not marked</span>';
async function getCsrf(){const r=await fetch('/api/csrf',{credentials:'same-origin'});if(!r.ok)throw new Error('Could not prepare your request. Refresh and try again.');return(await r.json()).csrfToken}
// Navigation reflects the permissions already enforced by the server. It is not an authorization boundary.
const access={school_admin:['overview','students','attendance','fees','staff','reports','library','admissions'],admissions_officer:['overview','students','attendance','fees','admissions'],finance_officer:['overview','students','fees'],teacher:['attendance','reports']};
async function dashboardGet(url){const r=await fetch(url,{credentials:'same-origin'});if(r.status===401){location.href='/login.html';throw new Error('Session expired.')}let data;try{data=await r.json()}catch{throw new Error('Could not load dashboard data.')}if(!r.ok)throw new Error(data.error||'Could not load dashboard data.');return data}
async function load(){try{
  const me=await dashboardGet('/api/auth/me'),role=me.user?.role,allowed=access[role];
  if(!allowed)throw new Error('Your account does not have dashboard access.');
  const requests=[];
  if(role!=='teacher')requests.push(dashboardGet('/api/admin/students').then(d=>{state.students=d.students}));
  if(role==='school_admin'||role==='admissions_officer')requests.push(dashboardGet('/api/admin/applications').then(d=>{state.applications=d.applications}));
  if(role==='school_admin')requests.push(dashboardGet('/api/admin/staff').then(d=>{state.staff=d.staff}));
  if(role==='school_admin'||role==='teacher')requests.push(dashboardGet('/api/admin/parent-reports').then(d=>{state.reports=d.reports}));
  if(role==='teacher')requests.push(dashboardGet('/api/admin/report-students').then(d=>{state.reportStudents=d.students}));
  await Promise.all(requests);state.user=me.user;
  const changedView=!allowed.includes(state.view);if(changedView)state.view=allowed[0];
  if(changedView&&state.view==='attendance')await loadAttendance();else render();
}catch(e){$('#view').innerHTML='<h2>Dashboard unavailable</h2><p class="note">'+esc(e.message||'Refresh and try again.')+'</p>'}}

async function loadAttendance(){try{const r=await fetch('/api/admin/attendance?date='+encodeURIComponent(state.attendanceDate),{credentials:'same-origin'});if(r.status===401){location.href='/login.html';return}const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not load attendance.');state.attendance=d.attendance;state.attendanceDate=d.attendanceDate;render()}catch(e){state.notice=e.message||'Could not load attendance.';render()}}
