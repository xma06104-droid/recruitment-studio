'use client';

import { FormEvent, useEffect, useState } from 'react';
import {
  DEMO_ACCOUNT,
  LAST_REGISTERED_KEY,
  hashPassword,
  isValidIdentifier,
  normalizeIdentifier,
  readAccounts,
} from './auth-rules';

export default function Home() {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const registered = window.localStorage.getItem(LAST_REGISTERED_KEY);
    if (!registered) return;
    setIdentifier(registered);
    setMessage('注册成功，请使用刚刚设置的密码登录。');
    window.localStorage.removeItem(LAST_REGISTERED_KEY);
  }, []);

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    const accountInput = normalizeIdentifier(identifier);

    if (!accountInput) {
      setError('请输入手机号或企业邮箱。');
      return;
    }
    if (!isValidIdentifier(accountInput)) {
      setError('请输入正确的中国大陆手机号或企业邮箱。');
      return;
    }
    if (!password) {
      setError('请输入登录密码。');
      return;
    }

    setSubmitting(true);
    const isDemoIdentifier = accountInput === DEMO_ACCOUNT.phone || accountInput === DEMO_ACCOUNT.email;
    const isDemoMatch = isDemoIdentifier && password === DEMO_ACCOUNT.password;
    const account = readAccounts().find(item => item.phone === accountInput || item.email === accountInput);
    const passwordHash = account ? await hashPassword(password) : '';
    const isRegisteredMatch = Boolean(account && account.passwordHash === passwordHash);

    if (!isDemoMatch && !isRegisteredMatch) {
      setSubmitting(false);
      setError('账号或密码错误，请检查后重新输入。');
      return;
    }

    window.sessionStorage.setItem('xingjian-current-user', accountInput);
    setMessage('登录成功，正在进入工作台…');
    window.setTimeout(() => window.location.assign('/workbench'), 500);
  }

  return (
    <main className="auth-shell">
      <section className="brand-panel">
        <div className="brand-mark"><span>星</span> 星鉴人才</div>
        <div className="brand-copy">
          <span className="eyebrow">AI RECRUITING COPILOT</span>
          <h1>让每一次招聘，<br />更快找到对的人。</h1>
          <p>从职位发布、智能筛选到面试协同，一站式管理你的招聘全流程。</p>
          <div className="preview-window">
            <div className="preview-bar"><i /><i /><i /><b>招聘工作台</b></div>
            <div className="preview-body">
              <div className="mini-sidebar"><strong>XJ</strong><i /><i /><i /><i /></div>
              <div className="mini-content">
                <span>上午好，招聘负责人</span>
                <div className="mini-kpis"><b>12<small>招聘中职位</small></b><b>286<small>新增候选人</small></b><b>43<small>待处理</small></b></div>
                <div className="mini-chart"><i /><i /><i /><i /><i /><i /><i /></div>
              </div>
            </div>
          </div>
        </div>
        <p className="brand-footer">星鉴人才 · AI 人才决策与智能招聘平台</p>
      </section>

      <section className="auth-panel">
        <div className="mobile-brand"><span>星</span> 星鉴人才</div>
        <div className="auth-card">
          <div className="auth-title">
            <span className="eyebrow purple">WELCOME BACK</span>
            <h2>欢迎登录</h2>
            <p>登录你的企业招聘工作台</p>
          </div>
          <form noValidate onSubmit={submitLogin}>
            <label>手机号 / 企业邮箱<input name="identifier" value={identifier} onChange={event=>setIdentifier(event.target.value)} autoComplete="username" inputMode="email" aria-invalid={Boolean(error)} placeholder="请输入手机号或企业邮箱" /></label>
            <label>密码<a href="#">忘记密码？</a><input name="password" value={password} onChange={event=>setPassword(event.target.value)} type="password" autoComplete="current-password" aria-invalid={Boolean(error)} placeholder="请输入登录密码" /></label>
            <div className="form-meta"><label className="check"><input type="checkbox" /> 记住我</label></div>
            {error && <div className="auth-error" role="alert" aria-live="assertive"><span>!</span><div><b>登录失败</b><p>{error}</p></div></div>}
            <button className="primary-button" type="submit" disabled={submitting}>{submitting ? '正在验证…' : '登录工作台'} <span>→</span></button>
          </form>
          {message && <p className="success-message" role="status">{message}</p>}
          <p className="demo-credentials"><span>测试账号</span> {DEMO_ACCOUNT.email} <i>/</i> {DEMO_ACCOUNT.password}</p>
          <div className="divider"><span>或</span></div>
          <button className="demo-button" onClick={() => window.location.assign('/workbench')}>直接查看演示工作台</button>
          <p className="switch-auth">还没有账号？ <a href="/register">免费注册</a></p>
          <p className="terms">登录即代表你同意《用户协议》和《隐私政策》</p>
        </div>
      </section>
    </main>
  );
}
