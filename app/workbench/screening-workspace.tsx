'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { announceWorkbenchChange, useWorkbenchSync } from '@/app/workbench-sync';
import { CANDIDATE_STAGES, REJECTED_CANDIDATE_STAGES } from '@/app/candidate-stages';

type Person = { id:string; jobId:string|null; name:string; role:string; company:string; years:string; stage:string; source:string; skills:string[]; score:number|null; phone:string; email:string; city:string; createdAt:string; updatedAt:string };
type Job = { id:string; title:string; department:string; city:string; status:string };
type InterviewQuestion = { jobId:string|null; title:string; competency:string; keywords:string };
type Account = { contact:string; phone:string; email:string };
type Profile = { candidateId:string; education:string; major:string; school:string; age:number|null; gender:string; industry:string; expectedSalary:number|null; workYears:number|null; stabilityMonths:number|null; workHistory:string[]; projectHistory:string[]; certificates:string[]; highlights:string[]; risks:string[]; parsingStatus:string; fileName:string; fileType:string; fileSize:number; keywordScore:number|null; experienceScore:number|null; educationScore:number|null; stabilityScore:number|null; matchScore:number|null; matchLevel:string; screenedAt:string|null; updatedAt:string };
type MatchPreview = { score:number; level:string; keywordScore:number; experienceScore:number; educationScore:number; stabilityScore:number; matchedKeywords:string[]; missingKeywords:string[]; highlights:string[]; risks:string[]; summary:string };
type Application = { id:string; candidateId:string; jobId:string|null; channel:string; appliedAt:string; status:string };
type CustomCondition = { id?:string; field:string; operator:string; value:string };
type Rule = { id:string; jobId:string; name:string; logic:string; minEducation:string; majors:string[]; minYears:number|null; certificates:string[]; ageMin:number|null; ageMax:number|null; cities:string[]; salaryMax:number|null; industries:string[]; customConditions:CustomCondition[]; keywords:string[]; keywordWeight:number; experienceWeight:number; educationWeight:number; stabilityWeight:number; updatedAt:string };
type Template = { id:string; name:string; filters:Filters; updatedAt:string };
type Review = { candidateId:string; tags:string[]; comment:string; riskNote:string; rejectReason:string; reviewer:string; updatedAt:string };
type Log = { id:string; candidateId:string|null; jobId:string|null; operatorName:string; action:string; detail:string; createdAt:string };
type HrAccount = { id:string; contact:string; phone:string; email:string; role:'super_admin'|'hr' };
type Assignment = { candidateId:string; hrAccountId:string; hrName:string; hrEmail:string; assignedBy:string; assignedAt:string };
type ScreeningData = { profiles:Profile[]; applications:Application[]; rules:Rule[]; templates:Template[]; reviews:Review[]; logs:Log[]; hrAccounts:HrAccount[]; assignments:Assignment[] };
type Filters = { jobId:string; stage:string; education:string; city:string; source:string; skill:string; keywordMode:string; matchLevel:string; parsingStatus:string; minYears:string; salaryMax:string };
type Props = { people:Person[]; jobs:Job[]; questions:InterviewQuestion[]; account:Account; reload:()=>Promise<void>; openCandidate:(id:string)=>void; openNewJob:()=>void; flash:(text:string)=>void; openImport?:boolean; onImportOpened?:()=>void };

const emptyScreeningData:ScreeningData = { profiles:[], applications:[], rules:[], templates:[], reviews:[], logs:[], hrAccounts:[], assignments:[] };
let screeningDataCache:ScreeningData|null = null;
let screeningDataPromise:Promise<ScreeningData>|null = null;

export async function preloadScreeningData(force=false){
  if(screeningDataCache&&!force)return screeningDataCache;
  if(screeningDataPromise)return screeningDataPromise;
  screeningDataPromise=fetch('/api/screening',{cache:'no-store'}).then(async response=>{
    if(response.status===401)throw new Error('UNAUTHORIZED');
    if(!response.ok)throw new Error('LOAD_FAILED');
    const next=await response.json() as ScreeningData;
    screeningDataCache=next;
    return next;
  }).finally(()=>{screeningDataPromise=null});
  return screeningDataPromise;
}

const emptyFilters:Filters = { jobId:'',stage:'',education:'',city:'',source:'',skill:'',keywordMode:'包含',matchLevel:'',parsingStatus:'结构化完成',minYears:'',salaryMax:'' };
const educationOptions = ['高中','中专','大专','本科','硕士','博士'];
const channels = ['招聘网站投递','内推投递','官网招聘页','邮箱简历导入','手动上传简历','网页表单'];
const poolTabs = [['pool','筛选池'],['intake','解析入库'],['rules','规则配置'],['logs','操作日志']] as const;
const customConditionFields = [
  ['education','学历'],['major','专业'],['workYears','工作年限'],['certificates','职业证书'],['age','年龄'],['city','工作所在地'],
  ['expectedSalary','期望薪资'],['industry','行业背景'],['skills','技能关键词'],['company','最近公司'],['role','应聘职位'],['stabilityMonths','平均任职月数'],
] as const;
const customConditionOperators = [['contains','包含'],['not_contains','不包含'],['equals','等于'],['not_equals','不等于'],['gte','大于等于'],['lte','小于等于']] as const;
const numericCustomFields = new Set(['workYears','age','expectedSalary','stabilityMonths']);
const rejectedCandidateStages = REJECTED_CANDIDATE_STAGES;

export default function ScreeningWorkspace({people,jobs,questions,account,reload,openCandidate,openNewJob,flash,openImport=false,onImportOpened}:Props){
  const [data,setData]=useState<ScreeningData>(screeningDataCache||emptyScreeningData);
  const [hydrated,setHydrated]=useState(Boolean(screeningDataCache));
  const [refreshing,setRefreshing]=useState(!screeningDataCache);
  const [tab,setTab]=useState<(typeof poolTabs)[number][0]>('pool');
  const [filters,setFilters]=useState<Filters>(emptyFilters);
  const [selected,setSelected]=useState<string[]>([]);
  const [detailId,setDetailId]=useState<string|null>(null);
  const [compareIds,setCompareIds]=useState<string[]>([]);
  const [showCompare,setShowCompare]=useState(false);
  const [showImport,setShowImport]=useState(false);
  const [showFilters,setShowFilters]=useState(false);
  const [transition,setTransition]=useState<{ids:string[];stage:string}|null>(null);
  const [assignmentTarget,setAssignmentTarget]=useState<{ids:string[]}|null>(null);
  const [ruleJob,setRuleJob]=useState('');
  const [templateName,setTemplateName]=useState('');
  const [busy,setBusy]=useState(false);
  const [screeningId,setScreeningId]=useState('');
  const [error,setError]=useState('');
  const mutationInFlight=useRef(false);

  async function load(force=true){setRefreshing(true);try{const next=await preloadScreeningData(force);setData(next);setHydrated(true);setError('')}catch(loadError){if(loadError instanceof Error&&loadError.message==='UNAUTHORIZED'){window.location.assign('/');return}setError('简历筛选数据暂时无法加载。')}finally{setRefreshing(false)}}
  useEffect(()=>{let active=true;void preloadScreeningData(Boolean(screeningDataCache)).then(next=>{if(!active)return;setData(next);setHydrated(true);setError('')}).catch(loadError=>{if(!active)return;if(loadError instanceof Error&&loadError.message==='UNAUTHORIZED'){window.location.assign('/');return}setError('简历筛选数据暂时无法加载。')}).finally(()=>{if(active)setRefreshing(false)});return()=>{active=false}},[]);
  useEffect(()=>{if(!openImport)return;setTab('intake');setShowImport(true);onImportOpened?.()},[openImport,onImportOpened]);
  useWorkbenchSync(()=>mutationInFlight.current?undefined:load(true));

  const profileMap=useMemo(()=>new Map((data?.profiles||[]).map(item=>[item.candidateId,item])),[data]);
  const latestApplicationTime=useMemo(()=>{const times=new Map<string,number>();for(const application of data.applications){const timestamp=new Date(application.appliedAt).getTime();if(Number.isNaN(timestamp))continue;const current=times.get(application.candidateId)??0;if(timestamp>current)times.set(application.candidateId,timestamp)}return times},[data.applications]);
  const reviewMap=useMemo(()=>new Map((data?.reviews||[]).map(item=>[item.candidateId,item])),[data]);
  const assignmentMap=useMemo(()=>new Map((data?.assignments||[]).map(item=>[item.candidateId,item])),[data]);
  const rows=useMemo(()=>people.filter(person=>{const profile=profileMap.get(person.id);const keyword=(person.name+person.role+person.company+person.skills.join(' ')+(profile?.workHistory.join(' ')||'')).toLowerCase();const skillMatch=!filters.skill||(filters.keywordMode==='不包含'?!keyword.includes(filters.skill.toLowerCase()):keyword.includes(filters.skill.toLowerCase()));return !rejectedCandidateStages.has(person.stage)&&(!filters.jobId||person.jobId===filters.jobId)&&(!filters.stage||person.stage===filters.stage)&&(!filters.education||profile?.education===filters.education)&&(!filters.city||person.city.includes(filters.city))&&(!filters.source||person.source===filters.source)&&skillMatch&&(!filters.matchLevel||profile?.matchLevel===filters.matchLevel)&&(!filters.parsingStatus||!hydrated||profile?.parsingStatus===filters.parsingStatus)&&(!filters.minYears||(profile?.workYears||0)>=Number(filters.minYears))&&(!filters.salaryMax||!profile?.expectedSalary||profile.expectedSalary<=Number(filters.salaryMax))}).sort((a,b)=>{const uploadedDiff=(latestApplicationTime.get(b.id)??safeTimestamp(b.createdAt))-(latestApplicationTime.get(a.id)??safeTimestamp(a.createdAt));return uploadedDiff||(profileMap.get(b.id)?.matchScore??-1)-(profileMap.get(a.id)?.matchScore??-1)}),[people,profileMap,latestApplicationTime,filters,hydrated]);
  const selectedRule=data?.rules.find(item=>item.jobId===ruleJob);
  const detail=people.find(item=>item.id===detailId)||null;
  const detailProfile=detail?profileMap.get(detail.id):undefined;
  const detailReview=detail?reviewMap.get(detail.id):undefined;
  const sources=[...new Set(people.map(item=>item.source).filter(Boolean))];
  const stages=[...CANDIDATE_STAGES];

  async function post(payload:Record<string,unknown>,success:string,failure='操作失败'){if(mutationInFlight.current)return null;mutationInFlight.current=true;setBusy(true);try{const response=await fetch('/api/screening',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const result=await response.json().catch(()=>({})) as {message?:string;count?:number};if(response.status===401){window.location.assign('/');return null}if(!response.ok){flash(failure);return null}announceWorkbenchChange();await Promise.all([load(true),reload()]);flash(success);return result}catch{flash(failure);return null}finally{mutationInFlight.current=false;setBusy(false)}}
  async function move(ids:string[],stage:string,reason=''){const result=await post({action:'batchTransition',candidateIds:ids,stage,reason},`${ids.length} 份简历已流转至「${stage}」`);if(result){setSelected([]);setTransition(null);setDetailId(null)}}
  async function assignToHr(ids:string[],hrAccountId:string){const hr=data.hrAccounts.find(item=>item.id===hrAccountId);const result=await post({action:'assignToHr',candidateIds:ids,hrAccountId},`已将 ${ids.length} 份简历推荐给 ${hr?.contact||'指定 HR'}`,'推荐失败，请确认该账号仍为 HR');if(result){setSelected([]);setAssignmentTarget(null);setDetailId(null)}}
  function toggle(id:string){setSelected(current=>current.includes(id)?current.filter(item=>item!==id):[...current,id])}
  function toggleAll(){setSelected(selected.length===rows.length?[]:rows.map(item=>item.id))}
  function addCompare(id:string){setCompareIds(current=>{if(current.includes(id))return current.filter(item=>item!==id);if(current.length>=3){flash('最多同时对比 3 份简历');return current}return [...current,id]})}
  async function saveTemplate(){if(!templateName.trim()){flash('请输入模板名称');return}const result=await post({action:'saveTemplate',name:templateName,filters},'保存成功','保存失败');if(result)setTemplateName('')}
  async function rescreen(person:Person){
    setScreeningId(person.id);
    try{await post({action:'rescreenCandidate',candidateId:person.id},`${person.name}的简历已完成岗位匹配、重新筛选及后续流程关联`)}
    finally{setScreeningId('')}
  }
  async function deleteResume(profile:Profile){
    const person=people.find(item=>item.id===profile.candidateId);
    const name=person?.name||'该候选人';
    const confirmed=window.confirm(`确认删除${name}的简历吗？\n\n候选人管理中的对应候选人及其面试、Offer、AI 面试记录也会一并移除，删除后无法恢复。`);
    if(!confirmed)return;
    const result=await post({action:'deleteResume',candidateId:profile.candidateId},`${name}的简历及候选人记录已删除`,'删除失败');
    if(result){
      setSelected(current=>current.filter(id=>id!==profile.candidateId));
      setCompareIds(current=>current.filter(id=>id!==profile.candidateId));
      if(detailId===profile.candidateId)setDetailId(null);
    }
  }

  const pending=people.filter(item=>item.stage==='简历筛选').length;
  const high=data.profiles.filter(item=>item.matchLevel==='高匹配').length;
  const reviewing=people.filter(item=>item.stage==='用人部门筛选').length;
  const rejected=people.filter(item=>['初筛淘汰','淘汰人才库','已淘汰'].includes(item.stage)).length;

  return <section className="rs-shell">
    <div className="subpage-head rs-page-head"><div><p>招聘管理 / 简历筛选</p><h1>简历筛选中心</h1><small>解析入库、规则初筛、人工核验与结果流转使用同一份真实候选人数据</small></div><button className="new-job" onClick={()=>setShowImport(true)}>＋ 导入简历</button></div>
    {(refreshing||error)&&<div className={'rs-sync-note '+(error?'error':'')} role="status"><span>{error||'正在后台同步最新筛选数据，页面可立即操作。'}</span>{error&&<button onClick={()=>void load(true)}>重新加载</button>}</div>}
    <div className="rs-process"><div><i>1</i><span><b>解析入库</b><small>统一汇聚与结构化</small></span></div><em>→</em><div><i>2</i><span><b>自动初筛</b><small>硬性规则与评分</small></span></div><em>→</em><div><i>3</i><span><b>人工精筛</b><small>核验、标注与对比</small></span></div><em>→</em><div><i>4</i><span><b>结果流转</b><small>面试、复核或储备</small></span></div></div>
    <div className="rs-kpis">{[['简历总量',people.length,'全部真实档案'],['简历筛选',pending,'等待筛选与核验'],['高匹配',high,'评分 80 分及以上'],['用人部门筛选',reviewing,'已推荐至指定 HR'],['淘汰沉淀',rejected,'保留候选人档案']].map(item=><article key={String(item[0])}><span>{item[0]}</span><b>{item[1]}</b><small>{item[2]}</small></article>)}</div>
    <div className="rs-tabs">{poolTabs.map(([key,label])=><button key={key} className={tab===key?'active':''} onClick={()=>setTab(key)}>{label}{key==='pool'&&<b>{rows.length}</b>}</button>)}</div>
    {tab==='pool'&&<><div className="rs-pool-layout">
      <div className="rs-list-card"><header className="rs-list-toolbar"><div><label><input type="checkbox" checked={rows.length>0&&selected.length===rows.length} onChange={toggleAll}/> 全选</label><span>找到 <b>{rows.length}</b> 份真实简历</span></div><div><button className="rs-filter-trigger" onClick={()=>setShowFilters(true)}>筛选{activeFilterCount(filters)>0&&<b>{activeFilterCount(filters)}</b>}</button><button disabled={compareIds.length<2} onClick={()=>setShowCompare(true)}>对比简历 {compareIds.length?`(${compareIds.length})`:''}</button></div></header>{selected.length>0&&<div className="rs-batch-bar"><b>已选 {selected.length} 份</b><button onClick={()=>void move(selected,'AI面试')}>进入 AI 面试</button><button onClick={()=>setAssignmentTarget({ids:selected})}>用人部门筛选</button><button className="danger" onClick={()=>setTransition({ids:selected,stage:'已淘汰'})}>批量淘汰</button></div>}<div className="rs-list-head"><span/><span>候选人</span><span>匹配度</span><span>解析与标签</span><span>当前状态</span><span>操作</span></div>{rows.length===0?<div className="rs-empty"><span>▤</span><h3>没有符合条件的简历</h3><p>{people.length?'请调整筛选条件。':'先导入真实简历，结构化完成后才能进入筛选池。'}</p>{!people.length&&<button onClick={()=>setShowImport(true)}>导入第一份简历</button>}</div>:rows.map(person=>{const profile=profileMap.get(person.id);const assignment=assignmentMap.get(person.id);const experience=(profile?.workYears??person.years)||'经验未填写';const isSelected=selected.includes(person.id);return <div className={'rs-person-row '+(isSelected?'selected':'')} key={person.id}><label><input type="checkbox" checked={isSelected} onChange={()=>toggle(person.id)}/></label><div className="rs-person"><span>{person.name.slice(0,1)}</span><div><b>{person.name}<small>{person.role}</small></b><p>{person.company||'最近公司未填写'} · {experience}</p><em>{person.source||'来源未填写'} · {formatDate(person.createdAt)}</em></div></div><div className="rs-score"><strong className={scoreClass(profile?.matchScore)}>{profile?.matchScore??'—'}</strong><span>{profile?.matchLevel||'尚未评分'}</span></div><div className="rs-tags">{profile?.parsingStatus&&profile.parsingStatus!=='结构化完成'&&<span className="warn">{profile.parsingStatus}</span>}{(profile?.highlights||[]).slice(0,2).map(item=><i key={item}>{item}</i>)}{(profile?.risks||[]).slice(0,1).map(item=><i className="risk" key={item}>{item}</i>)}</div><div className="rs-stage"><b>{person.stage}</b><small>{assignment?`已推荐给 ${assignment.hrName} · ${formatDate(assignment.assignedAt)}`:profile?.screenedAt?`筛选于 ${formatDate(profile.screenedAt)}`:'尚未执行简历筛选'}</small></div><div className="rs-actions">{profile?.matchScore===null||profile?.matchScore===undefined?<button className="rescreen" disabled={busy} onClick={()=>void rescreen(person)}>{screeningId===person.id?'筛选中…':'重新筛选'}</button>:null}<button onClick={()=>setDetailId(person.id)}>核验详情</button><button className={compareIds.includes(person.id)?'active':''} onClick={()=>addCompare(person.id)}>{compareIds.includes(person.id)?'移出对比':'加入对比'}</button></div></div>})}</div>
    </div>{showFilters&&<FilterDialog filters={filters} setFilters={setFilters} jobs={jobs} stages={stages} sources={sources} templateName={templateName} setTemplateName={setTemplateName} templates={data.templates} resultCount={rows.length} busy={busy} saveTemplate={()=>void saveTemplate()} close={()=>setShowFilters(false)}/>}</>}
    {tab==='intake'&&<IntakePanel data={data} people={people} jobs={jobs} busy={busy} openImport={()=>setShowImport(true)} confirm={id=>void post({action:'confirmParsing',candidateId:id},'简历解析核验完成，已进入筛选池')} remove={profile=>void deleteResume(profile)}/>}
    {tab==='rules'&&<RulePanel jobs={jobs} questions={questions} ruleJob={ruleJob} setRuleJob={setRuleJob} rule={selectedRule} busy={busy} flash={flash} save={async form=>{const result=await post({action:'saveRule',jobId:ruleJob,...formDataObject(form)},'保存成功','保存失败');return Boolean(result)}} run={()=>void post({action:'runScreening',jobId:ruleJob},'自动初筛已执行并完成评分')}/>}
    {tab==='logs'&&<LogPanel logs={data.logs} people={people} jobs={jobs}/>}
    {showImport&&<ImportModal
      jobs={jobs}
      busy={busy}
      close={()=>setShowImport(false)}
      openNewJob={openNewJob}
      done={async form=>{
        if(mutationInFlight.current)return '简历正在提交，请稍候。';
        mutationInFlight.current=true;setBusy(true);
        try{
          const response=await fetch('/api/screening/import',{method:'POST',body:form});
          const result=await response.json().catch(()=>({})) as {message?:string;duplicate?:boolean;parsingStatus?:string;createdJob?:boolean;matchedJob?:{title:string};match?:MatchPreview};
          if(response.status===401){window.location.assign('/');return '登录状态已失效，请重新登录。'}
          if(!response.ok)return result.message||'简历导入失败，请检查填写内容。';
          announceWorkbenchChange();setShowImport(false);await Promise.all([load(true),reload()]);
          flash(result.duplicate?'检测到重复投递，已合并到现有候选人档案':result.createdJob&&result.matchedJob&&result.match?`已新增岗位「${result.matchedJob.title}」、配置系统初筛规则，并生成 ${result.match.score} 分匹配度`:result.matchedJob&&result.match?`简历已关联「${result.matchedJob.title}」，岗位匹配度 ${result.match.score} 分`:'简历已完成解析入库');
          return null;
        }catch{return '简历导入失败，请检查网络后重试。'}finally{mutationInFlight.current=false;setBusy(false)}
      }}
    />}
    {detail&&<DetailDrawer person={detail} profile={detailProfile} review={detailReview} account={account} busy={busy} close={()=>setDetailId(null)} save={async form=>{const result=await post({action:'saveReview',candidateId:detail.id,...formDataObject(form)},'保存成功','保存失败');if(result)setDetailId(null);return Boolean(result)}} move={(stage)=>stage==='已淘汰'?setTransition({ids:[detail.id],stage}):void move([detail.id],stage)} recommend={()=>setAssignmentTarget({ids:[detail.id]})} openCandidate={()=>{setDetailId(null);openCandidate(detail.id)}}/>}
    {showCompare&&<CompareModal ids={compareIds} people={people} profiles={profileMap} close={()=>setShowCompare(false)}/>}
    {transition&&<RejectDialog count={transition.ids.length} close={()=>setTransition(null)} submit={reason=>void move(transition.ids,transition.stage,reason)}/>}
    {assignmentTarget&&<HrAssignmentDialog count={assignmentTarget.ids.length} accounts={data.hrAccounts} busy={busy} close={()=>setAssignmentTarget(null)} submit={hrAccountId=>void assignToHr(assignmentTarget.ids,hrAccountId)}/>}
  </section>
}

function FilterDialog({filters,setFilters,jobs,stages,sources,templateName,setTemplateName,templates,resultCount,busy,saveTemplate,close}:{filters:Filters;setFilters:(value:Filters)=>void;jobs:Job[];stages:string[];sources:string[];templateName:string;setTemplateName:(value:string)=>void;templates:Template[];resultCount:number;busy:boolean;saveTemplate:()=>void;close:()=>void}){
  return <div className="flow-modal-backdrop rs-filter-backdrop" onMouseDown={close}><aside className="rs-filter-dialog" onMouseDown={event=>event.stopPropagation()}><button className="flow-overlay-close" onClick={close}>×</button><header><span className="eyebrow purple">RESUME FILTER</span><h2>筛选简历</h2><p>组合岗位、状态、学历与履历条件，快速缩小候选人范围。</p></header><div className="rs-filter-fields"><label>关联岗位<select value={filters.jobId} onChange={event=>setFilters({...filters,jobId:event.target.value})}><option value="">全部岗位</option>{jobs.map(job=><option key={job.id} value={job.id}>{job.title}</option>)}</select></label><div className="rs-two"><label>当前状态<select value={filters.stage} onChange={event=>setFilters({...filters,stage:event.target.value})}><option value="">全部状态</option>{stages.map(item=><option key={item}>{item}</option>)}</select></label><label>学历<select value={filters.education} onChange={event=>setFilters({...filters,education:event.target.value})}><option value="">不限</option>{educationOptions.map(item=><option key={item}>{item}</option>)}</select></label></div><div className="rs-two"><label>所在城市<input value={filters.city} onChange={event=>setFilters({...filters,city:event.target.value})} placeholder="例如：上海"/></label><label>简历来源<select value={filters.source} onChange={event=>setFilters({...filters,source:event.target.value})}><option value="">全部渠道</option>{sources.map(item=><option key={item}>{item}</option>)}</select></label></div><label>技能 / 公司 / 履历关键词<div className="rs-inline-input"><select value={filters.keywordMode} onChange={event=>setFilters({...filters,keywordMode:event.target.value})}><option>包含</option><option>不包含</option></select><input value={filters.skill} onChange={event=>setFilters({...filters,skill:event.target.value})} placeholder="输入关键词"/></div></label><div className="rs-two"><label>最低工作年限<input type="number" min="0" value={filters.minYears} onChange={event=>setFilters({...filters,minYears:event.target.value})} placeholder="年"/></label><label>期望薪资上限<input type="number" min="0" value={filters.salaryMax} onChange={event=>setFilters({...filters,salaryMax:event.target.value})} placeholder="元/月"/></label></div><div className="rs-two"><label>匹配等级<select value={filters.matchLevel} onChange={event=>setFilters({...filters,matchLevel:event.target.value})}><option value="">全部</option><option>高匹配</option><option>中匹配</option><option>低匹配</option></select></label><label>解析状态<select value={filters.parsingStatus} onChange={event=>setFilters({...filters,parsingStatus:event.target.value})}><option value="">全部</option><option>结构化完成</option><option>解析待复核</option></select></label></div><div className="rs-template-save"><input value={templateName} onChange={event=>setTemplateName(event.target.value)} placeholder="常用筛选模板名称"/><button disabled={busy} onClick={saveTemplate}>{busy?'保存中…':'保存模板'}</button></div>{templates.length>0&&<div className="rs-template-list">{templates.map(item=><button key={item.id} onClick={()=>setFilters({...emptyFilters,...item.filters})}>{item.name}</button>)}</div>}</div><footer><button className="secondary" onClick={()=>setFilters(emptyFilters)}>重置条件</button><button className="primary" onClick={close}>查看 {resultCount} 份简历</button></footer></aside></div>
}

function activeFilterCount(filters:Filters){return Object.entries(filters).filter(([key,value])=>key==='keywordMode'?value!=='包含':key==='parsingStatus'?value!=='结构化完成':Boolean(value)).length}

function IntakePanel({data,people,jobs,busy,openImport,confirm,remove}:{data:ScreeningData;people:Person[];jobs:Job[];busy:boolean;openImport:()=>void;confirm:(id:string)=>void;remove:(profile:Profile)=>void}){const personMap=new Map(people.map(item=>[item.id,item]));return <div className="rs-intake"><div className="rs-intake-card"><header><div><h3>简历解析与入库记录</h3><p>PDF、Word、图片、文本与网页表单统一沉淀为结构化候选人档案</p></div><button className="new-job" onClick={openImport}>＋ 导入简历</button></header><div className="rs-intake-head"><span>候选人</span><span>关联岗位</span><span>解析状态</span><span>原始附件</span><span>入库时间</span><span>操作</span></div>{data.profiles.length===0?<div className="rs-empty"><span>⇧</span><h3>还没有简历入库记录</h3><p>导入后将进入“简历筛选”，并按手机号和姓名识别重复投递。</p></div>:data.profiles.map(profile=>{const person=personMap.get(profile.candidateId);const app=data.applications.find(item=>item.candidateId===profile.candidateId);const job=jobs.find(item=>item.id===(app?.jobId||person?.jobId));return <div className="rs-intake-row" key={profile.candidateId}><b>{person?.name||'候选人已删除'}<small>{person?.role||'职位未记录'}</small></b><span>{job?.title||'候选人共享'}</span><div className="rs-intake-status"><em className={profile.parsingStatus==='结构化完成'?'ok':'warn'}>{profile.parsingStatus}</em>{profile.parsingStatus!=='结构化完成'&&<button disabled={busy} onClick={()=>confirm(profile.candidateId)}>核验完成</button>}</div><span>{profile.fileName?<a href={`/api/screening/file?candidateId=${profile.candidateId}`} target="_blank" rel="noreferrer">{profile.fileName}</a>:'网页表单 / 无附件'}</span><time>{formatDate(app?.appliedAt||profile.updatedAt)}</time><button className="rs-delete-resume" disabled={busy} onClick={()=>remove(profile)}>删除简历</button></div>})}</div></div>}

type SuggestedRule = Pick<Rule,'name'|'logic'|'minEducation'|'majors'|'minYears'|'certificates'|'ageMin'|'ageMax'|'cities'|'salaryMax'|'industries'|'keywords'|'keywordWeight'|'experienceWeight'|'educationWeight'|'stabilityWeight'>;

function splitKeywords(value:string){
  return value.split(/[，,、；;\n/|]+/).map(item=>item.trim()).filter(Boolean);
}

function uniqueKeywords(values:string[]){
  const seen=new Set<string>();
  return values.filter(value=>{const key=value.toLowerCase();if(!value||seen.has(key))return false;seen.add(key);return true});
}

function questionsForJob(jobId:string,questions:InterviewQuestion[]){
  const matched=questions.filter(item=>item.jobId===jobId);
  return {items:matched.length?matched:questions.filter(item=>!item.jobId),specific:matched.length>0};
}

function interviewKeywords(jobId:string,questions:InterviewQuestion[]){
  const relevant=questionsForJob(jobId,questions);
  return {...relevant,keywords:uniqueKeywords(relevant.items.flatMap(item=>[...splitKeywords(item.keywords),...splitKeywords(item.competency)])).slice(0,30)};
}

function suggestedRuleForJob(job:Job|undefined,questions:InterviewQuestion[]):SuggestedRule{
  const base:SuggestedRule={name:job?`${job.title}初筛规则`:'',logic:'AND',minEducation:'大专',majors:[],minYears:1,certificates:[],ageMin:null,ageMax:null,cities:job?.city&&job.city!=='待设置'?[job.city]:[],salaryMax:null,industries:[],keywords:[],keywordWeight:45,experienceWeight:25,educationWeight:18,stabilityWeight:12};
  if(!job)return base;
  const role=`${job.title} ${job.department}`.toLowerCase();
  let roleKeywords=[job.title,job.department].filter(Boolean);
  if(/前端|frontend|web/.test(role)){base.minEducation='本科';base.majors=['计算机','软件工程'];base.minYears=2;roleKeywords.push('JavaScript','TypeScript','React','Vue','前端工程化')}
  else if(/后端|服务端|java|开发|工程师/.test(role)){base.minEducation='本科';base.majors=['计算机','软件工程'];base.minYears=3;roleKeywords.push('系统设计','数据库','接口开发','性能优化','代码质量')}
  else if(/测试|qa|质量/.test(role)){base.minEducation='本科';base.majors=['计算机','软件工程'];base.minYears=2;roleKeywords.push('测试用例','缺陷管理','自动化测试','接口测试','质量保障')}
  else if(/产品/.test(role)){base.minEducation='本科';base.majors=['产品设计','工商管理'];base.minYears=3;roleKeywords.push('用户研究','需求分析','产品设计','项目推进','数据分析')}
  else if(/采购|供应链/.test(role)){base.minEducation='大专';base.majors=['采购管理','供应链'];base.minYears=3;roleKeywords.push('采购计划','供应商管理','询价比价','成本控制','合同管理')}
  else if(/视觉|设计/.test(role)){base.minEducation='大专';base.majors=['视觉传达','设计'];base.minYears=2;roleKeywords.push('视觉设计','品牌设计','设计规范','创意表达','设计工具')}
  else if(/人事|人力|招聘|hr/.test(role)){base.minEducation='本科';base.majors=['人力资源'];base.minYears=2;roleKeywords.push('招聘管理','人才甄选','沟通协调','劳动法规','员工关系')}
  const fromQuestions=interviewKeywords(job.id,questions).keywords;
  base.keywords=uniqueKeywords([...roleKeywords,...fromQuestions]).slice(0,30);
  return base;
}

function RulePanel({jobs,questions,ruleJob,setRuleJob,rule,busy,flash,save,run}:{jobs:Job[];questions:InterviewQuestion[];ruleJob:string;setRuleJob:(value:string)=>void;rule?:Rule;busy:boolean;flash:(text:string)=>void;save:(form:FormData)=>Promise<boolean>;run:()=>void}){
  const [custom,setCustom]=useState<(CustomCondition&{id:string})[]>([]);
  const [keywordValue,setKeywordValue]=useState('');
  const [keywordNotice,setKeywordNotice]=useState('');
  const job=jobs.find(item=>item.id===ruleJob);
  const questionSignature=questions.map(item=>`${item.jobId||'general'}:${item.keywords}:${item.competency}`).join('|');
  const suggestion=suggestedRuleForJob(job,questions);
  const defaults=rule||suggestion;

  useEffect(()=>setCustom((rule?.customConditions||[]).map(item=>({...item,id:item.id||crypto.randomUUID()}))),[rule?.id,rule?.updatedAt,ruleJob]);
  useEffect(()=>{setKeywordValue((rule?.keywords||suggestion.keywords).join('，'));setKeywordNotice('')},[rule?.id,rule?.updatedAt,ruleJob,questionSignature]);

  function addCondition(){setCustom(current=>[...current,{id:crypto.randomUUID(),field:'skills',operator:'contains',value:''}])}
  function updateCondition(id:string,patch:Partial<CustomCondition>){setCustom(current=>current.map(item=>item.id===id?{...item,...patch}:item))}
  function removeCondition(id:string){setCustom(current=>current.filter(item=>item.id!==id))}
  function generateQuestionKeywords(){
    if(!ruleJob){flash('请先选择适用岗位');return}
    const result=interviewKeywords(ruleJob,questions);
    if(!result.items.length||!result.keywords.length){flash('该岗位和通用题库暂无可提取的评分关键词');return}
    const next=uniqueKeywords([...splitKeywords(keywordValue),...result.keywords]);
    setKeywordValue(next.join('，'));
    setKeywordNotice(`已查找 ${result.items.length} 道${result.specific?'岗位':'通用'}面试题，合并生成 ${result.keywords.length} 个评分关键词。`);
  }

  return <div className="rs-rule-layout">
    <aside className="rs-rule-help"><span>AI</span><h3>规则执行说明</h3><ol><li><b>岗位自动建议</b><p>选择岗位后，系统按岗位类别自动填充学历、经验、专业与核心关键词。</p></li><li><b>自定义条件</b><p>新增的字段、比较方式和值会随规则保存，并参与自动初筛。</p></li><li><b>题库关键词</b><p>可查找岗位面试题；岗位未配置题目时，自动使用通用题目的考察关键词。</p></li><li><b>人工复核</b><p>未触发淘汰的简历进入 AI 面试；完成后可指定 HR 进入用人部门筛选。</p></li></ol></aside>
    <form key={rule?.id||ruleJob||'global'} className="rs-rule-form" onSubmit={event=>{event.preventDefault();void save(new FormData(event.currentTarget))}}>
      <header><div><h3>自动初筛规则</h3><p>选择岗位后自动填充建议规则，也可继续增删自定义条件</p></div><button type="button" className="rs-run" disabled={busy||!ruleJob||!rule} onClick={run}>▶ 执行自动初筛</button></header>
      <label>适用岗位<select value={ruleJob} onChange={event=>setRuleJob(event.target.value)}><option value="">通用规则 / 未关联岗位</option>{jobs.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      {job&&!rule&&<div className="rs-rule-auto-note"><b>已按岗位自动填充</b><span>已为「{job.title}」生成建议规则；所有内容均可修改，保存后即可执行初筛。</span></div>}
      <div className="rs-two"><label>规则名称<input name="name" defaultValue={defaults.name} placeholder="例如：技术岗位规则"/></label><label>硬性条件逻辑<select name="logic" defaultValue={defaults.logic}><option value="AND">且（任一不满足即淘汰）</option><option value="OR">或（全部不满足才淘汰）</option></select></label></div>
      <fieldset><legend>硬性门槛</legend><div className="rs-rule-grid"><label>最低学历<select name="minEducation" defaultValue={defaults.minEducation}><option value="">不限</option>{educationOptions.map(item=><option key={item}>{item}</option>)}</select></label><label>专业范围<input name="majors" defaultValue={defaults.majors.join('，')} placeholder="计算机，软件工程"/></label><label>最低工作年限<input name="minYears" type="number" min="0" step="0.5" defaultValue={defaults.minYears??''}/></label><label>必备职业证书<input name="certificates" defaultValue={defaults.certificates.join('，')} placeholder="PMP，中级工程师"/></label><label>最低年龄<input name="ageMin" type="number" min="16" max="80" defaultValue={defaults.ageMin??''}/></label><label>最高年龄<input name="ageMax" type="number" min="16" max="80" defaultValue={defaults.ageMax??''}/></label><label>工作所在地<input name="cities" defaultValue={defaults.cities.join('，')} placeholder="北京，上海"/></label><label>期望薪资上限<input name="salaryMax" type="number" min="1" defaultValue={defaults.salaryMax??''} placeholder="元/月"/></label><label>行业背景<input name="industries" defaultValue={defaults.industries.join('，')} placeholder="互联网，人工智能"/></label></div><small className="rs-rule-hint">自动建议仅作为初始值；固定条件留空即不启用，也可清空后保存以移除限制。</small></fieldset>
      <fieldset className="rs-custom-rules"><legend>自定义条件</legend><input type="hidden" name="customConditions" value={JSON.stringify(custom.map(({field,operator,value})=>({field,operator,value})))}/><div className="rs-custom-rule-head"><p>按候选人结构化字段自由增减条件，最多可保存 20 项。</p><button type="button" onClick={addCondition}>＋ 新增条件</button></div>{custom.length===0?<div className="rs-custom-empty">暂无自定义条件，点击“新增条件”进行配置。</div>:<div className="rs-custom-rule-list">{custom.map(item=>{const numeric=numericCustomFields.has(item.field);return <div className="rs-custom-rule-row" key={item.id}><select aria-label="条件字段" value={item.field} onChange={event=>{const field=event.target.value;updateCondition(item.id,{field,operator:numericCustomFields.has(field)?'gte':'contains'})}}>{customConditionFields.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><select aria-label="比较方式" value={item.operator} onChange={event=>updateCondition(item.id,{operator:event.target.value})}>{customConditionOperators.filter(([value])=>numeric?['equals','not_equals','gte','lte'].includes(value):!['gte','lte'].includes(value)).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><input aria-label="条件值" type={numeric?'number':'text'} step={item.field==='workYears'?'0.5':'1'} value={item.value} onChange={event=>updateCondition(item.id,{value:event.target.value})} placeholder={numeric?'请输入数值':'请输入匹配内容'} required/><button type="button" className="remove" aria-label="移除此条件" onClick={()=>removeCondition(item.id)}>移除</button></div>})}</div>}</fieldset>
      <fieldset><legend>人岗匹配评分</legend><label><span className="rs-keyword-heading"><span>JD 核心技能 / 工具 / 证书关键词</span><button type="button" onClick={generateQuestionKeywords}>⌕ 从面试题生成关键词</button></span><input name="keywords" value={keywordValue} onChange={event=>{setKeywordValue(event.target.value);setKeywordNotice('')}} placeholder="React，TypeScript，项目管理"/></label>{keywordNotice&&<p className="rs-keyword-note" role="status">{keywordNotice}</p>}<div className="rs-weight-grid">{[['keywordWeight','关键词匹配',defaults.keywordWeight],['experienceWeight','经验相关性',defaults.experienceWeight],['educationWeight','学历背景',defaults.educationWeight],['stabilityWeight','职业稳定性',defaults.stabilityWeight]].map(item=><label key={String(item[0])}>{item[1]}<span><input name={String(item[0])} type="number" min="0" max="100" defaultValue={Number(item[2])}/><i>%</i></span></label>)}</div><p className="rs-weight-note">四项权重之和必须等于 100%</p></fieldset>
      <button className="primary-button" disabled={busy}>{busy?'正在保存…':'保存初筛规则'} <span>→</span></button>
    </form>
  </div>
}

function LogPanel({logs,people,jobs}:{logs:Log[];people:Person[];jobs:Job[]}){return <div className="rs-log-card"><header><div><h3>筛选操作日志</h3><p>状态变更、规则执行、人工标注和流转操作均自动留痕</p></div><span>{logs.length} 条记录</span></header><div className="rs-log-head"><span>时间</span><span>操作人</span><span>候选人 / 岗位</span><span>操作类型</span><span>具体内容</span></div>{logs.length===0?<div className="rs-empty"><span>◷</span><h3>暂无操作记录</h3><p>执行简历入库或筛选后，日志会自动记录。</p></div>:logs.map(log=><div className="rs-log-row" key={log.id}><time>{formatDateTime(log.createdAt)}</time><b>{log.operatorName}</b><span>{people.find(item=>item.id===log.candidateId)?.name||'—'}<small>{jobs.find(item=>item.id===log.jobId)?.title||'未关联岗位'}</small></span><em>{log.action}</em><p>{log.detail}</p></div>)}</div>}

function ImportModal({jobs,busy,close,openNewJob,done}:{jobs:Job[];busy:boolean;close:()=>void;openNewJob:()=>void;done:(form:FormData)=>Promise<string|null>}){
  const [fileName,setFileName]=useState('');
  const [parsing,setParsing]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [matchPreview,setMatchPreview]=useState<MatchPreview|null>(null);
  const [selectedJobId,setSelectedJobId]=useState('');
  const [unmatchedJobTitle,setUnmatchedJobTitle]=useState('');
  const [jobDecision,setJobDecision]=useState<''|'auto'|'manual'>('');

  async function parse(form:HTMLFormElement){
    setParsing(true);setError('');setNotice('');
    const response=await fetch('/api/screening/parse',{method:'POST',body:new FormData(form)});
    const result=await response.json().catch(()=>({})) as {message?:string;recoverable?:boolean;recognized?:number;parsed?:Record<string,string|number|null|string[]>;suggestedJob?:{id:string;title:string;confidence:number;reason:string};match?:MatchPreview;willCreateJob?:boolean};
    setParsing(false);
    if(response.status===401){window.location.assign('/');return}
    if(!response.ok){setMatchPreview(null);setUnmatchedJobTitle('');setJobDecision('');(result.recoverable?setNotice:setError)(result.message||'简历解析失败，请重新选择文件。');return}
    const parsed=result.parsed||{};
    Object.entries(parsed).forEach(([name,value])=>{
      if(value===null||value===''||(Array.isArray(value)&&value.length===0))return;
      const field=form.elements.namedItem(name);
      if(field instanceof HTMLInputElement||field instanceof HTMLSelectElement||field instanceof HTMLTextAreaElement){field.value=Array.isArray(value)?value.join(name.includes('History')?'\n':'，'):String(value)}
    });
    if(result.suggestedJob){
      if(result.willCreateJob){
        setSelectedJobId('');
        setUnmatchedJobTitle(result.suggestedJob.title);
        setJobDecision('');
      }else{
        setSelectedJobId(result.suggestedJob.id);
        setUnmatchedJobTitle('');
        setJobDecision('');
      }
      const roleField=form.elements.namedItem('role');
      if(roleField instanceof HTMLInputElement&&!roleField.value.trim())roleField.value=result.suggestedJob.title;
    }else{
      setUnmatchedJobTitle('');
      setJobDecision('');
    }
    setMatchPreview(result.match||null);
    const parsedRole=typeof parsed.role==='string'?parsed.role:'';
    setNotice(result.suggestedJob&&result.match?result.willCreateJob?`已识别并填充 ${result.recognized||0} 项信息，但未找到匹配职位。请选择自动新建「${result.suggestedJob.title}」，或手动指定现有职位。`:`已识别并填充 ${result.recognized||0} 项信息，关联「${result.suggestedJob.title}」并生成 ${result.match.score} 分匹配度。请确认后提交。`:`已自动识别并回填 ${result.recognized||0} 项信息；${parsedRole?`已保留简历求职职位「${parsedRole}」。`:''}请补充岗位后提交。`);
  }

  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setError('');
    if(unmatchedJobTitle&&!selectedJobId&&jobDecision!=='auto'){
      setError('请选择自动新建识别到的职位，或从职位列表中手动选择投递职位。');
      return;
    }
    const message=await done(new FormData(event.currentTarget));
    if(message)setError(message);
  }

  return <div className="flow-modal-backdrop" onMouseDown={close}><form className="rs-import-modal" onMouseDown={event=>event.stopPropagation()} onSubmit={event=>void submit(event)}><button type="button" className="flow-overlay-close" onClick={close}>×</button><span className="eyebrow purple">RESUME INTAKE</span><h2>简历解析入库</h2><p>上传原始简历或粘贴简历文本，系统会自动识别并回填结构化字段，同时生成该简历对于关联岗位的匹配度。</p><input type="hidden" name="jobResolution" value={jobDecision==='auto'?'auto-create':''}/><label className="rs-upload"><input name="resume" type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp,.txt,.html" onChange={event=>{setFileName(event.target.files?.[0]?.name||'');setMatchPreview(null);setUnmatchedJobTitle('');setJobDecision('');if(event.currentTarget.form)void parse(event.currentTarget.form)}}/><i>{parsing?'…':'⇧'}</i><b>{fileName||'选择 PDF、Word、图片或网页简历'}</b><small>{parsing?'正在读取简历、识别字段并计算岗位匹配度…':'单个附件最大 10MB；PDF、DOCX、TXT 和网页简历可自动回填，图片需 OCR 文本'}</small></label><div className="rs-two"><label>来源渠道<select name="channel" defaultValue="手动上传简历">{channels.map(item=><option key={item}>{item}</option>)}</select></label><label>投递职位<select id="resume-import-job" name="jobId" value={selectedJobId} onChange={event=>{const next=event.target.value;if(next==='__new_job__'){close();openNewJob();return}setSelectedJobId(next);setJobDecision(next?'manual':'');if(event.currentTarget.form&&(fileName||String(new FormData(event.currentTarget.form).get('rawText')||'').trim()))void parse(event.currentTarget.form)}}><option value="">自动识别 / 请选择职位</option>{jobs.map(job=><option key={job.id} value={job.id}>{job.title}</option>)}<option value="__new_job__">＋ 新增职位</option></select></label></div>{unmatchedJobTitle&&<section className="rs-job-decision" aria-labelledby="resume-job-decision-title"><div><span>未找到匹配职位</span><h3 id="resume-job-decision-title">是否自动新建「{unmatchedJobTitle}」？</h3><p>自动新建会同步配置系统初筛规则；也可以手动选择简历实际投递的现有职位。</p></div><div className="rs-job-decision-actions"><button type="button" className={jobDecision==='auto'?'active':''} onClick={()=>{setSelectedJobId('');setJobDecision('auto');setError('')}}>＋ 自动新建职位</button><button type="button" className={jobDecision==='manual'?'active secondary':'secondary'} onClick={()=>{setJobDecision('manual');setError('');document.getElementById('resume-import-job')?.focus()}}>手动选择职位</button></div>{jobDecision==='manual'&&!selectedJobId&&<small>请在上方“投递职位”中选择一个现有职位。</small>}</section>}{matchPreview&&<div className="rs-match-preview"><div className="rs-match-score"><strong>{matchPreview.score}</strong><span>{matchPreview.level}</span></div><div><b>岗位匹配分析</b><p>{matchPreview.summary}</p><div className="rs-match-dimensions"><span>关键词 <b>{matchPreview.keywordScore}</b></span><span>经验 <b>{matchPreview.experienceScore}</b></span><span>学历 <b>{matchPreview.educationScore}</b></span><span>稳定性 <b>{matchPreview.stabilityScore}</b></span></div>{matchPreview.matchedKeywords.length>0&&<small>已匹配：{matchPreview.matchedKeywords.join('、')}</small>}</div></div>}<div className="rs-two"><label>姓名<input name="name" placeholder="可由简历自动识别"/></label><label>应聘职位<input name="role" placeholder="自动识别或使用关联岗位名称"/></label></div><div className="rs-three"><label>手机号<input name="phone" type="tel" placeholder="用于姓名 + 手机号去重"/></label><label>邮箱<input name="email" type="email"/></label><label>年龄<input name="age" type="number" min="16" max="80"/></label></div><div className="rs-three"><label>学历<select name="education" defaultValue=""><option value="">待识别</option>{educationOptions.map(item=><option key={item}>{item}</option>)}</select></label><label>专业<input name="major"/></label><label>毕业院校<input name="school"/></label></div><div className="rs-three"><label>工作年限<input name="workYears" type="number" min="0" step="0.5"/></label><label>平均任职月数<input name="stabilityMonths" type="number" min="1"/></label><label>期望月薪<input name="expectedSalary" type="number" min="1"/></label></div><div className="rs-three"><label>最近公司<input name="company"/></label><label>所在城市<input name="city"/></label><label>行业背景<input name="industry"/></label></div><div className="rs-two"><label>技能关键词<input name="skills" placeholder="多个请用逗号分隔"/></label><label>证书<input name="certificates" placeholder="多个请用逗号分隔"/></label></div><label>工作经历<textarea name="workHistory" placeholder="每段经历一行：公司 / 岗位 / 时长 / 职责"/></label><label>项目经验<textarea name="projectHistory" placeholder="每个项目一行"/></label><details><summary>粘贴可解析的简历原文</summary><textarea name="rawText" placeholder="粘贴 TXT、网页或 OCR 文本，失焦后会自动识别并回填" onBlur={event=>{if(event.currentTarget.value.trim()&&event.currentTarget.form)void parse(event.currentTarget.form)}}/><button type="button" className="rs-parse-button" disabled={parsing} onClick={event=>{const form=event.currentTarget.form;if(form)void parse(form)}}>{parsing?'正在智能识别…':'智能识别、回填并分析岗位匹配度'}</button></details>{error&&<div className="rs-import-feedback error" role="alert"><b>无法导入简历</b><span>{error}</span></div>}{notice&&<div className="rs-import-feedback notice" role="status"><b>解析提示</b><span>{notice}</span></div>}<button className="primary-button" disabled={busy||parsing}>{busy?'正在解析入库…':'解析并进入筛选池'} <span>→</span></button></form></div>}

function DetailDrawer({person,profile,review,account,busy,close,save,move,recommend,openCandidate}:{person:Person;profile?:Profile;review?:Review;account:Account;busy:boolean;close:()=>void;save:(form:FormData)=>Promise<boolean>;move:(stage:string)=>void;recommend:()=>void;openCandidate:()=>void}){return <div className="flow-detail-backdrop" onMouseDown={close}><aside className="rs-detail" onMouseDown={event=>event.stopPropagation()}><button className="flow-overlay-close" onClick={close}>×</button><header><span>{person.name.slice(0,1)}</span><div><h2>{person.name}</h2><p>{person.role} · {person.company||'最近公司未填写'}</p><small>{person.phone||'手机号未填写'}　{person.email||'邮箱未填写'}</small></div><div className="rs-detail-score"><b>{profile?.matchScore??'—'}</b><span>{profile?.matchLevel||'尚未评分'}</span></div></header><div className="rs-detail-actions"><button onClick={()=>move('AI面试')}>进入 AI 面试</button><button onClick={recommend}>用人部门筛选</button><button onClick={()=>move('安排面试')}>安排面试</button><button className="danger" onClick={()=>move('已淘汰')}>淘汰</button></div><section><div className="rs-section-title"><h3>结构化简历</h3><div>{profile?.fileName&&<a href={`/api/screening/file?candidateId=${person.id}`} target="_blank" rel="noreferrer">查看原始简历 ↗</a>}<button onClick={openCandidate}>人才档案</button></div></div><div className="rs-profile-grid">{[['学历',profile?.education],['专业',profile?.major],['毕业院校',profile?.school],['年龄',profile?.age],['工作年限',profile?.workYears!=null?`${profile.workYears} 年`:null],['所在城市',person.city],['行业背景',profile?.industry],['期望薪资',profile?.expectedSalary?`${profile.expectedSalary} 元/月`:null],['职业稳定性',formatStability(profile?.stabilityMonths)]].map(item=><p key={String(item[0])}><span>{item[0]}</span><b>{item[1]||'未识别'}</b></p>)}</div></section><section><h3>匹配度拆解</h3><div className="rs-dimension-grid">{[['关键词',profile?.keywordScore],['经验相关性',profile?.experienceScore],['学历背景',profile?.educationScore],['职业稳定性',profile?.stabilityScore]].map(item=><div key={String(item[0])}><span>{item[0]}<b>{item[1]??'—'}</b></span><i><em style={{width:`${item[1]??0}%`}}/></i></div>)}</div><div className="rs-tag-groups"><div><b>亮点标签</b>{profile?.highlights.length?profile.highlights.map(item=><span key={item}>{item}</span>):<small>暂无自动识别亮点</small>}</div><div className="risk"><b>风险标签</b>{profile?.risks.length?profile.risks.map(item=><span key={item}>{item}</span>):<small>暂无自动识别风险</small>}</div></div></section><section><h3>履历核验</h3><div className="rs-history"><article><b>工作经历</b>{profile?.workHistory.length?profile.workHistory.map(item=><p key={item}>{item}</p>):<p>未录入工作经历</p>}</article><article><b>项目经验</b>{profile?.projectHistory.length?profile.projectHistory.map(item=><p key={item}>{item}</p>):<p>未录入项目经验</p>}</article><article><b>技能/证书</b><div>{person.skills.map(item=><i key={item}>{item}</i>)}{profile?.certificates.map(item=><i key={item}>{item}</i>)}</div></article></div></section><form key={review?.updatedAt||person.id} className="rs-review-form" onSubmit={event=>{event.preventDefault();void save(new FormData(event.currentTarget))}}><h3>人工标注与评语</h3><label>自定义标签<input name="tags" defaultValue={review?.tags.join('，')||''} placeholder="多个标签请用逗号分隔"/></label><label>筛选评语<textarea name="comment" defaultValue={review?.comment||''} placeholder="记录核验结论与推荐理由"/></label><label>风险备注<textarea name="riskNote" defaultValue={review?.riskNote||''} placeholder="记录需要用人经理重点关注的风险"/></label><input type="hidden" name="rejectReason" value={review?.rejectReason||''}/><footer><small>最后核验人：{review?.reviewer||account.contact}</small><button disabled={busy}>{busy?'保存中…':'保存人工标注'}</button></footer></form></aside></div>}

function CompareModal({ids,people,profiles,close}:{ids:string[];people:Person[];profiles:Map<string,Profile>;close:()=>void}){const items=ids.map(id=>people.find(item=>item.id===id)).filter(Boolean) as Person[];const rows=[['应聘职位',(p:Person)=>p.role],['学历',(p:Person)=>profiles.get(p.id)?.education||'未识别'],['专业',(p:Person)=>profiles.get(p.id)?.major||'未识别'],['毕业院校',(p:Person)=>profiles.get(p.id)?.school||'未识别'],['工作年限',(p:Person)=>profiles.get(p.id)?.workYears===null?'未识别':`${profiles.get(p.id)?.workYears??'未识别'} 年`],['最近公司',(p:Person)=>p.company||'未填写'],['核心技能',(p:Person)=>p.skills.join('、')||'未填写'],['匹配总分',(p:Person)=>profiles.get(p.id)?.matchScore??'—'],['匹配等级',(p:Person)=>profiles.get(p.id)?.matchLevel||'尚未评分'],['风险标签',(p:Person)=>profiles.get(p.id)?.risks.join('、')||'暂无'] ] as [string,(person:Person)=>string|number][];return <div className="flow-modal-backdrop" onMouseDown={close}><div className="rs-compare" onMouseDown={event=>event.stopPropagation()}><button className="flow-overlay-close" onClick={close}>×</button><span className="eyebrow purple">RESUME COMPARE</span><h2>候选人简历对比</h2><p>最多 3 份结构化简历并排核验</p><div className="rs-compare-grid" style={{gridTemplateColumns:`150px repeat(${items.length},minmax(190px,1fr))`}}><b>对比维度</b>{items.map(item=><header key={item.id}><span>{item.name.slice(0,1)}</span><div><b>{item.name}</b><small>{item.role}</small></div></header>)}{rows.flatMap(([label,get])=>[<strong key={`${label}-label`}>{label}</strong>,...items.map(item=><span key={`${label}-${item.id}`}>{get(item)}</span>)])}</div></div></div>}

function RejectDialog({count,close,submit}:{count:number;close:()=>void;submit:(reason:string)=>void}){const [reason,setReason]=useState('');return <div className="flow-modal-backdrop" onMouseDown={close}><div className="rs-reject-dialog" onMouseDown={event=>event.stopPropagation()}><button className="flow-overlay-close" onClick={close}>×</button><span className="eyebrow purple">REJECTION REASON</span><h2>确认淘汰 {count} 份简历</h2><p>淘汰原因将写入候选人档案和操作日志，后续可在人才储备库复用。</p><label>淘汰原因<textarea autoFocus value={reason} onChange={event=>setReason(event.target.value)} placeholder="例如：学历不符、经验不足、薪资不匹配"/></label><button className="primary-button" disabled={!reason.trim()} onClick={()=>submit(reason.trim())}>确认淘汰并沉淀人才库 <span>→</span></button></div></div>}

function HrAssignmentDialog({count,accounts,busy,close,submit}:{count:number;accounts:HrAccount[];busy:boolean;close:()=>void;submit:(hrAccountId:string)=>void}){
  const [selectedId,setSelectedId]=useState('');
  return <div className="flow-modal-backdrop" onMouseDown={close}><div className="rs-assignment-dialog" onMouseDown={event=>event.stopPropagation()}><button className="flow-overlay-close" onClick={close}>×</button><span className="eyebrow purple">HIRING DEPARTMENT REVIEW</span><h2>推荐至用人部门</h2><p>为 {count} 份简历指定接收人。确认后，候选人进入“用人部门筛选”，所选超级管理员或 HR 可在自己的系统中立即查看并处理。</p>{accounts.length?<div className="rs-hr-account-list" role="radiogroup" aria-label="选择简历接收人">{accounts.map(hr=><label key={hr.id} className={selectedId===hr.id?'selected':''}><input type="radio" name="hrAccount" value={hr.id} checked={selectedId===hr.id} onChange={()=>setSelectedId(hr.id)}/><span>{hr.contact.slice(0,1)}</span><div><b>{hr.contact}</b><small>{hr.email||hr.phone||'未填写联系方式'}</small></div><em>{selectedId===hr.id?'已选择':hr.role==='super_admin'?'管理员':'HR'}</em></label>)}</div>:<div className="rs-assignment-empty"><b>暂无可选接收人</b><p>请先在“角色管理”中新增超级管理员或 HR。</p></div>}<button className="primary-button" disabled={busy||!selectedId} onClick={()=>submit(selectedId)}>{busy?'正在同步…':'确认推送给接收人'} <span>→</span></button></div></div>;
}

function formDataObject(form:FormData){const result:Record<string,unknown>={};form.forEach((value,key)=>{result[key]=value});return result}
function formatStability(months:number|null|undefined){if(months===null||months===undefined)return null;if(months<12)return `平均 ${months} 个月`;const years=Math.floor(months/12);const remainder=Math.round(months%12);return remainder?`平均 ${years} 年 ${remainder} 个月`:`平均 ${years} 年`}
function scoreClass(score:number|null|undefined){return score===null||score===undefined?'':score>=80?'high':score>=60?'mid':'low'}
function formatDate(value:string){const date=new Date(value);return Number.isNaN(date.getTime())?'未记录':new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit'}).format(date)}
function formatDateTime(value:string){const date=new Date(value);return Number.isNaN(date.getTime())?'未记录':new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(date)}
function safeTimestamp(value:string){const timestamp=new Date(value).getTime();return Number.isNaN(timestamp)?0:timestamp}
