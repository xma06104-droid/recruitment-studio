import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://dexian-recruiting-workbench.hyc-931212.chatgpt.site'),
  title: '星鉴人才 · AI 人才决策工作台',
  description: '覆盖职位、人才、AI 面试与招聘数据分析的一站式人才决策平台。',
  openGraph: {
    title: '星鉴人才 · AI 人才决策工作台',
    description: '覆盖职位、人才、AI 面试与招聘数据分析的一站式人才决策平台。',
    type: 'website',
    images: [{ url: '/og.png', width: 1731, height: 909, alt: '星鉴人才 · AI 人才决策工作台' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: '星鉴人才 · AI 人才决策工作台',
    description: '覆盖职位、人才、AI 面试与招聘数据分析的一站式人才决策平台。',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
