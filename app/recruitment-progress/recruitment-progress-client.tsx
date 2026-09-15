'use client';

import { useEffect, useMemo, useState } from 'react';
import { useWorkbenchSync } from '@/app/workbench-sync';
import HrAccountMenu from '@/app/components/hr-account-menu';
import { CANDIDATE_STAGES } from '@/app/candidate-stages';
import { HR_WORKBENCH_CACHE, readHrSessionCache, writeHrSessionCache } from '@/app/hr-session-cache';

type Account={contact:string;phone:string;email:string;role:'super_admin'|'hr'};
type Job={id:string;title:string;department:string;city:string;status:string};
type Candidate={id:string;jobId:string|null;name:string;role:string;company:string;years:string;stage:string;source:string;skills:string[];score:number|null;phone:string;email:string;city:string;createdAt:string;updatedAt:string};
type Interview={id:string;candidateId:string;status:string};
type Offer={id:string;candidateId:string;status:string};
type Dataset={account:Account;jobs:Job[];candidates:Candidate[];interviews:Interview[];offers:Offer[]};
const stages:string[]=[...CANDIDATE_STAGES];
const menuItems=[{icon:'◉',label:'候选人筛选',href:'/interviewer-candidate'},{icon:'▤',label:'人工评估',href:'/assessment'},{icon:'▣',label:'面试管理',href:'/interview-management'},{icon:'▥',label:'招聘进展',href:'/recruitment-progress'},{icon:'⚙',label:'设置',href:'/hr-settings'}];

export default function RecruitmentProgressClient(){
  const [data,setData]=useState<Dataset|null>(null);const [error,setError]=useState('');const [keyword,setKeyword]=useState('');const [jobId,setJobId]=useState('');const [stage,setStage]=useState('全部');
  async function load(){const response=await fetch('/api/workbench',{cache:'no-store'});if(response.status===401){window.location.assign('/');return}if(!response.ok)throw new Error('load');const result=await response.json() as Dataset;setData(result);writeHrSessionCache(HR_WORKBENCH_CACHE,result)}
  useEffect(()=>{const cached=readHrSessionCache<Dataset>(HR_WORKBENCH_CACHE);if(cached)setData(cached);void load().catch(()=>{if(!cached)setError('招聘进展数据加载失败，请稍后刷新。')})},[]);
  useWorkbenchSync(()=>load().catch(()=>undefined));
  const visible=useMemo(()=>data?.candidates.filter(person=>{const job=data.jobs.find(item=>item.id===person.jobId);const text=`${person.name}${person.phone}${person.role}${person.company}${job?.title||''}`.toLowerCase();return(!keyword||text.includes(keyword.toLowerCase()))&&(!jobId||person.jobId===jobId)&&(stage==='全部'||person.stage===stage)}).sort((a,b)=>new Date(b.updatedAt).getTime()-new Date(a.updatedAt).getTime())||[],[data,keyword,jobId,stage]);
  if(!data)return <main className="interviewer-loading"><span>星</span><b>{error||'正在读取招聘进展…'}</b>{error&&<button onClick={()=>window.location.reload()}>重新加载</button>}</main>;
  const groups=stages.map(label=>({label,count:data.candidates.filter(item=>item.stage===label).length}));
  const max=Math.max(1,...groups.map(item=>item.count));
  return <main className="interviewer-page"><aside className="interviewer-rail"><a className="interviewer-logo" href="/workbench"><span>星</span><b>星鉴人才<small>HIRING DEPARTMENT</small></b></a><p className="interviewer-role-label">HR 工作台</p><nav>{menuItems.map(item=><a key={item.label} className={item.label==='招聘进展'?'active':''} href={item.href}><i>{item.icon}</i><span>{item.label}</span></a>)}</nav><button type="button">«</button></aside>
    <section className="interviewer-main"><header className="interviewer-header"><div className="interviewer-heading"><h1>招聘进展</h1><small>HR 候选人工作台</small></div><div className="interviewer-tools"><div className="interviewer-global-search"><input value={keyword} onChange={event=>setKeyword(event.target.value)} placeholder="搜索候选人或职位"/><button type="button">⌕</button></div><HrAccountMenu contact={data.account.contact} phone={data.account.phone} email={data.account.email} role={data.account.role}/></div></header><div className="interviewer-open-tabs"><a href="/interviewer-candidate">候选人筛选</a><i>›</i><button type="button" className="active">招聘进展</button></div>
      <div className="hr-module-content"><section className="hr-module-hero"><div><p>RECRUITMENT PIPELINE</p><h2>招聘流程总览</h2><span>根据当前账号的候选人、面试和 Offer 记录实时汇总</span></div><div className="progress-summary"><span>{data.jobs.filter(job=>['招聘中','急聘'].includes(job.status)).length} 个招聘中职位</span><b>{data.candidates.length} 位候选人</b></div></section>
        <section className="progress-funnel">{groups.map((item,index)=><article key={item.label}><div><span>{String(index+1).padStart(2,'0')}</span><b>{item.label}</b><strong>{item.count}</strong></div><i><em style={{width:`${Math.max(item.count?8:0,item.count/max*100)}%`}}/></i><small>{`${Math.round(item.count/Math.max(1,data.candidates.length)*100)}% 总体占比`}</small></article>)}</section>
        <section className="hr-filter-bar"><select value={jobId} onChange={event=>setJobId(event.target.value)}><option value="">全部职位</option>{data.jobs.map(job=><option key={job.id} value={job.id}>{job.title}</option>)}</select><select value={stage} onChange={event=>setStage(event.target.value)}><option>全部</option>{stages.map(item=><option key={item}>{item}</option>)}</select><button type="button" onClick={()=>{setJobId('');setStage('全部');setKeyword('')}}>重置筛选</button><span>共 {visible.length} 位</span></section>
        <section className="hr-record-card progress-table"><header><h3>候选人流程明细</h3><span>展示候选人当前阶段</span></header><div className="progress-table-head"><span>候选人</span><span>应聘职位</span><span>流程数据</span><span>最近更新</span><span>当前阶段</span></div><div className="hr-record-list">{visible.length?visible.map(person=>{const job=data.jobs.find(item=>item.id===person.jobId);const interviewCount=data.interviews.filter(item=>item.candidateId===person.id).length;const offer=data.offers.find(item=>item.candidateId===person.id);return <article className="progress-row" key={person.id}><div><b>{person.name}</b><small>{person.company||'公司未填写'} · {person.city||'城市未填写'}</small></div><div><b>{job?.title||person.role||'未关联职位'}</b><small>{job?.department||person.role}</small></div><div className="progress-record-badges"><span>{interviewCount} 场面试</span><span>{offer?`Offer ${offer.status}`:'暂无 Offer'}</span></div><time>{formatDate(person.updatedAt)}</time><span className="progress-stage-badge" data-stage={person.stage}>{person.stage}</span></article>}):<div className="interviewer-empty"><span>▥</span><b>暂无候选人进展</b><p>调整筛选条件或先在候选人管理中录入候选人。</p></div>}</div></section>
      </div>
    </section>
  </main>;
}

function formatDate(value:string){const date=new Date(value);return Number.isNaN(date.getTime())?'-':`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`}
