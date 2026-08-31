export type ParsedResume = {
  name: string;
  role: string;
  phone: string;
  email: string;
  education: string;
  school: string;
  major: string;
  age: number | null;
  workYears: number | null;
  stabilityMonths: number | null;
  city: string;
  company: string;
  industry: string;
  expectedSalary: number | null;
  skills: string[];
  certificates: string[];
  workHistory: string[];
  projectHistory: string[];
};

export function parseResumeText(value: string): ParsedResume {
  const text = value.replace(/\r/g, '').replace(/[\t ]+/g, ' ').trim();
  const phone = text.match(/(?<!\d)1[3-9]\d{9}(?!\d)/)?.[0] || '';
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase() || '';
  const name = text.match(/(?:姓名|姓\s*名)\s*[：:]\s*([\u4e00-\u9fa5·]{2,12})/)?.[1] || '';
  const role = text.match(/(?:应聘岗位|求职意向|目标岗位|期望职位)\s*[：:]\s*([^\n]{2,40})/)?.[1]?.trim() || '';
  const education = ['博士', '硕士', '本科', '大专', '中专', '高中'].find(item => text.includes(item)) || '';
  const school = text.match(/([\u4e00-\u9fa5]{2,30}(?:大学|学院))/)?.[1] || '';
  const major = text.match(/(?:专业)\s*[：:]\s*([^\n]{2,30})/)?.[1]?.trim() || '';
  const ageText = text.match(/(?:年龄)\s*[：:]\s*(\d{2})/)?.[1];
  const yearsText = text.match(/(?:工作经验|工作年限)\s*[：:]?\s*(\d+(?:\.\d+)?)\s*年/)?.[1];
  const stabilityText = text.match(/(?:平均任职|任职周期)\s*[：:]?\s*(\d+)\s*个?月/)?.[1];
  const city = text.match(/(?:所在城市|现居地|工作地点|期望城市)\s*[：:]\s*([^\n]{2,20})/)?.[1]?.trim() || '';
  const company = text.match(/(?:最近公司|当前公司)\s*[：:]\s*([^\n]{2,50})/)?.[1]?.trim() || '';
  const industry = text.match(/(?:行业背景|所属行业|行业)\s*[：:]\s*([^\n]{2,40})/)?.[1]?.trim() || '';
  const salaryText = text.match(/(?:期望月薪|期望薪资)\s*[：:]?\s*(\d{4,6})/)?.[1];
  const skillText = text.match(/(?:技能|专业技能|核心技能)\s*[：:]\s*([^\n]{2,300})/)?.[1] || '';
  const certificateText = text.match(/(?:证书|资格证书)\s*[：:]\s*([^\n]{2,200})/)?.[1] || '';

  return {
    phone,
    email,
    name,
    role,
    education,
    school,
    major,
    age: ageText ? Number(ageText) : null,
    workYears: yearsText ? Number(yearsText) : null,
    stabilityMonths: stabilityText ? Number(stabilityText) : null,
    city,
    company,
    industry,
    expectedSalary: salaryText ? Number(salaryText) : null,
    skills: splitResumeList(skillText),
    certificates: splitResumeList(certificateText),
    workHistory: sectionLines(text, ['工作经历', '工作经验'], ['项目经验', '教育经历', '教育背景', '专业技能', '技能']),
    projectHistory: sectionLines(text, ['项目经验'], ['教育经历', '教育背景', '专业技能', '技能', '证书']),
  };
}

export function stripResumeHtml(value: string) {
  return value.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, '\n').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim();
}

function splitResumeList(value: string) {
  return value.split(/[,，、;；|\n]/).map(item => item.trim()).filter(Boolean).slice(0, 20);
}

function sectionLines(text: string, starts: string[], ends: string[]) {
  const startPattern = starts.map(escapeRegExp).join('|');
  const endPattern = ends.map(escapeRegExp).join('|');
  const match = text.match(new RegExp(`(?:${startPattern})\\s*[：:]?\\s*\\n?([\\s\\S]{2,2400}?)(?=\\n\\s*(?:${endPattern})\\s*[：:]?|$)`, 'i'));
  return (match?.[1] || '').split(/\n+/).map(item => item.trim()).filter(item => item.length > 2).slice(0, 20);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
