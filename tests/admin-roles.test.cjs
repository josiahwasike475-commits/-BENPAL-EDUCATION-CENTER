const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const path=require('node:path');
const files=['admin-part1.js','admin-part2.js','admin-part3.js','admin-part4.js','admin-part5.js','admin-part6.js','admin-part7.js'];
async function make(role,fail){
 const calls=[],listeners={},els={};
 const elem=id=>els[id]??=({id,innerHTML:'',value:'',disabled:false,addEventListener(){},focus(){},setSelectionRange(){}});
 const document={hidden:false,documentElement:{dataset:{}},querySelector:s=>elem(s),addEventListener:(type,fn)=>(listeners[type]??=[]).push(fn)};
 const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
 const allowed={school_admin:['students','applications','staff','parent-reports','attendance','report-students'],teacher:['report-students','parent-reports','attendance'],admissions_officer:['students','applications','attendance'],finance_officer:['students']};
 const dataset={'/api/auth/me':{user:{role,name:'Test'}},'/api/admin/students':{students:[{id:'s1',full_name:'Student',student_number:'S1',guardian_name:'Guardian',status:'active',balance_kes:500,charged_kes:600,paid_kes:100}]},'/api/admin/report-students':{students:[{id:'s1',full_name:'Student',student_number:'S1'}]},'/api/admin/applications':{applications:[{id:'a1',child_name:'Name',created_at:'2026-01-01'}]},'/api/admin/staff':{staff:[]},'/api/admin/parent-reports':{reports:[]},'/api/csrf':{csrfToken:'test'}};
 const context=vm.createContext({document,location:{href:''},localStorage:{getItem(){return null},setItem(){}},setInterval(){},confirm(){return true},alert(){},console,Intl,Date,Number,String,Promise,encodeURIComponent,fetch:async(url,opts={})=>{calls.push({url,opts});if(fail&&url===fail.url)return response({error:fail.error||'Failed'},fail.status);if(opts.method==='POST')return response({ok:true});let name=url.split('?')[0].split('/').at(-1);if(url.startsWith('/api/admin/')&&!allowed[role].includes(name))return response({error:'Forbidden'},403);if(name==='attendance')return response({attendance:[{student_id:'s1',full_name:'Student',student_number:'S1',status:null}],attendanceDate:url.split('date=')[1]});return response(dataset[url]??{},dataset[url]?200:404)}});
 for(const file of files)vm.runInContext(fs.readFileSync(path.join(__dirname,'../public',file),'utf8'),context,{filename:file});
 await new Promise(r=>setTimeout(r,20));return{context,calls,listeners,elem,run:s=>vm.runInContext(s,context)};
}
(async()=>{
 for(const role of ['school_admin','teacher','admissions_officer','finance_officer']){
  const t=await make(role);assert(!t.elem('#view').innerHTML.includes('Dashboard unavailable'),role);assert.equal(t.listeners.submit.length,1);assert.equal(t.listeners.click.length,1);assert(t.calls.every(c=>!c.opts.method),'Only read-only requests during load');
  const menu=t.elem('#menu').innerHTML;
  if(role==='school_admin'){assert(menu.includes('Library'));assert(t.run('page()').includes('Pending admissions'));assert(t.calls.some(c=>c.url==='/api/admin/staff'));}
  if(role==='teacher'){assert(!menu.includes('Library'));assert(menu.includes('Attendance')&&menu.includes('Parent reports'));assert(!t.calls.some(c=>c.url==='/api/admin/students'));assert(t.calls.some(c=>c.url.startsWith('/api/admin/attendance?')));assert(t.run('parentReports()').includes('Student'));}
  if(role==='admissions_officer'){assert(menu.includes('Fees'));assert(t.run('students()').includes('Fee balance'));assert(t.run('overview()').includes('Pending admissions'));}
  if(role==='finance_officer'){assert(!menu.includes('Attendance'));assert(!t.run('students()').includes('Mark attendance'));assert(!t.run('overview()').includes('Pending admissions'));assert(t.run('overview()').includes('Fees outstanding'));}
  t.run("state.notice='Previous status';state.paymentOpen=true");const link={dataset:{view:role==='teacher'?'reports':'students'}};await t.listeners.click[0]({target:{closest:s=>s==='[data-view]'?link:null}});assert.equal(t.run('state.notice'),'');assert.equal(t.run('state.paymentOpen'),false);
 }
 const denied=await make('teacher',{url:'/api/admin/parent-reports',status:403,error:'Denied'});assert(denied.elem('#view').innerHTML.includes('Dashboard unavailable'));assert(denied.elem('#view').innerHTML.includes('Denied'));
 const expired=await make('school_admin',{url:'/api/auth/me',status:401});assert.equal(expired.context.location.href,'/login.html');
 console.log('PASS role-specific loading for four existing roles, original fee visibility, no fabricated pending admissions, teacher report/attendance, navigation, notice and payment-form reset, single delegated listeners, denial and expired session (mocked read-only APIs)');
})().catch(e=>{console.error(e);process.exitCode=1});
