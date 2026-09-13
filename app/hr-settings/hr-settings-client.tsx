'use client';

import { FormEvent, useEffect, useState } from 'react';
import HrAccountMenu from '@/app/components/hr-account-menu';

type Account={contact:string;phone:string;email:string;role:'super_admin'|'hr'};
type Feedback={kind:'success'|'error';text:string}|null;

const menuItems=[
  {icon:'◉',label:'候选人筛选',href:'/interviewer-candidate'},
  {icon:'▤',label:'人工评估',href:'/assessment'},
  {icon:'▣',label:'面试管理',href:'/interview-management'},
  {icon:'▥',label:'招聘进展',href:'/recruitment-progress'},
  {icon:'⚙',label:'设置',href:'/hr-settings'},
];

export default function HrSettingsClient(){
  const [account,setAccount]=useState<Account|null>(null);
  const [error,setError]=useState('');
  const [profileSaving,setProfileSaving]=useState(false);
  const [passwordSaving,setPasswordSaving]=useState(false);
  const [profileFeedback,setProfileFeedback]=useState<Feedback>(null);
  const [passwordFeedback,setPasswordFeedback]=useState<Feedback>(null);

  useEffect(()=>{
    void fetch('/api/auth/me',{cache:'no-store'}).then(async response=>{
      if(response.status===401){window.location.assign('/');return}
      if(!response.ok)throw new Error('load');
      const result=await response.json() as {account:Account};
      setAccount(result.account);
    }).catch(()=>setError('账号信息加载失败，请稍后刷新。'));
  },[]);

  async function saveProfile(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(profileSaving||!account)return;
    setProfileSaving(true);
    setProfileFeedback(null);
    const contact=String(new FormData(event.currentTarget).get('contact')||'').trim();
    try{
      const response=await fetch('/api/auth/account',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'profile',contact})});
      const result=await response.json().catch(()=>({})) as {message?:string;account?:Account};
      if(!response.ok)throw new Error(result.message||'个人资料保存失败。');
      setAccount(result.account||{...account,contact});
      setProfileFeedback({kind:'success',text:'个人资料已保存，工作台显示姓名已同步更新。'});
    }catch(saveError){
      setProfileFeedback({kind:'error',text:saveError instanceof Error?saveError.message:'个人资料保存失败。'});
    }finally{
      setProfileSaving(false);
    }
  }

  async function savePassword(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(passwordSaving)return;
    const formElement=event.currentTarget;
    const form=new FormData(formElement);
    const currentPassword=String(form.get('currentPassword')||'');
    const newPassword=String(form.get('newPassword')||'');
    const confirmPassword=String(form.get('confirmPassword')||'');
    setPasswordSaving(true);
    setPasswordFeedback(null);
    try{
      const response=await fetch('/api/auth/account',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'password',currentPassword,newPassword,confirmPassword})});
      const result=await response.json().catch(()=>({})) as {message?:string};
      if(!response.ok)throw new Error(result.message||'登录密码修改失败。');
      formElement.reset();
      setPasswordFeedback({kind:'success',text:'登录密码已修改，下次登录请使用新密码。'});
    }catch(saveError){
      setPasswordFeedback({kind:'error',text:saveError instanceof Error?saveError.message:'登录密码修改失败。'});
    }finally{
      setPasswordSaving(false);
    }
  }

  if(!account)return <main className="interviewer-loading"><span>星</span><b>{error||'正在读取账号设置…'}</b>{error&&<button onClick={()=>window.location.reload()}>重新加载</button>}</main>;

  return <main className="interviewer-page">
    <aside className="interviewer-rail">
      <a className="interviewer-logo" href="/workbench"><span>星</span><b>星鉴人才<small>HIRING DEPARTMENT</small></b></a>
      <p className="interviewer-role-label">HR 工作台</p>
      <nav>{menuItems.map(item=><a key={item.label} className={item.label==='设置'?'active':''} href={item.href}><i>{item.icon}</i><span>{item.label}</span></a>)}</nav>
      <button type="button">«</button>
    </aside>
    <section className="interviewer-main">
      <header className="interviewer-header">
        <div className="interviewer-heading"><h1>设置</h1><small>HR 账号与安全</small></div>
        <div className="interviewer-tools"><HrAccountMenu key={account.contact} contact={account.contact} phone={account.phone} email={account.email} role={account.role}/></div>
      </header>
      <div className="interviewer-open-tabs"><a href="/interviewer-candidate">候选人筛选</a><i>›</i><button type="button" className="active">设置</button></div>
      <div className="hr-module-content hr-settings-content">
        <section className="hr-module-hero"><div><p>ACCOUNT SETTINGS</p><h2>账号设置</h2><span>维护个人资料并定期更新登录密码，保障账号安全</span></div></section>
        <div className="hr-settings-grid">
          <form className="hr-settings-card" onSubmit={saveProfile}>
            <header><i>◎</i><div><h3>个人资料</h3><p>修改工作台中展示的账号姓名</p></div></header>
            <label>姓名<input required name="contact" defaultValue={account.contact} maxLength={40} placeholder="请输入姓名"/></label>
            <div className="hr-settings-readonly"><label>手机号<input value={account.phone||'未绑定'} readOnly/></label><label>邮箱<input value={account.email||'未绑定'} readOnly/></label></div>
            {profileFeedback&&<p className={`hr-settings-feedback ${profileFeedback.kind}`} role={profileFeedback.kind==='error'?'alert':'status'}>{profileFeedback.text}</p>}
            <footer><button type="submit" disabled={profileSaving}>{profileSaving?'保存中…':'保存个人资料'}</button></footer>
          </form>
          <form className="hr-settings-card" onSubmit={savePassword}>
            <header><i>⌾</i><div><h3>修改登录密码</h3><p>验证当前密码后设置新的登录密码</p></div></header>
            <label>当前密码<input required name="currentPassword" type="password" autoComplete="current-password" placeholder="请输入当前密码"/></label>
            <div className="hr-settings-password-row"><label>新密码<input required name="newPassword" type="password" autoComplete="new-password" minLength={8} maxLength={20} placeholder="8–20 位，同时包含字母和数字"/></label><label>确认新密码<input required name="confirmPassword" type="password" autoComplete="new-password" minLength={8} maxLength={20} placeholder="请再次输入新密码"/></label></div>
            {passwordFeedback&&<p className={`hr-settings-feedback ${passwordFeedback.kind}`} role={passwordFeedback.kind==='error'?'alert':'status'}>{passwordFeedback.text}</p>}
            <footer><button type="submit" disabled={passwordSaving}>{passwordSaving?'修改中…':'修改登录密码'}</button></footer>
          </form>
        </div>
      </div>
    </section>
  </main>;
}
