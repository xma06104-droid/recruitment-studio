'use client';

import { useEffect, useMemo, useState } from 'react';
import { announceWorkbenchChange, useWorkbenchSync } from '@/app/workbench-sync';
import { AiInterviewResultPanel } from '@/app/components/ai-interview-result';
import AiInterviewRecordings from '@/app/components/ai-interview-recordings';
import HrAccountMenu from '@/app/components/hr-account-menu';
import { HR_SCREENING_CACHE, HR_WORKBENCH_CACHE, readHrSessionCache, writeHrSessionCache } from '@/app/hr-session-cache';

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
  {icon:'⚙',label:'设置',href:'/hr-settings'},
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

  async function load(){
    const [workbenchResponse,screeningResponse]=await Promise.all([
      fetch('/api/workbench?scope=department-review',{cache:'no-store'}),
      fetch('/api/screening?scope=department-review',{cache:'no-store'}),
    ]);
    if(workbenchResponse.status===401||screeningResponse.status===401){window.location.assign('/');return}
    if(!workbenchResponse.ok)throw new Error('load');
    const result=await workbenchResponse.json() as Dataset;
    setData(result);
    writeHrSessionCache(HR_WORKBENCH_CACHE,result);
    if(screeningResponse.ok){
      const screening=await screeningResponse.json() as ScreeningData;
      setProfiles(screening.profiles||[]);
      setReviews(screening.reviews||[]);
      writeHrSessionCache(HR_SCREENING_CACHE,screening);
    }
    setError('');
  }
  useEffect(()=>{
    const cached=readHrSessionCache<Dataset>(HR_WORKBENCH_CACHE);
    const cachedScreening=readHrSessionCache<ScreeningData>(HR_SCREENING_CACHE);
    if(cached)setData(cached);
    if(cachedScreening){setProfiles(cachedScreening.profiles||[]);setReviews(cachedScreening.reviews||[])}
    void load().catch(()=>{if(!cached)setError('候选人数据加载失败，请稍后刷新。')});
  },[]);
  useEffect(()=>{
    if(!data)return;
    const candidateId=new URLSearchParams(window.location.search).get('candidateId')||'';
    const candidate=data.candidates.find(item=>item.id===candidateId);
    if(candidate){setStatus(candidateReviewStatus(candidate.stage));setDetailId(candidate.id)}
  },[data]);
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
  async function updateReview(candidate:Candidate,action:ReviewAction){
    if(savingId)return;
    const next={
      pass:{stage:'AI面试',message:'已通过，状态已更新为 AI 面试'},
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
          <div className="interviewer-batch-row"><label><input type="checkbox" checked={allSelected} onChange={toggleAll}/> 全选</label><button type="button" onClick={downloadBatchResumes}><span>下载简历</span></button></div>
          <div className="interviewer-candidate-list">
            {candidates.length?candidates.map(candidate=>{const job=data.jobs.find(item=>item.id===candidate.jobId);const profile=profiles.find(item=>item.candidateId===candidate.id);const matchScore=profile?.matchScore??candidate.score;const displayStatus=candidateDisplayStatus(candidate.stage);const statusTone=displayStatus==='已通过'?'pass':displayStatus==='已拒绝'?'reject':'';return <article className="interviewer-candidate-row" key={candidate.id} role="button" tabIndex={0} onClick={()=>setDetailId(candidate.id)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();setDetailId(candidate.id)}}}>
              <label onClick={event=>event.stopPropagation()}><input type="checkbox" checked={selected.includes(candidate.id)} onChange={()=>setSelected(selected.includes(candidate.id)?selected.filter(id=>id!==candidate.id):[...selected,candidate.id])}/></label>
              <div className="interviewer-candidate-profile"><p>{job?.title||candidate.role||'未关联职位'}　{formatDate(candidate.createdAt)}申请</p><h3>{candidate.name}<b className={`interviewer-match-score ${matchScore===null?'unrated':''}`} title="候选人与应聘岗位的简历匹配度">{matchScore===null?'匹配度未评估':`匹配度 ${matchScore}%`}</b><span>{candidate.city||'城市未填写'}</span>{candidate.years&&<span>{candidate.years}工作经验</span>}</h3><p>◼ {candidate.company||'最近公司未填写'}　{candidate.role||'职位未填写'}　{candidate.skills.slice(0,2).join('｜')||'暂无技能标签'}</p></div>
              <div className="interviewer-candidate-owner"><p>接收 HR： <b>{candidate.assignedHrName||data.account.contact}</b></p><p>当前状态： <span className={statusTone}>◢ {displayStatus}</span></p></div>
              <div className="interviewer-candidate-note"><p>推荐时间：{formatDate(candidate.assignedAt||candidate.updatedAt)}</p><p>最近备注： {reviews.find(review=>review.candidateId===candidate.id)?.comment||'-'}</p></div>
              <button type="button" className="interviewer-view-detail" onClick={event=>{event.stopPropagation();setDetailId(candidate.id)}}>查看详情</button>
            </article>}):<div className="interviewer-empty"><span>⌕</span><b>暂无候选人</b><p>当前筛选条件下没有候选人记录</p></div>}
          </div>
          <footer className="interviewer-pagination"><span>共 {candidates.length} 条</span><button type="button" disabled>‹</button><button type="button" className="active">1</button><button type="button" disabled>›</button><select><option>10条/页</option><option>20条/页</option></select><label>前往 <input defaultValue="1"/> 页</label></footer>
        </section>
      </div>
    </section>
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
  const [detailView,setDetailView]=useState<'resume'|'ai'|'file'>('resume');
  return <div className="drawer-backdrop hr-resume-backdrop" onMouseDown={onClose}>
    <aside className={`detail-drawer candidate-drawer hr-resume-drawer ${detailView==='file'?'file-review-mode':''}`} aria-label={`${candidate.name}的简历`} onMouseDown={event=>event.stopPropagation()}>
      <button type="button" className="drawer-close" onClick={onClose} aria-label="关闭简历">×</button>
      <p className="drawer-label">CANDIDATE RESUME</p>
      <div className="candidate-profile hr-resume-profile"><span>{candidate.name.slice(0,1)}</span><div><div className="hr-resume-name-line"><h2>{candidate.name}</h2><em><b>{profile?.matchScore??candidate.score??'—'}</b><small>匹配度</small></em><strong className={`hr-resume-inline-status ${status==='已拒绝'?'reject':status==='待定'?'pending':status==='已通过'?'pass':'screen'}`}>{status}</strong></div><p>{candidate.company||'公司未填写'} · {candidate.role||job?.title||'职位未填写'}</p></div></div>
      <div className="hr-review-sidebar">
        <div className="hr-review-actions" aria-label="候选人审核操作">
          <button type="button" className={status==='已通过'?'active pass':'pass'} disabled={saving} onClick={()=>onReview('pass')}><i>✓</i><span><b>通过</b><small>进入 AI 面试</small></span></button>
          <button type="button" className={status==='待定'?'active pending':'pending'} disabled={saving} onClick={()=>onReview('pending')}><i>◷</i><span><b>待定</b><small>保留候选人</small></span></button>
          <button type="button" className={status==='已拒绝'?'active reject':'reject'} disabled={saving} onClick={()=>onReview('reject')}><i>×</i><span><b>拒绝</b><small>结束初筛</small></span></button>
          <button type="button" className={noteOpen?'active note':'note'} disabled={saving} onClick={()=>setNoteOpen(current=>!current)}><i>✎</i><span><b>备注</b><small>{review?.comment?'查看或修改':'添加候选人备注'}</small></span></button>
        </div>
        {noteOpen&&<form className="hr-resume-note" onSubmit={event=>{event.preventDefault();void onSaveNote(note).then(saved=>{if(saved)setNoteOpen(false)})}}><label>候选人备注<textarea value={note} maxLength={2000} onChange={event=>setNote(event.target.value)} placeholder="记录沟通情况、筛选意见或后续关注事项"/></label><footer><small>{note.length}/2000</small><button type="button" disabled={saving} onClick={()=>setNoteOpen(false)}>取消</button><button type="submit" disabled={saving}>{saving?'保存中…':'保存备注'}</button></footer></form>}
        {saving&&<p className="hr-resume-saving">正在同步审核结果…</p>}
      </div>
      <div className="hr-resume-tabs" role="tablist" aria-label="候选人详情内容">
        <button type="button" role="tab" aria-selected={detailView==='resume'} className={detailView==='resume'?'active':''} onClick={()=>setDetailView('resume')}>基本信息</button>
        <button type="button" role="tab" aria-selected={detailView==='ai'} className={detailView==='ai'?'active':''} onClick={()=>setDetailView('ai')}>AI 面试结果 <span>{aiInterview?.score!==null&&aiInterview?.score!==undefined?`${aiInterview.score} 分`:aiInterview?'待确认':'暂无'}</span></button>
        <button type="button" role="tab" aria-selected={detailView==='file'} className={detailView==='file'?'active':''} disabled={!profile?.fileName} onClick={()=>setDetailView('file')}>查看简历</button>
      </div>
      {detailView==='resume'?<div className="hr-resume-tab-panel" role="tabpanel">
        <section className="hr-resume-section hr-resume-basic"><div className="profile-info"><p><span>应聘职位</span>{job?.title||candidate.role||'-'}</p><p><span>手机号</span>{candidate.phone||'-'}</p><p><span>邮箱</span>{candidate.email||'-'}</p><p><span>所在城市</span>{candidate.city||'-'}</p><p><span>工作经验</span>{profile?.workYears!==null&&profile?.workYears!==undefined?`${profile.workYears}年`:candidate.years||'-'}</p><p><span>期望薪资</span>{profile?.expectedSalary?`${profile.expectedSalary}元/月`:'-'}</p></div></section>
        <section className="hr-resume-section"><h3>教育背景</h3><p className="hr-resume-copy">{[profile?.school,profile?.major,profile?.education].filter(Boolean).join(' · ')||'暂无教育背景信息'}</p></section>
        <ExperienceTimeline title="工作经历" items={profile?.workHistory}/>
        <ExperienceTimeline title="项目经历" items={profile?.projectHistory}/>
        <section className="hr-resume-section"><h3>技能与证书</h3><div className="channel-tags">{[...candidate.skills,...(profile?.certificates||[])].length?[...candidate.skills,...(profile?.certificates||[])].map((item,index)=><span key={`${item}-${index}`}>{item}</span>):<p className="hr-resume-copy">暂无技能与证书信息</p>}</div></section>
        {(profile?.highlights.length||profile?.risks.length)?<section className="hr-resume-section hr-resume-insights"><h3>AI 简历摘要</h3>{profile?.highlights.length?<div className="hr-insight-group highlight"><b>优势</b><div>{profile.highlights.map((item,index)=><span key={`highlight-${index}`}>{item}</span>)}</div></div>:null}{profile?.risks.length?<div className="hr-insight-group risk"><b>关注</b><div>{profile.risks.map((item,index)=><span key={`risk-${index}`}>{item}</span>)}</div></div>:null}</section>:null}
        {profile?.fileName?<div className="hr-resume-file-actions"><button type="button" onClick={()=>window.print()}>打印简历</button><a className="hr-resume-file" href={`/api/screening/file?candidateId=${encodeURIComponent(candidate.id)}`} target="_blank" rel="noreferrer">查看原始简历 · {profile.fileName}</a></div>:<p className="hr-resume-copy hr-resume-file-empty">未找到可预览的原始简历文件</p>}
      </div>:detailView==='ai'?<div className="hr-resume-tab-panel hr-resume-ai-panel" role="tabpanel">
        {aiInterview?<section className="hr-resume-section hr-ai-interview-result"><AiInterviewResultPanel summary={aiInterview.summary} fallbackScore={aiInterview.score} durationSeconds={aiInterview.durationSeconds} completedAt={aiInterview.completedAt} compact/><AiInterviewRecordings candidateId={candidate.id}/></section>:<div className="hr-resume-ai-empty"><span>AI</span><b>暂无 AI 面试结果</b><p>候选人完成 AI 面试后，评分、能力维度和面试摘要会显示在这里。</p></div>}
      </div>:<div className="hr-resume-tab-panel hr-resume-file-panel" role="tabpanel"><iframe title={`${candidate.name}的原始简历`} src={`/api/screening/file?candidateId=${encodeURIComponent(candidate.id)}`}/></div>}
    </aside>
  </div>;
}

function ExperienceTimeline({title,items}:{title:string;items:string[]|undefined}){
  const source=title==='工作经历'?mergeLeadingWorkDates(items||[]):expandProjectHistoryItems(items||[]);
  const projects=groupProjectHistory(source);
  return <section className="hr-resume-section"><h3>{title}</h3>{projects.length?<div className="hr-project-timeline">{projects.map((project,index)=><article key={`${project.label}-${index}`}><strong>{project.label}</strong><div>{project.details.length?project.details.map((detail,detailIndex)=><TimelineDetail key={`${project.label}-${detailIndex}`} value={detail}/>):<p>暂无详细描述</p>}</div></article>)}</div>:<p className="hr-resume-copy">暂无{title}信息</p>}</section>;
}

function TimelineDetail({value}:{value:string}){
  const match=value.match(/^(工作职责|工作内容|职责描述|责任描述|项目简介|项目描述|技术点|技术栈|软件环境|硬件环境|开发工具|项目周期)\s*[:：]\s*([\s\S]*)$/);
  if(!match)return <p>{value}</p>;
  const tone=/技术|环境|工具/.test(match[1])?'tech':/职责|责任|工作内容/.test(match[1])?'duty':'summary';
  return <p className="hr-timeline-labeled"><b className={tone}>{match[1]}</b><span>{match[2]||'未填写'}</span></p>;
}

function expandProjectHistoryItems(items:string[]){
  return items.flatMap(item=>item
    .split(/(?=项目(?:名称|名)\s*[:：]|项目[一二三四五六七八九十\d]+\s+(?:19|20)\d{2})/g)
    .map(part=>part.trim())
    .filter(Boolean));
}

function mergeLeadingWorkDates(items:string[]){
  const values=items.map(item=>item.trim()).filter(Boolean);
  const singleDate=/^(?:19|20)\d{2}(?:[.\/\-年]\d{1,2})?$/;
  if(values.length>=3&&singleDate.test(values[0])&&singleDate.test(values[1]))return [`${values[0]} — ${values[1]}`,values.slice(2).join(' · ')];
  return values;
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
      const labeled=splitLabeledProject(detail);
      if(labeled){groups.push(labeled);continue}
      const explicit=explicitProjectTitle(detail);
      const split=splitProjectTitleAndDescription(explicit||detail);
      if(explicit&&split.title){
        groups.push({label:split.title,details:split.description?[split.description]:[]});
        continue;
      }
      const title=split.title||projectTitle(detail);
      const titleOnly=Boolean(title&&title===detail.replace(/[：:]$/,''));
      const startsAfterResponsibilities=Boolean(title&&groups.length&&groups[groups.length-1].details.some(value=>/项目职责|工作职责|主要职责|负责/.test(value)));
      if(explicit||titleOnly||startsAfterResponsibilities){
        groups.push({label:title||`项目 ${String(groups.length+1).padStart(2,'0')}`,details:titleOnly?[]:[split.description||detail]});
      }else if(groups.length){
        groups[groups.length-1].details.push(detail);
      }else{
        groups.push({label:title||'项目 01',details:[split.description||detail]});
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

function splitLabeledProject(value:string){
  const match=value.match(/^项目(?:名称|名)\s*[:：]\s*([\s\S]+)$/);
  if(!match)return null;
  const body=match[1].trim();
  const marker=/(?:工作职责|工作内容|职责描述|责任描述|项目简介|项目描述|技术点|技术栈|软件环境|硬件环境|开发工具|项目周期)\s*[:：]/;
  const markerIndex=body.search(marker);
  const label=(markerIndex>=0?body.slice(0,markerIndex):body).trim().replace(/[，,。；;]+$/,'');
  const remainder=markerIndex>=0?body.slice(markerIndex).trim():'';
  const details=remainder?remainder.split(/(?=(?:工作职责|工作内容|职责描述|责任描述|项目简介|项目描述|技术点|技术栈|软件环境|硬件环境|开发工具|项目周期)\s*[:：])/g).map(item=>item.trim()).filter(Boolean):[];
  return {label:label||'未命名项目',details};
}

function explicitProjectTitle(value:string){
  return value.match(/^(?:项目(?:名称|名)?|项目[一二三四五六七八九十\d]+)\s*[:：]\s*(.+)$/)?.[1]?.trim()||'';
}

function splitProjectTitleAndDescription(value:string){
  const cleaned=value.trim();
  const duplicate=cleaned.match(/^([\u4e00-\u9fa5A-Za-z0-9_-]{2,24})\1(?=是|为|用于|提供|负责|参与|实现)/);
  if(duplicate){
    const title=duplicate[1];
    return {title,description:`${title}${cleaned.slice(duplicate[0].length)}`};
  }
  const sentence=cleaned.match(/^([\u4e00-\u9fa5A-Za-z0-9_-]{2,30}?)(?=是用于|用于|是一个|是一款|为一|主要用于|负责|提供)/);
  if(sentence)return {title:sentence[1],description:cleaned};
  return {title:'',description:cleaned};
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
  if(['简历筛选','用人部门筛选'].includes(stage))return '待筛选';
  return '已通过';
}

function candidateDisplayStatus(stage:string){
  if(stage==='已淘汰')return '已拒绝';
  if(stage==='待定')return '待定';
  if(stage==='用人部门筛选')return '待审核';
  if(stage==='简历筛选')return '待筛选';
  return '已通过';
}

function formatDate(value:string){
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return '-';
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
