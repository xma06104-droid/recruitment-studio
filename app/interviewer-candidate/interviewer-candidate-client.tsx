'use client';

import { useEffect, useMemo, useState } from 'react';
import { useWorkbenchSync } from '@/app/workbench-sync';

type Account = { contact:string; phone:string; email:string };
type Job = { id:string; title:string; department:string; city:string; status:string; ownerName:string; createdAt:string };
type Candidate = { id:string; jobId:string|null; name:string; role:string; company:string; years:string; stage:string; source:string; skills:string[]; score:number|null; phone:string; email:string; city:string; createdAt:string; updatedAt:string };
type Dataset = { account:Account; jobs:Job[]; candidates:Candidate[] };
type ReviewStatus = '待筛选'|'已通过'|'已拒绝'|'待定'|'已失效';

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

  async function load(){
    await fetch('/api/workbench',{cache:'no-store'}).then(async response=>{
      if(response.status===401){window.location.assign('/');return}
      if(!response.ok)throw new Error('load');
      const result=await response.json() as Dataset;
      setData(result);
      setError('');
    });
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

  function flash(message:string){setToast(message);window.setTimeout(()=>setToast(''),2200)}
  function toggleAll(){setSelected(allSelected?selected.filter(id=>!candidates.some(candidate=>candidate.id===id)):[...new Set([...selected,...candidates.map(candidate=>candidate.id)])])}
  function runAction(message:string){flash(selected.length?`${message}：已选择 ${selected.length} 位候选人`:'请先选择候选人')}

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
          <span className="interviewer-avatar">{data.account.contact.slice(0,1)}</span><div className="interviewer-account-copy"><b>{data.account.contact}</b><small>HR 招聘</small></div><i>⌄</i>
        </div>
      </header>
      <div className="interviewer-open-tabs"><a href="/workbench">招聘管理</a><i>›</i><button type="button" className="active">候选人筛选</button><span>当前角色：HR</span></div>

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
          <div className="interviewer-batch-row"><label><input type="checkbox" checked={allSelected} onChange={toggleAll}/> 全选</label><button type="button" onClick={()=>runAction('发送通知')}>发送通知⌄</button><button type="button" onClick={()=>runAction('变更阶段')}>变更阶段⌄</button><button type="button" onClick={()=>runAction('下载简历')}>下载简历⌄</button><button type="button" onClick={()=>runAction('导出数据')}>导出数据⌄</button><button type="button" onClick={()=>runAction('更多操作')}>更多⌄</button></div>
          <div className="interviewer-candidate-list">
            {candidates.length?candidates.map(candidate=>{const job=data.jobs.find(item=>item.id===candidate.jobId);return <article className="interviewer-candidate-row" key={candidate.id}>
              <label><input type="checkbox" checked={selected.includes(candidate.id)} onChange={()=>setSelected(selected.includes(candidate.id)?selected.filter(id=>id!==candidate.id):[...selected,candidate.id])}/></label>
              <div className="interviewer-candidate-profile"><p>{job?.title||candidate.role||'未关联职位'}　{formatDate(candidate.createdAt)}申请 <i>▣</i></p><h3>{candidate.name}<b>{candidate.score===null?'—':Math.max(1,Math.round(candidate.score/20))}</b><span>{candidate.city||'城市未填写'}</span>{candidate.years&&<span>{candidate.years}工作经验</span>}</h3><p>◼ {candidate.company||'最近公司未填写'}　{candidate.role||'职位未填写'}　{candidate.skills.slice(0,2).join('｜')||'暂无技能标签'}</p></div>
              <div className="interviewer-candidate-owner"><p>候选人所有者： <b>{job?.ownerName||data.account.contact}</b>　<i>□</i>　<em>♧</em></p><p>推荐状态： <span>◢ {status==='已通过'?'已通过':status==='已拒绝'?'已拒绝':'未推荐'}</span></p></div>
              <div className="interviewer-candidate-note"><p>推荐时间：{formatDate(candidate.updatedAt)}</p><p>最近备注： -</p></div>
            </article>}):<div className="interviewer-empty"><span>⌕</span><b>暂无候选人</b><p>当前筛选条件下没有候选人记录</p></div>}
          </div>
          <footer className="interviewer-pagination"><span>共 {candidates.length} 条</span><button type="button" disabled>‹</button><button type="button" className="active">1</button><button type="button" disabled>›</button><select><option>10条/页</option><option>20条/页</option></select><label>前往 <input defaultValue="1"/> 页</label></footer>
        </section>
      </div>
    </section>
    <button type="button" className="interviewer-wechat" onClick={()=>flash('微信咨询')}>微信</button>
    <div className="interviewer-floating"><button type="button" onClick={()=>flash('在线咨询')}>◉　在线咨询</button><button type="button" onClick={()=>flash('需求反馈')}>✎　需求反馈</button></div>
    {toast&&<div className="interviewer-toast">{toast}</div>}
  </main>;
}

function candidateReviewStatus(stage:string):ReviewStatus {
  if(['初筛淘汰','淘汰人才库','已淘汰'].includes(stage))return '已拒绝';
  if(stage==='待沟通')return '待定';
  if(['待初筛','待复核'].includes(stage))return '待筛选';
  return '已通过';
}

function formatDate(value:string){
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return '-';
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
