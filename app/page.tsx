'use client';

import { FormEvent, useState } from 'react';

export default function Home() {
  const [message, setMessage] = useState('');

  function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('登录成功，正在进入工作台…');
    window.setTimeout(() => window.location.assign('/workbench'), 500);
  }

  return (
    <main className="auth-shell">
      <section className="brand-panel">
        <div className="brand-mark"><span>得</span> 得贤招聘官</div>
        <div className="brand-copy">
          <span className="eyebrow">AI RECRUITING COPILOT</span>
          <h1>让每一次招聘，<br />更快找到对的人。</h1>
          <p>从职位发布、智能筛选到面试协同，一站式管理你的招聘全流程。</p>
          <div className="preview-window">
            <div className="preview-bar"><i /><i /><i /><b>招聘工作台</b></div>
            <div className="preview-body">
              <div className="mini-sidebar"><strong>DX</strong><i /><i /><i /><i /></div>
              <div className="mini-content">
                <span>上午好，招聘负责人</span>
                <div className="mini-kpis"><b>12<small>招聘中职位</small></b><b>286<small>新增候选人</small></b><b>43<small>待处理</small></b></div>
                <div className="mini-chart"><i /><i /><i /><i /><i /><i /><i /></div>
              </div>
            </div>
          </div>
        </div>
        <p className="brand-footer">AI 得贤招聘官 · 企业智能招聘解决方案</p>
      </section>

      <section className="auth-panel">
        <div className="mobile-brand"><span>得</span> 得贤招聘官</div>
        <div className="auth-card">
          <div className="auth-title">
            <span className="eyebrow purple">WELCOME BACK</span>
            <h2>欢迎登录</h2>
            <p>登录你的企业招聘工作台</p>
          </div>
          <form onSubmit={submitLogin}>
            <label>手机号 / 企业邮箱<input required placeholder="请输入手机号或企业邮箱" /></label>
            <label>密码<a href="#">忘记密码？</a><input required type="password" placeholder="请输入登录密码" /></label>
            <div className="form-meta"><label className="check"><input type="checkbox" /> 记住我</label></div>
            <button className="primary-button" type="submit">登录工作台 <span>→</span></button>
          </form>
          {message && <p className="success-message">{message}</p>}
          <div className="divider"><span>或</span></div>
          <button className="demo-button" onClick={() => window.location.assign('/workbench')}>直接查看演示工作台</button>
          <p className="switch-auth">还没有企业账号？ <a href="/register">免费注册</a></p>
          <p className="terms">登录即代表你同意《用户协议》和《隐私政策》</p>
        </div>
      </section>
    </main>
  );
}
