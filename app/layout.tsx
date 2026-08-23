import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '得贤招聘官 · 企业智能招聘工作台',
  description: '覆盖职位、人才、面试与数据分析的一站式 AI 招聘工作台。',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
