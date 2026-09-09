'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type HrAccountMenuProps = {
  contact: string;
  phone?: string;
  email?: string;
  role: 'super_admin' | 'hr';
};

type AccountModal='profile'|'password'|null;

function maskPhone(phone?:string){
  return phone?.replace(/^(\d{3})\d{4}(\d{4})$/,'$1 **** $2')||'未绑定';
}

export default function HrAccountMenu({contact,phone,email,role}:HrAccountMenuProps){
  const [displayContact,setDisplayContact]=useState(contact);
  const [open,setOpen]=useState(false);
  const [modal,setModal]=useState<AccountModal>(null);
  const [saving,setSaving]=useState(false);
  const [modalError,setModalError]=useState('');
  const [notice,setNotice]=useState('');
  const [loggingOut,setLoggingOut]=useState(false);
  const [logoutError,setLogoutError]=useState('');
  const rootRef=useRef<HTMLDivElement>(null);

  function openModal(next:Exclude<AccountModal,null>){
    setOpen(false);
    setNotice('');
    setModalError('');
    setModal(next);
  }

  async function saveAccount(event:FormEvent<HTMLFormElement>,action:'profile'|'password'){
    event.preventDefault();
    setSaving(true);
    setModalError('');
    const form=new FormData(event.currentTarget);
    const payload=Object.fromEntries(form.entries());
    try{
      const response=await fetch('/api/auth/account',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...payload})});
      const result=await response.json().catch(()=>({})) as {message?:string};
      if(!response.ok)throw new Error(result.message||'保存失败，请稍后重试。');
      if(action==='profile'){
        setDisplayContact(String(payload.contact||contact));
        setSaving(false);
        setModal(null);
        setNotice('个人资料保存成功。');
        setOpen(true);
        return;
      }
      setSaving(false);
      setModal(null);
      setNotice('登录密码修改成功。');
      setOpen(true);
    }catch(error){
      setSaving(false);
      setModalError(error instanceof Error?error.message:'保存失败，请稍后重试。');
    }
  }

  async function logout(){
    setLoggingOut(true);
    setLogoutError('');
    try{
      const response=await fetch('/api/auth/logout',{method:'POST'});
      if(!response.ok)throw new Error('logout failed');
      window.location.assign('/');
    }catch{
      setLoggingOut(false);
      setLogoutError('退出失败，请稍后重试。');
    }
  }

  useEffect(()=>{
    function closeMenu(event:MouseEvent){
      if(!rootRef.current?.contains(event.target as Node))setOpen(false);
    }
    function closeOnEscape(event:KeyboardEvent){
      if(event.key==='Escape'){
        setOpen(false);
        if(!saving)setModal(null);
      }
    }
    document.addEventListener('mousedown',closeMenu);
    document.addEventListener('keydown',closeOnEscape);
    return ()=>{
      document.removeEventListener('mousedown',closeMenu);
      document.removeEventListener('keydown',closeOnEscape);
    };
  },[saving]);

  return <div className="hr-account-menu" ref={rootRef}>
    <button
      type="button"
      className={`hr-account-trigger${open?' open':''}`}
      aria-expanded={open}
      aria-haspopup="menu"
      onClick={()=>setOpen(current=>!current)}
    >
      <span className="interviewer-avatar">{displayContact.slice(0,1)}</span>
      <span className="interviewer-account-copy"><b>{displayContact}</b><small>HR 招聘</small></span>
      <i aria-hidden="true">⌄</i>
    </button>
    {open&&<div className="account-menu hr-account-dropdown" role="menu">
      <header>
        <span className="interviewer-avatar">{displayContact.slice(0,1)}</span>
        <div><b>{displayContact}<em>HR</em></b><small>{email||'HR 招聘账号'}</small></div>
      </header>
      <section>
        <p><span>手机号</span><b>{maskPhone(phone)}</b></p>
        <p><span>邮箱</span><b>{email||'未绑定'}</b></p>
      </section>
      {role==='super_admin'?<button type="button" role="menuitem" onClick={()=>window.location.assign('/workbench')}>
        <i aria-hidden="true">⇄</i>
        <div><b>切换至管理员页面</b><small>进入超级管理员招聘工作台</small></div>
        <em aria-hidden="true">›</em>
      </button>:null}
      <button type="button" role="menuitem" onClick={()=>openModal('profile')}>
        <i aria-hidden="true">◎</i>
        <div><b>个人资料</b><small>修改账号显示姓名</small></div>
        <em aria-hidden="true">›</em>
      </button>
      <button type="button" role="menuitem" onClick={()=>openModal('password')}>
        <i aria-hidden="true">⌾</i>
        <div><b>登录与安全</b><small>验证当前密码后修改</small></div>
        <em aria-hidden="true">›</em>
      </button>
      <button className="account-logout" type="button" role="menuitem" onClick={logout} disabled={loggingOut}>
        <i aria-hidden="true">↪</i>
        <div><b>{loggingOut?'正在退出…':'安全退出'}</b><small>退出当前登录账号</small></div>
      </button>
      {logoutError&&<p className="hr-account-logout-error" role="alert">{logoutError}</p>}
      {notice&&<p className="hr-account-success" role="status">{notice}</p>}
    </div>}
    {modal&&createPortal(<div className="hr-account-modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&!saving)setModal(null)}}>
      <form className="hr-account-modal" onSubmit={event=>void saveAccount(event,modal)}>
        <button className="hr-account-modal-close" type="button" aria-label="关闭" disabled={saving} onClick={()=>setModal(null)}>×</button>
        <span>{modal==='profile'?'ACCOUNT PROFILE':'LOGIN SECURITY'}</span>
        <h2>{modal==='profile'?'个人资料':'修改登录密码'}</h2>
        <p>{modal==='profile'?'更新后，HR 工作台中的账号姓名会同步更新。':'验证当前密码后设置新的登录密码。'}</p>
        {modal==='profile'?<>
          <label>姓名<input required name="contact" defaultValue={displayContact} maxLength={40} placeholder="请输入姓名"/></label>
          <div className="hr-account-readonly"><label>手机号<input value={phone||'未绑定'} readOnly/></label><label>邮箱<input value={email||'未绑定'} readOnly/></label></div>
        </>:<>
          <label>当前密码<input required name="currentPassword" type="password" autoComplete="current-password" placeholder="请输入当前密码"/></label>
          <label>新密码<input required name="newPassword" type="password" autoComplete="new-password" minLength={8} maxLength={20} placeholder="8-20 位，同时包含字母和数字"/></label>
          <label>确认新密码<input required name="confirmPassword" type="password" autoComplete="new-password" minLength={8} maxLength={20} placeholder="请再次输入新密码"/></label>
        </>}
        {modalError&&<div className="hr-account-modal-error" role="alert">{modalError}</div>}
        <footer><button type="button" disabled={saving} onClick={()=>setModal(null)}>取消</button><button type="submit" disabled={saving}>{saving?'正在保存…':'保存'}</button></footer>
      </form>
    </div>,document.body)}
  </div>;
}
