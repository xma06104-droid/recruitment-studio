'use client';

import { useMemo, useState } from 'react';

const navItems = [
  ['⌂','工作台'], ['▣','职位管理'], ['♙','人才库'], ['✦','AI 智能初筛'],
  ['◴','面试管理'], ['✓','Offer 管理'], ['↗','招聘数据'],
];

const jobs = [
  {title:'高级产品经理', dept:'产品中心 · 北京', status:'招聘中', newCount:18, process:26, interviews:5},
  {title:'大模型算法工程师', dept:'AI 实验室 · 上海', status:'急聘', newCount:32, process:41, interviews:8},
  {title:'海外市场负责人', dept:'市场部 · 深圳', status:'招聘中', newCount:9, process:17, interviews:3},
  {title:'资深 UI/UX 设计师', dept:'设计中心 · 杭州', status:'招聘中', newCount:14, process:22, interviews:4},
];

const viewCopy: Record<string, {title:string; sub:string}> = {
  '职位管理':{title:'职位管理',sub:'创建职位并跟踪各渠道的招聘进展'},
  '人才库':{title:'企业人才库',sub:'集中沉淀、标签化管理所有候选人'},
  'AI 智能初筛':{title:'AI 智能初筛',sub:'基于岗位要求自动评估候选人匹配度'},
  '面试管理':{title:'面试管理',sub:'安排面试并协同面试官反馈'},
  'Offer 管理':{title:'Offer 管理',sub:'跟踪审批、发放与候选人接受状态'},
  '招聘数据':{title:'招聘数据',sub:'洞察招聘漏斗、渠道质量与团队效率'},
};

export default function WorkbenchPage() {
  const [active, setActive] = useState('工作台');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(false);
  const [notice, setNotice] = useState(false);
  const [toast, setToast] = useState('');
  const [jobList, setJobList] = useState(jobs);
  const filtered = useMemo(() => jobList.filter(job => job.title.includes(search) || job.dept.includes(search)), [search, jobList]);

  function createJob(form: FormData) {
    const title = String(form.get('title') || '新职位');
    const dept = String(form.get('dept') || '待分配');
    setJobList([{title, dept:dept + ' · 待设置', status:'草稿', newCount:0, process:0, interviews:0}, ...jobList]);
    setModal(false);
    setActive('职位管理');
    setToast('职位草稿已创建');
    window.setTimeout(() => setToast(''), 2200);
  }

  return (
    <main className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <a className="dash-logo" href="/workbench"><span>得</span><b>得贤招聘官</b></a>
        <nav>
          <p>招聘管理</p>
          {navItems.map(([icon,label]) => <button key={label} className={active===label?'active':''} onClick={()=>setActive(label)}><i>{icon}</i><span>{label}</span>{label==='AI 智能初筛'&&<em>AI</em>}</button>)}
          <p>协作与设置</p>
          <button><i>♧</i><span>团队协作</span></button>
          <button><i>⚙</i><span>企业设置</span></button>
        </nav>
        <div className="sidebar-help"><b>招聘小助手</b><p>有问题？随时找我</p><button onClick={()=>{setToast('智能助手已为你开启');window.setTimeout(()=>setToast(''),2200)}}>立即咨询</button></div>
        <a className="back-login" href="/">← 退出演示</a>
      </aside>

      <section className="dashboard-main">
        <header className="dashboard-header">
          <div className="global-search"><span>⌕</span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜索职位、候选人或面试..." /><kbd>⌘ K</kbd></div>
          <div className="header-tools">
            <button className="round-button" onClick={()=>setNotice(!notice)}>♧<b>3</b></button>
            <button className="round-button">?</button>
            <div className="user-info"><span>林</span><div><b>林嘉怡</b><small>企业管理员</small></div><i>⌄</i></div>
            {notice && <div className="notice-pop"><b>最新通知</b><p>你有 3 份新简历待处理</p><p>下午 14:30 有一场技术面试</p><p>AI 已完成 28 份简历初筛</p></div>}
          </div>
        </header>

        <div className="dashboard-content">
          {active==='工作台' ? (
            <>
              <section className="welcome-row"><div><p>2026 年 8 月 23 日 · 星期日</p><h1>上午好，林嘉怡 <span>👋</span></h1><small>今天有 <b>6 项</b> 招聘任务等待你处理，继续保持高效。</small></div><button className="new-job" onClick={()=>setModal(true)}>＋ 发布新职位</button></section>
              <section className="kpi-grid">
                <article><div className="kpi-icon purple-bg">▣</div><span>招聘中职位<em>较上月 +2</em></span><strong>12</strong><small>全部职位 18 个</small></article>
                <article><div className="kpi-icon blue-bg">♙</div><span>本月新增候选人<em>环比 +18.6%</em></span><strong>286</strong><small>其中 AI 推荐 96 人</small></article>
                <article><div className="kpi-icon orange-bg">◴</div><span>待处理事项<em className="warm">需要关注</em></span><strong>43</strong><small>简历 28 · 面试 15</small></article>
                <article><div className="kpi-icon green-bg">✓</div><span>本月已入职<em>目标完成 72%</em></span><strong>8</strong><small>月度目标 11 人</small></article>
              </section>

              <section className="dashboard-grid">
                <article className="panel job-panel">
                  <div className="panel-title"><div><h3>重点职位进展</h3><p>实时关注核心岗位招聘动态</p></div><button onClick={()=>setActive('职位管理')}>查看全部 →</button></div>
                  <div className="job-head"><span>职位名称</span><span>新增简历</span><span>流程中</span><span>待面试</span><span>状态</span></div>
                  {filtered.slice(0,4).map((job,index)=><div className="job-row" key={job.title}><div><b>{job.title}</b><small>{job.dept}</small></div><span><i className={'job-dot dot-'+index}/>{job.newCount}</span><span>{job.process}</span><span>{job.interviews}</span><em className={job.status==='急聘'?'urgent':''}>{job.status}</em></div>)}
                </article>
                <aside className="panel today-panel">
                  <div className="panel-title"><div><h3>今日安排</h3><p>8 月 23 日</p></div><button>⋯</button></div>
                  <div className="schedule-item"><time>10:00</time><div className="schedule-line purple-line"><b>产品经理二面</b><p>候选人：周思远</p><span>视频面试 · 45 分钟</span></div></div>
                  <div className="schedule-item"><time>14:30</time><div className="schedule-line orange-line"><b>算法工程师技术面</b><p>候选人：陈子航</p><span>会议室 A3 · 60 分钟</span></div></div>
                  <div className="schedule-item"><time>16:00</time><div className="schedule-line green-line"><b>招聘周会</b><p>招聘项目组</p><span>3 楼会议室 · 30 分钟</span></div></div>
                </aside>
                <article className="panel funnel-panel">
                  <div className="panel-title"><div><h3>招聘漏斗</h3><p>近 30 天候选人转化</p></div><select><option>全部职位</option><option>技术岗位</option></select></div>
                  <div className="funnel-bars"><div><span>收到简历</span><i style={{width:'100%'}}/><b>1,284</b></div><div><span>AI 初筛通过</span><i style={{width:'72%'}}/><b>926</b></div><div><span>进入面试</span><i style={{width:'39%'}}/><b>504</b></div><div><span>发放 Offer</span><i style={{width:'14%'}}/><b>176</b></div><div><span>成功入职</span><i style={{width:'8%'}}/><b>103</b></div></div>
                </article>
                <aside className="ai-panel"><div><span>✦</span><b>AI 招聘洞察</b><em>实时</em></div><h3>大模型算法工程师<br />本周简历质量提升 23%</h3><p>建议优先查看来自「技术社区」渠道的 8 位高匹配候选人。</p><button onClick={()=>setActive('AI 智能初筛')}>查看 AI 推荐 →</button></aside>
              </section>
            </>
          ) : (
            <section className="subpage">
              <div className="subpage-head"><div><p>招聘管理 / {active}</p><h1>{viewCopy[active]?.title || active}</h1><small>{viewCopy[active]?.sub || '高效管理企业招聘流程'}</small></div><button className="new-job" onClick={()=>setModal(true)}>＋ 发布新职位</button></div>
              <div className="sub-toolbar"><div className="tab-set"><button className="active">全部</button><button>进行中</button><button>待处理</button><button>已完成</button></div><div className="filter-box">⌕ <input value={search} onChange={e=>setSearch(e.target.value)} placeholder={'搜索'+active}/><button>筛选</button></div></div>
              <div className="management-table">
                <div className="manage-head"><span>职位 / 项目</span><span>状态</span><span>候选人</span><span>面试</span><span>更新时间</span><span>操作</span></div>
                {filtered.map(job=><div className="manage-row" key={job.title}><div><b>{job.title}</b><small>{job.dept}</small></div><em className={job.status==='急聘'?'urgent':''}>{job.status}</em><span>{job.newCount + job.process} 人</span><span>{job.interviews} 场</span><span>今天 09:{job.newCount}</span><button>查看详情</button></div>)}
              </div>
            </section>
          )}
        </div>
      </section>

      {modal && <div className="modal-backdrop" onMouseDown={()=>setModal(false)}><form className="job-modal" onSubmit={e=>{e.preventDefault();createJob(new FormData(e.currentTarget))}} onMouseDown={e=>e.stopPropagation()}><button type="button" className="modal-close" onClick={()=>setModal(false)}>×</button><span className="eyebrow purple">NEW POSITION</span><h2>发布新职位</h2><p>创建职位草稿，后续可继续完善职位要求与发布渠道。</p><label>职位名称<input required name="title" placeholder="例如：高级产品经理" /></label><label>所属部门<select required name="dept" defaultValue=""><option value="" disabled>请选择部门</option><option>产品中心</option><option>AI 实验室</option><option>市场部</option><option>设计中心</option></select></label><div className="form-grid"><label>工作城市<input placeholder="北京" /></label><label>招聘人数<input type="number" min="1" defaultValue="1" /></label></div><button className="primary-button" type="submit">创建职位草稿 <span>→</span></button></form></div>}
      {toast && <div className="dashboard-toast">✓ {toast}</div>}
    </main>
  );
}
