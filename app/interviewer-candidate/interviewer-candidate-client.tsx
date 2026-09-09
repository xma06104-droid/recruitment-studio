'use client';

import { useEffect, useMemo, useState } from 'react';
import { announceWorkbenchChange, useWorkbenchSync } from '@/app/workbench-sync';
import { AiInterviewResultPanel } from '@/app/components/ai-interview-result';
import HrAccountMenu from '@/app/components/hr-account-menu';

type Account = { contact:string; phone:string; email:string; role:'super_admin'|'hr' };
type Job = { id:string; title:string; department:string; city:string; status:string; ownerName:string; createdAt:string };
type Candidate = { id:string; jobId:string|null; name:string; role:string; company:string; years:string; stage:string; source:string; skills:string[]; score:number|null; phone:string; email:string; city:string; assignedHrId?:string; assignedHrName?:string; assignedAt?:string; createdAt:string; updatedAt:string };
type AiInterview = { id:string; candidateId:string; jobTitle:string; status:string; score:number|null; durationSeconds:number|null; summary:string; completedAt:string|null; createdAt:string; updatedAt:string };
type Dataset = { account:Account; jobs:Job[]; candidates:Candidate[]; aiInterviews:AiInterview[] };
type Profile = { candidateId:string; education:string; major:string; school:string; age:number|null; gender:string; industry:string; expectedSalary:number|null; workYears:number|null; stabilityMonths:number|null; workHistory:string[]; projectHistory:string[]; certificates:string[]; highlights:string[]; risks:string[]; parsingStatus:string; fileName:string; fileType:string; fileSize:number; matchScore:number|null; matchLevel:string; updatedAt:string };
type ScreeningData = { profiles:Profile[] };
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
  const [detailId,setDetailId]=useState('');
  const [savingId,setSavingId]=useState('');

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
  const detailAiInterview=detailCandidate?data?.aiInterviews.find(report=>report.candidateId===detailCandidate.id):undefined;

  function flash(message:string){setToast(message);window.setTimeout(()=>setToast(''),2200)}
  function toggleAll(){setSelected(allSelected?selected.filter(id=>!candidates.some(candidate=>candidate.id===id)):[...new Set([...selected,...candidates.map(candidate=>candidate.id)])])}
  function runAction(message:string){flash(selected.length?`${message}：已选择 ${selected.length} 位候选人`:'请先选择候选人')}
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
          <div className="interviewer-batch-row"><label><input type="checkbox" checked={allSelected} onChange={toggleAll}/> 全选</label><button type="button" onClick={()=>runAction('发送通知')}><span>发送通知</span><i aria-hidden="true">⌄</i></button><button type="button" onClick={()=>runAction('变更阶段')}><span>变更阶段</span><i aria-hidden="true">⌄</i></button><button type="button" onClick={()=>runAction('下载简历')}><span>下载简历</span><i aria-hidden="true">⌄</i></button><button type="button" onClick={()=>runAction('导出数据')}><span>导出数据</span><i aria-hidden="true">⌄</i></button><button type="button" onClick={()=>runAction('更多操作')}><span>更多</span><i aria-hidden="true">⌄</i></button></div>
          <div className="interviewer-candidate-list">
            {candidates.length?candidates.map(candidate=>{const job=data.jobs.find(item=>item.id===candidate.jobId);return <article className="interviewer-candidate-row" key={candidate.id} role="button" tabIndex={0} onClick={()=>setDetailId(candidate.id)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();setDetailId(candidate.id)}}}>
              <label onClick={event=>event.stopPropagation()}><input type="checkbox" checked={selected.includes(candidate.id)} onChange={()=>setSelected(selected.includes(candidate.id)?selected.filter(id=>id!==candidate.id):[...selected,candidate.id])}/></label>
              <div className="interviewer-candidate-profile"><p>{job?.title||candidate.role||'未关联职位'}　{formatDate(candidate.createdAt)}申请 <i>▣</i></p><h3>{candidate.name}<b>{candidate.score===null?'—':Math.max(1,Math.round(candidate.score/20))}</b><span>{candidate.city||'城市未填写'}</span>{candidate.years&&<span>{candidate.years}工作经验</span>}</h3><p>◼ {candidate.company||'最近公司未填写'}　{candidate.role||'职位未填写'}　{candidate.skills.slice(0,2).join('｜')||'暂无技能标签'}</p></div>
              <div className="interviewer-candidate-owner"><p>接收 HR： <b>{candidate.assignedHrName||data.account.contact}</b>　<i>□</i>　<em>♧</em></p><p>当前状态： <span>◢ {candidateDisplayStatus(candidate.stage)}</span></p></div>
              <div className="interviewer-candidate-note"><p>推荐时间：{formatDate(candidate.assignedAt||candidate.updatedAt)}</p><p>最近备注： -</p></div>
            </article>}):<div className="interviewer-empty"><span>⌕</span><b>暂无候选人</b><p>当前筛选条件下没有候选人记录</p></div>}
          </div>
          <footer className="interviewer-pagination"><span>共 {candidates.length} 条</span><button type="button" disabled>‹</button><button type="button" className="active">1</button><button type="button" disabled>›</button><select><option>10条/页</option><option>20条/页</option></select><label>前往 <input defaultValue="1"/> 页</label></footer>
        </section>
      </div>
    </section>
    <button type="button" className="interviewer-wechat" onClick={()=>flash('微信咨询')}>微信</button>
    <div className="interviewer-floating"><button type="button" onClick={()=>flash('在线咨询')}>◉　在线咨询</button><button type="button" onClick={()=>flash('需求反馈')}>✎　需求反馈</button></div>
    {detailCandidate&&<CandidateResumeDrawer
      candidate={detailCandidate}
      job={data.jobs.find(job=>job.id===detailCandidate.jobId)}
      profile={detailProfile}
      aiInterview={detailAiInterview}
      saving={savingId===detailCandidate.id}
      onClose={()=>setDetailId('')}
      onReview={action=>void updateReview(detailCandidate,action)}
    />}
    {toast&&<div className="interviewer-toast">{toast}</div>}
  </main>;
}

function CandidateResumeDrawer({candidate,job,profile,aiInterview,saving,onClose,onReview}:{candidate:Candidate;job:Job|undefined;profile:Profile|undefined;aiInterview:AiInterview|undefined;saving:boolean;onClose:()=>void;onReview:(action:ReviewAction)=>void}){
  const status=candidateDisplayStatus(candidate.stage);
  return <div className="drawer-backdrop hr-resume-backdrop" onMouseDown={onClose}>
    <aside className="detail-drawer candidate-drawer hr-resume-drawer" aria-label={`${candidate.name}的简历`} onMouseDown={event=>event.stopPropagation()}>
      <button type="button" className="drawer-close" onClick={onClose} aria-label="关闭简历">×</button>
      <p className="drawer-label">CANDIDATE RESUME</p>
      <div className="candidate-profile hr-resume-profile"><span>{candidate.name.slice(0,1)}</span><div><div className="hr-resume-name-line"><h2>{candidate.name}</h2><em><b>{profile?.matchScore??candidate.score??'—'}</b><small>匹配度</small></em><strong className={`hr-resume-inline-status ${status==='已拒绝'?'reject':status==='待定'?'pending':status==='已通过'?'pass':'screen'}`}>{status}</strong></div><p>{candidate.company||'公司未填写'} · {candidate.role||job?.title||'职位未填写'}</p></div></div>
      <div className="hr-review-actions" aria-label="候选人审核操作">
        <button type="button" className={status==='已通过'?'active pass':'pass'} disabled={saving} onClick={()=>onReview('pass')}><i>✓</i><span><b>通过</b><small>进入安排面试</small></span></button>
        <button type="button" className={status==='待定'?'active pending':'pending'} disabled={saving} onClick={()=>onReview('pending')}><i>◷</i><span><b>待定</b><small>保留候选人</small></span></button>
        <button type="button" className={status==='已拒绝'?'active reject':'reject'} disabled={saving} onClick={()=>onReview('reject')}><i>×</i><span><b>拒绝</b><small>结束初筛</small></span></button>
      </div>
      {saving&&<p className="hr-resume-saving">正在同步审核结果…</p>}
      <section className="hr-resume-section"><h3>基本信息</h3><div className="profile-info"><p><span>应聘职位</span>{job?.title||candidate.role||'-'}</p><p><span>手机号</span>{candidate.phone||'-'}</p><p><span>邮箱</span>{candidate.email||'-'}</p><p><span>所在城市</span>{candidate.city||'-'}</p><p><span>工作经验</span>{profile?.workYears!==null&&profile?.workYears!==undefined?`${profile.workYears}年`:candidate.years||'-'}</p><p><span>期望薪资</span>{profile?.expectedSalary?`${profile.expectedSalary}元/月`:'-'}</p></div></section>
      {aiInterview&&<section className="hr-resume-section hr-ai-interview-result"><h3>AI 面试结果</h3><AiInterviewResultPanel summary={aiInterview.summary} fallbackScore={aiInterview.score} durationSeconds={aiInterview.durationSeconds} completedAt={aiInterview.completedAt} compact/></section>}
      <section className="hr-resume-section"><h3>教育背景</h3><p className="hr-resume-copy">{[profile?.school,profile?.major,profile?.education].filter(Boolean).join(' · ')||'暂无教育背景信息'}</p></section>
      <ResumeList title="工作经历" items={profile?.workHistory}/>
      <ProjectTimeline items={profile?.projectHistory}/>
      <section className="hr-resume-section"><h3>技能与证书</h3><div className="channel-tags">{[...candidate.skills,...(profile?.certificates||[])].length?[...candidate.skills,...(profile?.certificates||[])].map((item,index)=><span key={`${item}-${index}`}>{item}</span>):<p className="hr-resume-copy">暂无技能与证书信息</p>}</div></section>
      {(profile?.highlights.length||profile?.risks.length)?<section className="hr-resume-section hr-resume-insights"><h3>AI 简历摘要</h3>{profile?.highlights.length?<div className="hr-insight-group highlight"><b>优势</b><div>{profile.highlights.map((item,index)=><span key={`highlight-${index}`}>{item}</span>)}</div></div>:null}{profile?.risks.length?<div className="hr-insight-group risk"><b>关注</b><div>{profile.risks.map((item,index)=><span key={`risk-${index}`}>{item}</span>)}</div></div>:null}</section>:null}
      {profile?.fileName?<a className="hr-resume-file" href={`/api/screening/file?candidateId=${encodeURIComponent(candidate.id)}`} target="_blank" rel="noreferrer">查看原始简历 · {profile.fileName}</a>:<p className="hr-resume-copy hr-resume-file-empty">未找到可预览的原始简历文件</p>}
    </aside>
  </div>;
}

function ResumeList({title,items}:{title:string;items:string[]|undefined}){
  return <section className="hr-resume-section"><h3>{title}</h3>{items?.length?<div className="hr-resume-list">{items.map((item,index)=><p key={`${title}-${index}`}>{item}</p>)}</div>:<p className="hr-resume-copy">暂无{title}信息</p>}</section>;
}

function ProjectTimeline({items}:{items:string[]|undefined}){
  const projects=groupProjectHistory(items||[]);
  return <section className="hr-resume-section"><h3>项目经历</h3>{projects.length?<div className="hr-project-timeline">{projects.map((project,index)=><article key={`${project.period}-${index}`}><time>{project.period}</time><div>{project.details.length?project.details.map((detail,detailIndex)=><p key={`${project.period}-${detailIndex}`}>{detail}</p>):<p>暂无详细项目描述</p>}</div></article>)}</div>:<p className="hr-resume-copy">暂无项目经历信息</p>}</section>;
}

function groupProjectHistory(items:string[]){
  const dateRange=/^((?:19|20)\d{2}(?:[.\/\-年]\d{1,2})?\s*(?:至|到|[-—–~～])\s*(?:(?:19|20)\d{2}(?:[.\/\-年]\d{1,2})?|至今|现在|今))(?:\s*[\u00b7|｜]\s*|\s+)?(.*)$/i;
  const parsed=items.map(item=>{const match=item.trim().match(dateRange);return {period:match?.[1]?.replace(/\s+/g,'')||'',detail:match?match[2].trim():item.trim()}}).filter(item=>item.period||item.detail);
  const dateIndexes=parsed.map((item,index)=>item.period?index:-1).filter(index=>index>=0);
  if(!dateIndexes.length)return parsed.map((item,index)=>({period:`项目 ${String(index+1).padStart(2,'0')}`,details:[item.detail]}));

  const leadingDates=dateIndexes.length>1&&dateIndexes.every((index,position)=>index===position)&&parsed.slice(dateIndexes.length).every(item=>!item.period);
  if(leadingDates){
    const periods=parsed.slice(0,dateIndexes.length).map(item=>item.period);
    const details=parsed.slice(dateIndexes.length).map(item=>item.detail).filter(Boolean);
    return periods.map((period,index)=>({period,details:details.slice(Math.floor(index*details.length/periods.length),Math.floor((index+1)*details.length/periods.length))})).sort((a,b)=>projectDateValue(b.period)-projectDateValue(a.period));
  }

  const groups:{period:string;details:string[]}[]=[];
  for(const item of parsed){
    if(item.period)groups.push({period:item.period,details:item.detail?[item.detail]:[]});
    else if(groups.length)groups[groups.length-1].details.push(item.detail);
    else groups.push({period:'时间未标注',details:[item.detail]});
  }
  return groups.sort((a,b)=>projectDateValue(b.period)-projectDateValue(a.period));
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
