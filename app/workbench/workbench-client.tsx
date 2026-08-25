'use client';

import { useEffect, useMemo, useState } from 'react';

type Job = { id:number; title:string; dept:string; city:string; status:string; resumes:number; process:number; interviews:number; owner:string };
type Candidate = { id:number; name:string; avatar:string; role:string; company:string; years:string; stage:string; score:number; source:string; skills:string[] };
type Interview = { id:number; time:string; date:string; name:string; role:string; round:string; mode:string; interviewer:string; status:string };

const nav = [['⌂','工作台'],['▣','职位管理'],['♙','人才库'],['▤','简历筛选'],['◉','AI 面试'],['◴','面试管理'],['✓','Offer 管理'],['↗','招聘数据']];
const stages = ['AI 初筛','待沟通','一面','技术面','二面','Offer'];
const seedJobs:Job[] = [
  {id:1,title:'高级产品经理',dept:'产品中心',city:'北京',status:'招聘中',resumes:18,process:26,interviews:5,owner:'林嘉怡'},
  {id:2,title:'大模型算法工程师',dept:'AI 实验室',city:'上海',status:'急聘',resumes:32,process:41,interviews:8,owner:'陈昊'},
  {id:3,title:'海外市场负责人',dept:'市场部',city:'深圳',status:'招聘中',resumes:9,process:17,interviews:3,owner:'林嘉怡'},
  {id:4,title:'资深 UI/UX 设计师',dept:'设计中心',city:'杭州',status:'招聘中',resumes:14,process:22,interviews:4,owner:'王思敏'},
];
const seedCandidates:Candidate[] = [
  {id:1,name:'周思远',avatar:'周',role:'高级产品经理',company:'字节跳动',years:'7 年',stage:'二面',score:94,source:'Boss 直聘',skills:['B 端产品','增长策略','团队管理']},
  {id:2,name:'陈子航',avatar:'陈',role:'大模型算法工程师',company:'商汤科技',years:'5 年',stage:'技术面',score:92,source:'技术社区',skills:['LLM','PyTorch','RAG']},
  {id:3,name:'许清禾',avatar:'许',role:'资深 UI/UX 设计师',company:'网易',years:'6 年',stage:'待沟通',score:89,source:'内部推荐',skills:['设计系统','用户研究','Figma']},
  {id:4,name:'沈嘉树',avatar:'沈',role:'海外市场负责人',company:'SHEIN',years:'8 年',stage:'一面',score:87,source:'LinkedIn',skills:['北美市场','品牌增长','英语']},
  {id:5,name:'唐雨桐',avatar:'唐',role:'高级产品经理',company:'美团',years:'5 年',stage:'AI 初筛',score:85,source:'猎头推荐',skills:['商业化','数据分析','SaaS']},
];
type FlowCandidate = { id:number; name:string; badge:number; age:string; experience?:string; school:string; education:string; period:string; owner:string; recommend:string; city:string; phone:string; email:string; tags:string[] };
const flowCandidates:FlowCandidate[] = [
  {id:101,name:'尹心仪',badge:2,age:'22',experience:'1年工作经验',school:'山东大学',education:'工商',period:'2023-09-2025-11',owner:'朱千林',recommend:'未推荐',city:'山东省潍坊市',phone:'176 0000 4821',email:'yinxinyi@example.com',tags:['应届生','沟通能力','人力资源']},
  {id:102,name:'丁启朔',badge:3,age:'23',school:'山东大学',education:'本科｜人力资本管理',period:'2022-09-2025-11',owner:'朱千林',recommend:'未推荐',city:'山东省济南市',phone:'185 0000 2196',email:'dingqishuo@example.com',tags:['校招','组织发展','数据分析']},
  {id:103,name:'徐航雨',badge:3,age:'23',experience:'4年工作经验',school:'四川万泓源人力资源服务有限公司',education:'人事专员',period:'2024-07-2024-08',owner:'朱千林',recommend:'未推荐',city:'四川省成都市',phone:'133 0000 6752',email:'xuhangyu@example.com',tags:['招聘实务','员工关系','执行力']},
  {id:104,name:'王子涵',badge:2,age:'21',school:'山东财经大学',education:'本科｜人力资源管理',period:'2022-09-2026-06',owner:'朱千林',recommend:'未推荐',city:'山东省青岛市',phone:'156 0000 8034',email:'wangzihan@example.com',tags:['实习生','学习能力','校园活动']},
];
const seedInterviews:Interview[] = [
  {id:1,time:'10:00',date:'08-23',name:'周思远',role:'高级产品经理',round:'业务二面',mode:'腾讯会议',interviewer:'赵明 / 林嘉怡',status:'待开始'},
  {id:2,time:'14:30',date:'08-23',name:'陈子航',role:'大模型算法工程师',round:'技术面试',mode:'会议室 A3',interviewer:'陈昊 / 孙文',status:'待开始'},
  {id:3,time:'16:00',date:'08-23',name:'沈嘉树',role:'海外市场负责人',round:'业务一面',mode:'飞书会议',interviewer:'林嘉怡',status:'待开始'},
  {id:4,time:'11:00',date:'08-24',name:'许清禾',role:'资深 UI/UX 设计师',round:'作品集评审',mode:'会议室 B2',interviewer:'王思敏',status:'已确认'},
];
const offers = [
  ['罗一辰','前端开发工程师','28K × 15','林嘉怡','待审批','08-25'],
  ['孟知夏','商业分析师','24K × 14','王思敏','已发放','08-27'],
  ['苏景明','产品运营','20K × 14','林嘉怡','已接受','09-02'],
];

export default function WorkbenchClient() {
  const [active,setActive]=useState('工作台');
  const [search,setSearch]=useState('');
  const [jobs,setJobs]=useState<Job[]>(seedJobs);
  const [candidates,setCandidates]=useState<Candidate[]>(seedCandidates);
  const [interviews,setInterviews]=useState<Interview[]>(seedInterviews);
  const [modal,setModal]=useState<'job'|'interview'|null>(null);
  const [drawer,setDrawer]=useState<Job|Candidate|null>(null);
  const [notice,setNotice]=useState(false);
  const [toast,setToast]=useState('');
  const [loaded,setLoaded]=useState(false);

  useEffect(()=>{try{const j=localStorage.getItem('dexian-jobs');const c=localStorage.getItem('dexian-candidates');if(j)setJobs(JSON.parse(j));if(c)setCandidates(JSON.parse(c))}catch{}setLoaded(true)},[]);
  useEffect(()=>{if(loaded)localStorage.setItem('dexian-jobs',JSON.stringify(jobs))},[jobs,loaded]);
  useEffect(()=>{if(loaded)localStorage.setItem('dexian-candidates',JSON.stringify(candidates))},[candidates,loaded]);
  useEffect(()=>{
    if(active!=='工作台')return;
    const cards=Array.from(document.querySelectorAll<HTMLElement>('.kpi-grid article')).slice(0,4);
    const routes=['职位管理','人才库','简历筛选','Offer 管理'];
    const cleanups=cards.map((card,index)=>{
      const open=()=>setActive(routes[index]);
      const key=(event:KeyboardEvent)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();open()}};
      card.classList.add('clickable');card.tabIndex=0;card.setAttribute('role','button');
      card.addEventListener('click',open);card.addEventListener('keydown',key);
      return()=>{card.removeEventListener('click',open);card.removeEventListener('keydown',key)};
    });
    return()=>cleanups.forEach(cleanup=>cleanup());
  },[active]);

  const filteredJobs=useMemo(()=>jobs.filter(j=>(j.title+j.dept+j.city).includes(search)),[jobs,search]);
  const filteredPeople=useMemo(()=>candidates.filter(c=>(c.name+c.role+c.company+c.skills.join('')).includes(search)),[candidates,search]);
  const flash=(text:string)=>{setToast(text);window.setTimeout(()=>setToast(''),2200)};
  const referenceMode=active==='简历筛选'||active==='AI 面试';

  function createJob(data:FormData){const item:Job={id:Date.now(),title:String(data.get('title')),dept:String(data.get('dept')),city:String(data.get('city')||'待设置'),status:'草稿',resumes:0,process:0,interviews:0,owner:'林嘉怡'};setJobs([item,...jobs]);setModal(null);setActive('职位管理');flash('职位草稿已创建并保存')}
  function createInterview(data:FormData){const name=String(data.get('candidate'));const role=candidates.find(c=>c.name===name)?.role||'待确认职位';setInterviews([...interviews,{id:Date.now(),time:String(data.get('time')),date:'08-25',name,role,round:String(data.get('round')),mode:String(data.get('mode')),interviewer:'林嘉怡',status:'待确认'}]);setModal(null);setActive('面试管理');flash('面试邀请已安排')}
  function advance(person:Candidate){const next=stages[Math.min(stages.indexOf(person.stage)+1,stages.length-1)];const updated={...person,stage:next};setCandidates(candidates.map(c=>c.id===person.id?updated:c));setDrawer(updated);flash('候选人已推进至「'+next+'」')}

  return <main className="dashboard-shell">
    <aside className="dashboard-sidebar"><a className="dash-logo" href="/workbench"><span>得</span><b>得贤招聘官</b></a><nav><p>招聘管理</p>{nav.map(([icon,label])=><button key={label} className={active===label?'active':''} onClick={()=>{setActive(label);setSearch('')}}><i>{icon}</i><span>{label}</span>{label==='AI 面试'&&<em>AI</em>}</button>)}<p>协作与设置</p><button onClick={()=>flash('团队协作将在下一版接入')}><i>♧</i><span>团队协作</span></button><button onClick={()=>flash('企业设置将在下一版接入')}><i>⚙</i><span>企业设置</span></button></nav><div className="sidebar-help"><b>招聘小助手</b><p>有问题？随时找我</p><button onClick={()=>flash('智能助手已为你开启')}>立即咨询</button></div><a className="back-login" href="/">← 退出演示</a></aside>
    <section className="dashboard-main"><header className="dashboard-header"><div className="global-search"><span>⌕</span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜索职位、候选人或面试..." /><kbd>⌘ K</kbd></div><div className="header-tools"><button className="round-button" onClick={()=>setNotice(!notice)}>♧<b>3</b></button><button className="round-button" onClick={()=>flash('帮助中心已打开')}>?</button><div className="user-info"><span>林</span><div><b>林嘉怡</b><small>企业管理员</small></div><i>⌄</i></div>{notice&&<div className="notice-pop"><b>最新通知</b><p>你有 3 份新简历待处理</p><p>下午 14:30 有一场技术面试</p><p>AI 已完成 28 份简历初筛</p></div>}</div></header>
      <div className="dashboard-content">
        {active==='工作台'&&<Home jobs={filteredJobs} go={setActive} newJob={()=>setModal('job')}/>}
        {active==='职位管理'&&<Jobs jobs={filteredJobs} onNew={()=>setModal('job')} onPick={setDrawer}/>}
        {active==='人才库'&&<Talent people={filteredPeople} onPick={setDrawer}/>}
        {referenceMode&&<CandidateFlow mode={active as '简历筛选'|'AI 面试'} go={setActive} flash={flash}/>}
        {active==='面试管理'&&<Interviews items={interviews} onNew={()=>setModal('interview')} flash={flash}/>}
        {active==='Offer 管理'&&<Offers flash={flash}/>}
        {active==='招聘数据'&&<Analytics/>}
      </div>
    </section>
    {modal==='job'&&<JobModal close={()=>setModal(null)} submit={createJob}/>}
    {modal==='interview'&&<InterviewModal people={candidates} close={()=>setModal(null)} submit={createInterview}/>}
    {drawer&&('score' in drawer?<CandidateDrawer person={drawer} close={()=>setDrawer(null)} advance={()=>advance(drawer)}/>:<JobDrawer job={drawer} close={()=>setDrawer(null)} flash={flash}/>)}
    {toast&&<div className="dashboard-toast">✓ {toast}</div>}
  </main>
}

function Head({path,title,sub,action,click}:{path:string;title:string;sub:string;action?:string;click?:()=>void}){return <div className="subpage-head"><div><p>招聘管理 / {path}</p><h1>{title}</h1><small>{sub}</small></div>{action&&<button className="new-job" onClick={click}>＋ {action}</button>}</div>}

function Home({jobs,go,newJob}:{jobs:Job[];go:(v:string)=>void;newJob:()=>void}){return <><section className="welcome-row"><div><p>2026 年 8 月 23 日 · 星期日</p><h1>上午好，林嘉怡 <span>👋</span></h1><small>今天有 <b>6 项</b> 招聘任务等待你处理，继续保持高效。</small></div><button className="new-job" onClick={newJob}>＋ 发布新职位</button></section><section className="kpi-grid">{[['▣','招聘中职位','12','全部职位 18 个','purple-bg'],['♙','本月新增候选人','286','其中 AI 推荐 96 人','blue-bg'],['◴','待处理事项','43','简历 28 · 面试 15','orange-bg'],['✓','本月已入职','8','月度目标 11 人','green-bg']].map(k=><article key={k[1]}><div className={'kpi-icon '+k[4]}>{k[0]}</div><span>{k[1]}<em>环比 +18.6%</em></span><strong>{k[2]}</strong><small>{k[3]}</small></article>)}</section><section className="dashboard-grid"><article className="panel job-panel"><div className="panel-title"><div><h3>重点职位进展</h3><p>实时关注核心岗位招聘动态</p></div><button onClick={()=>go('职位管理')}>查看全部 →</button></div><div className="job-head"><span>职位名称</span><span>新增简历</span><span>流程中</span><span>待面试</span><span>状态</span></div>{jobs.slice(0,4).map((j,i)=><div className="job-row" key={j.id}><div><b>{j.title}</b><small>{j.dept} · {j.city}</small></div><span><i className={'job-dot dot-'+i}/>{j.resumes}</span><span>{j.process}</span><span>{j.interviews}</span><em className={j.status==='急聘'?'urgent':''}>{j.status}</em></div>)}</article><aside className="panel today-panel"><div className="panel-title"><div><h3>今日安排</h3><p>8 月 23 日</p></div></div>{[['10:00','产品经理二面','周思远'],['14:30','算法工程师技术面','陈子航'],['16:00','招聘周会','招聘项目组']].map((r,i)=><div className="schedule-item" key={r[0]}><time>{r[0]}</time><div className={'schedule-line '+(i===1?'orange-line':i===2?'green-line':'purple-line')}><b>{r[1]}</b><p>{r[2]}</p><span>视频 / 会议室 · 45 分钟</span></div></div>)}</aside><article className="panel funnel-panel"><div className="panel-title"><div><h3>招聘漏斗</h3><p>近 30 天候选人转化</p></div></div><div className="funnel-bars">{[['收到简历','100%','1,284'],['AI 初筛通过','72%','926'],['进入面试','39%','504'],['发放 Offer','14%','176'],['成功入职','8%','103']].map(r=><div key={r[0]}><span>{r[0]}</span><i style={{width:r[1]}}/><b>{r[2]}</b></div>)}</div></article><aside className="ai-panel"><div><span>✦</span><b>AI 招聘洞察</b><em>实时</em></div><h3>大模型算法工程师<br/>本周简历质量提升 23%</h3><p>建议优先查看来自「技术社区」渠道的 8 位高匹配候选人。</p><button onClick={()=>go('简历筛选')}>查看 AI 推荐 →</button></aside></section></>}

function Jobs({jobs,onNew,onPick}:{jobs:Job[];onNew:()=>void;onPick:(j:Job)=>void}){return <section><Head path="职位管理" title="职位管理" sub="创建职位并跟踪各渠道的招聘进展" action="发布新职位" click={onNew}/><div className="summary-strip"><span><b>{jobs.length}</b> 全部职位</span><span><b>12</b> 招聘中</span><span><b>3</b> 草稿</span><span><b>2</b> 已暂停</span></div><div className="sub-toolbar"><div className="tab-set"><button className="active">全部</button><button>招聘中</button><button>急聘</button><button>草稿</button></div><div className="filter-box"><button>筛选</button><button>批量操作</button></div></div><div className="management-table"><div className="manage-head"><span>职位名称</span><span>状态</span><span>候选人</span><span>面试</span><span>负责人</span><span>操作</span></div>{jobs.map(j=><div className="manage-row" key={j.id}><div><b>{j.title}</b><small>{j.dept} · {j.city}</small></div><em className={j.status==='急聘'?'urgent':''}>{j.status}</em><span>{j.resumes+j.process} 人</span><span>{j.interviews} 场</span><span>{j.owner}</span><button onClick={()=>onPick(j)}>查看详情</button></div>)}</div></section>}

function Talent({people,onPick}:{people:Candidate[];onPick:(p:Candidate)=>void}){return <section><Head path="人才库" title="企业人才库" sub="集中沉淀、标签化管理所有候选人" action="添加候选人"/><div className="talent-tabs">{stages.map((s,i)=><button className={i===0?'active':''} key={s}>{s}<b>{people.filter(p=>p.stage===s).length}</b></button>)}</div><div className="candidate-grid">{people.map(p=><button className="candidate-card" key={p.id} onClick={()=>onPick(p)}><div className="candidate-top"><span>{p.avatar}</span><div><b>{p.name}</b><small>{p.company} · {p.years}</small></div><em>{p.score}%</em></div><h3>{p.role}</h3><div className="skill-row">{p.skills.map(s=><i key={s}>{s}</i>)}</div><footer><span>{p.stage}</span><small>来自 {p.source}</small><b>查看档案 →</b></footer></button>)}</div></section>}

function CandidateFlow({mode,go,flash}:{mode:'简历筛选'|'AI 面试';go:(v:string)=>void;flash:(s:string)=>void}){
  const [selected,setSelected]=useState<number[]>([]);
  const [invited,setInvited]=useState<number[]>([]);
  const [keyword,setKeyword]=useState('');
  const [communication,setCommunication]=useState<number[]>([]);
  const [communicationFilter,setCommunicationFilter]=useState('全部');
  const [aiFilter,setAiFilter]=useState('全部');
  const [inviteIds,setInviteIds]=useState<number[]|null>(null);
  const [detail,setDetail]=useState<FlowCandidate|null>(null);
  const [detailTab,setDetailTab]=useState<'resume'|'ai'>('resume');
  const [candidateStages,setCandidateStages]=useState<Record<number,string>>({});
  const [flowLoaded,setFlowLoaded]=useState(false);
  useEffect(()=>{try{const saved=localStorage.getItem('dexian-candidate-flow');if(saved){const data=JSON.parse(saved);setInvited(data.invited||[]);setCommunication(data.communication||[]);setCandidateStages(data.candidateStages||{})}}catch{}setFlowLoaded(true)},[]);
  useEffect(()=>{if(flowLoaded)localStorage.setItem('dexian-candidate-flow',JSON.stringify({invited,communication,candidateStages}))},[flowLoaded,invited,communication,candidateStages]);
  const screening=flowCandidates.filter(p=>!invited.includes(p.id));
  const aiPeople=flowCandidates.filter(p=>invited.includes(p.id));
  const source=mode==='简历筛选'?screening:aiPeople;
  const items=source.filter(p=>(p.name+p.school+p.education).includes(keyword)).filter(p=>communicationFilter==='全部'||(communicationFilter==='已沟通'?communication.includes(p.id):!communication.includes(p.id))).filter(()=>mode!=='AI 面试'||aiFilter==='全部'||aiFilter==='待面试');
  const allChecked=items.length>0&&items.every(p=>selected.includes(p.id));
  const switchAll=()=>setSelected(allChecked?selected.filter(id=>!items.some(p=>p.id===id)):[...new Set([...selected,...items.map(p=>p.id)])]);
  const openInvite=(ids=selected)=>{if(!ids.length){flash('请先选择候选人');return}setInviteIds(ids)};
  const confirmInvite=()=>{if(!inviteIds)return;setInvited([...new Set([...invited,...inviteIds])]);setSelected([]);setInviteIds(null);go('AI 面试');flash(`已向 ${inviteIds.length} 位候选人发送 AI 面试邀请`)};
  const pickOne=()=>{const person=aiPeople.find(p=>selected.includes(p.id));if(!person){flash('请先选择一位候选人');return null}return person};
  const openDetail=(person:FlowCandidate,tab:'resume'|'ai'='resume')=>{setDetailTab(tab);setDetail(person)};
  const downloadText=(name:string,content:string,type='text/plain;charset=utf-8')=>{const url=URL.createObjectURL(new Blob([content],{type}));const link=document.createElement('a');link.href=url;link.download=name;link.click();URL.revokeObjectURL(url)};
  const downloadResumes=()=>{const people=flowCandidates.filter(p=>selected.includes(p.id));if(!people.length){flash('请选择要下载的简历');return}downloadText('候选人简历.txt',people.map(p=>`${p.name}\n${p.age}岁 · ${p.city}\n${p.school} · ${p.education}\n应聘：人力资源管培生\n`).join('\n———\n'));flash('简历已开始下载')};
  const exportData=()=>{const rows=[['姓名','年龄','学校/公司','经历','负责人','当前阶段'],...source.map(p=>[p.name,p.age,p.school,p.education,p.owner,candidateStages[p.id]||(invited.includes(p.id)?'AI面试':'简历筛选')])];downloadText('候选人数据.csv','\ufeff'+rows.map(row=>row.join(',')).join('\n'),'text/csv;charset=utf-8');flash('候选人数据已导出')};
  const stagesList=[['简历',3],['简历筛选',screening.length],['AI面试',aiPeople.length],['人工评估',0],['用人部门筛选',0],['安排面试',0],['录用',0],['背景调查',0],['黑名单',0],['淘汰',1]] as const;
  return <><section className="flow-page">
    <Head path="候选人管理" title={mode} sub={mode==='简历筛选'?'集中筛选候选人并推进至 AI 面试':'管理 AI 面试邀请、通知与面试状态'}/>
    <div className="flow-stage-tabs">{stagesList.map(([label,count])=><button key={label} className={(mode==='AI 面试'?label==='AI面试':label==='简历筛选')?'active':''} onClick={()=>{if(label==='简历筛选')go('简历筛选');if(label==='AI面试')go('AI 面试')}}><span>{label}</span><b>{count}</b></button>)}</div>
    <div className="flow-workspace">
      <aside className="flow-filter-card"><div className="flow-card-title"><div><h3>职位与候选人</h3><p>按职位快速定位候选人</p></div><span>1</span></div><button className="flow-position-select"><i>▣</i><span>招聘中的职位</span><b>⌄</b></button><div className="flow-search"><span>⌕</span><input value={keyword} onChange={e=>setKeyword(e.target.value)} placeholder="搜索姓名或学校"/></div><div className="flow-search"><span>⌕</span><input placeholder="搜索职位"/></div><button className="flow-filter-button"><i>≡</i> 候选人信息筛选 <b>→</b></button><div className="flow-job-summary"><span>全部职位</span><b>共 1 个</b></div><label className="flow-job-choice"><input type="checkbox" defaultChecked/><span><b>人力资源管培生</b><small>JD000004 · 招聘中</small></span></label></aside>
      <div className="flow-list-card">
        <div className="flow-list-title"><div><h3>{mode==='简历筛选'?'待筛选候选人':'AI 面试候选人'}</h3><p>{mode==='简历筛选'?'审核简历并批量发起 AI 面试':'跟踪邀请发送与候选人作答进度'}</p></div><span>{items.length} 位候选人</span></div>
        <div className="flow-filter-row"><select aria-label="沟通状态" value={communicationFilter} onChange={e=>setCommunicationFilter(e.target.value)}><option value="全部">全部沟通状态</option><option>未沟通</option><option>已沟通</option></select><select aria-label="推荐筛选状态"><option>全部推荐状态</option><option>未推荐</option></select>{mode==='AI 面试'&&<><select aria-label="通知状态"><option>全部通知状态</option><option>通知已发送</option></select><select aria-label="AI面试状态" value={aiFilter} onChange={e=>setAiFilter(e.target.value)}><option value="全部">全部面试状态</option><option>待面试</option></select></>}<select aria-label="状态变更时间"><option>全部变更时间</option><option>近 7 天</option></select></div>
        <div className="flow-batch-row"><label><input type="checkbox" checked={allChecked} onChange={switchAll}/> 全选</label>{mode==='简历筛选'?<button className="primary" onClick={()=>openInvite()}>✦ 邀请 AI 面试</button>:<><button className="primary" onClick={()=>{const person=pickOne();if(person)openDetail(person,'ai')}}>查看报告</button><button onClick={()=>{if(!selected.length){flash('请先选择候选人');return}openInvite()}}>再次邀请</button></>}<button onClick={()=>{if(!selected.length){flash('请先选择候选人');return}setCommunication([...new Set([...communication,...selected])]);flash('已标记沟通并发送通知')}}>发送通知</button><button onClick={()=>{if(!selected.length){flash('请选择要变更的候选人');return}const next=mode==='AI 面试'?'人工评估':'AI面试';setCandidateStages({...candidateStages,...Object.fromEntries(selected.map(id=>[id,next]))});flash(`已将 ${selected.length} 位候选人变更至「${next}」`)}}>变更阶段</button><button onClick={downloadResumes}>下载简历</button><button onClick={exportData}>导出数据</button></div>
        <div className="flow-person-list">{items.map(person=><article className="flow-person-row" key={person.id}><label><input type="checkbox" checked={selected.includes(person.id)} onChange={()=>setSelected(selected.includes(person.id)?selected.filter(id=>id!==person.id):[...selected,person.id])}/></label><div className="flow-person-profile"><span>{person.name.slice(0,1)}</span><div><h3>{person.name}<i>{person.badge}</i><small>{person.age} 岁{person.experience&&' · '+person.experience}</small></h3><p>{person.school} · {person.education}</p><small>应聘：人力资源管培生　{person.period}</small></div></div><div className="flow-person-owner"><span>候选人所有者</span><b>{person.owner}</b><small>{communication.includes(person.id)?'已标记沟通':'2025-11-25 申请'}</small></div><div className="flow-person-status">{mode==='简历筛选'?<><span>推荐状态</span><b>{candidateStages[person.id]||person.recommend}</b></>:<><span>AI 面试状态</span><b className="waiting">待面试</b><small>通知已发送</small></>}</div><button className="flow-more" onClick={()=>openDetail(person)}>详情 →</button></article>)}{items.length===0&&<div className="flow-empty"><span>✦</span><h3>{mode==='AI 面试'?'暂无 AI 面试候选人':'没有符合条件的候选人'}</h3><p>{mode==='AI 面试'?'从“简历筛选”中选择候选人并发送 AI 面试邀请。':'请调整搜索或筛选条件后重试。'}</p>{mode==='AI 面试'&&<button onClick={()=>go('简历筛选')}>前往简历筛选</button>}</div>}</div>
        <div className="flow-pagination"><span>共 {items.length} 条</span><button disabled>‹</button><button className="active">1</button><button disabled>›</button><select><option>10 条 / 页</option></select></div>
      </div>
    </div>
  </section>
  {inviteIds&&<FlowInviteModal people={flowCandidates.filter(p=>inviteIds.includes(p.id))} close={()=>setInviteIds(null)} confirm={confirmInvite}/>}
  {detail&&<FlowCandidateDetail key={`${detail.id}-${detailTab}`} person={detail} initialTab={detailTab} invited={invited.includes(detail.id)} communicated={communication.includes(detail.id)} stage={candidateStages[detail.id]||(invited.includes(detail.id)?'AI面试':'简历筛选')} close={()=>setDetail(null)} invite={()=>{setDetail(null);openInvite([detail.id])}} communicate={()=>{setCommunication([...new Set([...communication,detail.id])]);flash('已标记为沟通')}} changeStage={stage=>{setCandidateStages({...candidateStages,[detail.id]:stage});flash(`已推进至「${stage}」`)}} flash={flash}/>}
  </>
}

function FlowInviteModal({people,close,confirm}:{people:FlowCandidate[];close:()=>void;confirm:()=>void}){
  return <div className="flow-modal-backdrop" onMouseDown={close}><form className="flow-invite-modal" onMouseDown={e=>e.stopPropagation()} onSubmit={e=>{e.preventDefault();confirm()}}><button type="button" className="flow-overlay-close" onClick={close}>×</button><span className="flow-modal-kicker">AI INTERVIEW</span><h2>邀请 AI 面试</h2><p>确认面试方案与通知方式，邀请将在提交后立即发送。</p><div className="flow-invite-people">{people.slice(0,4).map(person=><span key={person.id}><i>{person.name.slice(0,1)}</i>{person.name}</span>)}{people.length>4&&<b>等 {people.length} 人</b>}</div><div className="flow-form-grid"><label>AI 面试方案<select defaultValue="通用素质初面"><option>通用素质初面</option><option>人力资源专业初面</option></select></label><label>作答有效期<select defaultValue="7 天"><option>3 天</option><option>7 天</option><option>14 天</option></select></label></div><fieldset><legend>通知方式</legend><label><input type="checkbox" defaultChecked/> 短信通知</label><label><input type="checkbox" defaultChecked/> 邮件通知</label><label><input type="checkbox"/> 微信通知</label></fieldset><label>邀请附言<textarea defaultValue="你好，感谢应聘人力资源管培生。请在有效期内完成 AI 视频面试，期待你的精彩表现。"/></label><div className="flow-modal-actions"><button type="button" onClick={close}>取消</button><button className="primary" type="submit">确认发送邀请 →</button></div></form></div>
}

function FlowCandidateDetail({person,initialTab,invited,communicated,stage,close,invite,communicate,changeStage,flash}:{person:FlowCandidate;initialTab:'resume'|'ai';invited:boolean;communicated:boolean;stage:string;close:()=>void;invite:()=>void;communicate:()=>void;changeStage:(stage:string)=>void;flash:(text:string)=>void}){
  const [tab,setTab]=useState<'resume'|'ai'>(initialTab);
  const [followed,setFollowed]=useState(false);
  const [note,setNote]=useState('');
  const [noteOpen,setNoteOpen]=useState(false);
  const stageOptions=['AI面试','用人部门筛选','安排面试','录用','背景调查','待入职','已入职'];
  const tabs=[['resume','简历信息'],['ai','AI视频面试'],['empty','在线笔试'],['empty2','认知能力'],['empty3','职业性格'],['empty4','职业投入'],['empty5','心理健康'],['empty6','第三方测评']];
  return <div className="flow-detail-backdrop" onMouseDown={close}><section className="flow-detail-panel" onMouseDown={e=>e.stopPropagation()}><button className="flow-overlay-close" onClick={close}>×</button><header className="flow-detail-head"><span>{person.name.slice(0,1)}</span><div><h2>{person.name}<em>已应聘 {person.badge} 次</em></h2><p>{person.age} 岁 · {person.experience||'应届毕业生'} · {person.city}　候选人 ID：DX{person.id}</p><small>{person.phone}　·　{person.email}</small><div>{person.tags.map(tag=><i key={tag}>{tag}</i>)}</div></div></header><nav className="flow-detail-tabs">{tabs.map(([key,label])=><button key={key} className={tab===key?'active':''} onClick={()=>{if(key==='resume'||key==='ai')setTab(key);else flash(`${label}暂无测评数据`)}}>{label}</button>)}</nav><div className="flow-detail-layout"><main className="flow-detail-content">{tab==='resume'?<><div className="flow-resume-toolbar"><div><button className="active">原始简历</button><button>标准简历</button><button>应聘登记表</button><button>附加信息</button></div><div><button onClick={()=>flash('简历已开始下载')}>⇩ 下载</button><button onClick={()=>window.print()}>▣ 打印</button></div></div><article className="flow-resume-paper"><div className="flow-resume-title"><span>{person.name.slice(0,1)}</span><div><h1>{person.name}</h1><p>{person.age} 岁 · {person.city} · {person.experience||'应届毕业生'}</p></div><b>应聘职位<br/><strong>人力资源管培生</strong></b></div><section><h3>教育经历</h3><div><b>{person.school}</b><span>{person.period}</span><p>{person.education}</p></div></section><section><h3>{person.experience?'工作经历':'校园经历'}</h3><div><b>{person.experience?'人力资源相关实践':'学生组织与校园活动'}</b><span>2024-03 至今</span><p>参与招聘协同、候选人沟通和数据整理，能够独立完成基础招聘流程，重视沟通体验与执行效率。</p></div></section><section><h3>个人优势</h3><p>具备良好的学习能力和沟通协调能力，熟悉人力资源基础知识，能够快速理解业务需求并推进任务落地。</p></section></article></>:<div className="flow-ai-report"><span>✦</span><h2>{invited?'候选人未进入答题':'尚未邀请参加 AI 面试'}</h2><p>{invited?'邀请已发送，候选人完成作答后将在这里生成 AI 面试报告。':'发送邀请后，可在此跟踪作答进度并查看智能分析报告。'}</p>{invited?<div className="flow-ai-status"><b>邀请已发送</b><span>有效期剩余 7 天</span><em>待面试</em></div>:<button onClick={invite}>邀请 AI 面试</button>}</div>}</main><aside className="flow-detail-side"><div className="flow-side-title"><span>招聘阶段</span><b>{stage}</b></div><div className="flow-pipeline-list">{['简历','简历筛选','AI面试','人工评估','安排面试','录用'].map((item,index)=><div key={item} className={item===stage?'active':index<2?'done':''}><i>{index<2?'✓':index+1}</i><span>{item}</span></div>)}</div><label className="flow-stage-select">进入下一阶段<select value={stageOptions.includes(stage)?stage:'AI面试'} onChange={e=>changeStage(e.target.value)}>{stageOptions.map(item=><option key={item}>{item}</option>)}</select></label><div className="flow-detail-actions"><button className={communicated?'active':''} onClick={communicate}>✓ {communicated?'已沟通':'标记沟通'}</button><button onClick={()=>flash('淘汰原因选择已打开')}>⊘ 淘汰</button><button onClick={()=>flash('候选人已归档')}>□ 归档</button><button className={followed?'active':''} onClick={()=>setFollowed(!followed)}>☆ {followed?'已关注':'关注'}</button><button onClick={()=>setNoteOpen(!noteOpen)}>✎ 备注</button><button onClick={()=>flash('人工综合评价已打开')}>▤ 人工综合评价</button></div>{noteOpen&&<div className="flow-note-box"><textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="记录与候选人的沟通重点..."/><button onClick={()=>{setNoteOpen(false);flash('备注已保存')}}>保存备注</button></div>}<div className="flow-owner-card"><span>候选人所有者</span><b><i>朱</i>{person.owner}</b><small>最后更新：今天 10:28</small></div></aside></div></section></div>
}

function Interviews({items,onNew,flash}:{items:Interview[];onNew:()=>void;flash:(s:string)=>void}){return <section><Head path="面试管理" title="面试管理" sub="安排面试并协同面试官反馈" action="安排面试" click={onNew}/><div className="week-strip">{['周日|23','周一|24','周二|25','周三|26','周四|27','周五|28','周六|29'].map((d,i)=>{const a=d.split('|');return <button className={i===0?'active':''} key={d}><span>{a[0]}</span><b>{a[1]}</b>{i<4&&<i/>}</button>})}</div><div className="interview-layout"><div className="interview-list"><div className="list-title"><h3>面试日程</h3><span>{items.length} 场面试</span></div>{items.map(x=><article className="interview-card" key={x.id}><time><b>{x.time}</b><small>{x.date}</small></time><i className="interview-color"/><div><h3>{x.name} · {x.round}</h3><p>{x.role}</p><span>{x.mode}　面试官：{x.interviewer}</span></div><em>{x.status}</em><button onClick={()=>flash('面试详情已打开')}>详情</button></article>)}</div><aside className="interview-side"><h3>面试协同提醒</h3><div><b>3</b><span>待提交评价<small>请在面试后 24 小时内完成</small></span></div><div><b>2</b><span>候选人待确认<small>系统将在 2 小时后自动提醒</small></span></div><button onClick={()=>flash('提醒已发送给相关面试官')}>一键发送提醒</button></aside></div></section>}

function Offers({flash}:{flash:(s:string)=>void}){return <section><Head path="Offer 管理" title="Offer 管理" sub="跟踪审批、发放与候选人接受状态" action="新建 Offer" click={()=>flash('新建 Offer 流程已开启')}/><div className="offer-kpis">{[['待审批','3','平均审批 1.2 天'],['本月已发放','12','较上月 +20%'],['候选人已接受','8','接受率 72.7%'],['即将入职','5','未来 14 天']].map(x=><article key={x[0]}><span>{x[0]}</span><b>{x[1]}</b><small>{x[2]}</small></article>)}</div><div className="offer-table"><div className="offer-head"><span>候选人</span><span>职位</span><span>薪资方案</span><span>负责人</span><span>状态</span><span>截止日期</span><span>操作</span></div>{offers.map(o=><div className="offer-row" key={o[0]}><div><span>{o[0].slice(0,1)}</span><b>{o[0]}</b></div><span>{o[1]}</span><strong>{o[2]}</strong><span>{o[3]}</span><em>{o[4]}</em><span>{o[5]}</span><button onClick={()=>flash('Offer 详情已打开')}>查看</button></div>)}</div></section>}

function Analytics(){const hs=[42,55,46,70,63,82,76,91,68,88,96,84];return <section><Head path="招聘数据" title="招聘数据" sub="洞察招聘漏斗、渠道质量与团队效率"/><div className="analytics-filters"><div><button className="active">近 30 天</button><button>本季度</button><button>本年度</button></div><select><option>全部职位</option><option>技术岗位</option></select></div><div className="analytics-kpis">{[['简历总量','1,284','↑ 18.6%'],['面试转化率','39.2%','↑ 4.8%'],['Offer 接受率','72.7%','↑ 6.2%'],['平均招聘周期','18.4 天','↓ 2.1 天']].map(x=><article key={x[0]}><span>{x[0]}</span><b>{x[1]}</b><small>{x[2]}</small></article>)}</div><div className="analytics-layout"><article className="analytics-chart"><div className="chart-title"><div><h3>候选人趋势</h3><p>近 30 天新增与推进人数</p></div><div><span>● 新增简历</span><span>● 进入面试</span></div></div><div className="chart-body">{hs.map((h,i)=><div key={i}><i style={{height:h+'%'}}/><b style={{height:(h*.55)+'%'}}/><span>{i%2===0?(i+1)+'日':''}</span></div>)}</div></article><aside className="channel-card"><div className="chart-title"><div><h3>渠道质量排行</h3><p>按有效候选人占比</p></div></div>{[['内部推荐','86%','48 人'],['技术社区','78%','96 人'],['猎头推荐','72%','63 人'],['Boss 直聘','64%','182 人'],['LinkedIn','59%','77 人']].map((x,i)=><div className="channel-row" key={x[0]}><b>{i+1}</b><span>{x[0]}<i><em style={{width:x[1]}}/></i></span><strong>{x[1]}<small>{x[2]}</small></strong></div>)}</aside></div></section>}

function JobModal({close,submit}:{close:()=>void;submit:(f:FormData)=>void}){return <div className="modal-backdrop" onMouseDown={close}><form className="job-modal" onSubmit={e=>{e.preventDefault();submit(new FormData(e.currentTarget))}} onMouseDown={e=>e.stopPropagation()}><button type="button" className="modal-close" onClick={close}>×</button><span className="eyebrow purple">NEW POSITION</span><h2>发布新职位</h2><p>创建职位草稿，后续可继续完善职位要求与发布渠道。</p><label>职位名称<input required name="title" placeholder="例如：高级产品经理"/></label><label>所属部门<select required name="dept" defaultValue=""><option value="" disabled>请选择部门</option><option>产品中心</option><option>AI 实验室</option><option>市场部</option></select></label><div className="form-grid"><label>工作城市<input name="city" placeholder="北京"/></label><label>招聘人数<input type="number" min="1" defaultValue="1"/></label></div><button className="primary-button" type="submit">创建职位草稿 <span>→</span></button></form></div>}

function InterviewModal({people,close,submit}:{people:Candidate[];close:()=>void;submit:(f:FormData)=>void}){return <div className="modal-backdrop" onMouseDown={close}><form className="job-modal" onSubmit={e=>{e.preventDefault();submit(new FormData(e.currentTarget))}} onMouseDown={e=>e.stopPropagation()}><button type="button" className="modal-close" onClick={close}>×</button><span className="eyebrow purple">SCHEDULE</span><h2>安排面试</h2><p>选择候选人和面试方式，系统将生成面试安排。</p><label>候选人<select required name="candidate" defaultValue=""><option value="" disabled>请选择候选人</option>{people.map(p=><option key={p.id}>{p.name}</option>)}</select></label><div className="form-grid"><label>面试轮次<select name="round"><option>业务一面</option><option>技术面试</option><option>业务二面</option></select></label><label>时间<input name="time" type="time" defaultValue="10:00"/></label></div><label>面试方式<select name="mode"><option>腾讯会议</option><option>飞书会议</option><option>会议室 A3</option></select></label><button className="primary-button" type="submit">确认安排 <span>→</span></button></form></div>}

function JobDrawer({job,close,flash}:{job:Job;close:()=>void;flash:(s:string)=>void}){return <div className="drawer-backdrop" onMouseDown={close}><aside className="detail-drawer" onMouseDown={e=>e.stopPropagation()}><button className="drawer-close" onClick={close}>×</button><span className="drawer-label">职位详情</span><h2>{job.title}</h2><p>{job.dept} · {job.city}　负责人：{job.owner}</p><div className="drawer-kpis"><div><b>{job.resumes}</b><small>新增简历</small></div><div><b>{job.process}</b><small>流程中</small></div><div><b>{job.interviews}</b><small>待面试</small></div></div><section><h3>职位进度</h3><div className="pipeline">{[['收到简历','100%',job.resumes+job.process],['AI 通过','72%',job.process],['进入面试','36%',job.interviews],['Offer','12%',2]].map(x=><div key={String(x[0])}><span>{x[0]}</span><i><em style={{width:String(x[1])}}/></i><b>{x[2]}</b></div>)}</div></section><section><h3>发布渠道</h3><div className="channel-tags"><span>Boss 直聘 ✓</span><span>猎聘 ✓</span><span>官网 ✓</span></div></section><div className="drawer-actions"><button onClick={()=>flash('职位编辑器已打开')}>编辑职位</button><button onClick={()=>flash('职位发布链接已复制')}>复制链接</button></div></aside></div>}

function CandidateDrawer({person,close,advance}:{person:Candidate;close:()=>void;advance:()=>void}){return <div className="drawer-backdrop" onMouseDown={close}><aside className="detail-drawer candidate-drawer" onMouseDown={e=>e.stopPropagation()}><button className="drawer-close" onClick={close}>×</button><div className="candidate-profile"><span>{person.avatar}</span><div><h2>{person.name}</h2><p>{person.company} · {person.years}经验</p></div><em><b>{person.score}</b>%<small>AI 匹配度</small></em></div><div className="current-stage">当前阶段 <b>{person.stage}</b></div><section><h3>AI 评估摘要</h3><div className="ai-assessment"><p><b>优势</b>核心经验与岗位要求高度一致，具备成熟项目落地经验。</p><p><b>关注</b>建议面试中进一步了解跨团队协作与目标拆解能力。</p></div></section><section><h3>核心技能</h3><div className="channel-tags">{person.skills.map(s=><span key={s}>{s}</span>)}</div></section><section><h3>候选人信息</h3><div className="profile-info"><p><span>应聘职位</span>{person.role}</p><p><span>简历来源</span>{person.source}</p><p><span>最近公司</span>{person.company}</p></div></section><button className="primary-button" onClick={advance}>推进到下一阶段 <span>→</span></button></aside></div>}
