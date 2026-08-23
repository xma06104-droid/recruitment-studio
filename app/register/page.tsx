'use client';

import { FormEvent, useState } from 'react';

export default function RegisterPage() {
  const [done, setDone] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDone(true);
    window.setTimeout(() => window.location.assign('/workbench'), 800);
  }

  return (
    <main className="register-shell">
      <a className="register-brand" href="/"><span>得</span> 得贤招聘官</a>
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
          <form onSubmit={submit}>
            <label>企业名称<input required placeholder="请输入营业执照上的企业名称" /></label>
            <div className="form-grid">
              <label>联系人姓名<input required placeholder="怎么称呼你" /></label>
              <label>团队规模<select defaultValue=""><option value="" disabled>请选择</option><option>1-20 人</option><option>21-100 人</option><option>101-500 人</option><option>500 人以上</option></select></label>
            </div>
            <label>手机号<input required type="tel" placeholder="请输入常用手机号" /></label>
            <div className="code-row"><label>验证码<input required placeholder="6 位验证码" /></label><button type="button">获取验证码</button></div>
            <label>设置密码<input required type="password" minLength={6} placeholder="至少 6 位，包含字母和数字" /></label>
            <label className="check register-check"><input required type="checkbox" /> 我已阅读并同意《用户协议》和《隐私政策》</label>
            <button className="primary-button" type="submit">{done ? '注册成功，正在进入…' : '免费注册并进入工作台'} <span>→</span></button>
          </form>
          <p className="switch-auth">已有账号？ <a href="/">直接登录</a></p>
        </div>
      </section>
    </main>
  );
}
