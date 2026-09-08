'use client';

import { useEffect, useRef, useState } from 'react';

type HrAccountMenuProps = {
  contact: string;
  email?: string;
  role: 'super_admin' | 'hr';
};

export default function HrAccountMenu({contact,email,role}:HrAccountMenuProps){
  const [open,setOpen]=useState(false);
  const rootRef=useRef<HTMLDivElement>(null);

  useEffect(()=>{
    function closeMenu(event:MouseEvent){
      if(!rootRef.current?.contains(event.target as Node))setOpen(false);
    }
    function closeOnEscape(event:KeyboardEvent){
      if(event.key==='Escape')setOpen(false);
    }
    document.addEventListener('mousedown',closeMenu);
    document.addEventListener('keydown',closeOnEscape);
    return ()=>{
      document.removeEventListener('mousedown',closeMenu);
      document.removeEventListener('keydown',closeOnEscape);
    };
  },[]);

  return <div className="hr-account-menu" ref={rootRef}>
    <button
      type="button"
      className={`hr-account-trigger${open?' open':''}`}
      aria-expanded={open}
      aria-haspopup="menu"
      onClick={()=>setOpen(current=>!current)}
    >
      <span className="interviewer-avatar">{contact.slice(0,1)}</span>
      <span className="interviewer-account-copy"><b>{contact}</b><small>HR 招聘</small></span>
      <i aria-hidden="true">⌄</i>
    </button>
    {open&&<div className="hr-account-dropdown" role="menu">
      <header>
        <span className="interviewer-avatar">{contact.slice(0,1)}</span>
        <div><b>{contact}</b><small>{email||'HR 招聘账号'}</small></div>
      </header>
      <div className="hr-account-role"><span>当前角色</span><b>HR 招聘</b></div>
      {role==='super_admin'?<button type="button" role="menuitem" onClick={()=>window.location.assign('/workbench')}>
        <i aria-hidden="true">⇄</i>
        <span><b>切换至管理员页面</b><small>进入超级管理员招聘工作台</small></span>
        <em aria-hidden="true">›</em>
      </button>:<p className="hr-account-permission">HR 账号仅拥有 HR 工作台权限</p>}
    </div>}
  </div>;
}
