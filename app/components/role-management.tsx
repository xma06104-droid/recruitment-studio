'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';

type ManagedRole='super_admin'|'hr'|'none';
type ManagedAccount={id:string;contact:string;phone:string;email:string;role:ManagedRole;createdAt:string;current:boolean};

export default function RoleManagement({flash}:{flash:(message:string)=>void}){
  const [accounts,setAccounts]=useState<ManagedAccount[]>([]);
  const [loading,setLoading]=useState(true);
  const [adding,setAdding]=useState(false);
  const [saving,setSaving]=useState('');
  const [error,setError]=useState('');
  const [testEnvironment,setTestEnvironment]=useState(false);

  const load=useCallback(async()=>{
    const response=await fetch('/api/roles',{cache:'no-store'});
    if(response.status===401){window.location.assign('/');return}
    if(response.status===403){window.location.assign('/interviewer-candidate');return}
    if(!response.ok){setError('角色数据加载失败，请稍后刷新。');return}
    const result=await response.json() as {accounts:ManagedAccount[]};
    setAccounts(result.accounts);
    setError('');
    setLoading(false);
  },[]);

  useEffect(()=>{void load()},[load]);
  useEffect(()=>{setTestEnvironment(['localhost','127.0.0.1','::1'].includes(window.location.hostname))},[]);

  async function createPerson(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(saving)return;
    setSaving('new');setError('');
    const form=new FormData(event.currentTarget);
    const response=await fetch('/api/roles',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(form))});
    const result=await response.json().catch(()=>({})) as {message?:string};
    if(!response.ok){setError(result.message||'新增人员失败。');setSaving('');return}
    setAdding(false);setSaving('');await load();flash('人员账号已新增');
  }

  async function updateRole(person:ManagedAccount,role:ManagedRole){
    if(saving||person.role===role)return;
    if(role==='none'&&!window.confirm(`确认取消“${person.contact}”的系统身份吗？该账号将立即退出并无法访问系统。`))return;
    setSaving(person.id);setError('');
    const response=await fetch('/api/roles',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:person.id,role})});
    const result=await response.json().catch(()=>({})) as {message?:string};
    if(!response.ok){setError(result.message||'角色更新失败。');setSaving('');return}
    setSaving('');await load();flash(role==='none'?'人员身份已取消':'人员角色已更新');
  }

  async function deleteHrAccount(person:ManagedAccount){
    if(saving||person.role!=='hr'||person.current)return;
    if(!window.confirm(`确认永久删除 HR 账号“${person.contact}”吗？\n\n该账号会立即退出，候选人分配将解除，已有业务记录会移交给当前超级管理员。`))return;
    setSaving(person.id);setError('');
    try{
      const response=await fetch('/api/roles',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:person.id})});
      const result=await response.json().catch(()=>({})) as {message?:string};
      if(!response.ok){setError(result.message||'删除 HR 账号失败。');return}
      await load();flash(`HR 账号“${person.contact}”已删除`);
    }catch{setError('删除 HR 账号失败，请稍后重试。')}finally{setSaving('')}
  }

  const superCount=accounts.filter(item=>item.role==='super_admin').length;
  const hrCount=accounts.filter(item=>item.role==='hr').length;
  return <section className="role-management-page">
    <div className="subpage-head"><div><p>系统管理 / 角色管理</p><h1>角色管理</h1><small>配置超级管理员与 HR 的系统访问权限</small></div><button className="new-job" onClick={()=>{setAdding(true);setError('')}}>＋ 新增人员</button></div>
    <div className="role-kpis"><article><span>超级管理员</span><b>{superCount}</b><small>拥有管理员端与 HR 端全部权限</small></article><article><span>HR</span><b>{hrCount}</b><small>仅可进入 HR 工作台</small></article><article><span>已取消身份</span><b>{accounts.filter(item=>item.role==='none').length}</b><small>账号保留，但无法登录系统</small></article></div>
    {error&&<div className="role-error">! {error}</div>}
    <section className="role-table"><header><div><h2>人员与权限</h2><p>角色修改立即生效；删除 HR 会终止登录并解除候选人分配。</p></div><span>共 {accounts.length} 人</span></header>
      <div className="role-table-head"><span>人员</span><span>联系方式</span><span>当前角色</span><span>权限范围</span><span>操作</span></div>
      {loading?<div className="role-loading">正在读取人员角色…</div>:accounts.map(person=><article key={person.id}>
        <div className="role-person"><i>{person.contact.slice(0,1)}</i><span><b>{person.contact}{person.current&&<em>当前账号</em>}</b><small>加入于 {new Date(person.createdAt).toLocaleDateString('zh-CN')}</small></span></div>
        <div className="role-contact"><b>{person.phone}</b><small>{person.email}</small></div>
        <span className={`role-badge ${person.role}`}>{roleName(person.role)}</span>
        <p>{person.role==='super_admin'?'全部管理权限，可切换 HR 端':person.role==='hr'?'候选人筛选、评估、面试与招聘进展':'无系统访问权限'}</p>
        <div className="role-actions"><select disabled={saving===person.id||person.current} value={person.role} onChange={event=>void updateRole(person,event.target.value as ManagedRole)}><option value="super_admin">超级管理员</option><option value="hr">HR</option><option value="none">取消身份</option></select>{person.role==='hr'&&!person.current&&<button className="role-delete-button" disabled={saving===person.id} onClick={()=>void deleteHrAccount(person)}>{saving===person.id?'删除中…':'删除'}</button>}</div>
      </article>)}
    </section>
    {adding&&<div className="assessment-modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget&&!saving)setAdding(false)}}><form className="assessment-modal role-create-modal" autoComplete="off" onSubmit={createPerson}><div className="role-autofill-trap" aria-hidden="true"><input name="loginIdentifier" autoComplete="username" tabIndex={-1}/><input name="loginPassword" type="password" autoComplete="current-password" tabIndex={-1}/></div><button type="button" className="assessment-modal-close" onClick={()=>setAdding(false)}>×</button><p>NEW TEAM MEMBER</p><h2>新增人员</h2><small>创建登录账号并直接分配超级管理员或 HR 角色</small><label>姓名<input required name="contact" maxLength={40} autoComplete="off" placeholder="请输入姓名"/></label><div className="hr-form-grid"><label>手机号<input required name="phone" inputMode="numeric" autoComplete="off" minLength={11} maxLength={11} pattern="[0-9]{11}" title="请输入 11 位数字" placeholder="11 位数字"/></label><label>邮箱<input required name="email" type="email" autoComplete="off" placeholder="name@company.com"/></label></div><div className="hr-form-grid"><label>初始密码<input required name="password" type="password" minLength={8} maxLength={20} autoComplete="new-password" placeholder={testEnvironment?'8–20 位，测试环境不限字母':'8–20 位字母和数字'}/></label><label>角色<select name="role" defaultValue="hr"><option value="hr">HR</option><option value="super_admin">超级管理员</option></select></label></div>{error&&<div className="account-form-error">{error}</div>}<footer><button type="button" onClick={()=>setAdding(false)}>取消</button><button type="submit" disabled={saving==='new'}>{saving==='new'?'正在创建…':'新增人员'}</button></footer></form></div>}
  </section>;
}

function roleName(role:ManagedRole){return role==='super_admin'?'超级管理员':role==='hr'?'HR':'已取消身份'}
