'use client';

import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import ScreeningWorkspace, { preloadScreeningData } from './screening-workspace';
import { buildSpeechHints, contextualizeSpeechTranscript, selectContextualSpeechTranscript } from '@/app/speech-context';
import { announceWorkbenchChange, useWorkbenchSync } from '@/app/workbench-sync';
import { AiInterviewResultPanel, aiInterviewQuestionTotal } from '@/app/components/ai-interview-result';
import AiInterviewRecordings from '@/app/components/ai-interview-recordings';
import RoleManagement from '@/app/components/role-management';
import { CANDIDATE_STAGES, candidateStageIndex, normalizeCandidateStage } from '@/app/candidate-stages';
import { CHINA_CITIES, CHINA_CITY_GROUPS } from '@/app/china-cities';
import { questionMaxScores, weightedQuestionScore } from '@/app/interview-score-weights';

type Account = { id:string; contact:string; phone:string; email:string; role:'super_admin'|'hr'; createdAt:string };
type Job = { id:string; title:string; department:string; city:string; status:string; headcount:number; ownerName:string; createdAt:string; updatedAt:string };
type Candidate = { id:string; jobId:string|null; name:string; role:string; company:string; years:string; stage:string; source:string; skills:string[]; score:number|null; phone:string; email:string; city:string; gender?:string; age?:number|null; education?:string; workYears?:number|null; resumeFileName?:string; assignedHrId?:string; assignedHrName?:string; assignedAt?:string; createdAt:string; updatedAt:string };
type Interview = { id:string; candidateId:string; scheduledAt:string; round:string; mode:string; interviewer:string; status:string; createdAt:string; updatedAt:string };
type Offer = { id:string; candidateId:string; jobTitle:string; salary:string; recipientEmail:string; content:string; ownerName:string; status:string; deadline:string; createdAt:string; updatedAt:string };
type AiQuestion = { id:string; jobId:string|null; title:string; category:string; questionType:string; duration:number; competency:string; keywords:string; referenceAnswer:string; followUp:boolean; createdAt:string; updatedAt:string };
type AiInterview = { id:string; candidateId:string; jobTitle:string; status:string; score:number|null; durationSeconds:number|null; summary:string; completedAt:string|null; createdAt:string; updatedAt:string };
type AiInvitation = { id:string; candidateId:string; recipientEmail:string; jobTitle:string; status:string; sentAt:string; openedAt:string|null; completedAt:string|null; expiresAt:string; interviewUrl:string; createdAt:string; updatedAt:string };
type ManualAssessment = { candidateId:string; total:number; professional:number; communication:number; culture:number; comment:string; reviewer:string; updatedAt:string };
type RecipientAccount = { id:string; contact:string; phone:string; email:string; role:'super_admin'|'hr' };
type CandidateFactType = 'gender'|'age'|'work'|'education'|'phone'|'email';
type AnswerScore = { score:number; keywords:string[]; matched:string[] };
type SpeechAlternativeLike = { transcript:string;confidence?:number };
type SpeechResultLike = { [index:number]:SpeechAlternativeLike;length:number;isFinal?:boolean };
type SpeechRecognitionEventLike = { resultIndex?:number;results:ArrayLike<SpeechResultLike> };
type SpeechRecognitionLike = {
  lang:string; continuous:boolean; interimResults:boolean; maxAlternatives?:number; phrases?:SpeechRecognitionPhraseLike[];
  start:(track?:MediaStreamTrack)=>void; stop:()=>void; abort:()=>void;
  onresult:((event:SpeechRecognitionEventLike)=>void)|null;
  onend:(()=>void)|null; onerror:((event:{error?:string})=>void)|null;
};
type SpeechRecognitionPhraseLike = { phrase:string;boost:number };
type SpeechRecognitionConstructor = new()=>SpeechRecognitionLike;
type Dataset = { account:Account; jobs:Job[]; candidates:Candidate[]; interviews:Interview[]; offers:Offer[]; aiQuestions:AiQuestion[]; aiInterviews:AiInterview[]; aiInvitations:AiInvitation[]; manualAssessments:ManualAssessment[]; recipientAccounts:RecipientAccount[] };
type ModalName = 'job'|'candidateEntry'|'candidate'|'interview'|'offer'|'question'|'questionGenerator'|'aiResult'|'profile'|'password'|null;

const nav = [['⌂','工作台'],['▣','职位管理'],['♙','候选人管理'],['▤','简历筛选'],['◉','AI 面试'],['◴','面试管理'],['✓','Offer 管理'],['↗','招聘数据'],['♜','角色管理']];
const stages:string[] = [...CANDIDATE_STAGES];
const jobStatuses = ['草稿','招聘中','急聘','已暂停','已关闭'];
const jobStatusPriority:Record<string,number> = { '急聘':0,'招聘中':1,'草稿':2,'已暂停':3,'已关闭':4 };
const interviewStatuses = ['待确认','已确认','已完成','已取消'];
const offerStatuses = ['待审批','已发放','已接受','已拒绝','已撤回'];
const rejectedCandidateStages = new Set(['初筛淘汰','淘汰人才库','已淘汰']);
const cityPickerGroups:[string,string[]][] = [
  ['直辖市',CHINA_CITY_GROUPS.slice(0,4).map(([,cities])=>cities).join('|').split('|')],
  ...CHINA_CITY_GROUPS.slice(4).map(([province,cities])=>[province,cities.split('|')] as [string,string[]]),
];

export default function WorkbenchClient() {
  const [data,setData]=useState<Dataset|null>(null);
  const [active,setActive]=useState('工作台');
  const [search,setSearch]=useState('');
  const [modal,setModal]=useState<ModalName>(null);
  const [resumeImportRequested,setResumeImportRequested]=useState(false);
  const [drawer,setDrawer]=useState<{type:'job'|'candidate';id:string}|null>(null);
  const [notice,setNotice]=useState(false);
  const [accountOpen,setAccountOpen]=useState(false);
  const [accountError,setAccountError]=useState('');
  const [accountSaving,setAccountSaving]=useState(false);
  const [modalSaving,setModalSaving]=useState(false);
  const [editingJob,setEditingJob]=useState<Job|null>(null);
  const [editingQuestion,setEditingQuestion]=useState<AiQuestion|null>(null);
  const [editingInterview,setEditingInterview]=useState<Interview|null>(null);
  const [editingOffer,setEditingOffer]=useState<Offer|null>(null);
  const [assignmentTarget,setAssignmentTarget]=useState<Candidate|null>(null);
  const [assignmentSaving,setAssignmentSaving]=useState(false);
  const [toast,setToast]=useState<{text:string;tone:'success'|'error'|'info'}|null>(null);
  const [error,setError]=useState('');
  const saveInFlight=useRef(false);

  async function loadData() {
    const response = await fetch('/api/workbench', { cache:'no-store' });
    if (response.status === 401) { window.location.assign('/'); return; }
    if (!response.ok) { setError('真实数据暂时无法加载，请稍后刷新。'); return; }
    const nextData=await response.json() as Dataset;
    if(nextData.account.role!=='super_admin'){window.location.assign('/interviewer-candidate');return}
    setData(nextData);
    void preloadScreeningData().catch(()=>undefined);
    setError('');
  }

  useEffect(()=>{ void loadData(); },[]);
  useWorkbenchSync(()=>saveInFlight.current?undefined:loadData());
  useEffect(()=>{const closeAccount=(event:MouseEvent)=>{if(!(event.target instanceof Element)||!event.target.closest('.account-area'))setAccountOpen(false)};document.addEventListener('mousedown',closeAccount);return()=>document.removeEventListener('mousedown',closeAccount)},[]);

  async function create(resource:string,payload:Record<string,unknown>) {
    if(saveInFlight.current)return;
    saveInFlight.current=true;setModalSaving(true);
    try{
      const response=await fetch('/api/workbench',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({resource,payload})});
      const result=await response.json().catch(()=>({})) as {message?:string};
      if(response.status===401){window.location.assign('/');return}
      if(!response.ok){flash('保存失败');return}
      setModal(null);announceWorkbenchChange();await loadData();flash('保存成功');
    }catch{flash('保存失败')}finally{saveInFlight.current=false;setModalSaving(false)}
  }

  async function updateQuestion(id:string,payload:Record<string,unknown>){
    if(saveInFlight.current)return;
    saveInFlight.current=true;setModalSaving(true);
    try{
      const response=await fetch('/api/workbench',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({resource:'aiQuestion',id,payload})});
      const result=await response.json().catch(()=>({})) as {message?:string};
      if(response.status===401){window.location.assign('/');return}
      if(!response.ok){flash('保存失败');return}
      setModal(null);setEditingQuestion(null);announceWorkbenchChange();await loadData();flash('保存成功');
    }catch{flash('保存失败')}finally{saveInFlight.current=false;setModalSaving(false)}
  }

  async function generateQuestions(payload:Record<string,unknown>){
    if(saveInFlight.current)return;
    saveInFlight.current=true;setModalSaving(true);
    try{
      const response=await fetch('/api/workbench',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({resource:'generateAiQuestions',payload})});
      const result=await response.json().catch(()=>({})) as {message?:string;count?:number};
      if(response.status===401){window.location.assign('/');return}
      if(!response.ok){flash(result.message||'面试题生成失败，请稍后重试。');return}
      setModal(null);announceWorkbenchChange();await loadData();flash(result.count?`已生成并保存 ${result.count} 道岗位面试题`:'该岗位的推荐题目已经存在');
    }catch{flash('面试题生成失败，请检查网络后重试。')}finally{saveInFlight.current=false;setModalSaving(false)}
  }

  async function deleteQuestion(question:AiQuestion){
    if(saveInFlight.current||!window.confirm(`确认删除面试题“${question.title}”吗？删除后无法恢复。`))return false;
    saveInFlight.current=true;
    try{
      const response=await fetch('/api/workbench',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({resource:'aiQuestion',id:question.id})});
      const result=await response.json().catch(()=>({})) as {message?:string};
      if(response.status===401){window.location.assign('/');return false}
      if(!response.ok){flash(result.message||'面试题删除失败，请稍后重试。');return false}
      announceWorkbenchChange();await loadData();flash('面试题已删除');return true;
    }catch{flash('面试题删除失败，请检查网络后重试。');return false}
    finally{saveInFlight.current=false}
  }

  async function updateJob(id:string,payload:Record<string,unknown>){
    if(saveInFlight.current)return;
    saveInFlight.current=true;setModalSaving(true);
    try{
      const response=await fetch('/api/workbench',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({resource:'job',id,payload})});
      const result=await response.json().catch(()=>({})) as {message?:string};
      if(response.status===401){window.location.assign('/');return}
      if(!response.ok){flash('保存失败');return}
      setModal(null);setEditingJob(null);announceWorkbenchChange();await loadData();flash('保存成功');
    }catch{flash('保存失败')}finally{saveInFlight.current=false;setModalSaving(false)}
  }

  async function saveAiInterview(payload:Record<string,unknown>){
    if(saveInFlight.current)return false;
    saveInFlight.current=true;
    try{
      const response=await fetch('/api/workbench',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({resource:'aiInterview',payload})});
      const result=await response.json().catch(()=>({})) as {message?:string};
      if(response.status===401){window.location.assign('/');return false}
      if(!response.ok){flash('保存失败');return false}
      announceWorkbenchChange();await loadData();flash('保存成功');return true;
    }catch{flash('保存失败');return false}
    finally{saveInFlight.current=false}
  }

  async function sendAiInvitation(candidateId:string,validityHours:number){
    if(saveInFlight.current)return false;
    saveInFlight.current=true;
    try{
      const response=await fetch('/api/workbench',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({resource:'aiInterviewInvite',payload:{candidateId,validityHours}})});
      const result=await response.json().catch(()=>({})) as {message?:string;sent?:boolean;mailtoUrl?:string;recipientEmail?:string;interviewUrl?:string;testMode?:boolean};
      if(response.status===401){window.location.assign('/');return false}
      if(!response.ok){flash(result.message||'面试邀请生成失败，请稍后重试。');return false}
      announceWorkbenchChange();await loadData();
      if(result.mailtoUrl)window.location.href=result.mailtoUrl;
      if(result.sent&&result.interviewUrl)flash(`AI 面试邀请已发送至 ${result.recipientEmail}，地址可一键复制`);
      else if(result.interviewUrl)flash(result.mailtoUrl?'邀请邮件已生成，请在邮箱中确认发送；地址也可一键复制':'AI 面试邀请地址已生成，可一键复制');
      return result.interviewUrl?{interviewUrl:result.interviewUrl,testMode:Boolean(result.testMode)}:false;
    }catch{flash('面试邀请生成失败，请检查网络后重试。');return false}
    finally{saveInFlight.current=false}
  }

  async function updateInterview(id:string,payload:Record<string,unknown>){
    if(saveInFlight.current)return;
    saveInFlight.current=true;setModalSaving(true);
    try{
      const response=await fetch('/api/workbench',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({resource:'interview',id,payload})});
      const result=await response.json().catch(()=>({})) as {message?:string};
      if(response.status===401){window.location.assign('/');return}
      if(!response.ok){flash('保存失败');return}
      setModal(null);setEditingInterview(null);announceWorkbenchChange();await loadData();flash('保存成功');
    }catch{flash('保存失败')}finally{saveInFlight.current=false;setModalSaving(false)}
  }

  async function updateOffer(id:string,payload:Record<string,unknown>){
    if(saveInFlight.current)return;
    saveInFlight.current=true;setModalSaving(true);
    try{
      const response=await fetch('/api/workbench',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({resource:'offer',id,payload})});
      const result=await response.json().catch(()=>({})) as {message?:string};
      if(response.status===401){window.location.assign('/');return}
      if(!response.ok){flash('保存失败');return}
      setModal(null);setEditingOffer(null);announceWorkbenchChange();await loadData();flash('保存成功');
    }catch{flash('保存失败')}finally{saveInFlight.current=false;setModalSaving(false)}
  }

  async function deleteOffer(offer:Offer){
    const name=data?.candidates.find(item=>item.id===offer.candidateId)?.name||'该候选人';
    if(saveInFlight.current||!window.confirm(`确认删除${name}的 Offer 吗？删除后无法恢复。`))return;
    saveInFlight.current=true;
    try{
      const response=await fetch('/api/workbench',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({resource:'offer',id:offer.id})});
      const result=await response.json().catch(()=>({})) as {message?:string};
      if(response.status===401){window.location.assign('/');return}
      if(!response.ok){flash(result.message||'Offer 删除失败，请稍后重试。');return}
      announceWorkbenchChange();await loadData();flash('Offer 已删除');
    }catch{flash('Offer 删除失败，请检查网络后重试。')}finally{saveInFlight.current=false}
  }

  async function update(resource:string,id:string,value:string,success:string) {
    const response=await fetch('/api/workbench',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({resource,id,value})});
    const result=await response.json().catch(()=>({})) as {message?:string};
    if(!response.ok){flash(result.message||'更新失败，请稍后重试。');return false}
    announceWorkbenchChange();await loadData();flash(success);return true;
  }

  async function updateCandidateFact(id:string,field:CandidateFactType,value:string){
    const response=await fetch('/api/workbench',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({resource:'candidateFact',id,payload:{field,value}})});
    const result=await response.json().catch(()=>({})) as {message?:string};
    if(!response.ok){flash(result.message||'候选人信息保存失败');return false}
    announceWorkbenchChange();await loadData();flash('候选人信息已更新');return true;
  }

  async function assignCandidate(candidate:Candidate,recipientId:string){
    if(saveInFlight.current)return;
    saveInFlight.current=true;setAssignmentSaving(true);
    try{
      const response=await fetch('/api/screening',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'assignCandidate',candidateIds:[candidate.id],hrAccountId:recipientId})});
      const result=await response.json().catch(()=>({})) as {message?:string;recipientAccount?:RecipientAccount};
      if(response.status===401){window.location.assign('/');return}
      if(!response.ok){flash(result.message||'推送失败，请稍后重试。');return}
      setAssignmentTarget(null);announceWorkbenchChange();await loadData();flash(`已推送给${result.recipientAccount?.contact||'所选接收人'}`);
    }catch{flash('推送失败，请检查网络后重试。')}finally{saveInFlight.current=false;setAssignmentSaving(false)}
  }

  function flash(text:string){const tone=text.includes('失败')||text.includes('错误')?'error':text.includes('成功')||text.includes('已更新')?'success':'info';setToast({text,tone});window.setTimeout(()=>setToast(null),text==='请补充有效邮箱'?3000:2300)}
  async function logout(){await fetch('/api/auth/logout',{method:'POST'});window.location.assign('/')}
  function switchHiringDepartment(){setAccountOpen(false);window.location.assign('/interviewer-candidate')}
  function openAccountModal(name:'profile'|'password'){setAccountError('');setAccountOpen(false);setModal(name)}
  async function updateAccount(action:'profile'|'password',payload:Record<string,unknown>){
    if(saveInFlight.current)return;
    saveInFlight.current=true;
    setAccountSaving(true);setAccountError('');
    try{
      const response=await fetch('/api/auth/account',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...payload})});
      const result=await response.json().catch(()=>({})) as {message?:string;account?:Account};
      if(response.status===401){window.location.assign('/');return}
      if(!response.ok){setAccountError(result.message||'账号信息更新失败，请稍后重试。');flash('保存失败');return}
      if(result.account)setData(current=>current?{
        ...current,
        account:result.account as Account,
        jobs:action==='profile'?current.jobs.map(job=>({...job,ownerName:result.account!.contact})):current.jobs,
        interviews:action==='profile'?current.interviews.map(interview=>({...interview,interviewer:result.account!.contact})):current.interviews,
        offers:action==='profile'?current.offers.map(offer=>({...offer,ownerName:result.account!.contact})):current.offers,
      }:current);
      if(action==='profile'){announceWorkbenchChange();await loadData()}
      setModal(null);flash('保存成功');
    }catch{setAccountError('账号信息更新失败，请检查网络后重试。');flash('保存失败')}finally{saveInFlight.current=false;setAccountSaving(false)}
  }

  const filteredJobs=useMemo(()=>data?[...data.jobs.filter(item=>(item.title+item.department+item.city).toLowerCase().includes(search.toLowerCase()))].sort(compareJobs):[],[data,search]);
  const filteredCandidates=useMemo(()=>data?.candidates.filter(item=>(item.name+item.role+item.company+item.source+item.skills.join('')).toLowerCase().includes(search.toLowerCase()))||[],[data,search]);
  const activeCandidates=useMemo(()=>data?.candidates.filter(item=>!rejectedCandidateStages.has(item.stage))||[],[data]);
  const activeCandidateIds=useMemo(()=>new Set(activeCandidates.map(item=>item.id)),[activeCandidates]);
  const visibleInterviews=useMemo(()=>data?.interviews.filter(item=>activeCandidateIds.has(item.candidateId))||[],[data,activeCandidateIds]);
  const visibleAiInterviews=useMemo(()=>data?.aiInterviews.filter(item=>activeCandidateIds.has(item.candidateId))||[],[data,activeCandidateIds]);
  const pendingCount=data ? activeCandidates.filter(item=>item.stage!=='已入职').length+visibleInterviews.filter(item=>item.status==='待确认').length : 0;

  if(!data)return <main className="dashboard-loading"><span>星</span><b>{error||'正在读取真实业务数据…'}</b>{error&&<button onClick={()=>void loadData()}>重新加载</button>}</main>;
  const selectedJob=drawer?.type==='job'?data.jobs.find(item=>item.id===drawer.id):undefined;
  const selectedCandidate=drawer?.type==='candidate'?data.candidates.find(item=>item.id===drawer.id):undefined;

  return <main className="dashboard-shell">
    <aside className="dashboard-sidebar">
      <a className="dash-logo" href="/workbench"><span>星</span><b>星鉴人才</b></a>
      <nav><p>招聘管理</p>{nav.map(([icon,label])=><button key={label} className={active===label?'active':''} onClick={()=>{setActive(label);setSearch('')}}><i>{icon}</i><span>{label}</span>{label==='AI 面试'&&<em>AI</em>}</button>)}</nav>
      <div className="sidebar-help"><b>真实数据模式</b><p>仅展示当前账号实际保存的记录</p><button onClick={()=>setActive('招聘数据')}>查看数据来源</button></div>
      <button className="back-login sidebar-logout" onClick={()=>void logout()}>← 安全退出</button>
    </aside>
    <section className="dashboard-main">
      <header className="dashboard-header"><div className="global-search"><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="搜索真实职位、候选人或来源…"/><button type="button" className="global-search-button" aria-label="搜索"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg></button></div><div className="header-tools"><button className="round-button notice-button" aria-label="查看实时待办" onClick={()=>{setNotice(!notice);setAccountOpen(false)}}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>{pendingCount>0&&<b>{pendingCount}</b>}</button><button className="round-button" onClick={()=>flash('所有指标均由当前账号记录实时计算')}>?</button><div className="account-area"><button type="button" className={'user-info account-trigger '+(accountOpen?'open':'')} aria-expanded={accountOpen} onClick={()=>{setAccountOpen(!accountOpen);setNotice(false)}}><span>{data.account.contact.slice(0,1)}</span><div><b>{data.account.phone?maskPhone(data.account.phone):data.account.email}</b><small>超级管理员</small></div><i>⌄</i></button>{accountOpen&&<div className="account-menu"><header><span>{data.account.contact.slice(0,1)}</span><div><b>{data.account.contact}</b><small>{data.account.email||(data.account.phone?maskPhone(data.account.phone):'未绑定')}</small></div></header><section><p><span>手机号</span><b>{maskPhone(data.account.phone)}</b></p><p><span>邮箱</span><b>{data.account.email||'未绑定'}</b></p></section><button type="button" className="account-switch" onClick={switchHiringDepartment}><i>⇄</i><div><b>切换用人部门</b><small>进入用人部门候选人工作台</small></div><em>›</em></button><button type="button" onClick={()=>openAccountModal('profile')}><i>◎</i><div><b>个人资料</b><small>修改账号显示姓名</small></div><em>›</em></button><button type="button" onClick={()=>openAccountModal('password')}><i>⌾</i><div><b>登录与安全</b><small>验证当前密码后修改</small></div><em>›</em></button><button type="button" className="account-logout" onClick={()=>void logout()}><i>↪</i><div><b>安全退出</b><small>退出当前登录账号</small></div></button></div>}</div>{notice&&<div className="notice-pop"><b>实时待办</b>{pendingCount===0?<p>暂无待处理记录</p>:<><p>{activeCandidates.filter(item=>item.stage!=='已入职').length} 位候选人待推进</p><p>{visibleInterviews.filter(item=>item.status==='待确认').length} 场面试待确认</p></>}</div>}</div></header>
      <div className="dashboard-content">
        {active==='工作台'&&<Home data={{...data,interviews:visibleInterviews}} go={setActive} newJob={()=>{setEditingJob(null);setModal('job')}}/>}
        {active==='职位管理'&&<Jobs jobs={filteredJobs} candidates={data.candidates} interviews={visibleInterviews} onNew={()=>{setEditingJob(null);setModal('job')}} onPick={id=>setDrawer({type:'job',id})} updateStatus={(id,value)=>void update('jobStatus',id,value,'职位状态已更新')}/>}
        {active==='候选人管理'&&(
          <Talent people={filteredCandidates} aiInterviews={data.aiInterviews} onNew={()=>setModal('candidateEntry')} onPick={id=>setDrawer({type:'candidate',id})}/>
        )}
        {active==='简历筛选'&&(
          <ScreeningWorkspace people={filteredCandidates} jobs={data.jobs} questions={data.aiQuestions} account={data.account} reload={loadData} openCandidate={id=>setDrawer({type:'candidate',id})} openNewJob={()=>{setEditingJob(null);setActive('职位管理');setModal('job')}} flash={flash} openImport={resumeImportRequested} onImportOpened={()=>setResumeImportRequested(false)}/>
        )}
        {active==='AI 面试'&&<AiStudio
          data={{...data,candidates:activeCandidates,aiInterviews:visibleAiInterviews}}
          openQuestion={question=>{setEditingQuestion(question||null);setModal('question')}}
          openGenerator={()=>setModal('questionGenerator')}
          deleteQuestion={deleteQuestion}
          openResult={()=>setModal('aiResult')}
          saveResult={saveAiInterview}
          sendInvite={sendAiInvitation}
          flash={flash}
        />}
        {active==='面试管理'&&<Interviews items={visibleInterviews} people={activeCandidates} onNew={()=>{setEditingInterview(null);setModal('interview')}} onPick={id=>{setEditingInterview(visibleInterviews.find(item=>item.id===id)||null);setModal('interview')}} updateStatus={(id,value)=>void update('interviewStatus',id,value,'面试状态已更新')}/>}
        {active==='Offer 管理'&&<Offers items={data.offers} people={data.candidates} onNew={()=>{setEditingOffer(null);setModal('offer')}} onEdit={offer=>{setEditingOffer(offer);setModal('offer')}} onDelete={offer=>void deleteOffer(offer)} updateStatus={(id,value)=>void update('offerStatus',id,value,'Offer 状态已更新')}/>}
        {active==='招聘数据'&&<Analytics data={data}/>}
        {active==='角色管理'&&<RoleManagement flash={flash}/>}
      </div>
    </section>
    {modal==='candidateEntry'&&<CandidateEntryModal close={()=>setModal(null)} manual={()=>setModal('candidate')} upload={()=>{setModal(null);setResumeImportRequested(true);setActive('简历筛选')}}/>}
    {modal==='job'&&<JobModal job={editingJob} close={()=>{if(!modalSaving){setModal(null);setEditingJob(null)}}} submitting={modalSaving} submit={form=>editingJob?void updateJob(editingJob.id,formObject(form)):void create('job',formObject(form))}/>}
    {modal==='candidate'&&<CandidateModal jobs={data.jobs} close={()=>setModal(null)} upload={()=>{setModal(null);setResumeImportRequested(true);setActive('简历筛选')}} submitting={modalSaving} submit={form=>void create('candidate',formObject(form))}/>}
    {modal==='interview'&&<InterviewModal interview={editingInterview} people={activeCandidates} close={()=>{if(!modalSaving){setModal(null);setEditingInterview(null)}}} submitting={modalSaving} submit={form=>editingInterview?void updateInterview(editingInterview.id,formObject(form)):void create('interview',formObject(form))}/>}
    {modal==='offer'&&<OfferModal offer={editingOffer} people={data.candidates} close={()=>{if(!modalSaving){setModal(null);setEditingOffer(null)}}} submitting={modalSaving} submit={form=>editingOffer?void updateOffer(editingOffer.id,formObject(form)):void create('offer',formObject(form))}/>}
    {modal==='question'&&<QuestionModal question={editingQuestion} jobs={data.jobs} close={()=>{if(!modalSaving){setModal(null);setEditingQuestion(null)}}} submitting={modalSaving} submit={form=>editingQuestion?void updateQuestion(editingQuestion.id,formObject(form)):void create('aiQuestion',formObject(form))}/>}
    {modal==='questionGenerator'&&<QuestionGeneratorModal jobs={data.jobs} close={()=>{if(!modalSaving)setModal(null)}} submitting={modalSaving} submit={form=>void generateQuestions(formObject(form))}/>}
    {modal==='aiResult'&&<AiResultModal people={activeCandidates} close={()=>setModal(null)} submitting={modalSaving} submit={form=>void create('aiInterview',formObject(form))}/>}
    {modal==='profile'&&<ProfileModal account={data.account} close={()=>setModal(null)} error={accountError} submitting={accountSaving} submit={form=>void updateAccount('profile',formObject(form))}/>}
    {modal==='password'&&<PasswordModal close={()=>setModal(null)} error={accountError} submitting={accountSaving} submit={form=>void updateAccount('password',formObject(form))}/>}
    {selectedJob&&<JobDrawer job={selectedJob} candidates={data.candidates} interviews={visibleInterviews} offers={data.offers} close={()=>setDrawer(null)} edit={()=>{setDrawer(null);setEditingJob(selectedJob);setModal('job')}}/>}
    {selectedCandidate&&<CandidateDrawer
      person={selectedCandidate}
      aiInterview={data.aiInterviews.find(item=>item.candidateId===selectedCandidate.id)}
      assessment={data.manualAssessments.find(item=>item.candidateId===selectedCandidate.id)}
      aiCompleted={data.aiInterviews.some(item=>item.candidateId===selectedCandidate.id&&item.status==='已完成')}
      interviewCompleted={data.interviews.some(item=>item.candidateId===selectedCandidate.id&&item.status==='已完成'&&item.round!=='AI 初面')}
      offerAccepted={data.offers.some(item=>item.candidateId===selectedCandidate.id&&item.status==='已接受')}
      canApproveDepartment={selectedCandidate.assignedHrId===data.account.id}
      close={()=>setDrawer(null)}
      saveFact={(field,value)=>updateCandidateFact(selectedCandidate.id,field,value)}
      advance={value=>update('candidateStage',selectedCandidate.id,value,'候选人阶段已更新')}
      requestAssignment={()=>setAssignmentTarget(selectedCandidate)}
    />}
    {assignmentTarget&&<CandidateAssignmentDialog candidate={assignmentTarget} accounts={data.recipientAccounts||[]} busy={assignmentSaving} close={()=>{if(!assignmentSaving)setAssignmentTarget(null)}} submit={recipientId=>void assignCandidate(assignmentTarget,recipientId)}/>}
    {toast&&<div className={`dashboard-toast ${toast.tone}${toast.text==='请补充有效邮箱'?' prominent':''}`} role="status" aria-live="polite">{toast.tone==='success'?'✓ ':toast.tone==='error'?'! ':''}{toast.text}</div>}
  </main>
}

function Head({path,title,sub,action,click}:{path:string;title:string;sub:string;action?:string;click?:()=>void}){return <div className="subpage-head"><div><p>招聘管理 / {path}</p><h1>{title}</h1><small>{sub}</small></div>{action&&<button className="new-job" onClick={click}>＋ {action}</button>}</div>}

function Home({data,go,newJob}:{data:Dataset;go:(page:string)=>void;newJob:()=>void}){
  const today=new Date();const monthStart=new Date(today.getFullYear(),today.getMonth(),1);const activeJobs=data.jobs.filter(item=>['招聘中','急聘'].includes(item.status));const monthCandidates=data.candidates.filter(item=>new Date(item.createdAt)>=monthStart);const pendingCandidates=data.candidates.filter(item=>item.stage!=='已入职');const pendingInterviews=data.interviews.filter(item=>item.status==='待确认');const joined=data.candidates.filter(item=>item.stage==='已入职'&&new Date(item.updatedAt)>=monthStart);const todayInterviews=data.interviews.filter(item=>sameDay(new Date(item.scheduledAt),today));
  const orderedJobs=[...data.jobs].sort(compareJobs);
  const kpis=[['▣','招聘中职位',activeJobs.length,`全部职位 ${data.jobs.length} 个`,'purple-bg','职位管理'],['♙','本月新增候选人',monthCandidates.length,`候选人共 ${data.candidates.length} 人`,'blue-bg','候选人管理'],['◴','待处理事项',pendingCandidates.length+pendingInterviews.length,`候选人 ${pendingCandidates.length} · 面试 ${pendingInterviews.length}`,'orange-bg','简历筛选'],['✓','本月已入职',joined.length,`累计入职 ${data.candidates.filter(item=>item.stage==='已入职').length} 人`,'green-bg','Offer 管理']];
  const stageCounts=[['简历筛选',data.candidates.length],['AI面试',data.candidates.filter(item=>stageIndex(item.stage)>=1).length],['安排面试',data.candidates.filter(item=>stageIndex(item.stage)>=3).length],['录用',data.candidates.filter(item=>stageIndex(item.stage)>=4).length],['已入职',data.candidates.filter(item=>item.stage==='已入职').length]] as [string,number][];const max=Math.max(stageCounts[0][1],1);
  const reviewPriority=data.candidates.filter(item=>['简历筛选','用人部门筛选'].includes(item.stage)).length;const interviewPriority=data.candidates.filter(item=>['AI面试','安排面试'].includes(item.stage)).length;const insightTitle=reviewPriority?`有 ${reviewPriority} 位候选人等待筛选复核`:interviewPriority?`有 ${interviewPriority} 位候选人等待面试推进`:activeJobs.length?`当前 ${activeJobs.length} 个职位保持招聘中`:'当前没有需要立即处理的招聘事项';const insightText=reviewPriority?'建议优先完成简历核验与用人部门筛选，及时推进合适人才。':interviewPriority?'建议尽快确认面试安排，避免候选人在流程中等待过久。':activeJobs.length?'职位运行正常，可继续导入候选人并关注招聘漏斗转化。':'发布新职位后，这里会根据真实招聘进度给出下一步建议。';const insightTarget=reviewPriority||interviewPriority?'简历筛选':'职位管理';
  return <><section className="welcome-row"><div><p>{formatLongDate(today)}</p><h1>{greeting(today)}，{data.account.contact} <span>👋</span></h1><small>当前有 <b>{pendingCandidates.length+pendingInterviews.length} 项</b> 真实招聘记录等待处理。</small></div><button className="new-job" onClick={newJob}>＋ 发布新职位</button></section><section className="kpi-grid">{kpis.map(item=><article className="clickable" role="button" tabIndex={0} onClick={()=>go(String(item[5]))} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();go(String(item[5]))}}} key={String(item[1])}><div className={'kpi-icon '+item[4]}>{item[0]}</div><span>{item[1]}<em>实时数据</em></span><strong>{item[2]}</strong><small>{item[3]}</small></article>)}</section><section className="dashboard-grid"><article className="panel job-panel"><div className="panel-title"><div><h3>重点职位进展</h3><p>来自当前账号保存的职位与候选人记录</p></div><button onClick={()=>go('职位管理')}>查看全部 →</button></div><div className="job-head"><span>职位名称</span><span>候选人</span><span>流程中</span><span>面试</span><span>状态</span></div>{data.jobs.length===0?<Empty compact title="暂无真实职位" text="发布第一个职位后，进展会在这里实时显示。" action="发布职位" click={newJob}/>:orderedJobs.slice(0,4).map((job,index)=>{const candidates=data.candidates.filter(item=>item.jobId===job.id);return <div className="job-row" key={job.id}><div><b>{job.title}</b><small>{jobMeta(job)}</small></div><span><i className={'job-dot dot-'+index}/>{candidates.length}</span><span>{candidates.filter(item=>!['简历筛选','已淘汰','已入职'].includes(item.stage)).length}</span><span>{data.interviews.filter(item=>candidates.some(candidate=>candidate.id===item.candidateId)).length}</span><em className={job.status==='急聘'?'urgent':''}>{job.status}</em></div>})}</article><aside className="panel today-panel"><div className="panel-title"><div><h3>今日安排</h3><p>{today.getMonth()+1} 月 {today.getDate()} 日</p></div></div>{todayInterviews.length===0?<Empty compact icon="◴" title="今日暂无面试" text="安排面试后将自动出现在日程中。"/>:todayInterviews.map((item,index)=><div className="schedule-item" key={item.id}><time>{formatTime(item.scheduledAt)}</time><div className={'schedule-line '+(index%3===1?'orange-line':index%3===2?'green-line':'purple-line')}><b>{item.round}</b><p>{candidateName(item.candidateId,data.candidates)}</p><span>{item.mode} · {item.status}</span></div></div>)}</aside><article className="panel funnel-panel"><div className="panel-title"><div><h3>招聘漏斗</h3><p>按当前候选人阶段实时汇总</p></div></div><div className="funnel-bars">{stageCounts.map(([label,count])=><div key={label}><span>{label}</span><i style={{width:`${Math.round(count/max*100)}%`}}/><b>{count}</b></div>)}</div></article><aside className="ai-panel"><div><span>✦</span><b>推进建议</b><em>实时</em></div><h3>{insightTitle}</h3><p>{insightText}</p><button onClick={()=>go(insightTarget)}>立即处理 →</button></aside></section></>
}

function Jobs({jobs,candidates,interviews,onNew,onPick,updateStatus}:{jobs:Job[];candidates:Candidate[];interviews:Interview[];onNew:()=>void;onPick:(id:string)=>void;updateStatus:(id:string,value:string)=>void}){return <section><Head path="职位管理" title="职位管理" sub="只展示当前账号实际创建的职位" action="发布新职位" click={onNew}/><div className="summary-strip"><span><b>{jobs.length}</b> 全部职位</span><span><b>{jobs.filter(item=>item.status==='招聘中').length}</b> 招聘中</span><span><b>{jobs.filter(item=>item.status==='草稿').length}</b> 草稿</span><span><b>{jobs.filter(item=>item.status==='已暂停').length}</b> 已暂停</span></div><div className="sub-toolbar"><div className="tab-set"><button className="active">全部职位</button></div><div className="filter-box"><span className="data-update-label">数据更新时间：刚刚</span></div></div><div className="management-table"><div className="manage-head"><span>职位名称</span><span>状态</span><span>候选人</span><span>面试</span><span>负责人</span><span>操作</span></div>{jobs.length===0?<Empty icon="▣" title="还没有职位记录" text="创建职位后，候选人和面试数量会自动关联统计。" action="发布新职位" click={onNew}/>:jobs.map(job=>{const people=candidates.filter(item=>item.jobId===job.id);return <div className="manage-row" key={job.id}><div><b>{job.title}</b><small>{jobMeta(job,true)}</small></div><select value={job.status} onChange={event=>updateStatus(job.id,event.target.value)}>{jobStatuses.map(item=><option key={item}>{item}</option>)}</select><span>{people.length} 人</span><span>{interviews.filter(item=>people.some(person=>person.id===item.candidateId)).length} 场</span><span>{job.ownerName}</span><button onClick={()=>onPick(job.id)}>查看详情</button></div>})}</div></section>}

function Talent({people,aiInterviews,onNew,onPick}:{people:Candidate[];aiInterviews:AiInterview[];onNew:()=>void;onPick:(id:string)=>void}){const [stage,setStage]=useState('全部');const visible=stage==='全部'?people:people.filter(item=>item.stage===stage);return <section><Head path="候选人管理" title="候选人管理" sub="候选人信息来自你实际录入的业务记录" action="添加候选人" click={onNew}/><div className="talent-tabs"><button className={stage==='全部'?'active':''} onClick={()=>setStage('全部')}>全部<b>{people.length}</b></button>{stages.map(item=><button className={stage===item?'active':''} onClick={()=>setStage(item)} key={item}>{item}<b>{people.filter(person=>person.stage===item).length}</b></button>)}</div>{visible.length===0?<Empty icon="♙" title={people.length?'该阶段暂无候选人':'还没有候选人记录'} text="添加候选人后，简历筛选、面试和 Offer 模块会同步使用同一份数据。" action="添加候选人" click={onNew}/>:<div className="candidate-grid">{visible.map(person=>{const interview=aiInterviews.find(item=>item.candidateId===person.id&&item.score!==null);const interviewTotal=interview?aiInterviewQuestionTotal(interview.summary,interview.score):null;const hasInterview=Boolean(interview);const score=interviewTotal?.score??interview?.score??person.score;return <button className="candidate-card" key={person.id} onClick={()=>onPick(person.id)}><div className="candidate-top"><span>{person.name.slice(0,1)}</span><div><b>{person.name}</b><small>{person.company||'未填写最近公司'}{person.years?` · ${person.years}`:''}</small></div><em className={`${score===null?'unrated':''}${hasInterview?' interview-score':''}`} title={hasInterview?(interviewTotal?`AI 面试得分，满分 ${interviewTotal.max} 分`:'AI 面试得分'):'简历匹配度'}>{score===null?'未评估':hasInterview?`${score}分`:`${score}%`}</em></div><h3>{person.role}</h3><div className="skill-row">{person.skills.length?person.skills.map(skill=><i key={skill}>{skill}</i>):<i>未添加技能标签</i>}</div><footer><span data-stage={person.stage}>{person.stage}</span><b>查看档案 →</b></footer></button>})}</div>}</section>}

function AiStudio({data,openQuestion,openGenerator,deleteQuestion,openResult,sendInvite,flash}:{data:Dataset;openQuestion:(question?:AiQuestion)=>void;openGenerator:()=>void;deleteQuestion:(question:AiQuestion)=>Promise<boolean>;openResult:()=>void;saveResult:(payload:Record<string,unknown>)=>Promise<boolean>;sendInvite:(candidateId:string,validityHours:number)=>Promise<{interviewUrl:string;testMode:boolean}|false>;flash:(text:string)=>void}){
  const [tab,setTab]=useState<'candidates'|'library'|'summary'>('candidates');
  const [current,setCurrent]=useState(data.aiInterviews[0]?.id||'');
  const [selectedQuestion,setSelectedQuestion]=useState('');
  const [jobFilter,setJobFilter]=useState(data.jobs[0]?.id||'all');
  const [sendingId,setSendingId]=useState('');
  const [inviteTarget,setInviteTarget]=useState<Candidate|null>(null);
  const [validityHours,setValidityHours]=useState(24);
  const [interviewUrl,setInterviewUrl]=useState('');
  const [clock,setClock]=useState(Date.now());
  useEffect(()=>{const timer=window.setInterval(()=>setClock(Date.now()),30000);return()=>window.clearInterval(timer)},[]);
  const selected=data.aiInterviews.find(item=>item.id===current)||data.aiInterviews[0];
  const questions=data.aiQuestions
    .filter((question,index,items)=>items.findIndex(item=>questionKey(item)===questionKey(question))===index)
    .sort((first,second)=>Date.parse(first.createdAt)-Date.parse(second.createdAt)||first.id.localeCompare(second.id));
  const visibleQuestions=jobFilter==='all'?questions:jobFilter==='general'?questions.filter(question=>!question.jobId):questions.filter(question=>!question.jobId||question.jobId===jobFilter);
  function prepareInvitation(person:Candidate){
    const job=data.jobs.find(item=>item.id===person.jobId)||data.jobs.find(item=>item.title.trim().toLowerCase()===person.role.trim().toLowerCase());
    const specific=job?questions.filter(question=>question.jobId===job.id):[];
    const general=questions.filter(question=>!question.jobId);
    const interviewQuestions=specific.length?specific:general;
    if(!interviewQuestions.length){setJobFilter(job?.id||'general');setTab('library');flash(job?`请先为“${job.title}”配置面试题`:'请先创建通用 AI 面试题');return}
    if(!validEmail(person.email)){flash('请补充有效邮箱');return}
    setValidityHours(24);setInterviewUrl('');setInviteTarget(person);
  }
  async function confirmInvitation(){
    if(!inviteTarget)return;
    setSendingId(inviteTarget.id);
    try{const result=await sendInvite(inviteTarget.id,validityHours);if(result)setInterviewUrl(result.interviewUrl)}finally{setSendingId('')}
  }
  async function copyInterviewUrl(value=interviewUrl){
    if(!value){flash('复制失败，请重新发送面试邀请');return}
    try{await navigator.clipboard.writeText(value);flash('AI 面试地址已复制')}
    catch{const input=document.createElement('textarea');input.value=value;input.style.position='fixed';input.style.opacity='0';document.body.appendChild(input);input.select();const copied=document.execCommand('copy');input.remove();flash(copied?'AI 面试地址已复制':'复制失败，请手动复制')}
  }
  return <section>
    <Head path="AI 面试" title="AI 面试" sub="题库与总结仅展示当前账号真实保存的内容"/>
    <div className="ai-studio-tabs">
      <button className={tab==='candidates'?'active':''} onClick={()=>setTab('candidates')}><i>◎</i><span>面试记录<small>{data.aiInterviews.length} 份真实记录</small></span></button>
      <button className={tab==='library'?'active':''} onClick={()=>setTab('library')}><i>▤</i><span>AI 面试题库<small>{questions.length} 道自建题目</small></span></button>
      <button className={tab==='summary'?'active':''} onClick={()=>setTab('summary')}><i>✦</i><span>AI 面试总结<small>{data.aiInterviews.filter(item=>item.status==='已完成').length} 份已完成报告</small></span></button>
    </div>
    {tab==='candidates'&&<div className="flow-list-card">
      <div className="flow-list-title"><h3>候选人面试记录</h3><button className="new-job" disabled={!data.candidates.length} onClick={openResult}>＋ 录入已完成面试</button></div>
      {data.candidates.length===0?<Empty icon="◎" title="暂无候选人" text="先录入候选人，才能关联真实 AI 面试记录。"/>:<div className="flow-person-list">{data.candidates.map(person=>{
        const report=data.aiInterviews.find(item=>item.candidateId===person.id);
        const invitation=data.aiInvitations.find(item=>item.candidateId===person.id&&item.status!=='已失效');
        const timedOut=Boolean(invitation&&!report&&(invitation.status==='已超时'||Date.parse(invitation.expiresAt)<=clock));
        const reportGenerating=Boolean(invitation&&!report&&!timedOut&&(invitation.openedAt||['进行中','已完成','报告生成中'].includes(invitation.status)));
        const statusLabel=report||reportGenerating?'报告状态':'邀请状态';
        const statusText=report?'已生成':reportGenerating?'生成中':timedOut?'已超时':invitation?.status==='待发送'?'链接已生成':invitation?'已发送':'待发送';
        const statusTime=report?.completedAt?`生成于 ${formatDateTime(report.completedAt)}`:reportGenerating&&invitation?.openedAt?`面试开始于 ${formatDateTime(invitation.openedAt)}`:timedOut&&invitation?`已于 ${formatDateTime(invitation.expiresAt)} 超时`:invitation?.sentAt?`发送于 ${formatDateTime(invitation.sentAt)}`:'—';
        const reportTotal=report?aiInterviewQuestionTotal(report.summary,report.score):null;
        return <div className="flow-person-row" key={person.id}><span/><div className="flow-person-profile"><span>{person.name.slice(0,1)}</span><div><h3>{person.name}<small>{person.role}</small></h3><p>{person.company||'公司未填写'}</p><small>{person.email||'邮箱未填写'}</small></div></div><div className="flow-person-owner"><span>{statusLabel}</span><b className={timedOut?'timeout':report?'completed':''}>{statusText}</b><small>{statusTime}</small></div><div className="flow-person-status"><span>综合总分</span><b className={report?'completed':''}>{report?`${reportTotal?.score??report.score??0} / 100`:'—'}</b></div><div className="ai-invite-row-actions">{report?<button className="flow-more" onClick={()=>{setCurrent(report.id);setTab('summary')}}>查看总结</button>:reportGenerating?<button className="invite-waiting" disabled>报告生成中</button>:timedOut?<button className="flow-more timeout-action" disabled={sendingId===person.id} onClick={()=>prepareInvitation(person)}>{sendingId===person.id?'正在生成邮件…':'重新邀请'}</button>:invitation?<><button className="invite-waiting" disabled>待确认</button><small>剩余 {remainingTime(invitation.expiresAt,clock)}</small>{invitation.interviewUrl&&<button className="flow-more copy-link" onClick={()=>void copyInterviewUrl(invitation.interviewUrl)}>复制链接</button>}<button className="flow-more resend-link" disabled={sendingId===person.id} onClick={()=>prepareInvitation(person)}>{sendingId===person.id?'正在生成邮件…':'重新发送链接'}</button></>:<button className="flow-more" disabled={sendingId===person.id} onClick={()=>prepareInvitation(person)}>发送面试邀请</button>}</div></div>
      })}</div>}
    </div>}
    {tab==='library'&&<div className="ai-generator-bar"><div><b>岗位面试题智能生成</b><span>根据岗位名称与部门生成问题、评分关键词和参考回答</span></div><button type="button" disabled={!data.jobs.length} onClick={openGenerator}>✦ AI 生成面试题</button></div>}
    {tab==='library'&&<div className="ai-library-shell">
      <aside className="ai-library-filter"><h3>岗位题库</h3><p>按适用岗位展示已保存题目</p><button className={jobFilter==='all'?'active':''} onClick={()=>setJobFilter('all')}>全部题目<b>{questions.length}</b></button><button className={jobFilter==='general'?'active':''} onClick={()=>setJobFilter('general')}>通用题目<b>{questions.filter(question=>!question.jobId).length}</b></button>{data.jobs.map(job=><button className={jobFilter===job.id?'active':''} onClick={()=>setJobFilter(job.id)} key={job.id}>{job.title}<b>{questions.filter(question=>question.jobId===job.id).length}</b></button>)}<div className="ai-library-tip"><i>✦</i><b>岗位自动匹配</b><p>发起面试时优先使用候选人应聘岗位的题目；未配置时使用通用题目。</p></div></aside>
      <section className="ai-library-main">
        <div className="ai-library-toolbar"><label>⌕<input value={jobFilter==='all'?'全部岗位':jobFilter==='general'?'通用题目':data.jobs.find(job=>job.id===jobFilter)?.title||'岗位题目'} readOnly/></label><div><button onClick={()=>openQuestion()}>＋ 新建题目</button><span>共 {visibleQuestions.length} 道</span></div></div>
        <div className="ai-question-head"><span>题目内容</span><span>提问方式</span><span>时长</span><span>追问</span><span>操作</span></div>
        {visibleQuestions.length===0?<Empty icon="▤" title="该岗位暂无题目" text="新建题目并选择适用岗位后，会自动显示在这里。" action="新建题目" click={()=>openQuestion()}/>:visibleQuestions.map(question=><div className={`ai-question-row ${selectedQuestion===question.id?'selected':''}`} key={question.id} role="button" tabIndex={0} aria-selected={selectedQuestion===question.id} onClick={()=>{setSelectedQuestion(question.id);openQuestion(question)}} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();setSelectedQuestion(question.id);openQuestion(question)}}}><div><i>Q</i><span><b>{question.title}</b><small>{question.jobId?`岗位：${data.jobs.find(job=>job.id===question.jobId)?.title||'岗位已删除'} · `:'通用题目 · '}关键词：{question.keywords||'未设置'}</small></span></div><em className={question.questionType==='语音提问'?'voice':''}>{question.questionType}</em><span>{question.duration} 秒</span><span>{question.followUp?'是':'否'}</span><div><button onClick={event=>{event.stopPropagation();setSelectedQuestion(question.id);openQuestion(question)}}>修改</button><button onClick={event=>{event.stopPropagation();setSelectedQuestion(question.id);speak(question.title,flash)}}>试听</button><button className="danger" onClick={event=>{event.stopPropagation();void deleteQuestion(question).then(removed=>{if(removed&&selectedQuestion===question.id)setSelectedQuestion('')})}}>删除</button></div></div>)}
      </section>
    </div>}
    {tab==='summary'&&(selected?<div className="ai-summary-shell"><aside><div className="ai-summary-list-title"><div><h3>已完成面试</h3><p>共 {data.aiInterviews.length} 份真实总结</p></div></div>{data.aiInterviews.map(report=>{const person=data.candidates.find(item=>item.id===report.candidateId);const total=aiInterviewQuestionTotal(report.summary,report.score);return <button key={report.id} className={report.id===selected.id?'active':''} onClick={()=>setCurrent(report.id)}><span>{person?.name.slice(0,1)||'候'}</span><div><b>{person?.name||'候选人已删除'}</b><small>{report.jobTitle}</small></div><em>{total?`${total.score}/100`:report.score??'—'}</em></button>})}</aside><AiSummary report={selected} person={data.candidates.find(item=>item.id===selected.candidateId)}/></div>:<Empty icon="✦" title="暂无 AI 面试总结" text="完成真实面试后，可通过“录入已完成面试”保存得分、用时与总结；系统不会生成虚构报告。" action={data.candidates.length?'录入面试结果':undefined} click={data.candidates.length?openResult:undefined}/>)}
    {inviteTarget&&<div className="flow-modal-backdrop" onMouseDown={()=>{if(!sendingId)setInviteTarget(null)}}><section className="ai-invite-dialog" onMouseDown={event=>event.stopPropagation()}><button type="button" className="flow-overlay-close" onClick={()=>setInviteTarget(null)}>×</button><span>AI INTERVIEW INVITATION</span><h2>{interviewUrl?'面试邀请地址已生成':'发送面试邀请'}</h2><p>候选人：<b>{inviteTarget.name}</b> · {inviteTarget.role}</p>{interviewUrl?<div className="ai-test-interview-url"><label>面试邀请地址</label><code>{interviewUrl}</code><button type="button" onClick={()=>void copyInterviewUrl()}>复制邀请地址</button></div>:<><label>面试链接有效期</label><div className="ai-validity-options">{[12,24,72].map(hours=><button type="button" key={hours} className={validityHours===hours?'active':''} onClick={()=>setValidityHours(hours)}><b>{hours}</b><span>小时</span><small>{hours===12?'半天内完成':hours===24?'一天内完成':'三天内完成'}</small></button>)}</div><div className="ai-invite-note"><i>⌁</i><p>超过有效期后，邮件中的专属链接将立即失效；重新发送邀请会使旧链接失效。</p></div></>}<footer><button type="button" onClick={()=>setInviteTarget(null)}>{interviewUrl?'完成':'取消'}</button>{!interviewUrl&&<button type="button" className="primary" disabled={Boolean(sendingId)} onClick={()=>void confirmInvitation()}>{sendingId?'正在生成邮件…':`发送 ${validityHours} 小时邀请`}</button>}</footer></section></div>}
  </section>
}

function AiInterviewSession({candidate,questions,flash,close,complete}:{candidate:Candidate;questions:AiQuestion[];flash:(text:string)=>void;close:()=>void;complete:(payload:Record<string,unknown>)=>Promise<boolean>}){
  const videoRef=useRef<HTMLVideoElement>(null);
  const streamRef=useRef<MediaStream|null>(null);
  const recognitionRef=useRef<SpeechRecognitionLike|null>(null);
  const transcriptRef=useRef<Record<string,string>>({});
  const committedTranscriptRef=useRef<Record<string,string>>({});
  const listenWantedRef=useRef(false);
  const recognitionGenerationRef=useRef(0);
  const speechRestartTimerRef=useRef<number|null>(null);
  const speechWatchdogTimerRef=useRef<number|null>(null);
  const speechFailureCountRef=useRef(0);
  const startedAt=useRef(Date.now());
  const submittingQuestionRef=useRef('');
  const [cameraState,setCameraState]=useState<'requesting'|'ready'|'denied'>('requesting');
  const [index,setIndex]=useState(0);
  const [answers,setAnswers]=useState<Record<string,string>>({});
  const [scores,setScores]=useState<Record<string,AnswerScore>>({});
  const [listening,setListening]=useState(false);
  const [saving,setSaving]=useState(false);
  const [secondsLeft,setSecondsLeft]=useState(questions[0]?.duration||120);
  const question=questions[index];
  const answer=question?answers[question.id]||'':'';

  async function requestCamera(){
    setCameraState('requesting');
    try{
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('unsupported');
      streamRef.current?.getTracks().forEach(track=>track.stop());
      const stream=await navigator.mediaDevices.getUserMedia({video:true,audio:true});
      streamRef.current=stream;
      if(videoRef.current){videoRef.current.srcObject=stream;await videoRef.current.play().catch(()=>undefined)}
      setCameraState('ready');
    }catch{setCameraState('denied')}
  }

  useEffect(()=>{
    void requestCamera();
    return()=>{
      listenWantedRef.current=false;recognitionGenerationRef.current+=1;
      if(speechRestartTimerRef.current!==null)window.clearTimeout(speechRestartTimerRef.current);
      if(speechWatchdogTimerRef.current!==null)window.clearTimeout(speechWatchdogTimerRef.current);
      streamRef.current?.getTracks().forEach(track=>track.stop());
      recognitionRef.current?.abort();
      if('speechSynthesis'in window)window.speechSynthesis.cancel();
    };
  },[]);

  useEffect(()=>{
    listenWantedRef.current=false;recognitionGenerationRef.current+=1;recognitionRef.current?.abort();
    setListening(false);
    setSecondsLeft(question?.duration||120);
    const timer=question?window.setTimeout(()=>speakQuestion(question.title,startListening),350):undefined;
    return()=>{if(timer)window.clearTimeout(timer)};
  },[question?.id]);

  useEffect(()=>{
    if(secondsLeft<=0)return;
    const timer=window.setInterval(()=>setSecondsLeft(value=>Math.max(0,value-1)),1000);
    return()=>window.clearInterval(timer);
  },[question?.id,secondsLeft<=0]);

  useEffect(()=>{
    if(secondsLeft!==0||saving||submittingQuestionRef.current===question.id)return;
    submittingQuestionRef.current=question.id;
    void submitCurrent(true);
  },[secondsLeft,question.id,saving]);

  function speakQuestion(text:string,after?:()=>void){
    if(!('speechSynthesis'in window)){after?.();return}
    window.speechSynthesis.cancel();
    const utterance=new SpeechSynthesisUtterance(text);utterance.lang='zh-CN';utterance.rate=.95;
    if(after)utterance.onend=after;
    window.speechSynthesis.speak(utterance);
  }

  function startListening(){beginListening(false)}

  function beginListening(resume:boolean){
    const speechWindow=window as unknown as {SpeechRecognition?:SpeechRecognitionConstructor;webkitSpeechRecognition?:SpeechRecognitionConstructor};
    const Recognition=speechWindow.SpeechRecognition||speechWindow.webkitSpeechRecognition;
    if(!Recognition){flash('当前浏览器不支持语音识别，请使用最新版 Chrome 或 Edge');return}
    if(!question)return;
    if(speechRestartTimerRef.current!==null){window.clearTimeout(speechRestartTimerRef.current);speechRestartTimerRef.current=null}
    if(speechWatchdogTimerRef.current!==null){window.clearTimeout(speechWatchdogTimerRef.current);speechWatchdogTimerRef.current=null}
    if(!resume){
      listenWantedRef.current=false;recognitionGenerationRef.current+=1;
      const previous=recognitionRef.current;if(previous){previous.onend=null;previous.onerror=null;previous.onresult=null;previous.abort()}
    }
    const generation=recognitionGenerationRef.current;const recognition=new Recognition();const questionId=question.id;
    const sessionBase=committedTranscriptRef.current[questionId]||transcriptRef.current[questionId]||answers[questionId]||'';let committed=sessionBase;let latestInterim='';let fatalError=false;
    recognition.lang='zh-CN';recognition.continuous=true;recognition.interimResults=true;recognition.maxAlternatives=5;listenWantedRef.current=true;
    applySpeechContext(recognition,candidate.role,question);
    const scheduleRestart=(delay=320)=>{
      if(!listenWantedRef.current||generation!==recognitionGenerationRef.current)return;
      setListening(true);
      speechRestartTimerRef.current=window.setTimeout(()=>{speechRestartTimerRef.current=null;if(listenWantedRef.current&&generation===recognitionGenerationRef.current)beginListening(true)},delay);
    };
    const armWatchdog=()=>{
      if(speechWatchdogTimerRef.current!==null)window.clearTimeout(speechWatchdogTimerRef.current);
      speechWatchdogTimerRef.current=window.setTimeout(()=>{
        speechWatchdogTimerRef.current=null;
        if(listenWantedRef.current&&generation===recognitionGenerationRef.current&&recognitionRef.current===recognition)recognition.abort();
      },18000);
    };
    recognition.onresult=event=>{
      speechFailureCountRef.current=0;
      armWatchdog();
      let sessionFinal='';let interim='';
      for(let resultIndex=0;resultIndex<event.results.length;resultIndex+=1){
        const result=event.results[resultIndex];const value=selectContextualSpeechTranscript(speechAlternatives(result),candidate.role,question);
        if(!value)continue;
        if(result.isFinal)sessionFinal=joinSpeechTranscript(sessionFinal,value);else interim=joinSpeechTranscript(interim,value);
      }
      committed=joinSpeechTranscript(sessionBase,sessionFinal);committedTranscriptRef.current[questionId]=committed;
      latestInterim=interim;
      const transcript=contextualizeSpeechTranscript(joinSpeechTranscript(committed,interim),candidate.role,question);transcriptRef.current[questionId]=transcript;
      setAnswers(current=>({...current,[questionId]:transcript}));
      setScores(current=>{const next={...current};delete next[questionId];return next});
    };
    recognition.onerror=event=>{const code=event.error||'';if(['not-allowed','service-not-allowed','audio-capture'].includes(code)){fatalError=true;listenWantedRef.current=false;flash('无法使用麦克风进行语音识别，请检查浏览器权限')}else if(code!=='no-speech'&&code!=='aborted'){speechFailureCountRef.current+=1;if(speechFailureCountRef.current>=3)flash('语音识别连续连接失败，请检查网络后重新识别')}};
    recognition.onend=()=>{
      if(speechWatchdogTimerRef.current!==null){window.clearTimeout(speechWatchdogTimerRef.current);speechWatchdogTimerRef.current=null}
      if(latestInterim){committed=contextualizeSpeechTranscript(joinSpeechTranscript(committed,latestInterim),candidate.role,question);committedTranscriptRef.current[questionId]=committed;transcriptRef.current[questionId]=committed;setAnswers(current=>({...current,[questionId]:committed}))}
      if(!fatalError&&listenWantedRef.current&&generation===recognitionGenerationRef.current)scheduleRestart();else setListening(false);
    };
    recognitionRef.current=recognition;
    try{const audioTrack=streamRef.current?.getAudioTracks()[0];recognition.start(audioTrack?.readyState==='live'?audioTrack:undefined);setListening(true);armWatchdog()}catch{speechFailureCountRef.current+=1;if(speechFailureCountRef.current>=3)flash('语音识别启动失败，请检查麦克风和网络后重新识别');scheduleRestart(650)}
  }

  function submitCurrent(auto=false){
    if(saving)return;
    const currentAnswer=contextualizeSpeechTranscript(transcriptRef.current[question.id]||answer,candidate.role,question);
    if(currentAnswer){transcriptRef.current[question.id]=currentAnswer;committedTranscriptRef.current[question.id]=currentAnswer;setAnswers(current=>({...current,[question.id]:currentAnswer}))}
    if(!currentAnswer.trim()&&!auto){submittingQuestionRef.current='';flash('请先回答当前问题');return}
    listenWantedRef.current=false;recognitionGenerationRef.current+=1;recognitionRef.current?.stop();setListening(false);
    const next=scoreInterviewAnswer(currentAnswer,question,candidate);
    setScores(current=>({...current,[question.id]:next}));
    submittingQuestionRef.current=question.id;
    if(index<questions.length-1){
      const nextIndex=index+1;
      setSecondsLeft(questions[nextIndex].duration);
      setIndex(nextIndex);
      return;
    }
    void finishInterview(next);
  }

  async function finishInterview(currentScore:AnswerScore){
    const finalScores=questions.map(item=>item.id===question.id?currentScore:scores[item.id]||scoreInterviewAnswer(contextualizeSpeechTranscript(transcriptRef.current[item.id]||answers[item.id]||'',candidate.role,item),item,candidate));
    const maxScores=questionMaxScores(questions.length);
    const weightedScores=finalScores.map((item,itemIndex)=>weightedQuestionScore(item.score,maxScores[itemIndex]||1));
    const overall=weightedScores.reduce((sum,item)=>sum+item,0);
    const details=questions.map((item,itemIndex)=>{
      const itemScore=finalScores[itemIndex];
      const itemAnswer=contextualizeSpeechTranscript(transcriptRef.current[item.id]||answers[item.id]||'未作答',candidate.role,item).replace(/\s+/g,' ');
      return `${itemIndex+1}. ${item.title}（得分 ${weightedScores[itemIndex]}/${maxScores[itemIndex]}）\n自动评分：${itemScore.score}\n命中关键词：${itemScore.matched.join('、')||'无'}\n回答：${itemAnswer}`;
    });
    const summary=[`AI 题目权重评分：综合 ${overall}/100。评分依据各题满分、题目关键词、参考回答、题意与候选人技能综合生成。`,...details].join('\n\n');
    setSaving(true);
    const saved=await complete({candidateId:candidate.id,jobTitle:candidate.role,score:overall,durationMinutes:Math.max(1,Math.ceil((Date.now()-startedAt.current)/60000)),summary});
    if(!saved){setSaving(false);submittingQuestionRef.current=''}
  }

  const progress=Math.round((index+1)/questions.length*100);
  return <section className="ai-live-page">
    <header className="ai-live-header"><div><span>AI LIVE INTERVIEW</span><h1>{candidate.name} · {candidate.role}</h1><p>摄像头面试进行中 · 第 {index+1}/{questions.length} 题</p></div><button type="button" onClick={close} disabled={saving}>退出面试 ×</button></header>
    <div className="ai-live-progress"><i style={{width:`${progress}%`}}/></div>
    <div className="ai-live-grid">
      <section className="ai-camera-card">
        <video ref={videoRef} autoPlay playsInline muted/>
        <div className={`ai-camera-status ${cameraState}`}><i/>{cameraState==='ready'?'摄像头与麦克风已连接':cameraState==='requesting'?'正在请求摄像头权限…':'未获得摄像头权限'}</div>
        {cameraState==='denied'&&<div className="ai-camera-help"><b>无法连接面试设备</b><p>本次面试仅支持语音作答，请在浏览器地址栏允许摄像头和麦克风权限后重新连接。</p><button type="button" onClick={()=>void requestCamera()}>重新连接设备</button></div>}
        <footer><span>{candidate.name.slice(0,1)}</span><div><b>{candidate.name}</b><small>{candidate.role}</small></div><em>● 面试中</em></footer>
      </section>
      <section className="ai-answer-card">
        <div className="ai-question-step"><span>QUESTION {String(index+1).padStart(2,'0')}</span><b>{formatCountdown(secondsLeft)}</b></div>
        <h2>{question.title}</h2>
        <p className="ai-question-note">建议回答时长 {question.duration} 秒 · 倒计时结束后自动提交</p>
        <div className={`ai-voice-answer ${listening?'listening':''}`}><i>◉</i><span><b>{listening?'正在自动识别语音':'语音转写结果'}</b><p>{answer||'请直接口述回答，识别结果将在这里实时显示。'}</p></span></div>
        <div className="ai-answer-actions"><span className={listening?'ai-listening-status active':'ai-listening-status'}>{listening?'● 正在自动识别语音':'仅支持语音作答'}</span><button type="button" onClick={()=>speakQuestion(question.title)}>▶ 重播题目</button>{!listening&&<button type="button" onClick={startListening}>重新识别</button>}<button type="button" className="primary" disabled={saving||!answer.trim()} onClick={()=>submitCurrent(false)}>{saving?'正在保存…':'提交'}</button></div>
        <footer className="ai-question-nav"><button type="button" disabled={index===0||saving} onClick={()=>{const previous=index-1;submittingQuestionRef.current='';setSecondsLeft(questions[previous].duration);setIndex(previous)}}>← 上一题</button><span>评分结果将在面试结束后提供给后台工作人员</span></footer>
      </section>
    </div>
  </section>;
}

function AiSummary({report,person}:{report:AiInterview;person?:Candidate}){
  return <article className="ai-summary-report">
    <header><div><span>{person?.name.slice(0,1)||'候'}</span><div><h2>{person?.name||'候选人'} · AI 面试总结</h2><p>{report.jobTitle} · 用时 {durationText(report.durationSeconds)} · {report.completedAt?formatDate(report.completedAt):'时间未记录'}</p></div></div></header>
    <AiInterviewResultPanel summary={report.summary} fallbackScore={report.score} durationSeconds={report.durationSeconds} completedAt={report.completedAt}/>
  </article>
}

function Interviews({items,people,onNew,onPick,updateStatus}:{items:Interview[];people:Candidate[];onNew:()=>void;onPick:(id:string)=>void;updateStatus:(id:string,value:string)=>void}){const week=weekDays(new Date());return <section><Head path="面试管理" title="面试管理" sub="日程来自实际保存的面试安排" action="安排面试" click={onNew}/><div className="week-strip">{week.map(date=><button className={sameDay(date,new Date())?'active':''} key={date.toISOString()}><span>{weekLabel(date)}</span><b>{date.getDate()}</b>{items.some(item=>sameDay(new Date(item.scheduledAt),date))&&<i/>}</button>)}</div><div className="interview-layout"><div className="interview-list"><div className="list-title"><h3>面试日程</h3><span>{items.length} 场真实面试</span></div>{items.length===0?<Empty icon="◴" title="还没有面试安排" text="选择真实候选人并安排面试后，日程会保存到这里。" action="安排面试" click={onNew}/>:items.map(item=><article className="interview-card clickable" role="button" tabIndex={0} key={item.id} onClick={()=>onPick(item.id)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onPick(item.id)}}}><time><b>{formatTime(item.scheduledAt)}</b><small>{formatMonthDay(item.scheduledAt)}</small></time><i className="interview-color"/><div><h3>{candidateName(item.candidateId,people)} · {item.round}</h3><p>{people.find(person=>person.id===item.candidateId)?.role||'职位未关联'}</p><span>{item.mode}　面试官：{item.interviewer}</span></div><select value={item.status} onClick={event=>event.stopPropagation()} onChange={event=>updateStatus(item.id,event.target.value)}>{interviewStatuses.map(status=><option key={status}>{status}</option>)}</select></article>)}</div><aside className="interview-side"><h3>面试协同提醒</h3><div><b>{items.filter(item=>new Date(item.scheduledAt)<new Date()&&item.status!=='已完成'&&item.status!=='已取消').length}</b><span>待补充面试结果<small>基于已过期且未完成的真实日程</small></span></div><div><b>{items.filter(item=>item.status==='待确认').length}</b><span>候选人待确认<small>来自当前实际安排</small></span></div></aside></div></section>}

function Offers({items,people,onNew,onEdit,onDelete,updateStatus}:{items:Offer[];people:Candidate[];onNew:()=>void;onEdit:(offer:Offer)=>void;onDelete:(offer:Offer)=>void;updateStatus:(id:string,value:string)=>void}){const accepted=items.filter(item=>item.status==='已接受').length;return <section><Head path="Offer 管理" title="Offer 管理" sub="审批、发放和接受状态来自真实 Offer 记录" action="新建 Offer" click={onNew}/><div className="offer-kpis">{[['待审批',items.filter(item=>item.status==='待审批').length,'当前待处理'],['本月已发放',items.filter(item=>item.status==='已发放'&&isThisMonth(item.updatedAt)).length,'按更新时间统计'],['候选人已接受',accepted,items.length?`接受率 ${percent(accepted,items.length)}`:'暂无记录'],['即将截止',items.filter(item=>daysUntil(item.deadline)>=0&&daysUntil(item.deadline)<=14&&!['已接受','已拒绝','已撤回'].includes(item.status)).length,'未来 14 天']].map(item=><article key={String(item[0])}><span>{item[0]}</span><b>{item[1]}</b><small>{item[2]}</small></article>)}</div><div className="offer-table"><div className="offer-head"><span>候选人</span><span>职位</span><span>薪资方案</span><span>负责人</span><span>状态</span><span>截止日期</span><span>操作</span></div>{items.length===0?<Empty icon="✓" title="还没有 Offer 记录" text="创建 Offer 后，状态与接受率会根据实际记录计算。" action="新建 Offer" click={onNew}/>:items.map(item=><div className="offer-row" key={item.id}><div><span>{candidateName(item.candidateId,people).slice(0,1)}</span><b>{candidateName(item.candidateId,people)}</b></div><span>{item.jobTitle}</span><strong>{item.salary}</strong><span>{item.ownerName}</span><select value={item.status} onChange={event=>updateStatus(item.id,event.target.value)}>{offerStatuses.map(status=><option key={status}>{status}</option>)}</select><span>{formatDate(item.deadline)}</span><div className="offer-row-actions"><button type="button" onClick={()=>onEdit(item)}>修改</button><button type="button" className="danger" onClick={()=>onDelete(item)}>删除</button></div></div>)}</div></section>}

function Analytics({data}:{data:Dataset}){
  const total=data.candidates.length;
  const interviewed=data.candidates.filter(item=>stageIndex(item.stage)>=2).length;
  const accepted=data.offers.filter(item=>item.status==='已接受').length;
  const joined=data.candidates.filter(item=>item.stage==='已入职');
  const averageDays=joined.length?joined.reduce((sum,item)=>sum+Math.max(0,(new Date(item.updatedAt).getTime()-new Date(item.createdAt).getTime())/86400000),0)/joined.length:0;
  const days=recentDays(12);
  const trend=days.map(day=>({day,newCandidates:data.candidates.filter(item=>sameDay(new Date(item.createdAt),day)).length,interviews:data.interviews.filter(item=>sameDay(new Date(item.scheduledAt),day)).length}));
  const max=Math.max(1,...trend.flatMap(item=>[item.newCandidates,item.interviews]));
  const normalizedStages=data.candidates.map(item=>normalizeCandidateStage(item.stage));
  const stageDistribution=[...CANDIDATE_STAGES,'待定','已淘汰'].map(name=>({name,count:normalizedStages.filter(stage=>stage===name).length})).filter(item=>item.count>0);
  return <section>
    <Head path="招聘数据" title="招聘数据" sub="所有指标从职位、候选人、面试与 Offer 真实记录实时计算"/>
    <div className="analytics-filters"><div><button className="active">近 12 天</button></div><span className="data-origin-badge">● 真实数据 · 当前账号</span></div>
    <div className="analytics-kpis">{[['简历总量',total,'当前全部记录'],['面试转化率',percent(interviewed,total),`${interviewed} 人进入面试阶段`],['Offer 接受率',percent(accepted,data.offers.length),`${accepted} 份已接受`],['平均招聘周期',joined.length?`${averageDays.toFixed(1)} 天`:'—',joined.length?`${joined.length} 位已入职候选人`:'暂无入职样本']].map(item=><article key={String(item[0])}><span>{item[0]}</span><b>{item[1]}</b><small>{item[2]}</small></article>)}</div>
    <div className="analytics-layout">
      <article className="analytics-chart"><div className="chart-title"><div><h3>候选人与面试趋势</h3><p>按真实创建和日程日期统计</p></div><div><span>● 新增候选人</span><span>● 面试场次</span></div></div>{total===0&&data.interviews.length===0?<Empty compact icon="↗" title="暂无趋势数据" text="录入候选人或安排面试后自动生成。"/>:<div className="chart-body">{trend.map(item=><div key={item.day.toISOString()}><i style={{height:`${item.newCandidates/max*100}%`}}/><b style={{height:`${item.interviews/max*100}%`}}/><span>{item.day.getMonth()+1}/{item.day.getDate()}</span></div>)}</div>}</article>
      <aside className="channel-card"><div className="chart-title"><div><h3>招聘阶段分布</h3><p>查看候选人在各招聘阶段的人数与占比</p></div></div>{stageDistribution.length===0?<Empty compact icon="♙" title="暂无阶段数据" text="录入候选人后自动汇总招聘进度。"/>:stageDistribution.map((item,index)=><div className="channel-row" key={item.name}><b>{index+1}</b><span>{item.name}<i><em style={{width:percentNumber(item.count,total)+'%'}}/></i></span><strong>{item.count} 人<small>{percent(item.count,total)}</small></strong></div>)}</aside>
    </div>
  </section>
}

function FormModal({close,submit,kicker,title,description,children,submitLabel='保存真实记录',error='',submitting=false,scrollable=false}:{close:()=>void;submit:(data:FormData)=>void;kicker:string;title:string;description:string;children:ReactNode;submitLabel?:string;error?:string;submitting?:boolean;scrollable?:boolean}){return <div className="modal-backdrop" onMouseDown={close}><form className={`job-modal${scrollable?' scrollable-modal':''}`} onSubmit={(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();submit(new FormData(event.currentTarget))}} onMouseDown={event=>event.stopPropagation()}><button type="button" className="modal-close" onClick={close}>×</button><span className="eyebrow purple">{kicker}</span><h2>{title}</h2><p>{description}</p>{children}{error&&<div className="account-form-error">{error}</div>}<button className="primary-button" type="submit" disabled={submitting}>{submitting?'正在保存…':submitLabel} <span>→</span></button></form></div>}
function CandidateEntryModal({close,manual,upload}:{close:()=>void;manual:()=>void;upload:()=>void}){return <div className="modal-backdrop" onMouseDown={close}><section className="candidate-entry-modal" role="dialog" aria-modal="true" aria-labelledby="candidate-entry-title" onMouseDown={event=>event.stopPropagation()}><button type="button" className="modal-close" onClick={close}>×</button><span className="eyebrow purple">ADD CANDIDATE</span><h2 id="candidate-entry-title">添加候选人</h2><p>选择录入方式，候选人会统一进入候选人管理并同步到后续招聘流程。</p><div className="candidate-entry-options"><button type="button" onClick={manual}><i>＋</i><span><b>手动添加</b><small>直接填写候选人、职位与联系方式</small></span><em>→</em></button><button type="button" onClick={upload}><i>⇧</i><span><b>上传简历添加</b><small>上传文件并自动解析为候选人档案</small></span><em>→</em></button></div></section></div>}
function CityPicker({defaultValue}:{defaultValue:string}){
  const customCity=defaultValue&&!CHINA_CITIES.includes(defaultValue)?defaultValue:'';
  const groups=customCity?[['其他',[customCity]] as [string,string[]],...cityPickerGroups]:cityPickerGroups;
  const initialGroup=groups.find(([,cities])=>cities.includes(defaultValue))?.[0]||groups[0][0];
  const [selectedCity,setSelectedCity]=useState(defaultValue);
  const [activeGroup,setActiveGroup]=useState(initialGroup);
  const [query,setQuery]=useState('');
  const [open,setOpen]=useState(false);
  const root=useRef<HTMLDivElement>(null);
  const activeGroupButton=useRef<HTMLButtonElement>(null);
  const filteredGroups=groups.map(([group,cities])=>[group,cities.filter(city=>city.includes(query.trim()))] as [string,string[]]).filter(([group,cities])=>!query.trim()||group.includes(query.trim())||cities.length);
  const visibleGroup=filteredGroups.find(([group])=>group===activeGroup)||filteredGroups[0];
  const visibleCities=query.trim()&&visibleGroup?.[0].includes(query.trim())?groups.find(([group])=>group===visibleGroup[0])?.[1]||[]:visibleGroup?.[1]||[];
  useEffect(()=>{
    if(!open)return;
    const closePicker=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node)){setOpen(false);setQuery('')}};
    document.addEventListener('pointerdown',closePicker);
    return()=>document.removeEventListener('pointerdown',closePicker);
  },[open]);
  useEffect(()=>{
    if(!open)return;
    const frame=window.requestAnimationFrame(()=>activeGroupButton.current?.scrollIntoView({block:'nearest'}));
    return()=>window.cancelAnimationFrame(frame);
  },[open,activeGroup]);
  function choose(city:string){setSelectedCity(city);setQuery('');setOpen(false);setActiveGroup(groups.find(([,cities])=>cities.includes(city))?.[0]||groups[0][0])}
  return <div className={`city-picker${open?' open':''}`} ref={root}>
    <input type="hidden" name="city" value={selectedCity}/>
    {open&&<div id="job-city-options" className="city-picker-panel" role="dialog" aria-label="选择工作城市">
      <div className="city-picker-groups" role="listbox" aria-label="省份或地区">{filteredGroups.length?filteredGroups.map(([group])=><button type="button" key={group} ref={visibleGroup?.[0]===group?activeGroupButton:undefined} className={visibleGroup?.[0]===group?'active':''} onMouseDown={event=>event.preventDefault()} onClick={()=>setActiveGroup(group)}><span>{group}</span><b>›</b></button>):<p>未找到匹配地区</p>}</div>
      <div className="city-picker-cities" role="listbox" aria-label={`${visibleGroup?.[0]||''}城市`}>{visibleCities.length?visibleCities.map(city=><button type="button" role="option" aria-selected={selectedCity===city} key={city} className={selectedCity===city?'selected':''} onMouseDown={event=>event.preventDefault()} onClick={()=>choose(city)}>{city}<span>✓</span></button>):<p>未找到匹配城市</p>}</div>
    </div>}
    <div className="city-picker-control">
      <input value={open?query:selectedCity} placeholder={open?'输入市名进行搜索':'请选择城市（可选）'} role="combobox" aria-expanded={open} aria-controls="job-city-options" autoComplete="off" onFocus={()=>setOpen(true)} onChange={event=>{setQuery(event.target.value);setOpen(true)}} onKeyDown={event=>{if(event.key==='Escape'){setOpen(false);setQuery('')}else if(event.key==='Enter'&&open&&visibleCities.length===1){event.preventDefault();choose(visibleCities[0])}}}/>
      {selectedCity&&!open&&<button type="button" className="city-picker-clear" aria-label="清除工作城市" onClick={()=>setSelectedCity('')}>×</button>}
      <button type="button" className="city-picker-toggle" aria-label={open?'收起城市选择':'展开城市选择'} onMouseDown={event=>event.preventDefault()} onClick={()=>{setOpen(value=>!value);setQuery('')}}>{open?'⌃':'⌄'}</button>
    </div>
  </div>;
}
function JobModal({job,close,submit,submitting}:{job:Job|null;close:()=>void;submit:(data:FormData)=>void;submitting:boolean}){
  const selectedCity=visibleCity(job?.city||'');
  return <FormModal close={close} submit={submit} submitting={submitting} kicker={job?'POSITION DETAILS':'NEW POSITION'} title={job?'编辑职位信息':'发布新职位'} description={job?'修改后将保留该职位与候选人、AI 面试题的现有关联。':'保存后，该职位将参与工作台与招聘数据的实时统计。'} submitLabel={job?'保存职位修改':'保存真实记录'}>
    <label>职位名称<input required name="title" defaultValue={job?.title||''} placeholder="请输入真实职位名称"/></label>
    <label>所属部门<input required name="department" defaultValue={job?.department||''} placeholder="请输入实际部门"/></label>
    <div className="form-grid"><div className="job-form-label"><span>工作城市</span><CityPicker defaultValue={selectedCity}/></div><label>招聘人数<input name="headcount" type="number" min="1" max="999" defaultValue={job?.headcount||1}/></label></div>
  </FormModal>
}
function CandidateModal({jobs,close,upload,submit,submitting}:{jobs:Job[];close:()=>void;upload:()=>void;submit:(data:FormData)=>void;submitting:boolean}){return <FormModal close={close} submit={submit} submitting={submitting} kicker="REAL CANDIDATE" title="添加候选人" description="请录入真实候选人信息；未填写的字段会明确显示为未填写。"><button type="button" className="candidate-modal-upload" onClick={upload}><span>⇧</span><div><b>上传简历自动填写</b><small>识别姓名、履历、项目与联系方式</small></div><em>→</em></button><div className="form-grid"><label>姓名<input required name="name" placeholder="候选人姓名"/></label><label>应聘职位<input required name="role" placeholder="实际应聘职位"/></label></div><label>关联职位<select name="jobId" defaultValue=""><option value="">暂不关联</option>{jobs.map(job=><option key={job.id} value={job.id}>{job.title}</option>)}</select></label><div className="form-grid"><label>最近公司<input name="company" placeholder="可选"/></label><label>工作经验<input name="years" placeholder="例如：5 年"/></label></div><div className="form-grid"><label>来源<input name="source" placeholder="例如：内部推荐"/></label><label>所在城市<input name="city" placeholder="可选"/></label></div><label>技能标签<input name="skills" placeholder="多个技能请用逗号分隔"/></label><div className="form-grid"><label>手机号<input name="phone" type="tel" placeholder="可选"/></label><label>邮箱<input name="email" type="email" placeholder="可选"/></label></div></FormModal>}
function InterviewModal({interview,people,close,submit,submitting}:{interview:Interview|null;people:Candidate[];close:()=>void;submit:(data:FormData)=>void;submitting:boolean}){return <FormModal close={close} submit={submit} submitting={submitting} kicker="SCHEDULE" title={interview?'查看与修改面试':'安排面试'} description="面试日程会按实际日期和候选人保存。" submitLabel={interview?'保存面试修改':'保存真实记录'}><label>候选人<select required name="candidateId" defaultValue={interview?.candidateId||''}><option value="" disabled>请选择真实候选人</option>{people.map(person=><option key={person.id} value={person.id}>{person.name} · {person.role}</option>)}</select></label><div className="form-grid"><label>面试日期<input required name="scheduledDate" type="date" defaultValue={interview?dateLocalValue(interview.scheduledAt):''}/></label><label>面试时间<input required name="scheduledTime" type="time" step="300" defaultValue={interview?timeLocalValue(interview.scheduledAt):''}/></label></div><div className="form-grid"><label>面试轮次<input name="round" defaultValue={interview?.round||''} placeholder="例如：业务一面"/></label><label>面试方式<input name="mode" defaultValue={interview?.mode||''} placeholder="例如：线下面试"/></label></div></FormModal>}
function OfferModal({offer,people,close,submit,submitting}:{offer:Offer|null;people:Candidate[];close:()=>void;submit:(data:FormData)=>void;submitting:boolean}){
  const [candidateId,setCandidateId]=useState(offer?.candidateId||'');
  const [jobTitle,setJobTitle]=useState(offer?.jobTitle||'');
  const [salary,setSalary]=useState(offer?.salary||'');
  const [deadline,setDeadline]=useState(offer?dateLocalValue(offer.deadline):'');
  const [recipientEmail,setRecipientEmail]=useState(offer?.recipientEmail||'');
  const [content,setContent]=useState(offer?.content||'');
  const [contentEdited,setContentEdited]=useState(Boolean(offer?.content));
  const selected=people.find(person=>person.id===candidateId);
  function generated(person:Candidate|undefined,nextJob=jobTitle,nextSalary=salary,nextDeadline=deadline){return person?offerDraft(person.name,nextJob||person.role,nextSalary,nextDeadline):''}
  return <FormModal close={close} submit={submit} submitting={submitting} scrollable kicker={offer?'OFFER DETAILS':'NEW OFFER'} title={offer?'修改 Offer':'新建 Offer'} description="选择候选人后将自动带入邮箱和职位，并根据薪资与截止日期生成可编辑的 Offer 内容。" submitLabel={offer?'保存 Offer 修改':'保存真实记录'}>
    <label>候选人<select required name="candidateId" value={candidateId} onChange={event=>{const id=event.target.value;const person=people.find(item=>item.id===id);const nextJob=person?.role||'';setCandidateId(id);setJobTitle(nextJob);setRecipientEmail(person?.email||'');setContentEdited(false);setContent(generated(person,nextJob,salary,deadline))}}><option value="" disabled>请选择真实候选人</option>{people.map(person=><option key={person.id} value={person.id}>{person.name} · {person.role}</option>)}</select></label>
    <div className="form-grid"><label>职位名称<input required name="jobTitle" value={jobTitle} onChange={event=>{const value=event.target.value;setJobTitle(value);if(!contentEdited)setContent(generated(selected,value,salary,deadline))}} placeholder="自动带入候选人应聘职位"/></label><label>薪资方案<input required name="salary" value={salary} onChange={event=>{const value=event.target.value;setSalary(value);if(!contentEdited)setContent(generated(selected,jobTitle,value,deadline))}} placeholder="例如：20K × 14"/></label></div>
    <label>候选人邮箱<input required name="recipientEmail" type="email" value={recipientEmail} onChange={event=>setRecipientEmail(event.target.value)} placeholder="选择候选人后自动带入，可手动补充"/></label>
    <label>有效截止日期<input required name="deadline" type="date" value={deadline} onChange={event=>{const value=event.target.value;setDeadline(value);if(!contentEdited)setContent(generated(selected,jobTitle,salary,value))}}/></label>
    <label className="offer-content-field">Offer 内容<textarea required name="content" value={content} onChange={event=>{setContent(event.target.value);setContentEdited(true)}} placeholder="选择候选人并填写薪资、截止日期后自动生成"/></label>
  </FormModal>
}
function parseQuestionCopy(value:string){
  const lines=value.replace(/\r/g,'').split('\n').map(line=>line.trim()).filter(Boolean);
  let title='';let keywords='';let referenceAnswer='';let section:'';
  for(const line of lines){
    const questionMatch=line.match(/^(?:面试问题|问题|题目)\s*[:：]\s*(.*)$/i);
    const keywordMatch=line.match(/^(?:评分关键词|关键词|关键字)\s*[:：]\s*(.*)$/i);
    const answerMatch=line.match(/^(?:参考回答|参考答案|回答要点|答案)\s*[:：]\s*(.*)$/i);
    if(questionMatch){title=questionMatch[1].trim();section='title';continue}
    if(keywordMatch){keywords=keywordMatch[1].trim();section='keywords';continue}
    if(answerMatch){referenceAnswer=answerMatch[1].trim();section='answer';continue}
    if(section==='title'&&!title)title=line;
    else if(section==='keywords')keywords=[keywords,line].filter(Boolean).join('，');
    else if(section==='answer')referenceAnswer=[referenceAnswer,line].filter(Boolean).join('\n');
  }
  if(!title){
    const questionLine=lines.find(line=>/[？?]$/.test(line))||lines[0]||'';
    title=questionLine.replace(/^\s*(?:\d+[.、）)]|[-*•])\s*/,'').trim();
    referenceAnswer=referenceAnswer||lines.filter(line=>line!==questionLine).join('\n');
  }
  if(!keywords){
    const source=`${title} ${referenceAnswer}`;
    const library=['沟通协作','项目推进','需求分析','问题解决','数据分析','领导力','团队管理','客户沟通','成本控制','供应商管理','风险管理','执行力','创新能力','复盘'];
    const matched=library.filter(item=>source.includes(item));
    keywords=(matched.length?matched:['职责','行动','结果','复盘']).join('，');
  }
  return {title,keywords,referenceAnswer};
}

function QuestionModal({question,jobs,close,submit,submitting}:{question:AiQuestion|null;jobs:Job[];close:()=>void;submit:(data:FormData)=>void;submitting:boolean}){
  const [copy,setCopy]=useState('');
  const [title,setTitle]=useState(question?.title||'');
  const [keywords,setKeywords]=useState(question?.keywords||question?.competency||'');
  const [referenceAnswer,setReferenceAnswer]=useState(question?.referenceAnswer||'');
  const [recognitionNote,setRecognitionNote]=useState('');
  function recognize(value=copy){
    if(!value.trim()){setRecognitionNote('请先粘贴包含面试题的文案');return}
    const result=parseQuestionCopy(value);
    setTitle(result.title);setKeywords(result.keywords);setReferenceAnswer(result.referenceAnswer);
    const count=[result.title,result.keywords,result.referenceAnswer].filter(Boolean).length;
    setRecognitionNote(`已识别并填充 ${count} 项内容，可继续手动修改。`);
  }
  return <FormModal close={close} submit={submit} submitting={submitting} scrollable kicker="QUESTION BANK" title={question?'修改面试题':'新建面试题'} description="题目会按岗位匹配；参考回答和评分关键词仅供后台核验与自动评分使用。" submitLabel={question?'保存题目修改':'保存真实记录'}>
    <section className="ai-question-copy"><div><b>粘贴文案自动识别</b><small>支持“题目、评分关键词、参考回答”等常见格式</small></div><textarea value={copy} onChange={event=>{setCopy(event.target.value);setRecognitionNote('')}} onPaste={event=>{const value=event.clipboardData.getData('text');if(value){event.preventDefault();setCopy(value);recognize(value)}}} placeholder={'示例：\n题目：请介绍一次项目推进经历\n评分关键词：目标，行动，协作，结果\n参考回答：说明背景、职责、过程和最终结果'}/><button type="button" onClick={()=>recognize()}>⌕ 智能识别并填充</button>{recognitionNote&&<p role="status">{recognitionNote}</p>}</section>
    <label>适用岗位<select name="jobId" defaultValue={question?.jobId||''}><option value="">通用题目（所有岗位无专属题目时使用）</option>{jobs.map(job=><option key={job.id} value={job.id}>{job.title} · {job.department}</option>)}</select></label>
    <label>面试问题<textarea required name="title" value={title} onChange={event=>setTitle(event.target.value)} placeholder="请输入实际需要使用的面试问题"/></label>
    <input type="hidden" name="competency" value={question?.competency||'综合能力'}/>
    <label>评分关键词<input required name="keywords" value={keywords} onChange={event=>setKeywords(event.target.value)} placeholder="多个关键词请用逗号分隔，例如：职责，行动，结果，复盘"/></label>
    <label>参考回答<textarea name="referenceAnswer" value={referenceAnswer} onChange={event=>setReferenceAnswer(event.target.value)} placeholder="填写理想回答的要点、结构或示例，仅后台工作人员可见"/></label>
    <div className="form-grid"><label>提问方式<select name="questionType" defaultValue={question?.questionType||'语音提问'}><option>语音提问</option><option>视频提问</option></select></label><label>回答时长（秒）<input name="duration" type="number" min="30" max="900" defaultValue={question?.duration||120}/></label></div>
    <label className="check"><input name="followUp" type="checkbox" defaultChecked={question?.followUp||false}/> 允许根据回答继续追问</label>
  </FormModal>
}
function QuestionGeneratorModal({jobs,close,submit,submitting}:{jobs:Job[];close:()=>void;submit:(data:FormData)=>void;submitting:boolean}){
  return <FormModal close={close} submit={submit} submitting={submitting} kicker="AI QUESTION GENERATOR" title="按岗位生成面试题" description="系统会结合岗位名称与所属部门，生成岗位问题、评分关键词和参考回答；生成后可继续修改或删除。" submitLabel="生成并保存题目">
    <label>适用岗位<select required name="jobId" defaultValue=""><option value="" disabled>请选择需要生成题目的岗位</option>{jobs.map(job=><option key={job.id} value={job.id}>{job.title} · {job.department}</option>)}</select></label>
    <label>生成数量<select name="count" defaultValue="5"><option value="3">3 道</option><option value="5">5 道</option><option value="7">7 道</option></select></label>
    <div className="ai-generator-note"><span>✦</span><div><b>生成内容</b><p>岗位认知、专业能力、问题解决、数据意识和复盘成长等维度；正式面试仍按题目创建顺序提问。</p></div></div>
  </FormModal>
}
function AiResultModal({people,close,submit,submitting}:{people:Candidate[];close:()=>void;submit:(data:FormData)=>void;submitting:boolean}){return <FormModal close={close} submit={submit} submitting={submitting} kicker="COMPLETED INTERVIEW" title="录入已完成面试" description="只填写实际完成的面试结果；系统不会自动生成未发生的答题证据。"><label>候选人<select required name="candidateId" defaultValue=""><option value="" disabled>请选择真实候选人</option>{people.map(person=><option key={person.id} value={person.id}>{person.name} · {person.role}</option>)}</select></label><div className="form-grid"><label>面试得分<input required name="score" type="number" min="0" max="100"/></label><label>实际用时（分钟）<input required name="durationMinutes" type="number" min="1" max="600"/></label></div><label>岗位名称<input name="jobTitle" placeholder="留空则使用应聘职位"/></label><label>面试总结<textarea required name="summary" placeholder="请输入真实面试结论、优势、风险和后续建议"/></label></FormModal>}
function ProfileModal({account,close,submit,error,submitting}:{account:Account;close:()=>void;submit:(data:FormData)=>void;error:string;submitting:boolean}){return <FormModal close={close} submit={submit} kicker="ACCOUNT PROFILE" title="个人资料" description="更新后，工作台头像、负责人和面试官姓名会保持一致。" submitLabel="保存个人资料" error={error} submitting={submitting}><label>姓名<input required name="contact" defaultValue={account.contact} maxLength={40} placeholder="请输入姓名"/></label><div className="account-readonly-grid"><label>手机号<input value={account.phone||'未绑定'} readOnly/></label><label>邮箱<input value={account.email||'未绑定'} readOnly/></label></div><p className="account-security-note">手机号和邮箱用于账号登录，暂不支持在工作台内直接变更。</p></FormModal>}
function PasswordModal({close,submit,error,submitting}:{close:()=>void;submit:(data:FormData)=>void;error:string;submitting:boolean}){return <FormModal close={close} submit={submit} kicker="LOGIN SECURITY" title="修改登录密码" description="需要先验证当前密码。更新成功后，下次登录请使用新密码。" submitLabel="更新登录密码" error={error} submitting={submitting}><label>当前密码<input required name="currentPassword" type="password" autoComplete="current-password" placeholder="请输入当前密码"/></label><label>新密码<input required name="newPassword" type="password" autoComplete="new-password" minLength={8} maxLength={20} placeholder="8-20 位，同时包含字母和数字"/></label><label>确认新密码<input required name="confirmPassword" type="password" autoComplete="new-password" minLength={8} maxLength={20} placeholder="请再次输入新密码"/></label><p className="account-security-note">密码不得包含空格，并需同时包含字母和数字。</p></FormModal>}

function JobDrawer({job,candidates,interviews,offers,close,edit}:{job:Job;candidates:Candidate[];interviews:Interview[];offers:Offer[];close:()=>void;edit:()=>void}){const people=candidates.filter(item=>item.jobId===job.id);const interviewCount=interviews.filter(item=>people.some(person=>person.id===item.candidateId)).length;const offerCount=offers.filter(item=>people.some(person=>person.id===item.candidateId)).length;const counts=[['收到简历',people.length],['进入流程',people.filter(item=>stageIndex(item.stage)>=1).length],['安排面试',people.filter(item=>stageIndex(item.stage)>=3).length],['录用',offerCount]] as [string,number][];const max=Math.max(1,people.length);return <div className="drawer-backdrop" onMouseDown={close}><aside className="detail-drawer" onMouseDown={event=>event.stopPropagation()}><button className="drawer-close" onClick={close}>×</button><span className="drawer-label">真实职位详情</span><h2>{job.title}</h2><p>{jobMeta(job)}　负责人：{job.ownerName}</p><div className="drawer-actions"><button type="button" onClick={edit}>编辑职位信息</button></div><div className="drawer-kpis"><div><b>{people.length}</b><small>候选人</small></div><div><b>{people.filter(item=>!['简历筛选','已淘汰'].includes(item.stage)).length}</b><small>流程中</small></div><div><b>{interviewCount}</b><small>面试记录</small></div></div><section><h3>职位进度</h3><div className="pipeline">{counts.map(([label,count])=><div key={label}><span>{label}</span><i><em style={{width:`${count/max*100}%`}}/></i><b>{count}</b></div>)}</div></section><section><h3>数据说明</h3><p className="drawer-note">以上数字均根据与该职位实际关联的候选人、面试及 Offer 记录统计。</p></section></aside></div>}
function CandidateInterviewAssessment({report}:{report?:AiInterview}){
  if(!report)return <div className="ai-assessment"><p><b>暂无记录</b>尚未录入该候选人的已完成 AI 面试结果。</p></div>;
  return <AiInterviewResultPanel summary={report.summary} fallbackScore={report.score} durationSeconds={report.durationSeconds} completedAt={report.completedAt} compact/>;
}

function CandidateStageStepper({stage,assignedName,aiCompleted,interviewCompleted,offerAccepted,canApproveDepartment,advance,requestAssignment}:{stage:string;assignedName?:string;aiCompleted:boolean;interviewCompleted:boolean;offerAccepted:boolean;canApproveDepartment:boolean;advance:(value:string)=>Promise<boolean>;requestAssignment:()=>void}){
  const [saving,setSaving]=useState('');
  const flowStage=stage==='待定'?'用人部门筛选':stage;
  const currentIndex=stages.indexOf(flowStage);
  const terminal=stage==='已淘汰'||currentIndex===stages.length-1;
  const stageCompleted=flowStage==='简历筛选'||(flowStage==='AI面试'&&aiCompleted)||(flowStage==='用人部门筛选'&&canApproveDepartment)||(flowStage==='安排面试'&&interviewCompleted)||(flowStage==='录用'&&offerAccepted)||flowStage==='待入职';
  const nextStage=!terminal&&currentIndex>=0?stages[currentIndex+1]:undefined;
  const canAdvance=Boolean(nextStage&&stageCompleted);
  async function moveNext(nextStage:string,index:number){
    if(saving||terminal||index!==currentIndex+1)return;
    if(nextStage==='用人部门筛选'){requestAssignment();return}
    setSaving(nextStage);
    try{await advance(nextStage)}finally{setSaving('')}
  }
  return <section className={`candidate-stage-stepper ${terminal?'terminal-only':''}`} aria-label="候选人招聘阶段">
    <header><div><span>候选人流程</span><small>仅显示当前所处阶段</small></div><b className={terminal?'terminal':''}>当前：{stage}</b></header>
    {canAdvance&&nextStage&&<button type="button" className="candidate-next-stage-button" disabled={Boolean(saving)} onClick={()=>void moveNext(nextStage,currentIndex+1)}><span>下一阶段</span><b>{nextStage}</b><em>{saving?`正在进入${nextStage}…`:'点击进入'}</em></button>}
    {!terminal&&flowStage==='AI面试'&&!aiCompleted&&<p className="candidate-stage-waiting" role="status">候选人未答题</p>}
    {!terminal&&flowStage==='用人部门筛选'&&assignedName&&<small className="candidate-current-assignee">已推送：{assignedName}</small>}
  </section>;
}

function CandidateFactIcon({type}:{type:CandidateFactType}){
  const paths={
    gender:<><circle cx="9" cy="8" r="3"/><path d="M4 19c.7-3.2 2.3-5 5-5s4.3 1.8 5 5M16 5h4v4M20 5l-5 5"/></>,
    age:<><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18M8 15h.01M12 15h.01M16 15h.01"/></>,
    work:<><rect x="3" y="7" width="18" height="13" rx="3"/><path d="M9 7V4h6v3M3 12h18M10 12v2h4v-2"/></>,
    education:<><path d="m2 9 10-5 10 5-10 5L2 9Z"/><path d="M6 11.5V16c3.4 2.5 8.6 2.5 12 0v-4.5M22 9v6"/></>,
    phone:<path d="M7.2 3.5 10 8l-2 2c1.4 2.8 3.2 4.6 6 6l2-2 4.5 2.8c.3.2.5.6.4 1-1 2.3-2.7 3.3-4.8 2.8-6.5-1.5-11.2-6.2-12.7-12.7-.5-2.1.5-3.8 2.8-4.8.4-.1.8.1 1 .4Z"/>,
    email:<><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[type]}</svg>;
}

function AssessmentComment({text}:{text:string}){
  const items=[...text.matchAll(/([^：\s]+)：([^｜\s]+)｜(\d+星)/g)].map(match=>({label:match[1],result:match[2],rating:match[3]}));
  return <div className="candidate-assessment-comment"><span>评估意见</span>{items.length?<div>{items.map(item=><article key={item.label}><small>{item.label}</small><b>{item.result}</b><em>{item.rating}</em></article>)}</div>:<p>{text||'未填写'}</p>}</div>;
}

function CandidateDrawer({person,aiInterview,assessment,aiCompleted,interviewCompleted,offerAccepted,canApproveDepartment,close,saveFact,advance,requestAssignment}:{person:Candidate;aiInterview?:AiInterview;assessment?:ManualAssessment;aiCompleted:boolean;interviewCompleted:boolean;offerAccepted:boolean;canApproveDepartment:boolean;close:()=>void;saveFact:(field:CandidateFactType,value:string)=>Promise<boolean>;advance:(value:string)=>Promise<boolean>;requestAssignment:()=>void}){
  const [editingFact,setEditingFact]=useState<CandidateFactType|null>(null);
  const [factValue,setFactValue]=useState('');
  const [factError,setFactError]=useState('');
  const [factSaving,setFactSaving]=useState(false);
  const [resumeOpen,setResumeOpen]=useState(false);
  async function submitFact(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!editingFact)return;
    const next=factValue.trim();
    if(editingFact==='email'&&!validEmail(next)){setFactError('请输入有效邮箱');return}
    if(editingFact==='phone'&&next&&!/^[+\d][\d\s-]{5,29}$/.test(next)){setFactError('请输入有效手机号');return}
    if(editingFact==='age'&&next&&(Number(next)<16||Number(next)>100)){setFactError('年龄应为 16–100 岁');return}
    if(editingFact==='work'&&next&&(Number(next)<0||Number(next)>70)){setFactError('工作年限应为 0–70 年');return}
    setFactSaving(true);setFactError('');
    if(await saveFact(editingFact,editingFact==='email'?next.toLowerCase():next))setEditingFact(null);
    setFactSaving(false);
  }
  const hasInterviewScore=aiInterview?.score!==null&&aiInterview?.score!==undefined;
  const interviewTotal=aiInterview?aiInterviewQuestionTotal(aiInterview.summary,aiInterview.score):null;
  const displayedScore=assessment?.total??interviewTotal?.score??(hasInterviewScore?aiInterview.score:person.score);
  const displayedLabel=assessment?'人工评估':hasInterviewScore?(interviewTotal?'面试总分 / 100':'面试得分'):'简历匹配度';
  const workYears=person.workYears!==null&&person.workYears!==undefined?`${person.workYears} 年`:person.years||'未填写';
  const facts:{type:CandidateFactType;label:string;value:string;rawValue:string}[]=[
    {type:'gender',label:'性别',value:person.gender||'未填写',rawValue:person.gender||''},
    {type:'age',label:'年龄',value:person.age?`${person.age} 岁`:'未填写',rawValue:person.age?String(person.age):''},
    {type:'work',label:'工作年限',value:workYears,rawValue:person.workYears!==null&&person.workYears!==undefined?String(person.workYears):(person.years||'').replace(/\s*年\s*$/,'')},
    {type:'education',label:'学历',value:person.education||'未填写',rawValue:person.education||''},
    {type:'phone',label:'手机号',value:person.phone||'未填写',rawValue:person.phone||''},
    {type:'email',label:'邮箱',value:person.email||'未填写',rawValue:person.email||''},
  ];
  function beginFactEdit(fact:typeof facts[number]){setEditingFact(fact.type);setFactValue(fact.rawValue);setFactError('')}
  function cancelFactEdit(){setEditingFact(null);setFactValue('');setFactError('')}
  function factInput(type:CandidateFactType){
    if(type==='gender')return <select autoFocus value={factValue} aria-label="修改候选人性别" onChange={event=>setFactValue(event.target.value)}><option value="">未填写</option><option value="男">男</option><option value="女">女</option><option value="其他">其他</option></select>;
    if(type==='education')return <select autoFocus value={factValue} aria-label="修改候选人学历" onChange={event=>setFactValue(event.target.value)}><option value="">未填写</option>{['高中','中专','大专','本科','硕士','博士','其他'].map(item=><option key={item}>{item}</option>)}</select>;
    const inputType=type==='age'||type==='work'?'number':type==='email'?'email':'tel';
    const placeholders={age:'请输入年龄',work:'请输入工作年限',phone:'请输入手机号',email:'请输入有效邮箱'};
    return <input autoFocus type={inputType} min={type==='age'?16:type==='work'?0:undefined} max={type==='age'?100:type==='work'?70:undefined} step={type==='work'?'0.5':undefined} value={factValue} onChange={event=>setFactValue(event.target.value)} placeholder={placeholders[type as keyof typeof placeholders]} aria-label={`修改候选人${facts.find(fact=>fact.type===type)?.label||''}`}/>;
  }
  return <div className="drawer-backdrop candidate-drawer-backdrop" onMouseDown={close}><aside className="detail-drawer candidate-drawer" role="dialog" aria-modal="true" aria-label={`${person.name}候选人详情`} onMouseDown={event=>event.stopPropagation()}>
    <button className="drawer-close" onClick={close}>×</button>
    <div className="candidate-profile"><span>{person.name.slice(0,1)}</span><div><div className="candidate-title-row"><h2>{person.name}</h2><span>{person.role||'应聘职位未填写'}</span></div><div className="candidate-profile-summary">{facts.map(fact=>editingFact===fact.type?<form key={fact.type} className="candidate-fact-editor" onSubmit={event=>void submitFact(event)}><CandidateFactIcon type={fact.type}/>{factInput(fact.type)}<button disabled={factSaving}>{factSaving?'保存中':'保存'}</button><button type="button" onClick={cancelFactEdit}>取消</button>{factError&&<small>{factError}</small>}</form>:<button key={fact.type} type="button" className="candidate-fact-edit" title={`点击修改${fact.label}`} aria-label={`${fact.label} ${fact.value}，点击修改`} onClick={()=>beginFactEdit(fact)}><CandidateFactIcon type={fact.type}/><b>{fact.value}</b><small>修改</small></button>)}</div></div><em><b>{displayedScore??'—'}</b><small>{displayedLabel}</small></em></div>
    <CandidateStageStepper stage={person.stage} assignedName={person.assignedHrName} aiCompleted={aiCompleted} interviewCompleted={interviewCompleted} offerAccepted={offerAccepted} canApproveDepartment={canApproveDepartment} advance={advance} requestAssignment={requestAssignment}/>
    {assessment&&<section><h3>HR 人工评估</h3><div className="profile-info"><p><span>综合得分</span>{assessment.total} 分</p><p><span>专业能力</span>{assessment.professional} 分</p><p><span>沟通表达</span>{assessment.communication} 分</p><p><span>文化匹配</span>{assessment.culture} 分</p><p><span>评估人</span>{assessment.reviewer}</p></div><AssessmentComment text={assessment.comment}/></section>}
    <section><div className="candidate-section-title"><h3>AI 面试记录</h3>{person.resumeFileName&&<button type="button" title={person.resumeFileName} onClick={()=>setResumeOpen(true)}>查看简历 ↗</button>}</div><CandidateInterviewAssessment report={aiInterview}/><AiInterviewRecordings candidateId={person.id}/></section>
    <section><h3>核心技能</h3><div className="channel-tags">{person.skills.length?person.skills.map(skill=><span key={skill}>{skill}</span>):<span>未填写</span>}</div></section>
  </aside>{resumeOpen&&person.resumeFileName&&<div className="candidate-resume-modal-backdrop" onMouseDown={event=>{event.stopPropagation();setResumeOpen(false)}}><section className="candidate-resume-modal" role="dialog" aria-modal="true" aria-label={`${person.name}简历预览`} onMouseDown={event=>event.stopPropagation()}><button type="button" className="candidate-resume-modal-close" aria-label="关闭简历预览" onClick={()=>setResumeOpen(false)}>×</button><header><div><span>RESUME PREVIEW</span><h3>{person.name}的简历</h3></div><small title={person.resumeFileName}>{person.resumeFileName}</small></header><iframe title={`${person.name}的原始简历`} src={`/api/screening/file?candidateId=${person.id}`}/></section></div>}</div>;
}

function CandidateAssignmentDialog({candidate,accounts,busy,close,submit}:{candidate:Candidate;accounts:RecipientAccount[];busy:boolean;close:()=>void;submit:(recipientId:string)=>void}){
  const [selectedId,setSelectedId]=useState('');
  const selected=accounts.find(account=>account.id===selectedId);
  return <div className="flow-modal-backdrop candidate-assignment-backdrop" onMouseDown={close}><section className="rs-assignment-dialog candidate-assignment-dialog" role="dialog" aria-modal="true" aria-labelledby="candidate-assignment-title" onMouseDown={event=>event.stopPropagation()}>
    <button type="button" className="flow-overlay-close" disabled={busy} onClick={close}>×</button>
    <span className="eyebrow purple">HIRING DEPARTMENT REVIEW</span><h2 id="candidate-assignment-title">选择接收人</h2>
    <p>将 <b>{candidate.name}</b> 推送至指定账号。确认后进入“用人部门筛选”，接收人可在自己的系统中立即查看该简历。</p>
    {accounts.length?<><label className="candidate-assignment-select">接收账号<select autoFocus value={selectedId} disabled={busy} onChange={event=>setSelectedId(event.target.value)}><option value="">请选择超级管理员或 HR</option>{accounts.map(account=><option key={account.id} value={account.id}>{account.contact} · {account.role==='super_admin'?'超级管理员':'HR'}</option>)}</select></label>{selected&&<div className="candidate-assignment-recipient"><span>{selected.contact.slice(0,1)}</span><div><b>{selected.contact}</b><small>{selected.email||selected.phone||'未填写联系方式'}</small></div><em>{selected.role==='super_admin'?'超级管理员':'HR'}</em></div>}</>:<div className="rs-assignment-empty"><b>暂无可选接收人</b><p>请先在“角色管理”中新增超级管理员或 HR。</p></div>}
    <button type="button" className="primary-button" disabled={busy||!selectedId} onClick={()=>submit(selectedId)}>{busy?'正在推送并同步…':'确认推送'} <span>→</span></button>
  </section></div>;
}

function Empty({icon,title,text,action,click,compact=false}:{icon?:string;title:string;text:string;action?:string;click?:()=>void;compact?:boolean}){return <div className={'real-empty '+(compact?'compact':'')}>{icon&&<span>{icon}</span>}<h3>{title}</h3><p>{text}</p>{action&&click&&<button onClick={click}>{action}</button>}</div>}
function formObject(data:FormData){const result:Record<string,unknown>={};data.forEach((value,key)=>{result[key]=value});result.followUp=data.get('followUp')==='on';const scheduledDate=String(data.get('scheduledDate')||'');const scheduledTime=String(data.get('scheduledTime')||'');if(scheduledDate&&scheduledTime){result.scheduledAt=`${scheduledDate}T${scheduledTime}`;delete result.scheduledDate;delete result.scheduledTime}return result}
function validEmail(value:string){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())}
function questionKey(question:AiQuestion){return [question.jobId,question.title,question.category,question.questionType,question.duration,question.competency,question.keywords,question.referenceAnswer,question.followUp].map(value=>String(value??'').trim().toLowerCase()).join('\u0000')}
function compareJobs(first:Job,second:Job){return (jobStatusPriority[first.status]??99)-(jobStatusPriority[second.status]??99)||Date.parse(second.updatedAt)-Date.parse(first.updatedAt)||first.title.localeCompare(second.title,'zh-CN')}
function candidateName(id:string,people:Candidate[]){return people.find(item=>item.id===id)?.name||'候选人已删除'}
function visibleCity(city:string){return city&&city!=='待设置'?city:''}
function jobMeta(job:Job,withHeadcount=false){return [job.department,visibleCity(job.city),withHeadcount?`招聘 ${job.headcount} 人`:''].filter(Boolean).join(' · ')}
function maskPhone(value:string){return /^\d{11}$/.test(value)?`${value.slice(0,3)} ***** ${value.slice(-3)}`:value||'未绑定'}
function stageIndex(stage:string){return candidateStageIndex(stage)}
function sameDay(a:Date,b:Date){return a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate()}
function formatDate(value:string){const date=new Date(value);return Number.isNaN(date.getTime())?'未记录':new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit'}).format(date)}
function offerDraft(name:string,jobTitle:string,salary:string,deadline:string){const confirmBy=deadline?formatOfferDate(deadline):'约定的截止日期';return `尊敬的${name}：\n\n您好！我们诚挚邀请您加入星鉴人才，担任${jobTitle}一职${salary?`，薪资方案为${salary}`:''}。请您于${confirmBy}前确认是否接受本次录用邀请。\n\n期待您的加入！`}
function formatOfferDate(value:string){const date=new Date(`${value}T00:00:00`);return Number.isNaN(date.getTime())?value:new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'long',day:'numeric'}).format(date)}
function formatDateTime(value:string){const date=new Date(value);return Number.isNaN(date.getTime())?'未记录':new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(date)}
function remainingTime(expiresAt:string,now:number){const remaining=Math.max(0,Date.parse(expiresAt)-now);const totalMinutes=Math.ceil(remaining/60000);if(totalMinutes<60)return `${totalMinutes} 分钟`;const hours=Math.floor(totalMinutes/60);const minutes=totalMinutes%60;if(hours<24)return `${hours} 小时${minutes?` ${minutes} 分钟`:''}`;const days=Math.floor(hours/24);const restHours=hours%24;return `${days} 天${restHours?` ${restHours} 小时`:''}`}
function dateTimeLocalValue(value:string){const date=new Date(value);if(Number.isNaN(date.getTime()))return '';const pad=(part:number)=>String(part).padStart(2,'0');return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`}
function dateLocalValue(value:string){return dateTimeLocalValue(value).slice(0,10)}
function timeLocalValue(value:string){return dateTimeLocalValue(value).slice(11,16)}
function formatMonthDay(value:string){const date=new Date(value);return `${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`}
function formatTime(value:string){return new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value))}
function formatLongDate(date:Date){return new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'long',day:'numeric',weekday:'long'}).format(date)}
function greeting(date:Date){const hour=date.getHours();return hour<11?'上午好':hour<14?'中午好':hour<18?'下午好':'晚上好'}
function weekDays(date:Date){const start=new Date(date);start.setDate(date.getDate()-((date.getDay()+6)%7));start.setHours(0,0,0,0);return Array.from({length:7},(_,index)=>{const item=new Date(start);item.setDate(start.getDate()+index);return item})}
function weekLabel(date:Date){return ['周日','周一','周二','周三','周四','周五','周六'][date.getDay()]}
function percent(value:number,total:number){return total?`${percentNumber(value,total).toFixed(1)}%`:'—'}
function percentNumber(value:number,total:number){return total?value/total*100:0}
function isThisMonth(value:string){const date=new Date(value),today=new Date();return date.getFullYear()===today.getFullYear()&&date.getMonth()===today.getMonth()}
function daysUntil(value:string){return Math.ceil((new Date(value).getTime()-Date.now())/86400000)}
function durationText(seconds:number|null){if(!seconds)return '用时未记录';return `${Math.floor(seconds/60)} 分 ${seconds%60} 秒`}
function groupCount(items:string[]){return items.reduce<Record<string,number>>((result,item)=>{result[item]=(result[item]||0)+1;return result},{})}
function recentDays(count:number){const today=new Date();today.setHours(0,0,0,0);return Array.from({length:count},(_,index)=>{const day=new Date(today);day.setDate(today.getDate()-(count-1-index));return day})}
function interviewKeywords(question:AiQuestion,candidate:Candidate){
  const configured=(question.keywords||question.competency).split(/[,，、;；/|]/).map(item=>item.trim()).filter(item=>item.length>=2);
  const text=`${question.title}${question.category}${question.competency}${question.referenceAnswer}`;
  const inferred:[RegExp,string[]][]=[
    [/项目|经验|案例/,['项目管理','职责','结果','复盘']],
    [/沟通|协作|冲突/,['沟通协作','跨部门','推进','解决']],
    [/数据|分析|指标/,['数据分析','指标','转化率','决策']],
    [/产品|需求|用户/,['用户需求','需求分析','产品规划','迭代']],
    [/技术|开发|系统/,['技术方案','系统设计','性能','稳定性']],
    [/管理|团队|领导/,['团队管理','目标','分工','绩效']],
    [/采购|供应商|成本/,['供应商','谈判','成本','交付']],
  ];
  const related=inferred.flatMap(([pattern,items])=>pattern.test(text+candidate.role)?items:[]);
  const skills=candidate.skills.filter(skill=>skill.length>=2).slice(0,3);
  return Array.from(new Set([...configured,...related,...skills])).slice(0,8).length?Array.from(new Set([...configured,...related,...skills])).slice(0,8):['具体职责','行动过程','量化结果','复盘改进'];
}
function speechAlternatives(result:SpeechResultLike){return Array.from({length:result.length},(_,index)=>({transcript:String(result[index]?.transcript||''),confidence:result[index]?.confidence}))}
function applySpeechContext(recognition:SpeechRecognitionLike,jobTitle:string,question:AiQuestion){
  const scope=window as unknown as {SpeechRecognitionPhrase?:new(phrase:string,boost:number)=>SpeechRecognitionPhraseLike};
  const Phrase=scope.SpeechRecognitionPhrase;if(!Phrase||!('phrases' in recognition))return;
  try{recognition.phrases=buildSpeechHints(jobTitle,question).map(phrase=>new Phrase(phrase,5))}catch{}
}
function joinSpeechTranscript(base:string,next:string){const left=base.trim(),right=next.trim();if(!right)return left;if(!left)return right;if(left.endsWith(right))return left;if(right.startsWith(left))return right;for(let overlap=Math.min(24,left.length,right.length);overlap>=2;overlap-=1){if(left.slice(-overlap)===right.slice(0,overlap))return `${left}${right.slice(overlap)}`}return `${left}${/[。！？!?，,；;：:]$/.test(left)?'':'，'}${right}`}
function scoreInterviewAnswer(answer:string,question:AiQuestion,candidate:Candidate):AnswerScore{
  const keywords=interviewKeywords(question,candidate);
  const normalized=answer.toLowerCase().replace(/\s+/g,'');
  const matched=keywords.filter(keyword=>normalized.includes(keyword.toLowerCase().replace(/\s+/g,'')));
  if(!answer.trim())return{score:0,keywords,matched:[]};
  const coverage=matched.length/Math.max(1,keywords.length);
  const detail=Math.min(15,Math.floor(answer.trim().length/45)*3);
  return{score:Math.min(100,Math.round(coverage*85+detail)),keywords,matched};
}
function formatCountdown(seconds:number){const minutes=Math.floor(seconds/60);return `${String(minutes).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`}
function speak(text:string,flash:(text:string)=>void){if(!('speechSynthesis'in window)){flash('当前浏览器不支持语音播放');return}window.speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(text);utterance.lang='zh-CN';utterance.rate=.95;window.speechSynthesis.speak(utterance);flash('正在播放真实题目')}
