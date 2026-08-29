'use client';

import { FormEvent, useState } from 'react';
import {
  LAST_REGISTERED_KEY,
  hashPassword,
  isMainlandMobile,
  isStrongPassword,
  isValidEmail,
  normalizeIdentifier,
  readAccounts,
  writeAccounts,
} from '../auth-rules';

export default function RegisterPage() {
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [phone, setPhone] = useState('');
  const [sending, setSending] = useState(false);

  function sendCode() {
    setError('');
    setNotice('');
    if (!isMainlandMobile(phone)) {
      setError('请输入正确的中国大陆手机号后再获取验证码。');
      return;
    }
    setSending(true);
    window.setTimeout(() => {
      setSending(false);
      setNotice('验证码已发送。本演示环境请填写 123456。');
    }, 500);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    const data = new FormData(event.currentTarget);
    const company = String(data.get('company') || '').trim();
    const contact = String(data.get('contact') || '').trim();
    const teamSize = String(data.get('teamSize') || '');
    const normalizedPhone = phone.trim();
    const email = normalizeIdentifier(String(data.get('email') || ''));
    const code = String(data.get('code') || '').trim();
    const password = String(data.get('password') || '');
    const agreed = data.get('agreement') === 'on';

    if (!company || !contact || !teamSize) {
      setError('请完整填写企业名称、联系人姓名和团队规模。');
      return;
    }
    if (!isMainlandMobile(normalizedPhone)) {
      setError('手机号格式不正确，请输入 1 开头的 11 位中国大陆手机号。');
      return;
    }
    if (!isValidEmail(email)) {
      setError('企业邮箱格式不正确，请检查邮箱名称和域名。');
      return;
    }
    if (!/^\d{6}$/.test(code) || code !== '123456') {
      setError('验证码错误，请输入演示验证码 123456。');
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

    const accounts = readAccounts();
    if (accounts.some(account => account.phone === normalizedPhone || account.email === email)) {
      setError('该手机号或企业邮箱已注册，请直接登录。');
      return;
    }

    const passwordHash = await hashPassword(password);
    writeAccounts([...accounts, {company, contact, phone: normalizedPhone, email, passwordHash, createdAt: new Date().toISOString()}]);
    window.localStorage.setItem(LAST_REGISTERED_KEY, email);
    setDone(true);
    setNotice('注册成功，正在返回登录页…');
    window.setTimeout(() => window.location.assign('/'), 900);
  }

  return (
    <main className="register-shell">
      <a className="register-brand" href="/"><span>星</span> 星鉴人才</a>
      <section className="register-side">
        <span className="eyebrow">START SMART RECRUITING</span>
        <h1>三分钟开启<br />智能招聘之旅</h1>
        <ul className="benefit-list">
          <li><b>01</b><div><strong>AI 智能初筛</strong><p>自动识别高匹配候选人，节省 70% 简历筛选时间</p></div></li>
          <li><b>02</b><div><strong>全渠道人才管理</strong><p>职位、简历、面试与 Offer 进度统一管理</p></div></li>
          <li><b>03</b><div><strong>数据驱动决策</strong><p>实时洞察招聘转化率与团队效能</p></div></li>
        </ul>
      </section>
      <section className="register-form-wrap">
        <div className="register-card">
          <div className="step-row"><span className="active">1</span><i /><span>2</span><i /><span>3</span></div>
          <h2>创建企业账号</h2>
          <p className="register-sub">免费体验完整招聘工作台，无需绑定支付方式</p>
          <form noValidate onSubmit={submit}>
            <label>企业名称<input name="company" autoComplete="organization" placeholder="请输入营业执照上的企业名称" /></label>
            <div className="form-grid">
              <label>联系人姓名<input name="contact" autoComplete="name" placeholder="怎么称呼你" /></label>
              <label>团队规模<select name="teamSize" defaultValue=""><option value="" disabled>请选择</option><option>1-20 人</option><option>21-100 人</option><option>101-500 人</option><option>500 人以上</option></select></label>
            </div>
            <div className="form-grid">
              <label>手机号<input name="phone" value={phone} onChange={event=>setPhone(event.target.value.replace(/\D/g,'').slice(0,11))} type="tel" inputMode="numeric" autoComplete="tel" placeholder="请输入 11 位大陆手机号" /></label>
              <label>企业邮箱<input name="email" type="email" inputMode="email" autoComplete="email" placeholder="name@company.com" /></label>
            </div>
            <div className="code-row"><label>验证码<input name="code" inputMode="numeric" maxLength={6} placeholder="6 位验证码" /></label><button type="button" disabled={sending} onClick={sendCode}>{sending ? '正在发送…' : '获取验证码'}</button></div>
            <label>设置密码<input name="password" type="password" autoComplete="new-password" placeholder="8–20 位，同时包含字母和数字" /><small className="field-hint">支持字母、数字和符号，不能包含空格</small></label>
            <label className="check register-check"><input name="agreement" type="checkbox" /> 我已阅读并同意《用户协议》和《隐私政策》</label>
            {error && <div className="auth-error register-error" role="alert" aria-live="assertive"><span>!</span><div><b>无法完成注册</b><p>{error}</p></div></div>}
            {notice && <p className="auth-notice" role="status">✓ {notice}</p>}
            <button className="primary-button" type="submit" disabled={done}>{done ? '注册成功，正在返回登录页…' : '免费注册并进入工作台'} <span>→</span></button>
          </form>
          <p className="switch-auth">已有账号？ <a href="/">直接登录</a></p>
        </div>
      </section>
    </main>
  );
}
