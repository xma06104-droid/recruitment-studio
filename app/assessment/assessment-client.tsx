'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { announceWorkbenchChange, useWorkbenchSync } from '@/app/workbench-sync';
import HrAccountMenu from '@/app/components/hr-account-menu';

type Account = { contact:string; phone:string; email:string; role:'super_admin'|'hr' };
type Job = { id:string; title:string; department:string; city:string; status:string; ownerName:string; createdAt:string };
type Candidate = { id:string; jobId:string|null; name:string; role:string; company:string; years:string; stage:string; source:string; skills:string[]; score:number|null; phone:string; email:string; city:string; createdAt:string; updatedAt:string };
type Assessment = { candidateId:string; total:number; professional:number; communication:number; culture:number; comment:string; reviewer:string; updatedAt:string };
type Dataset = { account:Account; jobs:Job[]; candidates:Candidate[]; manualAssessments:Assessment[] };

const menuItems = [
  {icon:'◉',label:'候选人筛选',href:'/interviewer-candidate'},
  {icon:'▤',label:'人工评估',href:'/assessment'},
  {icon:'▣',label:'面试管理',href:'/interview-management'},
  {icon:'▥',label:'招聘进展',href:'/recruitment-progress'},
  {icon:'⚙',label:'设置',href:'/workbench'},
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
    await fetch('/api/workbench',{cache:'no-store'}).then(async response=>{
      if(response.status===401){window.location.assign('/');return}
      if(!response.ok)throw new Error('load');
      const result=await response.json() as Dataset;
      setData(result);
      setError('');
    });
  }
  useEffect(()=>{void load().catch(()=>setError('评估数据加载失败，请稍后刷新。'))},[]);
  useWorkbenchSync(()=>load().catch(()=>undefined));
  const assessments=useMemo(()=>Object.fromEntries((data?.manualAssessments||[]).map(item=>[item.candidateId,item])) as Record<string,Assessment>,[data]);

  const candidates=useMemo(()=>{
    if(!data)return [];
    return data.candidates.filter(candidate=>{
      const job=data.jobs.find(item=>item.id===candidate.jobId);
      const text=`${candidate.name}${candidate.phone}${candidate.email}${candidate.role}${candidate.company}${candidate.city}${job?.title||''}`.toLowerCase();
      const assessed=Boolean(assessments[candidate.id]);
      return (!keyword||text.includes(keyword.toLowerCase()))
        &&(!jobId||candidate.jobId===jobId)
        &&(stateFilter==='all'||(stateFilter==='assessed'&&assessed)||(stateFilter==='pending'&&!assessed))
        &&(contentFilter==='all'||(contentFilter==='ai'&&candidate.score!==null)||(contentFilter==='manual'&&assessed));
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
          <button type="button" className="interviewer-help" onClick={()=>flash('人工评估用于记录面试官对候选人的综合判断')}>◉ 评估说明</button>
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
              const score=displayScore(candidate,assessments);
              return <article key={candidate.id} className="assessment-row">
                <div className="assessment-profile"><p>{job?.title||candidate.role||'未关联职位'} · {formatDate(candidate.createdAt)} 进入流程</p><h3>{candidate.name}<span>{candidate.city||'城市未填写'}</span><span>{candidate.years||'经验未填写'}</span></h3><small>{candidate.company||'最近公司未填写'} · {candidate.role||'职位未填写'} · {candidate.skills.slice(0,3).join(' / ')||'暂无技能标签'}</small></div>
                <div className="assessment-metrics"><p>人工评估 <b className={manual?'done':''}>{manual?`${manual.total} 分`:'待评估'}</b></p><p>AI 面试评分 <b>{candidate.score===null?'暂无':`${candidate.score} 分`}</b></p><p>流程阶段 <b>{candidate.stage}</b></p></div>
                <div className="assessment-stars"><span>综合匹配度</span><b>{score?stars(score):'☆☆☆☆☆'}</b><small>{manual?.comment||'尚未填写人工评语'}</small></div>
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
  const [professional,setProfessional]=useState(value?.professional||80);
  const [communication,setCommunication]=useState(value?.communication||80);
  const [culture,setCulture]=useState(value?.culture||80);
  const [comment,setComment]=useState(value?.comment||'');
  const total=Math.round((professional+communication+culture)/3);
  function submit(event:FormEvent){event.preventDefault();onSave({total,professional,communication,culture,comment:comment.trim(),updatedAt:new Date().toISOString()})}
  return <div className="assessment-modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}>
    <form className="assessment-modal" onSubmit={submit}>
      <button type="button" className="assessment-modal-close" onClick={onClose} aria-label="关闭">×</button>
      <p>人工评估</p><h2>{candidate.name}</h2><small>{job?.title||candidate.role||'未关联职位'} · {candidate.company||'公司未填写'}</small>
      <div className="assessment-total"><span>综合得分</span><strong>{total}</strong><em>分</em></div>
      <ScoreField label="专业能力" value={professional} onChange={setProfessional}/>
      <ScoreField label="沟通表达" value={communication} onChange={setCommunication}/>
      <ScoreField label="团队与文化匹配" value={culture} onChange={setCulture}/>
      <label className="assessment-comment"><span>评估意见</span><textarea value={comment} onChange={event=>setComment(event.target.value)} placeholder="记录候选人的优势、风险和后续建议" rows={4}/></label>
      <footer><button type="button" disabled={saving} onClick={onClose}>取消</button><button type="submit" disabled={saving}>{saving?'保存中…':'保存评估'}</button></footer>
    </form>
  </div>;
}

function ScoreField({label,value,onChange}:{label:string;value:number;onChange:(value:number)=>void}){
  return <label className="assessment-score-field"><span>{label}</span><input type="range" min="0" max="100" step="5" value={value} onChange={event=>onChange(Number(event.target.value))}/><b>{value}</b></label>;
}

function displayScore(candidate:Candidate,assessments:Record<string,Assessment>){return assessments[candidate.id]?.total??candidate.score??0}
function stars(score:number){const filled=Math.max(1,Math.min(5,Math.round(score/20)));return `${'★'.repeat(filled)}${'☆'.repeat(5-filled)}`}
function formatDate(value:string){const date=new Date(value);return Number.isNaN(date.getTime())?'-':`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`}
