'use client';

import { FormEvent, useState } from 'react';
import {
  isMainlandMobile,
  isStrongPassword,
  isValidEmail,
  normalizeIdentifier,
} from '../auth-rules';

export default function RegisterPage() {
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [phone, setPhone] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    const data = new FormData(event.currentTarget);
    const contact = String(data.get('contact') || '').trim();
    const normalizedPhone = phone.trim();
    const email = normalizeIdentifier(String(data.get('email') || ''));
    const password = String(data.get('password') || '');
    const role = data.get('role') === 'super_admin' ? 'super_admin' : 'hr';
    const agreed = data.get('agreement') === 'on';

    if (!contact) {
      setError('请输入姓名。');
      return;
    }
    if (!isMainlandMobile(normalizedPhone)) {
      setError('手机号格式不正确，请输入 1 开头的 11 位中国大陆手机号。');
      return;
    }
    if (!isValidEmail(email)) {
      setError('邮箱格式不正确，请检查邮箱名称和域名。');
      return;
    }
    if (!isStrongPassword(password)) {
      setError('密码需为 8–20 位，且同时包含字母和数字，不能包含空格。');
      return;
    }
    if (!agreed) {
      setError('请先阅读并同意《用户协议》和《隐私政策》。');
      return;
    }

    setDone(true);
    let response: Response;
    try {
      response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact, phone: normalizedPhone, email, password, role }),
      });
    } catch {
      setDone(false);
      setError('暂时无法连接账号服务，请稍后重试。');
      return;
    }
    const result = await response.json().catch(() => ({})) as { message?: string; role?:'super_admin'|'hr' };
    if (!response.ok) {
      setDone(false);
      setError(result.message || '注册失败，请稍后重试。');
      return;
    }
    setNotice(`${role === 'super_admin' ? '超级管理员' : 'HR'}账号已创建，正在返回登录页…`);
    window.setTimeout(() => window.location.assign(`/?registered=${encodeURIComponent(email)}&role=${role}`), 900);
  }

  return (
    <main className="register-shell">
      <section className="register-side">
        <a className="register-brand" href="/"><span>星</span> 星鉴人才</a>
        <div className="register-intro">
          <span className="eyebrow">START SMART RECRUITING</span>
          <h1>开启真实数据驱动的<br />智能招聘之旅</h1>
          <ul className="benefit-list">
            <li><b>01</b><div><strong>AI 智能初筛</strong><p>基于实际候选人记录统一管理筛选结果</p></div></li>
            <li><b>02</b><div><strong>全渠道人才管理</strong><p>职位、简历、面试与 Offer 进度统一管理</p></div></li>
            <li><b>03</b><div><strong>数据驱动决策</strong><p>实时洞察招聘转化率与团队效能</p></div></li>
          </ul>
        </div>
        <p className="register-side-footer">星鉴人才 · AI 人才决策与智能招聘平台</p>
      </section>
      <section className="register-form-wrap">
        <a className="mobile-brand register-mobile-brand" href="/"><span>星</span> 星鉴人才</a>
        <div className="register-card">
          <div className="step-row"><span className="active">1</span><i /><span>2</span><i /><span>3</span></div>
          <h2>创建账号</h2>
          <p className="register-sub">账号信息安全保存，业务数据将按账号独立管理</p>
          <form noValidate onSubmit={submit}>
            <div className="form-grid">
              <label>姓名<input name="contact" autoComplete="name" placeholder="请输入姓名" /></label>
              <label>注册角色<select name="role" defaultValue="hr"><option value="hr">HR</option><option value="super_admin">超级管理员</option></select></label>
            </div>
            <div className="form-grid">
              <label>手机号<input name="phone" value={phone} onChange={event=>setPhone(event.target.value.replace(/\D/g,'').slice(0,11))} type="tel" inputMode="numeric" autoComplete="tel" placeholder="请输入手机号" /></label>
              <label>邮箱<input name="email" type="email" inputMode="email" autoComplete="email" placeholder="name@example.com" /></label>
            </div>
            <label>设置密码<input name="password" type="password" autoComplete="new-password" placeholder="8–20 位，同时包含字母和数字" /><small className="field-hint">支持字母、数字和符号，不能包含空格</small></label>
            <label className="check register-check"><input name="agreement" type="checkbox" /> 我已阅读并同意《用户协议》和《隐私政策》</label>
            {error && <div className="auth-error register-error" role="alert" aria-live="assertive"><span>!</span><div><b>无法完成注册</b><p>{error}</p></div></div>}
            {notice && <p className="auth-notice" role="status">✓ {notice}</p>}
            <button className="primary-button" type="submit" disabled={done}>{done ? '注册成功，正在返回登录页…' : '创建账号'} <span>→</span></button>
          </form>
          <p className="switch-auth">已有账号？ <a href="/">直接登录</a></p>
        </div>
      </section>
    </main>
  );
}
