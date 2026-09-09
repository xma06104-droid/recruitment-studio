'use client';

import { useEffect, useMemo, useState } from 'react';
import { announceWorkbenchChange, useWorkbenchSync } from '@/app/workbench-sync';
import { AiInterviewResultPanel } from '@/app/components/ai-interview-result';
import HrAccountMenu from '@/app/components/hr-account-menu';
import { CANDIDATE_STAGES } from '@/app/candidate-stages';

type Account = { contact:string; phone:string; email:string; role:'super_admin'|'hr' };
type Job = { id:string; title:string; department:string; city:string; status:string; ownerName:string; createdAt:string };
type Candidate = { id:string; jobId:string|null; name:string; role:string; company:string; years:string; stage:string; source:string; skills:string[]; score:number|null; phone:string; email:string; city:string; assignedHrId?:string; assignedHrName?:string; assignedAt?:string; createdAt:string; updatedAt:string };
type AiInterview = { id:string; candidateId:string; jobTitle:string; status:string; score:number|null; durationSeconds:number|null; summary:string; completedAt:string|null; createdAt:string; updatedAt:string };
type Dataset = { account:Account; jobs:Job[]; candidates:Candidate[]; aiInterviews:AiInterview[] };
type Profile = { candidateId:string; education:string; major:string; school:string; age:number|null; gender:string; industry:string; expectedSalary:number|null; workYears:number|null; stabilityMonths:number|null; workHistory:string[]; projectHistory:string[]; certificates:string[]; highlights:string[]; risks:string[]; parsingStatus:string; fileName:string; fileType:string; fileSize:number; matchScore:number|null; matchLevel:string; updatedAt:string };
type Review = { candidateId:string; tags:string[]; comment:string; riskNote:string; rejectReason:string; reviewer:string; updatedAt:string };
type ScreeningData = { profiles:Profile[]; reviews:Review[] };
type ReviewStatus = '待筛选'|'已通过'|'已拒绝'|'待定'|'已失效';
type ReviewAction = 'pass'|'pending'|'reject';

const menuItems = [
  {icon:'◉',label:'候选人筛选',href:'/interviewer-candidate'},
  {icon:'▤',label:'人工评估',href:'/assessment'},
  {icon:'▣',label:'面试管理',href:'/interview-management'},
  {icon:'▥',label:'招聘进展',href:'/recruitment-progress'},
  {icon:'⚙',label:'设置',href:'/workbench'},
];
const reviewStatuses:ReviewStatus[] = ['待筛选','已通过','已拒绝','待定','已失效'];

export default function InterviewerCandidateClient() {
  const [data,setData]=useState<Dataset|null>(null);
  const [error,setError]=useState('');
  const [status,setStatus]=useState<ReviewStatus>('待筛选');
  const [keyword,setKeyword]=useState('');
  const [jobKeyword,setJobKeyword]=useState('');
  const [jobId,setJobId]=useState('');
  const [selected,setSelected]=useState<string[]>([]);
  const [toast,setToast]=useState('');
  const [profiles,setProfiles]=useState<Profile[]>([]);
  const [reviews,setReviews]=useState<Review[]>([]);
  const [detailId,setDetailId]=useState('');
  const [savingId,setSavingId]=useState('');
  const [batchStageOpen,setBatchStageOpen]=useState(false);
  const [batchStage,setBatchStage]=useState<string>('待定');
  const [batchReason,setBatchReason]=useState('');
  const [batchSaving,setBatchSaving]=useState(false);

  async function load(){
    const [workbenchResponse,screeningResponse]=await Promise.all([
      fetch('/api/workbench',{cache:'no-store'}),
      fetch('/api/screening',{cache:'no-store'}),
    ]);
    if(workbenchResponse.status===401||screeningResponse.status===401){window.location.assign('/');return}
    if(!workbenchResponse.ok)throw new Error('load');
    const result=await workbenchResponse.json() as Dataset;
    setData(result);
    if(screeningResponse.ok){
      const screening=await screeningResponse.json() as ScreeningData;
      setProfiles(screening.profiles||[]);
      setReviews(screening.reviews||[]);
    }
    setError('');
  }
  useEffect(()=>{void load().catch(()=>setError('候选人数据加载失败，请稍后刷新。'))},[]);
  useWorkbenchSync(()=>load().catch(()=>undefined));

  const jobs=useMemo(()=>data?.jobs.filter(job=>!jobKeyword||`${job.title}${job.department}${job.city}`.toLowerCase().includes(jobKeyword.toLowerCase()))||[],[data,jobKeyword]);
  const counts=useMemo(()=>Object.fromEntries(reviewStatuses.map(item=>[item,data?.candidates.filter(candidate=>candidateReviewStatus(candidate.stage)===item).length||0])) as Record<ReviewStatus,number>,[data]);
  const candidates=useMemo(()=>data?.candidates.filter(candidate=>{
    const matchesStatus=candidateReviewStatus(candidate.stage)===status;
    const matchesJob=!jobId||candidate.jobId===jobId;
    const text=`${candidate.name}${candidate.phone}${candidate.email}${candidate.role}${candidate.company}${candidate.city}${candidate.skills.join('')}`.toLowerCase();
    return matchesStatus&&matchesJob&&(!keyword||text.includes(keyword.toLowerCase()));
  })||[],[data,status,jobId,keyword]);
  const allSelected=candidates.length>0&&candidates.every(candidate=>selected.includes(candidate.id));
  const currentJob=jobId?data?.jobs.find(job=>job.id===jobId):null;
  const detailCandidate=detailId?data?.candidates.find(candidate=>candidate.id===detailId):undefined;
  const detailProfile=detailCandidate?profiles.find(profile=>profile.candidateId===detailCandidate.id):undefined;
  const detailReview=detailCandidate?reviews.find(review=>review.candidateId===detailCandidate.id):undefined;
  const detailAiInterview=detailCandidate?data?.aiInterviews.find(report=>report.candidateId===detailCandidate.id):undefined;

  function flash(message:string){setToast(message);window.setTimeout(()=>setToast(''),2200)}
  function toggleAll(){setSelected(allSelected?selected.filter(id=>!candidates.some(candidate=>candidate.id===id)):[...new Set([...selected,...candidates.map(candidate=>candidate.id)])])}
  function selectedCandidates(){return data?.candidates.filter(candidate=>selected.includes(candidate.id))||[]}
  function sendBatchNotification(){
    const people=selectedCandidates();
    if(!people.length){flash('请先选择候选人');return}
    const recipients=[...new Set(people.map(person=>person.email.trim()).filter(email=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))];
    if(!recipients.length){flash('所选候选人没有可用邮箱');return}
    const subject=encodeURIComponent('招聘流程通知');
    const body=encodeURIComponent(`您好，\n\n您的招聘流程有新的进展，请留意后续安排。\n\n${data?.account.contact||'招聘团队'}`);
    window.location.href=`mailto:?bcc=${encodeURIComponent(recipients.join(','))}&subject=${subject}&body=${body}`;
    flash(`已打开邮件通知，共 ${recipients.length} 位候选人`);
  }
  function openBatchStage(){
    const people=selectedCandidates();
    if(!people.length){flash('请先选择候选人');return}
    setBatchStage(people.every(person=>person.stage===people[0].stage)?people[0].stage:'待定');
    setBatchReason('');
    setBatchStageOpen(true);
  }
  async function changeBatchStage(){
    const people=selectedCandidates();
    if(!people.length||batchSaving)return;
    if(batchStage==='已淘汰'&&!batchReason.trim()){flash('淘汰候选人时请填写原因');return}
    setBatchSaving(true);
    let updated=0;
    let firstError='';
    try{
      for(const person of people){
        const response=await fetch('/api/workbench',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({resource:'candidateStage',id:person.id,value:batchStage})});
        if(response.ok){
          updated+=1;
          if(batchStage==='已淘汰'){
            const previous=reviews.find(review=>review.candidateId===person.id);
            await fetch('/api/screening',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'saveReview',candidateId:person.id,tags:previous?.tags||[],comment:previous?.comment||'',riskNote:previous?.riskNote||'',rejectReason:batchReason.trim()})});
          }
        }else if(!firstError){
          const result=await response.json().catch(()=>({})) as {message?:string};
          firstError=result.message||'阶段更新失败';
        }
      }
      if(updated){announceWorkbenchChange();await load();setSelected([])}
      if(updated===people.length){setBatchStageOpen(false);flash(`已更新 ${updated} 位候选人的流程阶段`)}
      else flash(`${updated} 位更新成功；${firstError||`${people.length-updated} 位更新失败`}`);
    }catch{
      flash(updated?`${updated} 位更新成功，其余更新失败`:'阶段更新失败，请稍后重试');
    }finally{
      setBatchSaving(false);
    }
  }
  function downloadBatchResumes(){
    const people=selectedCandidates();
    if(!people.length){flash('请先选择候选人');return}
    const downloadable=people.filter(person=>profiles.some(profile=>profile.candidateId===person.id&&profile.fileName));
    if(!downloadable.length){flash('所选候选人没有原始简历附件');return}
    downloadable.forEach((person,index)=>window.setTimeout(()=>{
      const link=document.createElement('a');
      link.href=`/api/screening/file?candidateId=${encodeURIComponent(person.id)}`;
      link.download=profiles.find(profile=>profile.candidateId===person.id)?.fileName||`${person.name}-简历`;
      document.body.appendChild(link);link.click();link.remove();
    },index*180));
    flash(`正在下载 ${downloadable.length} 份简历`);
  }
  function exportBatchData(){
    const people=selectedCandidates();
    if(!people.length){flash('请先选择候选人');return}
    const rows=[['姓名','应聘职位','手机号','邮箱','城市','工作经验','最近公司','流程阶段','接收HR','推荐时间','技能'],...people.map(person=>[person.name,person.role,person.phone,person.email,person.city,person.years,person.company,person.stage,person.assignedHrName||'',formatDate(person.assignedAt||person.updatedAt),person.skills.join('、')])];
    const csv=`\uFEFF${rows.map(row=>row.map(csvCell).join(',')).join('\r\n')}`;
    downloadText(csv,`候选人数据-${new Date().toISOString().slice(0,10)}.csv`,'text/csv;charset=utf-8');
    flash(`已导出 ${people.length} 位候选人数据`);
  }
  async function updateReview(candidate:Candidate,action:ReviewAction){
    if(savingId)return;
    const next={
      pass:{stage:'安排面试',message:'已通过，状态已更新为安排面试'},
      pending:{stage:'待定',message:'已设为待定'},
      reject:{stage:'已淘汰',message:'已拒绝'},
    }[action];
    setSavingId(candidate.id);
    try{
      const response=await fetch('/api/workbench',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({resource:'candidateStage',id:candidate.id,value:next.stage})});
      if(!response.ok)throw new Error('save');
      announceWorkbenchChange();
      await load();
      flash(`${candidate.name}${next.message}，超级管理员端已同步`);
    }catch{
      flash('保存失败，请稍后重试');
    }finally{
      setSavingId('');
    }
  }

  async function saveNote(candidate:Candidate,note:string){
    if(savingId)return false;
    const previous=reviews.find(review=>review.candidateId===candidate.id);
    setSavingId(candidate.id);
    try{
      const response=await fetch('/api/screening',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'saveReview',candidateId:candidate.id,tags:previous?.tags||[],comment:note,riskNote:previous?.riskNote||'',rejectReason:previous?.rejectReason||''})});
      if(!response.ok)throw new Error('save');
      announceWorkbenchChange();
      await load();
      flash(note?'候选人备注已保存':'候选人备注已清空');
      return true;
    }catch{
      flash('备注保存失败，请稍后重试');
      return false;
    }finally{
      setSavingId('');
    }
  }

  if(!data)return <main className="interviewer-loading"><span>星</span><b>{error||'正在读取候选人数据…'}</b>{error&&<button onClick={()=>window.location.reload()}>重新加载</button>}</main>;

  return <main className="interviewer-page">
    <aside className="interviewer-rail">
      <a className="interviewer-logo" href="/workbench" aria-label="返回星鉴人才招聘工作台"><span>星</span><b>星鉴人才<small>HIRING DEPARTMENT</small></b></a>
      <p className="interviewer-role-label">HR 工作台</p>
      <nav>{menuItems.map((item,index)=><a key={item.label} className={index===0?'active':''} href={item.href} title={item.label}><i>{item.icon}</i><span>{item.label}</span></a>)}</nav>
      <button type="button" title="收起菜单">«</button>
    </aside>

    <section className="interviewer-main">
      <header className="interviewer-header">
        <div className="interviewer-heading"><h1>候选人筛选</h1><small>HR 候选人工作台</small></div>
        <div className="interviewer-tools">
          <div className="interviewer-global-search"><input placeholder="全局搜索，请输入关键字"/><button type="button">⌕</button></div>
          <button type="button" className="interviewer-add" onClick={()=>window.location.assign('/workbench')}>＋ 添加职位/简历</button>
          <button type="button" className="interviewer-help" onClick={()=>flash('帮助中心')}>◉ 帮助中心</button>
          <button type="button" className="interviewer-tool-icon" onClick={()=>flash('消息中心')}>♧</button>
          <button type="button" className="interviewer-tool-icon" onClick={()=>flash('通知中心')}>♢</button>
          <HrAccountMenu contact={data.account.contact} phone={data.account.phone} email={data.account.email} role={data.account.role}/>
        </div>
      </header>
      <div className="interviewer-open-tabs"><a href="/workbench">招聘管理</a><i>›</i><button type="button" className="active">候选人筛选</button></div>

      <div className="interviewer-content">
        <aside className="interviewer-filter-panel">
          <div className="interviewer-name-search"><input value={keyword} onChange={event=>setKeyword(event.target.value)} placeholder="回车搜索手机号或姓名"/><span>⌕</span></div>
          <div className="interviewer-status-grid">
            {reviewStatuses.slice(0,4).map(item=><button type="button" key={item} className={status===item?'active':''} onClick={()=>{setStatus(item);setSelected([])}}><b>{counts[item]}</b><span>{item}</span></button>)}
            <button type="button" className={`wide ${status==='已失效'?'active':''}`} onClick={()=>{setStatus('已失效');setSelected([])}}><b>{counts['已失效']}</b><span>已失效</span></button>
          </div>
          <button type="button" className="interviewer-detail-filter" onClick={()=>flash('候选人信息筛选')}>▦ <span>候选人信息筛选</span><b>›</b></button>
          <section className="interviewer-position-filter">
            <button type="button" className={!jobId?'active':''} onClick={()=>setJobId('')}><span>▾　全部职位</span><b>共 {data.jobs.length} 个</b></button>
            <div className="interviewer-job-search"><input value={jobKeyword} onChange={event=>setJobKeyword(event.target.value)} placeholder="搜索职位名称"/><span>⌕</span></div>
            <div className="interviewer-job-list">{jobs.map(job=><button type="button" key={job.id} className={jobId===job.id?'active':''} onClick={()=>setJobId(job.id)}><span>{job.status!=='招聘中'&&job.status!=='急聘'?`(${job.status}) `:''}{job.title}</span><small>{job.department||job.city}</small></button>)}</div>
          </section>
        </aside>

        <section className="interviewer-list-panel">
          <h2>{status}{currentJob?<small>{currentJob.title}</small>:null}</h2>
          <div className="interviewer-filter-row"><select defaultValue=""><option value="">沟通状态</option><option>未沟通</option><option>已沟通</option></select><select defaultValue=""><option value="">推荐筛选状态</option><option>未推荐</option><option>已推荐</option></select><select defaultValue="time"><option value="time">状态变更时间　⇅</option></select></div>
          <div className="interviewer-batch-row"><label><input type="checkbox" checked={allSelected} onChange={toggleAll}/> 全选</label><button type="button" onClick={sendBatchNotification}><span>发送通知</span></button><button type="button" onClick={openBatchStage}><span>变更阶段</span><i aria-hidden="true">⌄</i></button><button type="button" onClick={downloadBatchResumes}><span>下载简历</span></button><button type="button" onClick={exportBatchData}><span>导出数据</span></button><button type="button" onClick={()=>flash(selected.length?'更多批量操作正在完善':'请先选择候选人')}><span>更多</span><i aria-hidden="true">⌄</i></button></div>
          <div className="interviewer-candidate-list">
            {candidates.length?candidates.map(candidate=>{const job=data.jobs.find(item=>item.id===candidate.jobId);return <article className="interviewer-candidate-row" key={candidate.id} role="button" tabIndex={0} onClick={()=>setDetailId(candidate.id)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();setDetailId(candidate.id)}}}>
              <label onClick={event=>event.stopPropagation()}><input type="checkbox" checked={selected.includes(candidate.id)} onChange={()=>setSelected(selected.includes(candidate.id)?selected.filter(id=>id!==candidate.id):[...selected,candidate.id])}/></label>
              <div className="interviewer-candidate-profile"><p>{job?.title||candidate.role||'未关联职位'}　{formatDate(candidate.createdAt)}申请 <i>▣</i></p><h3>{candidate.name}<b>{candidate.score===null?'—':Math.max(1,Math.round(candidate.score/20))}</b><span>{candidate.city||'城市未填写'}</span>{candidate.years&&<span>{candidate.years}工作经验</span>}</h3><p>◼ {candidate.company||'最近公司未填写'}　{candidate.role||'职位未填写'}　{candidate.skills.slice(0,2).join('｜')||'暂无技能标签'}</p></div>
              <div className="interviewer-candidate-owner"><p>接收 HR： <b>{candidate.assignedHrName||data.account.contact}</b></p><p>当前状态： <span>◢ {candidateDisplayStatus(candidate.stage)}</span></p></div>
              <div className="interviewer-candidate-note"><p>推荐时间：{formatDate(candidate.assignedAt||candidate.updatedAt)}</p><p>最近备注： {reviews.find(review=>review.candidateId===candidate.id)?.comment||'-'}</p></div>
            </article>}):<div className="interviewer-empty"><span>⌕</span><b>暂无候选人</b><p>当前筛选条件下没有候选人记录</p></div>}
          </div>
          <footer className="interviewer-pagination"><span>共 {candidates.length} 条</span><button type="button" disabled>‹</button><button type="button" className="active">1</button><button type="button" disabled>›</button><select><option>10条/页</option><option>20条/页</option></select><label>前往 <input defaultValue="1"/> 页</label></footer>
        </section>
      </div>
    </section>
    {batchStageOpen&&<div className="interviewer-batch-modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget&&!batchSaving)setBatchStageOpen(false)}}><form className="interviewer-batch-modal" onSubmit={event=>{event.preventDefault();void changeBatchStage()}}><button type="button" className="assessment-modal-close" aria-label="关闭" disabled={batchSaving} onClick={()=>setBatchStageOpen(false)}>×</button><p>批量操作</p><h2>变更流程阶段</h2><small>已选择 {selected.length} 位候选人，将按候选人流程规则逐一更新。</small><label>目标阶段<select value={batchStage} onChange={event=>setBatchStage(event.target.value)}>{[...CANDIDATE_STAGES,'待定','已淘汰'].map(stage=><option key={stage}>{stage}</option>)}</select></label>{batchStage==='已淘汰'&&<label>淘汰原因<textarea value={batchReason} onChange={event=>setBatchReason(event.target.value)} placeholder="请填写淘汰原因" maxLength={500}/></label>}<footer><button type="button" disabled={batchSaving} onClick={()=>setBatchStageOpen(false)}>取消</button><button type="submit" disabled={batchSaving}>{batchSaving?'更新中…':'确认变更'}</button></footer></form></div>}
    {detailCandidate&&<CandidateResumeDrawer
      candidate={detailCandidate}
      job={data.jobs.find(job=>job.id===detailCandidate.jobId)}
      profile={detailProfile}
      review={detailReview}
      aiInterview={detailAiInterview}
      saving={savingId===detailCandidate.id}
      onClose={()=>setDetailId('')}
      onReview={action=>void updateReview(detailCandidate,action)}
      onSaveNote={note=>saveNote(detailCandidate,note)}
    />}
    {toast&&<div className="interviewer-toast">{toast}</div>}
  </main>;
}

function CandidateResumeDrawer({candidate,job,profile,review,aiInterview,saving,onClose,onReview,onSaveNote}:{candidate:Candidate;job:Job|undefined;profile:Profile|undefined;review:Review|undefined;aiInterview:AiInterview|undefined;saving:boolean;onClose:()=>void;onReview:(action:ReviewAction)=>void;onSaveNote:(note:string)=>Promise<boolean>}){
  const status=candidateDisplayStatus(candidate.stage);
  const [noteOpen,setNoteOpen]=useState(false);
  const [note,setNote]=useState(review?.comment||'');
  return <div className="drawer-backdrop hr-resume-backdrop" onMouseDown={onClose}>
    <aside className="detail-drawer candidate-drawer hr-resume-drawer" aria-label={`${candidate.name}的简历`} onMouseDown={event=>event.stopPropagation()}>
      <button type="button" className="drawer-close" onClick={onClose} aria-label="关闭简历">×</button>
      <p className="drawer-label">CANDIDATE RESUME</p>
      <div className="candidate-profile hr-resume-profile"><span>{candidate.name.slice(0,1)}</span><div><div className="hr-resume-name-line"><h2>{candidate.name}</h2><em><b>{profile?.matchScore??candidate.score??'—'}</b><small>匹配度</small></em><strong className={`hr-resume-inline-status ${status==='已拒绝'?'reject':status==='待定'?'pending':status==='已通过'?'pass':'screen'}`}>{status}</strong></div><p>{candidate.company||'公司未填写'} · {candidate.role||job?.title||'职位未填写'}</p></div></div>
      <div className="hr-review-actions" aria-label="候选人审核操作">
        <button type="button" className={status==='已通过'?'active pass':'pass'} disabled={saving} onClick={()=>onReview('pass')}><i>✓</i><span><b>通过</b><small>进入安排面试</small></span></button>
        <button type="button" className={status==='待定'?'active pending':'pending'} disabled={saving} onClick={()=>onReview('pending')}><i>◷</i><span><b>待定</b><small>保留候选人</small></span></button>
        <button type="button" className={status==='已拒绝'?'active reject':'reject'} disabled={saving} onClick={()=>onReview('reject')}><i>×</i><span><b>拒绝</b><small>结束初筛</small></span></button>
        <button type="button" className={noteOpen?'active note':'note'} disabled={saving} onClick={()=>setNoteOpen(current=>!current)}><i>✎</i><span><b>备注</b><small>{review?.comment?'查看或修改':'添加候选人备注'}</small></span></button>
      </div>
      {noteOpen&&<form className="hr-resume-note" onSubmit={event=>{event.preventDefault();void onSaveNote(note).then(saved=>{if(saved)setNoteOpen(false)})}}><label>候选人备注<textarea value={note} maxLength={2000} onChange={event=>setNote(event.target.value)} placeholder="记录沟通情况、筛选意见或后续关注事项"/></label><footer><small>{note.length}/2000</small><button type="button" disabled={saving} onClick={()=>setNoteOpen(false)}>取消</button><button type="submit" disabled={saving}>{saving?'保存中…':'保存备注'}</button></footer></form>}
      {saving&&<p className="hr-resume-saving">正在同步审核结果…</p>}
      <section className="hr-resume-section"><h3>基本信息</h3><div className="profile-info"><p><span>应聘职位</span>{job?.title||candidate.role||'-'}</p><p><span>手机号</span>{candidate.phone||'-'}</p><p><span>邮箱</span>{candidate.email||'-'}</p><p><span>所在城市</span>{candidate.city||'-'}</p><p><span>工作经验</span>{profile?.workYears!==null&&profile?.workYears!==undefined?`${profile.workYears}年`:candidate.years||'-'}</p><p><span>期望薪资</span>{profile?.expectedSalary?`${profile.expectedSalary}元/月`:'-'}</p></div></section>
      {aiInterview&&<section className="hr-resume-section hr-ai-interview-result"><h3>AI 面试结果</h3><AiInterviewResultPanel summary={aiInterview.summary} fallbackScore={aiInterview.score} durationSeconds={aiInterview.durationSeconds} completedAt={aiInterview.completedAt} compact/></section>}
      <section className="hr-resume-section"><h3>教育背景</h3><p className="hr-resume-copy">{[profile?.school,profile?.major,profile?.education].filter(Boolean).join(' · ')||'暂无教育背景信息'}</p></section>
      <ResumeList title="工作经历" items={profile?.workHistory}/>
      <ProjectTimeline items={profile?.projectHistory}/>
      <section className="hr-resume-section"><h3>技能与证书</h3><div className="channel-tags">{[...candidate.skills,...(profile?.certificates||[])].length?[...candidate.skills,...(profile?.certificates||[])].map((item,index)=><span key={`${item}-${index}`}>{item}</span>):<p className="hr-resume-copy">暂无技能与证书信息</p>}</div></section>
      {(profile?.highlights.length||profile?.risks.length)?<section className="hr-resume-section hr-resume-insights"><h3>AI 简历摘要</h3>{profile?.highlights.length?<div className="hr-insight-group highlight"><b>优势</b><div>{profile.highlights.map((item,index)=><span key={`highlight-${index}`}>{item}</span>)}</div></div>:null}{profile?.risks.length?<div className="hr-insight-group risk"><b>关注</b><div>{profile.risks.map((item,index)=><span key={`risk-${index}`}>{item}</span>)}</div></div>:null}</section>:null}
      {profile?.fileName?<div className="hr-resume-file-actions"><button type="button" onClick={()=>window.print()}>打印简历</button><a className="hr-resume-file" href={`/api/screening/file?candidateId=${encodeURIComponent(candidate.id)}`} target="_blank" rel="noreferrer">查看原始简历 · {profile.fileName}</a></div>:<p className="hr-resume-copy hr-resume-file-empty">未找到可预览的原始简历文件</p>}
    </aside>
  </div>;
}

function ResumeList({title,items}:{title:string;items:string[]|undefined}){
  return <section className="hr-resume-section"><h3>{title}</h3>{items?.length?<div className="hr-resume-list">{items.map((item,index)=><p key={`${title}-${index}`}>{item}</p>)}</div>:<p className="hr-resume-copy">暂无{title}信息</p>}</section>;
}

function ProjectTimeline({items}:{items:string[]|undefined}){
  const projects=groupProjectHistory(items||[]);
  return <section className="hr-resume-section"><h3>项目经历</h3>{projects.length?<div className="hr-project-timeline">{projects.map((project,index)=><article key={`${project.label}-${index}`}><strong>{project.label}</strong><div>{project.details.length?project.details.map((detail,detailIndex)=><p key={`${project.label}-${detailIndex}`}>{detail}</p>):<p>暂无详细项目描述</p>}</div></article>)}</div>:<p className="hr-resume-copy">暂无项目经历信息</p>}</section>;
}

function groupProjectHistory(items:string[]){
  const dateRange=/^((?:19|20)\d{2}(?:[.\/\-年]\d{1,2})?\s*(?:至|到|[-—–~～])\s*(?:(?:19|20)\d{2}(?:[.\/\-年]\d{1,2})?|至今|现在|今))(?:\s*[\u00b7|｜]\s*|\s+)?(.*)$/i;
  const parsed=items.map(item=>{const match=item.trim().match(dateRange);return {period:match?.[1]?.replace(/\s+/g,'')||'',detail:match?match[2].trim():item.trim()}}).filter(item=>item.period||item.detail);
  const dateIndexes=parsed.map((item,index)=>item.period?index:-1).filter(index=>index>=0);
  if(!dateIndexes.length){
    const groups:{label:string;details:string[]}[]=[];
    for(const item of parsed){
      const detail=item.detail.replace(/^[-—·•\s]+/,'').trim();
      if(!detail)continue;
      const explicit=explicitProjectTitle(detail);
      const title=explicit||projectTitle(detail);
      const titleOnly=Boolean(title&&title===detail.replace(/[：:]$/,''));
      const startsAfterResponsibilities=Boolean(title&&groups.length&&groups[groups.length-1].details.some(value=>/项目职责|工作职责|主要职责|负责/.test(value)));
      if(explicit||titleOnly||startsAfterResponsibilities){
        groups.push({label:title||`项目 ${String(groups.length+1).padStart(2,'0')}`,details:titleOnly||explicit?[]:[detail]});
      }else if(groups.length){
        groups[groups.length-1].details.push(detail);
      }else{
        groups.push({label:title||'项目 01',details:[detail]});
      }
    }
    return finishProjectGroups(groups);
  }

  const leadingDates=dateIndexes.length>1&&dateIndexes.every((index,position)=>index===position)&&parsed.slice(dateIndexes.length).every(item=>!item.period);
  if(leadingDates){
    const periods=parsed.slice(0,dateIndexes.length).map(item=>item.period);
    const details=parsed.slice(dateIndexes.length).map(item=>item.detail).filter(Boolean);
    return finishProjectGroups(periods.map((label,index)=>({label,details:details.slice(Math.floor(index*details.length/periods.length),Math.floor((index+1)*details.length/periods.length))})).sort((a,b)=>projectDateValue(b.label)-projectDateValue(a.label)));
  }

  const groups:{label:string;details:string[]}[]=[];
  for(const item of parsed){
    if(item.period)groups.push({label:item.period,details:item.detail?[item.detail]:[]});
    else if(groups.length)groups[groups.length-1].details.push(item.detail);
    else groups.push({label:projectTitle(item.detail)||'时间未标注',details:[item.detail]});
  }
  return finishProjectGroups(groups.sort((a,b)=>projectDateValue(b.label)-projectDateValue(a.label)));
}

function explicitProjectTitle(value:string){
  return value.match(/^(?:项目(?:名称|名)?|项目[一二三四五六七八九十\d]+)\s*[:：]\s*(.+)$/)?.[1]?.trim()||'';
}

function finishProjectGroups(groups:{label:string;details:string[]}[]){
  return groups.map(group=>({...group,details:mergeProjectDetails(group.details)}));
}

function mergeProjectDetails(items:string[]){
  const details:string[]=[];
  const heading=/^(?:项目职责|工作职责|主要职责|项目描述|工作内容|技术栈|项目周期)\s*[:：]?$/;
  const structured=/^(?:\d{1,2}|[一二三四五六七八九十])[、.．)）]\s*/;
  for(const rawItem of items){
    const item=rawItem.trim();
    if(!item)continue;
    const previous=details.at(-1);
    const continuation=Boolean(previous&&!heading.test(item)&&!structured.test(item)&&!explicitProjectTitle(item)&&(
      !/[。！？!?；;：:]$/.test(previous)||/^(?:并|且|及|与|以及|同时|通过|根据|确保|保证|提高|完成|支持|由|从|尽可能|测试范围|试范围)/.test(item)
    ));
    if(continuation)details[details.length-1]=`${previous}${item}`;
    else details.push(item);
  }
  return details;
}

function projectTitle(value:string){
  const cleaned=value.replace(/[：:]$/,'').trim();
  const title=cleaned.match(/^([\u4e00-\u9fa5A-Za-z0-9_-]{2,30}(?:系统|平台|项目|应用|小程序|APP|网站))(?=是|为|，|。|：|:|\s|$)/i)?.[1];
  const sentenceVerb=/(?:用于|提供|查询|抓取|报送|提高|负责|参与|完成|实现|进行|根据|支持|需要|以及|并)/;
  if(title&&!sentenceVerb.test(title))return title;
  return cleaned.length<=30&&!sentenceVerb.test(cleaned)&&!/[，。；;、]/.test(cleaned)&&/(?:系统|平台|项目|应用|小程序|APP|网站)$/i.test(cleaned)?cleaned:'';
}

function projectDateValue(value:string){
  const match=value.match(/((?:19|20)\d{2})[.\/年-]?(\d{1,2})?/);
  return match?Number(match[1])*100+Number(match[2]||1):0;
}

function candidateReviewStatus(stage:string):ReviewStatus {
  if(stage==='已淘汰')return '已拒绝';
  if(stage==='待定')return '待定';
  if(['简历筛选','AI面试','用人部门筛选'].includes(stage))return '待筛选';
  return '已通过';
}

function candidateDisplayStatus(stage:string){
  if(stage==='已淘汰')return '已拒绝';
  if(stage==='待定')return '待定';
  if(['简历筛选','AI面试','用人部门筛选'].includes(stage))return '待筛选';
  return '已通过';
}

function formatDate(value:string){
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return '-';
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

function csvCell(value:unknown){
  const text=String(value??'');
  return /[",\r\n]/.test(text)?`"${text.replaceAll('"','""')}"`:text;
}

function downloadText(content:string,fileName:string,type:string){
  const url=URL.createObjectURL(new Blob([content],{type}));
  const link=document.createElement('a');
  link.href=url;
  link.download=fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
