'use client';

import { FormEvent, useState } from 'react';
import { isMainlandMobile, isStrongPassword, isValidEmail } from '@/app/auth-rules';

export default function ForgotPasswordPage() {
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [complete, setComplete] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    const phone = String(form.get('phone') ?? '').trim();
    const email = String(form.get('email') ?? '').trim().toLowerCase();
    const password = String(form.get('password') ?? '');
    const confirmPassword = String(form.get('confirmPassword') ?? '');

    if (!isMainlandMobile(phone)) return setError('请输入正确的手机号');
    if (!isValidEmail(email)) return setError('请输入正确的邮箱地址。');
    if (!isStrongPassword(password)) return setError('新密码需为 8–20 位，并同时包含字母和数字。');
    if (password !== confirmPassword) return setError('两次输入的新密码不一致。');

    setSubmitting(true);
    const response = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, email, password, confirmPassword }),
    });
    const result = await response.json().catch(() => ({})) as { message?: string };
    setSubmitting(false);
    if (!response.ok) return setError(result.message || '密码重置失败，请稍后重试。');
    setComplete(true);
  }

  return <main className="auth-shell reset-shell">
    <section className="brand-panel reset-brand-panel">
      <a className="brand-mark" href="/"><span>星</span> 星鉴人才</a>
      <div className="brand-copy reset-brand-copy">
        <span className="eyebrow">SECURE ACCOUNT RECOVERY</span>
        <h1>安全核验身份，<br/>快速找回账号。</h1>
        <p>手机号与邮箱必须同时匹配注册信息。密码重置成功后，该账号已有登录状态将自动失效。</p>
        <div className="reset-security-list">
          <article><i>01</i><div><b>双重信息核验</b><small>同时确认注册手机号与邮箱</small></div></article>
          <article><i>02</i><div><b>密码强度校验</b><small>8–20 位并同时包含字母和数字</small></div></article>
          <article><i>03</i><div><b>会话自动失效</b><small>重置后需使用新密码重新登录</small></div></article>
        </div>
      </div>
      <p className="brand-footer">星鉴人才 · 账号安全中心</p>
    </section>
    <section className="auth-panel">
      <a className="mobile-brand" href="/"><span>星</span> 星鉴人才</a>
      <div className="auth-card reset-card">
        {complete ? <div className="reset-complete">
          <span>✓</span>
          <div className="auth-title"><span className="eyebrow purple">PASSWORD UPDATED</span><h2>密码重置成功</h2><p>旧登录状态已失效，请使用新密码重新登录工作台。</p></div>
          <a className="primary-button" href="/">返回登录 <span>→</span></a>
        </div> : <>
          <div className="auth-title"><span className="eyebrow purple">ACCOUNT RECOVERY</span><h2>重置登录密码</h2><p>请填写注册时使用的手机号和邮箱，完成账号身份核验。</p></div>
          <form noValidate onSubmit={submit}>
            <div className="reset-grid">
              <label>注册手机号<input name="phone" type="tel" inputMode="numeric" autoComplete="tel" placeholder="请输入 11 位手机号"/></label>
              <label>注册邮箱<input name="email" type="email" inputMode="email" autoComplete="email" placeholder="请输入注册邮箱"/></label>
            </div>
            <label>设置新密码<input name="password" type="password" autoComplete="new-password" placeholder="8–20 位，同时包含字母和数字"/></label>
            <label>确认新密码<input name="confirmPassword" type="password" autoComplete="new-password" placeholder="请再次输入新密码"/></label>
            {error && <div className="auth-error" role="alert" aria-live="assertive"><span>!</span><div><b>无法重置密码</b><p>{error}</p></div></div>}
            <button className="primary-button" type="submit" disabled={submitting}>{submitting ? '正在核验账号…' : '核验并重置密码'} <span>→</span></button>
          </form>
          <p className="switch-auth">想起密码了？ <a href="/">返回登录</a></p>
          <p className="terms">为保护账号安全，手机号和邮箱必须与注册信息完全一致</p>
        </>}
      </div>
    </section>
  </main>;
}
