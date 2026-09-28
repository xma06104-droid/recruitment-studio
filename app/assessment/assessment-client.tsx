'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { announceWorkbenchChange, useWorkbenchSync } from '@/app/workbench-sync';
import HrAccountMenu from '@/app/components/hr-account-menu';
import { HR_WORKBENCH_CACHE, readHrSessionCache, writeHrSessionCache } from '@/app/hr-session-cache';

type Account = { contact:string; phone:string; email:string; role:'super_admin'|'hr' };
type Job = { id:string; title:string; department:string; city:string; status:string; ownerName:string; createdAt:string };
type Candidate = { id:string; jobId:string|null; name:string; role:string; company:string; years:string; stage:string; source:string; skills:string[]; score:number|null; phone:string; email:string; city:string; createdAt:string; updatedAt:string };
type AiInterview = { id:string; candidateId:string; status:string; score:number|null; completedAt:string|null; updatedAt:string };
type Assessment = { candidateId:string; total:number; professional:number; communication:number; culture:number; comment:string; reviewer:string; updatedAt:string };
type Dataset = { account:Account; jobs:Job[]; candidates:Candidate[]; aiInterviews:AiInterview[]; manualAssessments:Assessment[] };

const menuItems = [
  {icon:'◉',label:'候选人筛选',href:'/interviewer-candidate'},
  {icon:'▤',label:'人工评估',href:'/assessment'},
  {icon:'▣',label:'面试管理',href:'/interview-management'},
  {icon:'▥',label:'招聘进展',href:'/recruitment-progress'},
  {icon:'⚙',label:'设置',href:'/hr-settings'},
];

export default function AssessmentClient() {
  const [data,setData]=useState<Dataset|null>(null);
  const [error,setError]=useState('');
  const [keyword,setKeyword]=useState('');
  const [jobId,setJobId]=useState('');
  const [stateFilter,setStateFilter]=useState('all');
  const [contentFilter,setContentFilter]=useState('all');
  const [sort,setSort]=useState('recent');
  const [editing,setEditing]=useState<Candidate|null>(null);
  const [toast,setToast]=useState('');
  const [saving,setSaving]=useState(false);

  async function load(){
    await fetch('/api/workbench?scope=department-review',{cache:'no-store'}).then(async response=>{
      if(response.status===401){window.location.assign('/');return}
      if(!response.ok)throw new Error('load');
      const result=await response.json() as Dataset;
      setData(result);
      writeHrSessionCache(HR_WORKBENCH_CACHE,result);
      setError('');
    });
  }
  useEffect(()=>{const cached=readHrSessionCache<Dataset>(HR_WORKBENCH_CACHE);if(cached)setData(cached);void load().catch(()=>{if(!cached)setError('评估数据加载失败，请稍后刷新。')})},[]);
  useWorkbenchSync(()=>load().catch(()=>undefined));
  const assessments=useMemo(()=>Object.fromEntries((data?.manualAssessments||[]).map(item=>[item.candidateId,item])) as Record<string,Assessment>,[data]);

  const candidates=useMemo(()=>{
    if(!data)return [];
    return data.candidates.filter(candidate=>{
      const job=data.jobs.find(item=>item.id===candidate.jobId);
      const aiInterview=data.aiInterviews.find(item=>item.candidateId===candidate.id&&item.status==='已完成'&&item.score!==null);
      const text=`${candidate.name}${candidate.phone}${candidate.email}${candidate.role}${candidate.company}${candidate.city}${job?.title||''}`.toLowerCase();
      const assessed=Boolean(assessments[candidate.id]);
      return (!keyword||text.includes(keyword.toLowerCase()))
        &&(!jobId||candidate.jobId===jobId)
        &&(stateFilter==='all'||(stateFilter==='assessed'&&assessed)||(stateFilter==='pending'&&!assessed))
        &&(contentFilter==='all'||(contentFilter==='ai'&&Boolean(aiInterview))||(contentFilter==='manual'&&assessed));
    }).sort((a,b)=>{
      if(sort==='score')return (displayScore(b,assessments)-(displayScore(a,assessments)));
      if(sort==='name')return a.name.localeCompare(b.name,'zh-CN');
      return new Date(b.updatedAt).getTime()-new Date(a.updatedAt).getTime();
    });
  },[data,keyword,jobId,stateFilter,contentFilter,sort,assessments]);

  function flash(message:string){setToast(message);window.setTimeout(()=>setToast(''),2200)}
  function resetFilters(){setKeyword('');setJobId('');setStateFilter('all');setContentFilter('all');setSort('recent')}
  async function saveAssessment(candidate:Candidate,assessment:Omit<Assessment,'candidateId'|'reviewer'>){
    if(saving)return;
    setSaving(true);
    try{
      const response=await fetch('/api/workbench',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({resource:'manualAssessment',payload:{candidateId:candidate.id,...assessment}})});
      if(response.status===401){window.location.assign('/');return}
      if(!response.ok){flash('保存失败');return}
      announceWorkbenchChange();
      await load();
      setEditing(null);
      flash(`已保存 ${candidate.name} 的人工评估，两个系统已同步`);
    }catch{flash('保存失败')}finally{setSaving(false)}
  }

  if(!data)return <main className="interviewer-loading"><span>星</span><b>{error||'正在读取人工评估数据…'}</b>{error&&<button onClick={()=>window.location.reload()}>重新加载</button>}</main>;

  return <main className="interviewer-page assessment-page">
    <aside className="interviewer-rail">
      <a className="interviewer-logo" href="/workbench" aria-label="返回星鉴人才招聘工作台"><span>星</span><b>星鉴人才<small>HIRING DEPARTMENT</small></b></a>
      <p className="interviewer-role-label">HR 工作台</p>
      <nav>{menuItems.map((item,index)=><a key={item.label} className={index===1?'active':''} href={item.href} title={item.label}><i>{item.icon}</i><span>{item.label}</span></a>)}</nav>
      <button type="button" title="收起菜单">«</button>
    </aside>

    <section className="interviewer-main">
      <header className="interviewer-header">
        <div className="interviewer-heading"><h1>人工评估</h1><small>HR 候选人工作台</small></div>
        <div className="interviewer-tools">
          <div className="interviewer-global-search"><input value={keyword} onChange={event=>setKeyword(event.target.value)} placeholder="全局搜索候选人或职位"/><button type="button">⌕</button></div>
          <HrAccountMenu contact={data.account.contact} phone={data.account.phone} email={data.account.email} role={data.account.role}/>
        </div>
      </header>
      <div className="interviewer-open-tabs"><a href="/interviewer-candidate">候选人筛选</a><i>›</i><button type="button" className="active">人工评估</button></div>

      <div className="assessment-content">
        <aside className="assessment-filter-card">
          <header><p>评估范围</p><h2>候选人筛选</h2><small>共 {data.candidates.length} 位候选人，已评估 {Object.keys(assessments).length} 位</small></header>
          <label><span>搜索候选人</span><input value={keyword} onChange={event=>setKeyword(event.target.value)} placeholder="姓名、手机号或职位"/></label>
          <label><span>所属职位</span><select value={jobId} onChange={event=>setJobId(event.target.value)}><option value="">全部职位</option>{data.jobs.map(job=><option key={job.id} value={job.id}>{job.title}</option>)}</select></label>
          <label><span>评估状态</span><select value={stateFilter} onChange={event=>setStateFilter(event.target.value)}><option value="all">全部状态</option><option value="pending">待评估</option><option value="assessed">已评估</option></select></label>
          <label><span>评估内容</span><select value={contentFilter} onChange={event=>setContentFilter(event.target.value)}><option value="all">全部内容</option><option value="ai">已有 AI 评分</option><option value="manual">已填写人工评估</option></select></label>
          <label><span>排序方式</span><select value={sort} onChange={event=>setSort(event.target.value)}><option value="recent">最近更新</option><option value="score">综合得分</option><option value="name">候选人姓名</option></select></label>
          <button type="button" className="assessment-reset" onClick={resetFilters}>重置筛选条件</button>
        </aside>

        <section className="assessment-list-card">
          <header><div><p>人工评估列表</p><h2>全部候选人 <b>{candidates.length}</b></h2></div><span>评估结果保存在当前账号</span></header>
          <div className="assessment-list">
            {candidates.length?candidates.map(candidate=>{
              const job=data.jobs.find(item=>item.id===candidate.jobId);
              const manual=assessments[candidate.id];
              const aiInterview=data.aiInterviews.find(item=>item.candidateId===candidate.id);
              return <article key={candidate.id} className="assessment-row">
                <div className="assessment-profile"><p>{job?.title||candidate.role||'未关联职位'} · {formatDate(candidate.createdAt)} 进入流程</p><h3>{candidate.name}<span>{candidate.city||'城市未填写'}</span><span>{candidate.years||'经验未填写'}</span></h3><small>{candidate.company||'最近公司未填写'} · {candidate.role||'职位未填写'} · {candidate.skills.slice(0,3).join(' / ')||'暂无技能标签'}</small></div>
                <div className="assessment-metrics"><p>人工评估 <b className={manual?'done':''}>{manual?`${manual.total} 分`:'待评估'}</b></p><p>AI 面试评分 <b>{displayAiInterview(aiInterview,candidate.stage)}</b></p><p>流程阶段 <b>{candidate.stage}</b></p></div>
                <div className="assessment-stars"><span>综合匹配度</span><b>{manual?stars(manual.total):'☆☆☆☆☆'}</b><small>{manual?.comment||'尚未填写人工评语'}</small></div>
                <button type="button" className="assessment-action" onClick={()=>setEditing(candidate)}>{manual?'查看 / 修改评估':'开始评估'}</button>
              </article>;
            }):<div className="interviewer-empty"><span>▤</span><b>暂无符合条件的候选人</b><p>调整左侧筛选条件后再试</p></div>}
          </div>
          <footer className="assessment-pagination"><span>共 {candidates.length} 条</span><button type="button" disabled>‹</button><button type="button" className="active">1</button><button type="button" disabled>›</button><span>10 条 / 页</span></footer>
        </section>
      </div>
    </section>
    {editing&&<AssessmentDialog candidate={editing} job={data.jobs.find(item=>item.id===editing.jobId)} value={assessments[editing.id]} saving={saving} onClose={()=>{if(!saving)setEditing(null)}} onSave={value=>void saveAssessment(editing,value)}/>}
    {toast&&<div className="interviewer-toast">{toast}</div>}
  </main>;
}

function AssessmentDialog({candidate,job,value,saving,onClose,onSave}:{candidate:Candidate;job?:Job;value?:Assessment;saving:boolean;onClose:()=>void;onSave:(value:Omit<Assessment,'candidateId'|'reviewer'>)=>void}) {
  const [resumeDecision,setResumeDecision]=useState(assessmentDecision(value?.professional,'是','否'));
  const [resumeStars,setResumeStars]=useState(scoreToStars(value?.professional));
  const [resumeComment,setResumeComment]=useState(extractAssessmentDetail(value?.comment,'简历意向'));
  const [videoDecision,setVideoDecision]=useState(assessmentDecision(value?.communication,'通过','拒绝'));
  const [videoStars,setVideoStars]=useState(scoreToStars(value?.communication));
  const [videoComment,setVideoComment]=useState(extractAssessmentDetail(value?.comment,'视频面试'));
  const [overallDecision,setOverallDecision]=useState(assessmentDecision(value?.culture,'通过','拒绝'));
  const [overallStars,setOverallStars]=useState(scoreToStars(value?.culture));
  const [overallComment,setOverallComment]=useState(extractAssessmentDetail(value?.comment,'综合推荐')||(!value?.comment?.includes('简历意向：')?value?.comment||'':''));
  const professional=resumeStars*20;
  const communication=videoStars*20;
  const culture=overallStars*20;
  const total=Math.round((professional+communication+culture)/3);
  function submit(event:FormEvent){
    event.preventDefault();
    const comment=[
      assessmentSummary('简历意向',resumeDecision,resumeStars,resumeComment),
      assessmentSummary('视频面试',videoDecision,videoStars,videoComment),
      assessmentSummary('综合推荐',overallDecision,overallStars,overallComment),
    ].join('\n');
    onSave({total,professional,communication,culture,comment,updatedAt:new Date().toISOString()});
  }
  return <div className="assessment-modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}>
    <form className="assessment-modal assessment-questionnaire" onSubmit={submit}>
      <button type="button" className="assessment-modal-close" onClick={onClose} aria-label="关闭">×</button>
      <header><p>人工综合评价</p><h2>{candidate.name}</h2><small>{job?.title||candidate.role||'未关联职位'} · {candidate.company||'公司未填写'}</small><div className="assessment-questionnaire-score"><span>当前综合评分</span><b>{total}</b><em>分</em></div></header>
      <div className="assessment-question-list">
        <AssessmentQuestion number={1} title="您看完候选人的简历之后，还想面试 TA 吗？" options={['是','否','待定']} decision={resumeDecision} onDecision={setResumeDecision} rating={resumeStars} onRating={setResumeStars} comment={resumeComment} onComment={setResumeComment}/>
        <AssessmentQuestion number={2} title="请对候选人视频面试的表现进行五星评价" options={['通过','拒绝','待定']} decision={videoDecision} onDecision={setVideoDecision} rating={videoStars} onRating={setVideoStars} comment={videoComment} onComment={setVideoComment}/>
        <AssessmentQuestion number={3} title="请对候选人的综合表现进行五星评价，并决定是否推荐进入下一轮面试" options={['通过','拒绝','待定']} decision={overallDecision} onDecision={setOverallDecision} rating={overallStars} onRating={setOverallStars} comment={overallComment} onComment={setOverallComment}/>
      </div>
      <footer><button type="button" disabled={saving} onClick={onClose}>取消</button><button type="submit" disabled={saving}>{saving?'提交中…':'提交评估'}</button></footer>
    </form>
  </div>;
}

function AssessmentQuestion({number,title,options,decision,onDecision,rating,onRating,comment,onComment}:{number:number;title:string;options:string[];decision:string;onDecision:(value:string)=>void;rating:number;onRating:(value:number)=>void;comment:string;onComment:(value:string)=>void}){
  return <section className="assessment-question">
    <h3><span>{number}</span>{title}</h3>
    <div className="assessment-question-options" role="group" aria-label={`${number}. ${title}`}>{options.map(option=><button key={option} type="button" className={decision===option?'active':''} aria-pressed={decision===option} onClick={()=>onDecision(option)}>{option}</button>)}</div>
    <div className="assessment-question-stars" role="group" aria-label={`${number}. 五星评分`}>{[1,2,3,4,5].map(star=><button key={star} type="button" className={star<=rating?'active':''} aria-label={`${star} 星`} aria-pressed={rating===star} onClick={()=>onRating(star)}>{star<=rating?'★':'☆'}</button>)}</div>
    <label><textarea value={comment} maxLength={500} rows={3} onChange={event=>onComment(event.target.value)} placeholder="请填写具体评价"/><small>{comment.length}/500</small></label>
  </section>;
}

function displayScore(candidate:Candidate,assessments:Record<string,Assessment>){return assessments[candidate.id]?.total??candidate.score??0}
function displayAiInterview(interview:AiInterview|undefined,stage:string){return interview?.status==='已完成'&&interview.score!==null?`${interview.score} 分`:interview||stage==='AI面试'?'待确认':'暂无'}
function stars(score:number){const filled=Math.max(1,Math.min(5,Math.round(score/20)));return `${'★'.repeat(filled)}${'☆'.repeat(5-filled)}`}
function scoreToStars(score:number|undefined){return Math.max(1,Math.min(5,Math.round((score??80)/20)))}
function assessmentDecision(score:number|undefined,positive:string,negative:string){return (score??80)>=70?positive:(score??80)<=40?negative:'待定'}
function extractAssessmentDetail(comment:string|undefined,label:string){const line=comment?.split('\n').find(item=>item.startsWith(`${label}：`));return line?.split('｜').slice(2).join('｜').trim()||''}
function assessmentSummary(label:string,decision:string,rating:number,comment:string){return `${label}：${decision}｜${rating}星${comment.trim()?`｜${comment.trim()}`:''}`}
function formatDate(value:string){const date=new Date(value);return Number.isNaN(date.getTime())?'-':`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`}
