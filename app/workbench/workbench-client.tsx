'use client';

import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import ScreeningWorkspace, { preloadScreeningData } from './screening-workspace';

type Account = { id:string; contact:string; phone:string; email:string; createdAt:string };
type Job = { id:string; title:string; department:string; city:string; status:string; headcount:number; ownerName:string; createdAt:string; updatedAt:string };
type Candidate = { id:string; jobId:string|null; name:string; role:string; company:string; years:string; stage:string; source:string; skills:string[]; score:number|null; phone:string; email:string; city:string; createdAt:string; updatedAt:string };
type Interview = { id:string; candidateId:string; scheduledAt:string; round:string; mode:string; interviewer:string; status:string; createdAt:string; updatedAt:string };
type Offer = { id:string; candidateId:string; jobTitle:string; salary:string; ownerName:string; status:string; deadline:string; createdAt:string; updatedAt:string };
type AiQuestion = { id:string; jobId:string|null; title:string; category:string; questionType:string; duration:number; competency:string; followUp:boolean; createdAt:string; updatedAt:string };
type AiInterview = { id:string; candidateId:string; jobTitle:string; status:string; score:number|null; durationSeconds:number|null; summary:string; completedAt:string|null; createdAt:string; updatedAt:string };
type AnswerScore = { score:number; keywords:string[]; matched:string[] };
type SpeechRecognitionLike = {
  lang:string; continuous:boolean; interimResults:boolean;
  start:()=>void; stop:()=>void; abort:()=>void;
  onresult:((event:{results:ArrayLike<{0:{transcript:string}}>} )=>void)|null;
  onend:(()=>void)|null; onerror:(()=>void)|null;
};
type SpeechRecognitionConstructor = new()=>SpeechRecognitionLike;
type Dataset = { account:Account; jobs:Job[]; candidates:Candidate[]; interviews:Interview[]; offers:Offer[]; aiQuestions:AiQuestion[]; aiInterviews:AiInterview[] };
type ModalName = 'job'|'candidate'|'interview'|'offer'|'question'|'aiResult'|'profile'|'password'|null;

const nav = [['⌂','工作台'],['▣','职位管理'],['♙','人才库'],['▤','简历筛选'],['◉','AI 面试'],['◴','面试管理'],['✓','Offer 管理'],['↗','招聘数据']];
const stages = ['待初筛','待复核','面试待安排','AI 初面待发起','待沟通','一面','技术面','二面','Offer','已入职'];
const jobStatuses = ['草稿','招聘中','急聘','已暂停','已关闭'];
const interviewStatuses = ['待确认','已确认','已完成','已取消'];
const offerStatuses = ['待审批','已发放','已接受','已拒绝','已撤回'];

export default function WorkbenchClient() {
  const [data,setData]=useState<Dataset|null>(null);
  const [active,setActive]=useState('工作台');
  const [search,setSearch]=useState('');
  const [modal,setModal]=useState<ModalName>(null);
  const [drawer,setDrawer]=useState<{type:'job'|'candidate';id:string}|null>(null);
  const [notice,setNotice]=useState(false);
  const [accountOpen,setAccountOpen]=useState(false);
  const [accountError,setAccountError]=useState('');
  const [accountSaving,setAccountSaving]=useState(false);
  const [modalSaving,setModalSaving]=useState(false);
  const [editingQuestion,setEditingQuestion]=useState<AiQuestion|null>(null);
  const [editingInterview,setEditingInterview]=useState<Interview|null>(null);
  const [toast,setToast]=useState('');
  const [error,setError]=useState('');
  const saveInFlight=useRef(false);

  async function loadData() {
    const response = await fetch('/api/workbench', { cache:'no-store' });
    if (response.status === 401) { window.location.assign('/'); return; }
    if (!response.ok) { setError('真实数据暂时无法加载，请稍后刷新。'); return; }
    const nextData=await response.json() as Dataset;
    setData(nextData);
    void preloadScreeningData().catch(()=>undefined);
    setError('');
  }

  useEffect(()=>{ void loadData(); },[]);
  useEffect(()=>{const closeAccount=(event:MouseEvent)=>{if(!(event.target instanceof Element)||!event.target.closest('.account-area'))setAccountOpen(false)};document.addEventListener('mousedown',closeAccount);return()=>document.removeEventListener('mousedown',closeAccount)},[]);

  async function create(resource:string,payload:Record<string,unknown>,success:string) {
    if(saveInFlight.current)return;
    saveInFlight.current=true;setModalSaving(true);
    try{
      const response=await fetch('/api/workbench',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({resource,payload})});
      const result=await response.json().catch(()=>({})) as {message?:string};
      if(response.status===401){window.location.assign('/');return}
      if(!response.ok){flash(result.message||'保存失败，请稍后重试。');return}
      setModal(null);await loadData();flash(success);
    }catch{flash('保存失败，请检查网络后重试。')}finally{saveInFlight.current=false;setModalSaving(false)}
  }

  async function updateQuestion(id:string,payload:Record<string,unknown>){
    if(saveInFlight.current)return;
    saveInFlight.current=true;setModalSaving(true);
    try{
      const response=await fetch('/api/workbench',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({resource:'aiQuestion',id,payload})});
      const result=await response.json().catch(()=>({})) as {message?:string};
      if(response.status===401){window.location.assign('/');return}
      if(!response.ok){flash(result.message||'题目更新失败，请稍后重试。');return}
      setModal(null);setEditingQuestion(null);await loadData();flash('面试题已更新');
    }catch{flash('题目更新失败，请检查网络后重试。')}finally{saveInFlight.current=false;setModalSaving(false)}
  }

  async function saveAiInterview(payload:Record<string,unknown>){
    if(saveInFlight.current)return false;
    saveInFlight.current=true;
    try{
      const response=await fetch('/api/workbench',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({resource:'aiInterview',payload})});
      const result=await response.json().catch(()=>({})) as {message?:string};
      if(response.status===401){window.location.assign('/');return false}
      if(!response.ok){flash(result.message||'AI 面试结果保存失败，请稍后重试。');return false}
      await loadData();flash('AI 面试已完成，关键词评分和逐题回答已保存');return true;
    }catch{flash('AI 面试结果保存失败，请检查网络后重试。');return false}
    finally{saveInFlight.current=false}
  }

  async function updateInterview(id:string,payload:Record<string,unknown>){
    if(saveInFlight.current)return;
    saveInFlight.current=true;setModalSaving(true);
    try{
      const response=await fetch('/api/workbench',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({resource:'interview',id,payload})});
      const result=await response.json().catch(()=>({})) as {message?:string};
      if(response.status===401){window.location.assign('/');return}
      if(!response.ok){flash(result.message||'面试安排更新失败，请稍后重试。');return}
      setModal(null);setEditingInterview(null);await loadData();flash('面试安排已更新');
    }catch{flash('面试安排更新失败，请检查网络后重试。')}finally{saveInFlight.current=false;setModalSaving(false)}
  }

  async function update(resource:string,id:string,value:string,success:string) {
    const response=await fetch('/api/workbench',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({resource,id,value})});
    const result=await response.json().catch(()=>({})) as {message?:string};
    if(!response.ok){flash(result.message||'更新失败，请稍后重试。');return}
    await loadData();flash(success);
  }

  function flash(text:string){setToast(text);window.setTimeout(()=>setToast(''),2300)}
  async function logout(){await fetch('/api/auth/logout',{method:'POST'});window.location.assign('/')}
  function openAccountModal(name:'profile'|'password'){setAccountError('');setAccountOpen(false);setModal(name)}
  async function updateAccount(action:'profile'|'password',payload:Record<string,unknown>,success:string){
    if(saveInFlight.current)return;
    saveInFlight.current=true;
    setAccountSaving(true);setAccountError('');
    try{
      const response=await fetch('/api/auth/account',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...payload})});
      const result=await response.json().catch(()=>({})) as {message?:string;account?:Account};
      if(response.status===401){window.location.assign('/');return}
      if(!response.ok){setAccountError(result.message||'账号信息更新失败，请稍后重试。');return}
      if(result.account)setData(current=>current?{
        ...current,
        account:result.account as Account,
        jobs:action==='profile'?current.jobs.map(job=>({...job,ownerName:result.account!.contact})):current.jobs,
        interviews:action==='profile'?current.interviews.map(interview=>({...interview,interviewer:result.account!.contact})):current.interviews,
        offers:action==='profile'?current.offers.map(offer=>({...offer,ownerName:result.account!.contact})):current.offers,
      }:current);
      if(action==='profile')await loadData();
      setModal(null);flash(success);
    }catch{setAccountError('账号信息更新失败，请检查网络后重试。')}finally{saveInFlight.current=false;setAccountSaving(false)}
  }

  const filteredJobs=useMemo(()=>data?.jobs.filter(item=>(item.title+item.department+item.city).toLowerCase().includes(search.toLowerCase()))||[],[data,search]);
  const filteredCandidates=useMemo(()=>data?.candidates.filter(item=>(item.name+item.role+item.company+item.source+item.skills.join('')).toLowerCase().includes(search.toLowerCase()))||[],[data,search]);
  const pendingCount=data ? data.candidates.filter(item=>['待初筛','待复核','面试待安排','AI 初面待发起','待沟通'].includes(item.stage)).length+data.interviews.filter(item=>item.status==='待确认').length : 0;

  if(!data)return <main className="dashboard-loading"><span>星</span><b>{error||'正在读取真实业务数据…'}</b>{error&&<button onClick={()=>void loadData()}>重新加载</button>}</main>;
  const selectedJob=drawer?.type==='job'?data.jobs.find(item=>item.id===drawer.id):undefined;
  const selectedCandidate=drawer?.type==='candidate'?data.candidates.find(item=>item.id===drawer.id):undefined;

  return <main className="dashboard-shell">
    <aside className="dashboard-sidebar">
      <a className="dash-logo" href="/workbench"><span>星</span><b>星鉴人才</b></a>
      <nav><p>招聘管理</p>{nav.map(([icon,label])=><button key={label} className={active===label?'active':''} onClick={()=>{setActive(label);setSearch('')}}><i>{icon}</i><span>{label}</span>{label==='AI 面试'&&<em>AI</em>}</button>)}<p>协作与设置</p><button onClick={()=>flash('团队协作尚未配置数据源')}><i>♧</i><span>团队协作</span></button><button onClick={()=>flash('企业设置尚未配置')}><i>⚙</i><span>企业设置</span></button></nav>
      <div className="sidebar-help"><b>真实数据模式</b><p>仅展示当前账号实际保存的记录</p><button onClick={()=>setActive('招聘数据')}>查看数据来源</button></div>
      <button className="back-login sidebar-logout" onClick={()=>void logout()}>← 安全退出</button>
    </aside>
    <section className="dashboard-main">
      <header className="dashboard-header"><div className="global-search"><span>⌕</span><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="搜索真实职位、候选人或来源…"/><kbd>⌘ K</kbd></div><div className="header-tools"><button className="round-button" onClick={()=>{setNotice(!notice);setAccountOpen(false)}}>♧{pendingCount>0&&<b>{pendingCount}</b>}</button><button className="round-button" onClick={()=>flash('所有指标均由当前账号记录实时计算')}>?</button><div className="account-area"><button type="button" className={'user-info account-trigger '+(accountOpen?'open':'')} aria-expanded={accountOpen} onClick={()=>{setAccountOpen(!accountOpen);setNotice(false)}}><span>{data.account.contact.slice(0,1)}</span><div><b>{data.account.phone||data.account.email}</b><small>账号管理员</small></div><i>⌄</i></button>{accountOpen&&<div className="account-menu"><header><span>{data.account.contact.slice(0,1)}</span><div><b>{data.account.contact}</b><small>{data.account.email||data.account.phone}</small></div></header><section><p><span>手机号</span><b>{maskPhone(data.account.phone)}</b></p><p><span>邮箱</span><b>{data.account.email||'未绑定'}</b></p></section><button type="button" onClick={()=>openAccountModal('profile')}><i>◎</i><div><b>个人资料</b><small>修改账号显示姓名</small></div><em>›</em></button><button type="button" onClick={()=>openAccountModal('password')}><i>⌾</i><div><b>登录与安全</b><small>验证当前密码后修改</small></div><em>›</em></button><button type="button" className="account-logout" onClick={()=>void logout()}><i>↪</i><div><b>安全退出</b><small>退出当前登录账号</small></div></button></div>}</div>{notice&&<div className="notice-pop"><b>实时待办</b>{pendingCount===0?<p>暂无待处理记录</p>:<><p>{data.candidates.filter(item=>['待初筛','待复核','面试待安排','AI 初面待发起','待沟通'].includes(item.stage)).length} 位候选人待推进</p><p>{data.interviews.filter(item=>item.status==='待确认').length} 场面试待确认</p></>}</div>}</div></header>
      <div className="dashboard-content">
        {active==='工作台'&&<Home data={data} go={setActive} newJob={()=>setModal('job')}/>}
        {active==='职位管理'&&<Jobs jobs={filteredJobs} candidates={data.candidates} interviews={data.interviews} onNew={()=>setModal('job')} onPick={id=>setDrawer({type:'job',id})} updateStatus={(id,value)=>void update('jobStatus',id,value,'职位状态已更新')}/>}
        {active==='人才库'&&<Talent people={filteredCandidates} onNew={()=>setModal('candidate')} onPick={id=>setDrawer({type:'candidate',id})}/>}
        {active==='简历筛选'&&<ScreeningWorkspace people={filteredCandidates} jobs={data.jobs} account={data.account} reload={loadData} openCandidate={id=>setDrawer({type:'candidate',id})} flash={flash}/>}
        {active==='AI 面试'&&<AiStudio data={data} openQuestion={question=>{setEditingQuestion(question||null);setModal('question')}} openResult={()=>setModal('aiResult')} saveResult={saveAiInterview} flash={flash}/>}
        {active==='面试管理'&&<Interviews items={data.interviews} people={data.candidates} onNew={()=>{setEditingInterview(null);setModal('interview')}} onPick={id=>{setEditingInterview(data.interviews.find(item=>item.id===id)||null);setModal('interview')}} updateStatus={(id,value)=>void update('interviewStatus',id,value,'面试状态已更新')}/>}
        {active==='Offer 管理'&&<Offers items={data.offers} people={data.candidates} onNew={()=>setModal('offer')} updateStatus={(id,value)=>void update('offerStatus',id,value,'Offer 状态已更新')}/>}
        {active==='招聘数据'&&<Analytics data={data}/>}
      </div>
    </section>
    {modal==='job'&&<JobModal close={()=>setModal(null)} submitting={modalSaving} submit={form=>void create('job',formObject(form),'职位已创建并保存')}/>}
    {modal==='candidate'&&<CandidateModal jobs={data.jobs} close={()=>setModal(null)} submitting={modalSaving} submit={form=>void create('candidate',formObject(form),'候选人已加入人才库')}/>}
    {modal==='interview'&&<InterviewModal interview={editingInterview} people={data.candidates} close={()=>{if(!modalSaving){setModal(null);setEditingInterview(null)}}} submitting={modalSaving} submit={form=>editingInterview?void updateInterview(editingInterview.id,formObject(form)):void create('interview',formObject(form),'面试安排已保存')}/>}
    {modal==='offer'&&<OfferModal people={data.candidates} close={()=>setModal(null)} submitting={modalSaving} submit={form=>void create('offer',formObject(form),'Offer 已创建')}/>}
    {modal==='question'&&<QuestionModal question={editingQuestion} jobs={data.jobs} close={()=>{if(!modalSaving){setModal(null);setEditingQuestion(null)}}} submitting={modalSaving} submit={form=>editingQuestion?void updateQuestion(editingQuestion.id,formObject(form)):void create('aiQuestion',formObject(form),'面试题已保存到题库')}/>} 
    {modal==='aiResult'&&<AiResultModal people={data.candidates} close={()=>setModal(null)} submitting={modalSaving} submit={form=>void create('aiInterview',formObject(form),'真实面试结果已录入')}/>}
    {modal==='profile'&&<ProfileModal account={data.account} close={()=>setModal(null)} error={accountError} submitting={accountSaving} submit={form=>void updateAccount('profile',formObject(form),'个人资料已更新')}/>}
    {modal==='password'&&<PasswordModal close={()=>setModal(null)} error={accountError} submitting={accountSaving} submit={form=>void updateAccount('password',formObject(form),'登录密码已更新')}/>}
    {selectedJob&&<JobDrawer job={selectedJob} candidates={data.candidates} interviews={data.interviews} offers={data.offers} close={()=>setDrawer(null)}/>}
    {selectedCandidate&&<CandidateDrawer person={selectedCandidate} aiInterview={data.aiInterviews.find(item=>item.candidateId===selectedCandidate.id)} close={()=>setDrawer(null)} advance={value=>void update('candidateStage',selectedCandidate.id,value,'候选人阶段已更新')}/>}
    {toast&&<div className="dashboard-toast">{toast}</div>}
  </main>
}

function Head({path,title,sub,action,click}:{path:string;title:string;sub:string;action?:string;click?:()=>void}){return <div className="subpage-head"><div><p>招聘管理 / {path}</p><h1>{title}</h1><small>{sub}</small></div>{action&&<button className="new-job" onClick={click}>＋ {action}</button>}</div>}

function Home({data,go,newJob}:{data:Dataset;go:(page:string)=>void;newJob:()=>void}){
  const today=new Date();const monthStart=new Date(today.getFullYear(),today.getMonth(),1);const activeJobs=data.jobs.filter(item=>['招聘中','急聘'].includes(item.status));const monthCandidates=data.candidates.filter(item=>new Date(item.createdAt)>=monthStart);const pendingCandidates=data.candidates.filter(item=>['待初筛','待复核','面试待安排','AI 初面待发起','待沟通'].includes(item.stage));const pendingInterviews=data.interviews.filter(item=>item.status==='待确认');const joined=data.candidates.filter(item=>item.stage==='已入职'&&new Date(item.updatedAt)>=monthStart);const todayInterviews=data.interviews.filter(item=>sameDay(new Date(item.scheduledAt),today));
  const kpis=[['▣','招聘中职位',activeJobs.length,`全部职位 ${data.jobs.length} 个`,'purple-bg','职位管理'],['♙','本月新增候选人',monthCandidates.length,`人才库共 ${data.candidates.length} 人`,'blue-bg','人才库'],['◴','待处理事项',pendingCandidates.length+pendingInterviews.length,`候选人 ${pendingCandidates.length} · 面试 ${pendingInterviews.length}`,'orange-bg','简历筛选'],['✓','本月已入职',joined.length,`累计入职 ${data.candidates.filter(item=>item.stage==='已入职').length} 人`,'green-bg','Offer 管理']];
  const stageCounts=[['收到简历',data.candidates.length],['AI 初筛通过',data.candidates.filter(item=>stageIndex(item.stage)>=1).length],['进入面试',data.candidates.filter(item=>stageIndex(item.stage)>=2).length],['发放 Offer',data.offers.filter(item=>['已发放','已接受'].includes(item.status)).length],['成功入职',data.candidates.filter(item=>item.stage==='已入职').length]] as [string,number][];const max=Math.max(stageCounts[0][1],1);
  const sourceCounts=groupCount(data.candidates.map(item=>item.source).filter(Boolean));const bestSource=Object.entries(sourceCounts).sort((a,b)=>b[1]-a[1])[0];
  return <><section className="welcome-row"><div><p>{formatLongDate(today)}</p><h1>{greeting(today)}，{data.account.contact} <span>👋</span></h1><small>当前有 <b>{pendingCandidates.length+pendingInterviews.length} 项</b> 真实招聘记录等待处理。</small></div><button className="new-job" onClick={newJob}>＋ 发布新职位</button></section><section className="kpi-grid">{kpis.map(item=><article className="clickable" role="button" tabIndex={0} onClick={()=>go(String(item[5]))} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();go(String(item[5]))}}} key={String(item[1])}><div className={'kpi-icon '+item[4]}>{item[0]}</div><span>{item[1]}<em>实时数据</em></span><strong>{item[2]}</strong><small>{item[3]}</small></article>)}</section><section className="dashboard-grid"><article className="panel job-panel"><div className="panel-title"><div><h3>重点职位进展</h3><p>来自当前账号保存的职位与候选人记录</p></div><button onClick={()=>go('职位管理')}>查看全部 →</button></div><div className="job-head"><span>职位名称</span><span>候选人</span><span>流程中</span><span>面试</span><span>状态</span></div>{data.jobs.length===0?<Empty compact title="暂无真实职位" text="发布第一个职位后，进展会在这里实时显示。" action="发布职位" click={newJob}/>:data.jobs.slice(0,4).map((job,index)=>{const candidates=data.candidates.filter(item=>item.jobId===job.id);return <div className="job-row" key={job.id}><div><b>{job.title}</b><small>{job.department} · {job.city}</small></div><span><i className={'job-dot dot-'+index}/>{candidates.length}</span><span>{candidates.filter(item=>!['待初筛','初筛淘汰','淘汰人才库','已淘汰','已入职'].includes(item.stage)).length}</span><span>{data.interviews.filter(item=>candidates.some(candidate=>candidate.id===item.candidateId)).length}</span><em className={job.status==='急聘'?'urgent':''}>{job.status}</em></div>})}</article><aside className="panel today-panel"><div className="panel-title"><div><h3>今日安排</h3><p>{today.getMonth()+1} 月 {today.getDate()} 日</p></div></div>{todayInterviews.length===0?<Empty compact icon="◴" title="今日暂无面试" text="安排面试后将自动出现在日程中。"/>:todayInterviews.map((item,index)=><div className="schedule-item" key={item.id}><time>{formatTime(item.scheduledAt)}</time><div className={'schedule-line '+(index%3===1?'orange-line':index%3===2?'green-line':'purple-line')}><b>{item.round}</b><p>{candidateName(item.candidateId,data.candidates)}</p><span>{item.mode} · {item.status}</span></div></div>)}</aside><article className="panel funnel-panel"><div className="panel-title"><div><h3>招聘漏斗</h3><p>按当前候选人阶段实时汇总</p></div></div><div className="funnel-bars">{stageCounts.map(([label,count])=><div key={label}><span>{label}</span><i style={{width:`${Math.round(count/max*100)}%`}}/><b>{count}</b></div>)}</div></article><aside className="ai-panel"><div><span>✦</span><b>数据洞察</b><em>实时</em></div>{bestSource?<><h3>{bestSource[0]}是当前候选人最多的来源</h3><p>该来源已沉淀 {bestSource[1]} 位候选人，结论来自当前账号真实记录。</p></>:<><h3>暂无可分析的候选人数据</h3><p>录入候选人及来源后，这里会生成基于真实记录的渠道洞察。</p></>}<button onClick={()=>go('招聘数据')}>查看完整数据 →</button></aside></section></>
}

function Jobs({jobs,candidates,interviews,onNew,onPick,updateStatus}:{jobs:Job[];candidates:Candidate[];interviews:Interview[];onNew:()=>void;onPick:(id:string)=>void;updateStatus:(id:string,value:string)=>void}){return <section><Head path="职位管理" title="职位管理" sub="只展示当前账号实际创建的职位" action="发布新职位" click={onNew}/><div className="summary-strip"><span><b>{jobs.length}</b> 全部职位</span><span><b>{jobs.filter(item=>item.status==='招聘中').length}</b> 招聘中</span><span><b>{jobs.filter(item=>item.status==='草稿').length}</b> 草稿</span><span><b>{jobs.filter(item=>item.status==='已暂停').length}</b> 已暂停</span></div><div className="sub-toolbar"><div className="tab-set"><button className="active">全部职位</button></div><div className="filter-box"><span>数据更新时间：刚刚</span></div></div><div className="management-table"><div className="manage-head"><span>职位名称</span><span>状态</span><span>候选人</span><span>面试</span><span>负责人</span><span>操作</span></div>{jobs.length===0?<Empty icon="▣" title="还没有职位记录" text="创建职位后，候选人和面试数量会自动关联统计。" action="发布新职位" click={onNew}/>:jobs.map(job=>{const people=candidates.filter(item=>item.jobId===job.id);return <div className="manage-row" key={job.id}><div><b>{job.title}</b><small>{job.department} · {job.city} · 招聘 {job.headcount} 人</small></div><select value={job.status} onChange={event=>updateStatus(job.id,event.target.value)}>{jobStatuses.map(item=><option key={item}>{item}</option>)}</select><span>{people.length} 人</span><span>{interviews.filter(item=>people.some(person=>person.id===item.candidateId)).length} 场</span><span>{job.ownerName}</span><button onClick={()=>onPick(job.id)}>查看详情</button></div>})}</div></section>}

function Talent({people,onNew,onPick}:{people:Candidate[];onNew:()=>void;onPick:(id:string)=>void}){const [stage,setStage]=useState('全部');const visible=stage==='全部'?people:people.filter(item=>item.stage===stage);return <section><Head path="人才库" title="人才库" sub="候选人信息来自你实际录入的业务记录" action="添加候选人" click={onNew}/><div className="talent-tabs"><button className={stage==='全部'?'active':''} onClick={()=>setStage('全部')}>全部<b>{people.length}</b></button>{stages.map(item=><button className={stage===item?'active':''} onClick={()=>setStage(item)} key={item}>{item}<b>{people.filter(person=>person.stage===item).length}</b></button>)}</div>{visible.length===0?<Empty icon="♙" title={people.length?'该阶段暂无候选人':'还没有候选人记录'} text="添加候选人后，简历筛选、面试和 Offer 模块会同步使用同一份数据。" action="添加候选人" click={onNew}/>:<div className="candidate-grid">{visible.map(person=><button className="candidate-card" key={person.id} onClick={()=>onPick(person.id)}><div className="candidate-top"><span>{person.name.slice(0,1)}</span><div><b>{person.name}</b><small>{person.company||'未填写最近公司'}{person.years?` · ${person.years}`:''}</small></div><em>{person.score===null?'未评估':`${person.score}%`}</em></div><h3>{person.role}</h3><div className="skill-row">{person.skills.length?person.skills.map(skill=><i key={skill}>{skill}</i>):<i>未添加技能标签</i>}</div><footer><span>{person.stage}</span><small>{person.source?`来自 ${person.source}`:'来源未填写'}</small><b>查看档案 →</b></footer></button>)}</div>}</section>}

function AiStudio({data,openQuestion,openResult,saveResult,flash}:{data:Dataset;openQuestion:(question?:AiQuestion)=>void;openResult:()=>void;saveResult:(payload:Record<string,unknown>)=>Promise<boolean>;flash:(text:string)=>void}){
  const [tab,setTab]=useState<'candidates'|'library'|'summary'>('candidates');
  const [current,setCurrent]=useState(data.aiInterviews[0]?.id||'');
  const [selectedQuestion,setSelectedQuestion]=useState('');
  const [jobFilter,setJobFilter]=useState(data.jobs[0]?.id||'all');
  const [session,setSession]=useState<{candidate:Candidate;questions:AiQuestion[]}|null>(null);
  const selected=data.aiInterviews.find(item=>item.id===current)||data.aiInterviews[0];
  const questions=data.aiQuestions.filter((question,index,items)=>items.findIndex(item=>questionKey(item)===questionKey(question))===index);
  const visibleQuestions=jobFilter==='all'?questions:jobFilter==='general'?questions.filter(question=>!question.jobId):questions.filter(question=>!question.jobId||question.jobId===jobFilter);
  function startInterview(person:Candidate){
    const job=data.jobs.find(item=>item.id===person.jobId)||data.jobs.find(item=>item.title.trim().toLowerCase()===person.role.trim().toLowerCase());
    const specific=job?questions.filter(question=>question.jobId===job.id):[];
    const general=questions.filter(question=>!question.jobId);
    const interviewQuestions=specific.length?specific:general;
    if(!interviewQuestions.length){setJobFilter(job?.id||'general');setTab('library');flash(job?`请先为“${job.title}”配置面试题`:'请先创建通用 AI 面试题');return}
    setSession({candidate:person,questions:interviewQuestions});
  }
  if(session)return <AiInterviewSession candidate={session.candidate} questions={session.questions} flash={flash} close={()=>setSession(null)} complete={async payload=>{
    const saved=await saveResult(payload);
    if(saved){setSession(null);setCurrent('');setTab('summary')}
    return saved;
  }}/>;
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
        return <div className="flow-person-row" key={person.id}><span/><div className="flow-person-profile"><span>{person.name.slice(0,1)}</span><div><h3>{person.name}<small>{person.role}</small></h3><p>{person.company||'公司未填写'}</p><small>候选人创建于 {formatDate(person.createdAt)}</small></div></div><div className="flow-person-owner"><span>报告状态</span><b>{report?'已录入':'暂无记录'}</b><small>{report?.completedAt?formatDate(report.completedAt):'—'}</small></div><div className="flow-person-status"><span>综合得分</span><b className={report?'completed':''}>{report?.score??'—'}</b></div><button className="flow-more" onClick={report?()=>{setCurrent(report.id);setTab('summary')}:()=>startInterview(person)}>{report?'查看总结':'开始 AI 面试'}</button></div>
      })}</div>}
    </div>}
    {tab==='library'&&<div className="ai-library-shell">
      <aside className="ai-library-filter"><h3>岗位题库</h3><p>按适用岗位展示已保存题目</p><button className={jobFilter==='all'?'active':''} onClick={()=>setJobFilter('all')}>全部题目<b>{questions.length}</b></button><button className={jobFilter==='general'?'active':''} onClick={()=>setJobFilter('general')}>通用题目<b>{questions.filter(question=>!question.jobId).length}</b></button>{data.jobs.map(job=><button className={jobFilter===job.id?'active':''} onClick={()=>setJobFilter(job.id)} key={job.id}>{job.title}<b>{questions.filter(question=>question.jobId===job.id).length}</b></button>)}<div className="ai-library-tip"><i>✦</i><b>岗位自动匹配</b><p>发起面试时优先使用候选人应聘岗位的题目；未配置时使用通用题目。</p></div></aside>
      <section className="ai-library-main">
        <div className="ai-library-toolbar"><label>⌕<input value={jobFilter==='all'?'全部岗位':jobFilter==='general'?'通用题目':data.jobs.find(job=>job.id===jobFilter)?.title||'岗位题目'} readOnly/></label><div><button onClick={()=>openQuestion()}>＋ 新建题目</button><span>共 {visibleQuestions.length} 道</span></div></div>
        <div className="ai-question-head"><span>题目内容</span><span>分类</span><span>提问方式</span><span>时长</span><span>追问</span><span>操作</span></div>
        {visibleQuestions.length===0?<Empty icon="▤" title="该岗位暂无题目" text="新建题目并选择适用岗位后，会自动显示在这里。" action="新建题目" click={()=>openQuestion()}/>:visibleQuestions.map(question=><div className={`ai-question-row ${selectedQuestion===question.id?'selected':''}`} key={question.id} role="button" tabIndex={0} aria-selected={selectedQuestion===question.id} onClick={()=>setSelectedQuestion(question.id)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();setSelectedQuestion(question.id)}}}><div><i>Q</i><span><b>{question.title}</b><small>{question.jobId?`岗位：${data.jobs.find(job=>job.id===question.jobId)?.title||'岗位已删除'} · `:'通用题目 · '}考察：{question.competency}</small></span></div><span>{question.category}</span><em className={question.questionType==='语音提问'?'voice':''}>{question.questionType}</em><span>{question.duration} 秒</span><span>{question.followUp?'是':'否'}</span><div><button onClick={event=>{event.stopPropagation();setSelectedQuestion(question.id);openQuestion(question)}}>修改</button><button onClick={event=>{event.stopPropagation();setSelectedQuestion(question.id);speak(question.title,flash)}}>试听</button></div></div>)}
      </section>
    </div>}
    {tab==='summary'&&(selected?<div className="ai-summary-shell"><aside><div className="ai-summary-list-title"><div><h3>已完成面试</h3><p>共 {data.aiInterviews.length} 份真实总结</p></div></div>{data.aiInterviews.map(report=>{const person=data.candidates.find(item=>item.id===report.candidateId);return <button key={report.id} className={report.id===selected.id?'active':''} onClick={()=>setCurrent(report.id)}><span>{person?.name.slice(0,1)||'候'}</span><div><b>{person?.name||'候选人已删除'}</b><small>{report.jobTitle}</small></div><em>{report.score??'—'}</em></button>})}</aside><AiSummary report={selected} person={data.candidates.find(item=>item.id===selected.candidateId)}/></div>:<Empty icon="✦" title="暂无 AI 面试总结" text="完成真实面试后，可通过“录入已完成面试”保存得分、用时与总结；系统不会生成虚构报告。" action={data.candidates.length?'录入面试结果':undefined} click={data.candidates.length?openResult:undefined}/>)}
  </section>
}

function AiInterviewSession({candidate,questions,flash,close,complete}:{candidate:Candidate;questions:AiQuestion[];flash:(text:string)=>void;close:()=>void;complete:(payload:Record<string,unknown>)=>Promise<boolean>}){
  const videoRef=useRef<HTMLVideoElement>(null);
  const streamRef=useRef<MediaStream|null>(null);
  const recognitionRef=useRef<SpeechRecognitionLike|null>(null);
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
      streamRef.current?.getTracks().forEach(track=>track.stop());
      recognitionRef.current?.abort();
      if('speechSynthesis'in window)window.speechSynthesis.cancel();
    };
  },[]);

  useEffect(()=>{
    recognitionRef.current?.abort();
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

  function startListening(){
    const speechWindow=window as unknown as {SpeechRecognition?:SpeechRecognitionConstructor;webkitSpeechRecognition?:SpeechRecognitionConstructor};
    const Recognition=speechWindow.SpeechRecognition||speechWindow.webkitSpeechRecognition;
    if(!Recognition)return;
    recognitionRef.current?.abort();
    const recognition=new Recognition();
    const questionId=question.id;
    recognition.lang='zh-CN';recognition.continuous=true;recognition.interimResults=true;
    recognition.onresult=event=>{
      const transcript=Array.from(event.results).map(item=>item[0]?.transcript||'').join('');
      setAnswers(current=>({...current,[questionId]:transcript}));
      setScores(current=>{const next={...current};delete next[questionId];return next});
    };
    recognition.onend=()=>setListening(false);
    recognition.onerror=()=>setListening(false);
    recognitionRef.current=recognition;
    try{recognition.start();setListening(true)}catch{setListening(false)}
  }

  function submitCurrent(auto=false){
    if(saving)return;
    if(!answer.trim()&&!auto){submittingQuestionRef.current='';flash('请先回答当前问题');return}
    recognitionRef.current?.stop();setListening(false);
    const next=scoreInterviewAnswer(answer,question,candidate);
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
    const finalScores=questions.map(item=>item.id===question.id?currentScore:scores[item.id]||scoreInterviewAnswer(answers[item.id]||'',item,candidate));
    const overall=Math.round(finalScores.reduce((sum,item)=>sum+item.score,0)/Math.max(1,finalScores.length));
    const details=questions.map((item,itemIndex)=>{
      const itemScore=finalScores[itemIndex];
      const itemAnswer=(answers[item.id]||'未作答').replace(/\s+/g,' ').slice(0,360);
      return `${itemIndex+1}. ${item.title}（${itemScore.score}分）\n命中关键词：${itemScore.matched.join('、')||'无'}\n回答：${itemAnswer}`;
    });
    const summary=[`AI 关键词自动评分：综合 ${overall} 分。评分关键词来自题目“考察能力”配置，并结合题意与候选人技能生成。`,...details].join('\n\n').slice(0,4000);
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
        {cameraState==='denied'&&<div className="ai-camera-help"><b>无法显示视频画面</b><p>请在浏览器地址栏允许摄像头和麦克风权限，然后重新连接。文字作答仍可继续。</p><button type="button" onClick={()=>void requestCamera()}>重新连接设备</button></div>}
        <footer><span>{candidate.name.slice(0,1)}</span><div><b>{candidate.name}</b><small>{candidate.role}</small></div><em>● 面试中</em></footer>
      </section>
      <section className="ai-answer-card">
        <div className="ai-question-step"><span>QUESTION {String(index+1).padStart(2,'0')}</span><b>{formatCountdown(secondsLeft)}</b></div>
        <h2>{question.title}</h2>
        <p className="ai-question-note">建议回答时长 {question.duration} 秒 · 倒计时结束后自动提交</p>
        <label className="ai-answer-input">回答内容<textarea value={answer} onChange={event=>{setAnswers(current=>({...current,[question.id]:event.target.value}));setScores(current=>{const next={...current};delete next[question.id];return next})}} placeholder="可直接口述回答，系统会自动转写；也可以在这里输入回答…"/></label>
        <div className="ai-answer-actions"><span className={listening?'ai-listening-status active':'ai-listening-status'}>{listening?'● 正在自动识别语音':'可直接口述或输入回答'}</span><button type="button" onClick={()=>speakQuestion(question.title)}>▶ 重播题目</button><button type="button" className="primary" disabled={saving} onClick={()=>submitCurrent(false)}>{saving?'正在保存…':'提交'}</button></div>
        <footer className="ai-question-nav"><button type="button" disabled={index===0||saving} onClick={()=>{const previous=index-1;submittingQuestionRef.current='';setSecondsLeft(questions[previous].duration);setIndex(previous)}}>← 上一题</button><span>评分结果将在面试结束后提供给后台工作人员</span></footer>
      </section>
    </div>
  </section>;
}

function AiSummary({report,person}:{report:AiInterview;person?:Candidate}){return <article className="ai-summary-report"><header><div><span>{person?.name.slice(0,1)||'候'}</span><div><h2>{person?.name||'候选人'} · AI 面试总结</h2><p>{report.jobTitle} · 用时 {durationText(report.durationSeconds)} · {report.completedAt?formatDate(report.completedAt):'时间未记录'}</p></div></div><div><button className="primary" onClick={()=>window.print()}>导出报告</button></div></header><section className="ai-summary-overview"><div className="ai-score-ring"><strong>{report.score??'—'}</strong><small>综合得分</small></div><div><span>面试结果</span><h3>{report.status}</h3><p>{report.summary}</p><em>记录已保存</em></div></section><section className="ai-followup-advice"><span>✓</span><div><h3>评分说明</h3><p>自动面试按题目配置的考察能力与关键词进行匹配评分，并保留候选人的实际回答；人工录入的历史结果继续按原样展示。</p></div></section></article>}

function Interviews({items,people,onNew,onPick,updateStatus}:{items:Interview[];people:Candidate[];onNew:()=>void;onPick:(id:string)=>void;updateStatus:(id:string,value:string)=>void}){const week=weekDays(new Date());return <section><Head path="面试管理" title="面试管理" sub="日程来自实际保存的面试安排" action="安排面试" click={onNew}/><div className="week-strip">{week.map(date=><button className={sameDay(date,new Date())?'active':''} key={date.toISOString()}><span>{weekLabel(date)}</span><b>{date.getDate()}</b>{items.some(item=>sameDay(new Date(item.scheduledAt),date))&&<i/>}</button>)}</div><div className="interview-layout"><div className="interview-list"><div className="list-title"><h3>面试日程</h3><span>{items.length} 场真实面试</span></div>{items.length===0?<Empty icon="◴" title="还没有面试安排" text="选择真实候选人并安排面试后，日程会保存到这里。" action="安排面试" click={onNew}/>:items.map(item=><article className="interview-card clickable" role="button" tabIndex={0} key={item.id} onClick={()=>onPick(item.id)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onPick(item.id)}}}><time><b>{formatTime(item.scheduledAt)}</b><small>{formatMonthDay(item.scheduledAt)}</small></time><i className="interview-color"/><div><h3>{candidateName(item.candidateId,people)} · {item.round}</h3><p>{people.find(person=>person.id===item.candidateId)?.role||'职位未关联'}</p><span>{item.mode}　面试官：{item.interviewer}</span></div><select value={item.status} onClick={event=>event.stopPropagation()} onChange={event=>updateStatus(item.id,event.target.value)}>{interviewStatuses.map(status=><option key={status}>{status}</option>)}</select></article>)}</div><aside className="interview-side"><h3>面试协同提醒</h3><div><b>{items.filter(item=>new Date(item.scheduledAt)<new Date()&&item.status!=='已完成'&&item.status!=='已取消').length}</b><span>待补充面试结果<small>基于已过期且未完成的真实日程</small></span></div><div><b>{items.filter(item=>item.status==='待确认').length}</b><span>候选人待确认<small>来自当前实际安排</small></span></div></aside></div></section>}

function Offers({items,people,onNew,updateStatus}:{items:Offer[];people:Candidate[];onNew:()=>void;updateStatus:(id:string,value:string)=>void}){const accepted=items.filter(item=>item.status==='已接受').length;return <section><Head path="Offer 管理" title="Offer 管理" sub="审批、发放和接受状态来自真实 Offer 记录" action="新建 Offer" click={onNew}/><div className="offer-kpis">{[['待审批',items.filter(item=>item.status==='待审批').length,'当前待处理'],['本月已发放',items.filter(item=>item.status==='已发放'&&isThisMonth(item.updatedAt)).length,'按更新时间统计'],['候选人已接受',accepted,items.length?`接受率 ${percent(accepted,items.length)}`:'暂无记录'],['即将截止',items.filter(item=>daysUntil(item.deadline)>=0&&daysUntil(item.deadline)<=14&&!['已接受','已拒绝','已撤回'].includes(item.status)).length,'未来 14 天']].map(item=><article key={String(item[0])}><span>{item[0]}</span><b>{item[1]}</b><small>{item[2]}</small></article>)}</div><div className="offer-table"><div className="offer-head"><span>候选人</span><span>职位</span><span>薪资方案</span><span>负责人</span><span>状态</span><span>截止日期</span><span>操作</span></div>{items.length===0?<Empty icon="✓" title="还没有 Offer 记录" text="创建 Offer 后，状态与接受率会根据实际记录计算。" action="新建 Offer" click={onNew}/>:items.map(item=><div className="offer-row" key={item.id}><div><span>{candidateName(item.candidateId,people).slice(0,1)}</span><b>{candidateName(item.candidateId,people)}</b></div><span>{item.jobTitle}</span><strong>{item.salary}</strong><span>{item.ownerName}</span><select value={item.status} onChange={event=>updateStatus(item.id,event.target.value)}>{offerStatuses.map(status=><option key={status}>{status}</option>)}</select><span>{formatDate(item.deadline)}</span><button>已保存</button></div>)}</div></section>}

function Analytics({data}:{data:Dataset}){const total=data.candidates.length;const interviewed=data.candidates.filter(item=>stageIndex(item.stage)>=2).length;const accepted=data.offers.filter(item=>item.status==='已接受').length;const joined=data.candidates.filter(item=>item.stage==='已入职');const averageDays=joined.length?joined.reduce((sum,item)=>sum+Math.max(0,(new Date(item.updatedAt).getTime()-new Date(item.createdAt).getTime())/86400000),0)/joined.length:0;const days=recentDays(12);const trend=days.map(day=>({day,newCandidates:data.candidates.filter(item=>sameDay(new Date(item.createdAt),day)).length,interviews:data.interviews.filter(item=>sameDay(new Date(item.scheduledAt),day)).length}));const max=Math.max(1,...trend.flatMap(item=>[item.newCandidates,item.interviews]));const channels=Object.entries(groupCount(data.candidates.map(item=>item.source||'来源未填写'))).map(([name,count])=>({name,count,effective:data.candidates.filter(item=>(item.source||'来源未填写')===name&&stageIndex(item.stage)>=2).length})).sort((a,b)=>b.count-a.count);return <section><Head path="招聘数据" title="招聘数据" sub="所有指标从职位、候选人、面试与 Offer 真实记录实时计算"/><div className="analytics-filters"><div><button className="active">近 12 天</button></div><span className="data-origin-badge">● 真实数据 · 当前账号</span></div><div className="analytics-kpis">{[['简历总量',total,'当前全部记录'],['面试转化率',percent(interviewed,total),`${interviewed} 人进入面试阶段`],['Offer 接受率',percent(accepted,data.offers.length),`${accepted} 份已接受`],['平均招聘周期',joined.length?`${averageDays.toFixed(1)} 天`:'—',joined.length?`${joined.length} 位已入职候选人`:'暂无入职样本']].map(item=><article key={String(item[0])}><span>{item[0]}</span><b>{item[1]}</b><small>{item[2]}</small></article>)}</div><div className="analytics-layout"><article className="analytics-chart"><div className="chart-title"><div><h3>候选人与面试趋势</h3><p>按真实创建和日程日期统计</p></div><div><span>● 新增候选人</span><span>● 面试场次</span></div></div>{total===0&&data.interviews.length===0?<Empty compact icon="↗" title="暂无趋势数据" text="录入候选人或安排面试后自动生成。"/>:<div className="chart-body">{trend.map(item=><div key={item.day.toISOString()}><i style={{height:`${item.newCandidates/max*100}%`}}/><b style={{height:`${item.interviews/max*100}%`}}/><span>{item.day.getMonth()+1}/{item.day.getDate()}</span></div>)}</div>}</article><aside className="channel-card"><div className="chart-title"><div><h3>渠道质量排行</h3><p>按真实候选人来源与进入面试人数统计</p></div></div>{channels.length===0?<Empty compact icon="♙" title="暂无渠道数据" text="填写候选人来源后自动计算。"/>:channels.map((item,index)=><div className="channel-row" key={item.name}><b>{index+1}</b><span>{item.name}<i><em style={{width:percentNumber(item.effective,item.count)+'%'}}/></i></span><strong>{percent(item.effective,item.count)}<small>{item.count} 人</small></strong></div>)}</aside></div></section>}

function FormModal({close,submit,kicker,title,description,children,submitLabel='保存真实记录',error='',submitting=false}:{close:()=>void;submit:(data:FormData)=>void;kicker:string;title:string;description:string;children:ReactNode;submitLabel?:string;error?:string;submitting?:boolean}){return <div className="modal-backdrop" onMouseDown={close}><form className="job-modal" onSubmit={(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();submit(new FormData(event.currentTarget))}} onMouseDown={event=>event.stopPropagation()}><button type="button" className="modal-close" onClick={close}>×</button><span className="eyebrow purple">{kicker}</span><h2>{title}</h2><p>{description}</p>{children}{error&&<div className="account-form-error">{error}</div>}<button className="primary-button" type="submit" disabled={submitting}>{submitting?'正在保存…':submitLabel} <span>→</span></button></form></div>}
function JobModal({close,submit,submitting}:{close:()=>void;submit:(data:FormData)=>void;submitting:boolean}){return <FormModal close={close} submit={submit} submitting={submitting} kicker="NEW POSITION" title="发布新职位" description="保存后，该职位将参与工作台与招聘数据的实时统计。"><label>职位名称<input required name="title" placeholder="请输入真实职位名称"/></label><label>所属部门<input required name="department" placeholder="请输入实际部门"/></label><div className="form-grid"><label>工作城市<input name="city" placeholder="请输入城市"/></label><label>招聘人数<input name="headcount" type="number" min="1" defaultValue="1"/></label></div></FormModal>}
function CandidateModal({jobs,close,submit,submitting}:{jobs:Job[];close:()=>void;submit:(data:FormData)=>void;submitting:boolean}){return <FormModal close={close} submit={submit} submitting={submitting} kicker="REAL CANDIDATE" title="添加候选人" description="请录入真实候选人信息；未填写的字段会明确显示为未填写。"><div className="form-grid"><label>姓名<input required name="name" placeholder="候选人姓名"/></label><label>应聘职位<input required name="role" placeholder="实际应聘职位"/></label></div><label>关联职位<select name="jobId" defaultValue=""><option value="">暂不关联</option>{jobs.map(job=><option key={job.id} value={job.id}>{job.title}</option>)}</select></label><div className="form-grid"><label>最近公司<input name="company" placeholder="可选"/></label><label>工作经验<input name="years" placeholder="例如：5 年"/></label></div><div className="form-grid"><label>来源<input name="source" placeholder="例如：内部推荐"/></label><label>所在城市<input name="city" placeholder="可选"/></label></div><label>技能标签<input name="skills" placeholder="多个技能请用逗号分隔"/></label><div className="form-grid"><label>手机号<input name="phone" type="tel" placeholder="可选"/></label><label>邮箱<input name="email" type="email" placeholder="可选"/></label></div></FormModal>}
function InterviewModal({interview,people,close,submit,submitting}:{interview:Interview|null;people:Candidate[];close:()=>void;submit:(data:FormData)=>void;submitting:boolean}){return <FormModal close={close} submit={submit} submitting={submitting} kicker="SCHEDULE" title={interview?'查看与修改面试':'安排面试'} description="面试日程会按实际日期和候选人保存。" submitLabel={interview?'保存面试修改':'保存真实记录'}><label>候选人<select required name="candidateId" defaultValue={interview?.candidateId||''}><option value="" disabled>请选择真实候选人</option>{people.map(person=><option key={person.id} value={person.id}>{person.name} · {person.role}</option>)}</select></label><label>面试日期与时间<input required name="scheduledAt" type="datetime-local" defaultValue={interview?dateTimeLocalValue(interview.scheduledAt):''}/></label><div className="form-grid"><label>面试轮次<input name="round" defaultValue={interview?.round||''} placeholder="例如：业务一面"/></label><label>面试方式<input name="mode" defaultValue={interview?.mode||''} placeholder="例如：线下面试"/></label></div></FormModal>}
function OfferModal({people,close,submit,submitting}:{people:Candidate[];close:()=>void;submit:(data:FormData)=>void;submitting:boolean}){return <FormModal close={close} submit={submit} submitting={submitting} kicker="NEW OFFER" title="新建 Offer" description="薪资、截止日期和后续状态都将作为真实记录保存。"><label>候选人<select required name="candidateId" defaultValue=""><option value="" disabled>请选择真实候选人</option>{people.map(person=><option key={person.id} value={person.id}>{person.name} · {person.role}</option>)}</select></label><div className="form-grid"><label>职位名称<input name="jobTitle" placeholder="留空则使用应聘职位"/></label><label>薪资方案<input required name="salary" placeholder="例如：20K × 14"/></label></div><label>有效截止日期<input required name="deadline" type="date"/></label></FormModal>}
function QuestionModal({question,jobs,close,submit,submitting}:{question:AiQuestion|null;jobs:Job[];close:()=>void;submit:(data:FormData)=>void;submitting:boolean}){return <FormModal close={close} submit={submit} submitting={submitting} kicker="QUESTION BANK" title={question?'修改面试题':'新建面试题'} description="题目会按适用岗位归类，并在候选人发起面试时自动匹配。" submitLabel={question?'保存题目修改':'保存真实记录'}><label>适用岗位<select name="jobId" defaultValue={question?.jobId||''}><option value="">通用题目（所有岗位无专属题目时使用）</option>{jobs.map(job=><option key={job.id} value={job.id}>{job.title} · {job.department}</option>)}</select></label><label>面试问题<textarea required name="title" defaultValue={question?.title||''} placeholder="请输入实际需要使用的面试问题"/></label><div className="form-grid"><label>分类<input name="category" defaultValue={question?.category||''} placeholder="例如：行为面试"/></label><label>考察能力 / 评分关键词<input name="competency" defaultValue={question?.competency||''} placeholder="例如：沟通协作，项目推进，结果复盘"/></label></div><div className="form-grid"><label>提问方式<select name="questionType" defaultValue={question?.questionType||'语音提问'}><option>语音提问</option><option>视频提问</option></select></label><label>回答时长（秒）<input name="duration" type="number" min="30" max="900" defaultValue={question?.duration||120}/></label></div><label className="check"><input name="followUp" type="checkbox" defaultChecked={question?.followUp||false}/> 允许根据回答继续追问</label></FormModal>}
function AiResultModal({people,close,submit,submitting}:{people:Candidate[];close:()=>void;submit:(data:FormData)=>void;submitting:boolean}){return <FormModal close={close} submit={submit} submitting={submitting} kicker="COMPLETED INTERVIEW" title="录入已完成面试" description="只填写实际完成的面试结果；系统不会自动生成未发生的答题证据。"><label>候选人<select required name="candidateId" defaultValue=""><option value="" disabled>请选择真实候选人</option>{people.map(person=><option key={person.id} value={person.id}>{person.name} · {person.role}</option>)}</select></label><div className="form-grid"><label>面试得分<input required name="score" type="number" min="0" max="100"/></label><label>实际用时（分钟）<input required name="durationMinutes" type="number" min="1" max="600"/></label></div><label>岗位名称<input name="jobTitle" placeholder="留空则使用应聘职位"/></label><label>面试总结<textarea required name="summary" placeholder="请输入真实面试结论、优势、风险和后续建议"/></label></FormModal>}
function ProfileModal({account,close,submit,error,submitting}:{account:Account;close:()=>void;submit:(data:FormData)=>void;error:string;submitting:boolean}){return <FormModal close={close} submit={submit} kicker="ACCOUNT PROFILE" title="个人资料" description="更新后，工作台头像、负责人和面试官姓名会保持一致。" submitLabel="保存个人资料" error={error} submitting={submitting}><label>姓名<input required name="contact" defaultValue={account.contact} maxLength={40} placeholder="请输入姓名"/></label><div className="account-readonly-grid"><label>手机号<input value={account.phone||'未绑定'} readOnly/></label><label>邮箱<input value={account.email||'未绑定'} readOnly/></label></div><p className="account-security-note">手机号和邮箱用于账号登录，暂不支持在工作台内直接变更。</p></FormModal>}
function PasswordModal({close,submit,error,submitting}:{close:()=>void;submit:(data:FormData)=>void;error:string;submitting:boolean}){return <FormModal close={close} submit={submit} kicker="LOGIN SECURITY" title="修改登录密码" description="需要先验证当前密码。更新成功后，下次登录请使用新密码。" submitLabel="更新登录密码" error={error} submitting={submitting}><label>当前密码<input required name="currentPassword" type="password" autoComplete="current-password" placeholder="请输入当前密码"/></label><label>新密码<input required name="newPassword" type="password" autoComplete="new-password" minLength={8} maxLength={20} placeholder="8-20 位，同时包含字母和数字"/></label><label>确认新密码<input required name="confirmPassword" type="password" autoComplete="new-password" minLength={8} maxLength={20} placeholder="请再次输入新密码"/></label><p className="account-security-note">密码不得包含空格，并需同时包含字母和数字。</p></FormModal>}

function JobDrawer({job,candidates,interviews,offers,close}:{job:Job;candidates:Candidate[];interviews:Interview[];offers:Offer[];close:()=>void}){const people=candidates.filter(item=>item.jobId===job.id);const interviewCount=interviews.filter(item=>people.some(person=>person.id===item.candidateId)).length;const offerCount=offers.filter(item=>people.some(person=>person.id===item.candidateId)).length;const counts=[['收到简历',people.length],['进入流程',people.filter(item=>stageIndex(item.stage)>=1).length],['进入面试',people.filter(item=>stageIndex(item.stage)>=2).length],['Offer',offerCount]] as [string,number][];const max=Math.max(1,people.length);return <div className="drawer-backdrop" onMouseDown={close}><aside className="detail-drawer" onMouseDown={event=>event.stopPropagation()}><button className="drawer-close" onClick={close}>×</button><span className="drawer-label">真实职位详情</span><h2>{job.title}</h2><p>{job.department} · {job.city}　负责人：{job.ownerName}</p><div className="drawer-kpis"><div><b>{people.length}</b><small>候选人</small></div><div><b>{people.filter(item=>!['待初筛','初筛淘汰','淘汰人才库','已淘汰'].includes(item.stage)).length}</b><small>流程中</small></div><div><b>{interviewCount}</b><small>面试记录</small></div></div><section><h3>职位进度</h3><div className="pipeline">{counts.map(([label,count])=><div key={label}><span>{label}</span><i><em style={{width:`${count/max*100}%`}}/></i><b>{count}</b></div>)}</div></section><section><h3>数据说明</h3><p className="drawer-note">以上数字均根据与该职位实际关联的候选人、面试及 Offer 记录统计。</p></section></aside></div>}
function CandidateDrawer({person,aiInterview,close,advance}:{person:Candidate;aiInterview?:AiInterview;close:()=>void;advance:(value:string)=>void}){return <div className="drawer-backdrop" onMouseDown={close}><aside className="detail-drawer candidate-drawer" onMouseDown={event=>event.stopPropagation()}><button className="drawer-close" onClick={close}>×</button><div className="candidate-profile"><span>{person.name.slice(0,1)}</span><div><h2>{person.name}</h2><p>{person.company||'最近公司未填写'}{person.years?` · ${person.years}`:''}</p></div><em><b>{aiInterview?.score??'—'}</b><small>面试得分</small></em></div><label className="current-stage">当前阶段<select value={person.stage} onChange={event=>advance(event.target.value)}>{[...stages,'已淘汰'].map(item=><option key={item}>{item}</option>)}</select></label><section><h3>AI 面试记录</h3><div className="ai-assessment">{aiInterview?<p><b>真实总结</b>{aiInterview.summary}</p>:<p><b>暂无记录</b>尚未录入该候选人的已完成 AI 面试结果。</p>}</div></section><section><h3>核心技能</h3><div className="channel-tags">{person.skills.length?person.skills.map(skill=><span key={skill}>{skill}</span>):<span>未填写</span>}</div></section><section><h3>候选人信息</h3><div className="profile-info"><p><span>应聘职位</span>{person.role}</p><p><span>简历来源</span>{person.source||'未填写'}</p><p><span>手机号</span>{person.phone||'未填写'}</p><p><span>邮箱</span>{person.email||'未填写'}</p><p><span>所在城市</span>{person.city||'未填写'}</p></div></section></aside></div>}

function Empty({icon,title,text,action,click,compact=false}:{icon?:string;title:string;text:string;action?:string;click?:()=>void;compact?:boolean}){return <div className={'real-empty '+(compact?'compact':'')}>{icon&&<span>{icon}</span>}<h3>{title}</h3><p>{text}</p>{action&&click&&<button onClick={click}>{action}</button>}</div>}
function formObject(data:FormData){const result:Record<string,unknown>={};data.forEach((value,key)=>{result[key]=value});result.followUp=data.get('followUp')==='on';return result}
function questionKey(question:AiQuestion){return [question.jobId,question.title,question.category,question.questionType,question.duration,question.competency,question.followUp].map(value=>String(value??'').trim().toLowerCase()).join('\u0000')}
function candidateName(id:string,people:Candidate[]){return people.find(item=>item.id===id)?.name||'候选人已删除'}
function maskPhone(value:string){return /^\d{11}$/.test(value)?`${value.slice(0,3)} **** ${value.slice(-4)}`:value||'未绑定'}
function stageIndex(stage:string){const index=stages.indexOf(stage);return index<0?0:index}
function sameDay(a:Date,b:Date){return a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate()}
function formatDate(value:string){const date=new Date(value);return Number.isNaN(date.getTime())?'未记录':new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit'}).format(date)}
function dateTimeLocalValue(value:string){const date=new Date(value);if(Number.isNaN(date.getTime()))return '';const pad=(part:number)=>String(part).padStart(2,'0');return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`}
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
  const configured=question.competency.split(/[,，、;；/|]/).map(item=>item.trim()).filter(item=>item.length>=2);
  const text=`${question.title}${question.category}${question.competency}`;
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
