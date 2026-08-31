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

export type ResumeJob = { id: string; title: string };
export type ResumeJobMatch = ResumeJob & { confidence: number; reason: string };

const roleLabels = ['应聘岗位', '应聘职位', '求职意向', '求职目标', '目标岗位', '期望职位', '期望岗位', '求职岗位', '意向职位', '目标职位'];
const commonRoles = [
  '大模型算法工程师', '自然语言处理工程师', '机器学习工程师', '人工智能工程师', '数据开发工程师', '数据分析师', '数据产品经理',
  '高级产品经理', '产品经理', '项目经理', '前端开发工程师', '前端工程师', '后端开发工程师', '后端工程师', '全栈工程师',
  'Java开发工程师', 'Java工程师', 'Python开发工程师', 'Python工程师', '软件开发工程师', '软件工程师', '测试开发工程师',
  '自动化测试工程师', '测试工程师', '运维开发工程师', '运维工程师', 'DevOps工程师', '架构师', '技术经理', '研发经理',
  'UI设计师', 'UX设计师', '视觉设计师', '交互设计师', '平面设计师', '产品设计师', '运营经理', '产品运营', '用户运营',
  '市场经理', '品牌经理', '销售经理', '客户经理', '商务经理', '渠道经理', '招聘经理', '招聘专员', '人力资源经理', 'HRBP',
  '财务经理', '财务分析师', '会计', '出纳', '行政经理', '行政专员', '采购经理', '采购专员', '供应链经理', '客服主管', '客服专员',
].sort((a, b) => b.length - a.length);

const fieldLabels = [
  ...roleLabels, '姓名', '性别', '年龄', '出生日期', '手机号', '手机', '电话', '邮箱', '电子邮箱', '学历', '专业', '毕业院校', '学校',
  '工作经验', '工作年限', '现居地', '所在城市', '工作地点', '期望城市', '最近公司', '当前公司', '行业', '行业背景', '所属行业',
  '期望薪资', '期望月薪', '技能', '专业技能', '核心技能', '证书', '资格证书',
];

export function parseResumeText(value: string): ParsedResume {
  const text = normalizeResumeText(value);
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  const phone = text.match(/(?<!\d)1[3-9]\d{9}(?!\d)/)?.[0] || '';
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase() || '';
  const labeledName = labeledValue(lines, ['姓名', '姓 名'], 20);
  const name = cleanName(labeledName) || inferName(lines);
  const labeledRole = labeledValue(lines, roleLabels, 60);
  const role = cleanRole(labeledRole) || inferRole(lines);
  const education = inferEducation(text);
  const school = labeledValue(lines, ['毕业院校', '院校', '学校'], 80) || text.match(/([\u4e00-\u9fa5]{2,30}(?:大学|学院|学校))/)?.[1] || '';
  const major = labeledValue(lines, ['所学专业', '专业'], 50);
  const ageText = labeledValue(lines, ['年龄'], 10).match(/\d{2}/)?.[0] || text.match(/(?<!\d)(\d{2})\s*岁/)?.[1];
  const yearsText = text.match(/(?:工作经验|工作年限)\s*[：:|｜-]?\s*(\d+(?:\.\d+)?)\s*年/)?.[1]
    || text.match(/(\d+(?:\.\d+)?)\s*年(?:以上)?(?:工作|从业)经验/)?.[1];
  const stabilityText = text.match(/(?:平均任职|任职周期)\s*[：:|｜-]?\s*(\d+)\s*个?月/)?.[1];
  const city = labeledValue(lines, ['所在城市', '现居地', '现居城市', '工作地点', '期望城市'], 30);
  const company = labeledValue(lines, ['最近公司', '当前公司', '现公司'], 80) || inferRecentCompany(lines);
  const industry = labeledValue(lines, ['行业背景', '所属行业', '行业'], 50);
  const salaryText = labeledValue(lines, ['期望月薪', '期望薪资', '薪资期望'], 30);
  const skillText = labeledValue(lines, ['核心技能', '专业技能', '技能'], 500) || sectionText(text, ['核心技能', '专业技能', '技能清单'], ['证书', '工作经历', '项目经验'], 800);
  const certificateText = labeledValue(lines, ['资格证书', '职业证书', '证书'], 300) || sectionText(text, ['证书', '资格证书'], ['工作经历', '项目经验', '教育经历'], 500);

  return {
    phone,
    email,
    name,
    role,
    education,
    school: cleanField(school),
    major: cleanField(major),
    age: ageText ? Number(ageText) : null,
    workYears: yearsText ? Number(yearsText) : null,
    stabilityMonths: stabilityText ? Number(stabilityText) : null,
    city: cleanField(city),
    company: cleanField(company),
    industry: cleanField(industry),
    expectedSalary: parseSalary(salaryText),
    skills: splitResumeList(skillText),
    certificates: splitResumeList(certificateText),
    workHistory: sectionLines(text, ['工作经历', '工作经验', '职业经历'], ['项目经验', '教育经历', '教育背景', '专业技能', '技能', '证书']),
    projectHistory: sectionLines(text, ['项目经验', '项目经历'], ['教育经历', '教育背景', '专业技能', '技能', '证书', '自我评价']),
  };
}

export function matchResumeJob(role: string, rawText: string, jobs: ResumeJob[]): ResumeJobMatch | null {
  if (!jobs.length) return null;
  const normalizedRole = normalizeJobTitle(role);
  const topText = normalizeJobTitle(normalizeResumeText(rawText).split('\n').slice(0, 24).join(' '));
  let best: ResumeJobMatch | null = null;

  for (const job of jobs) {
    const normalizedTitle = normalizeJobTitle(job.title);
    if (!normalizedTitle) continue;
    let confidence = 0;
    let reason = '';
    if (normalizedRole && normalizedRole === normalizedTitle) {
      confidence = 100; reason = '岗位名称完全一致';
    } else if (normalizedRole && (normalizedRole.includes(normalizedTitle) || normalizedTitle.includes(normalizedRole))) {
      confidence = 92; reason = '岗位名称高度相似';
    } else if (normalizedRole) {
      const similarity = diceSimilarity(normalizedRole, normalizedTitle);
      if (similarity >= .58) { confidence = Math.round(68 + similarity * 25); reason = '岗位名称语义近似'; }
    }
    if (confidence < 84 && topText.includes(normalizedTitle)) {
      confidence = 84; reason = '简历开头明确出现该职位';
    }
    if (confidence >= 78 && (!best || confidence > best.confidence)) best = { ...job, confidence, reason };
  }
  return best;
}

export function stripResumeHtml(value: string) {
  return value.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, '\n').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\n{3,}/g, '\n\n').trim();
}

function normalizeResumeText(value: string) {
  return value.replace(/\r/g, '').replace(/[\t\u00a0]+/g, ' ').replace(/[ ]{2,}/g, ' ').replace(/\n[ ]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function labeledValue(lines: string[], labels: string[], maxLength: number) {
  const pattern = labels.map(escapeRegExp).join('|');
  const nextLabelPattern = fieldLabels.map(escapeRegExp).join('|');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const exact = line.match(new RegExp(`^(?:${pattern})\\s*[：:|｜-]?\\s*(.*)$`, 'i'));
    if (!exact) continue;
    let result = exact[1].trim();
    if (!result && lines[index + 1]) result = lines[index + 1].trim();
    result = result.split(new RegExp(`\\s+(?=(?:${nextLabelPattern})\\s*[：:|｜-]?)`, 'i'))[0];
    return cleanField(result).slice(0, maxLength);
  }
  return '';
}

function cleanName(value: string) {
  return value.match(/^[\u4e00-\u9fa5·]{2,12}$/)?.[0] || '';
}

function inferName(lines: string[]) {
  const blocked = /简历|求职|应聘|职位|岗位|工程师|经理|主管|总监|专员|顾问|学校|大学|学院|公司/;
  return lines.slice(0, 8).map(line => line.replace(/个人简历|RESUME/gi, '').trim()).find(line => /^[\u4e00-\u9fa5·]{2,4}$/.test(line) && !blocked.test(line)) || '';
}

function cleanRole(value: string) {
  const clean = cleanField(value).replace(/^(?:岗位|职位)\s*[：:]?\s*/, '').replace(/\s*(?:全职|兼职).*$/, '').trim();
  if (!clean || clean.length > 40) return '';
  const known = commonRoles.find(role => clean.toLowerCase().includes(role.toLowerCase()));
  return known || clean;
}

function inferRole(lines: string[]) {
  const top = lines.slice(0, 16).join('\n').toLowerCase();
  const known = commonRoles.find(role => top.includes(role.toLowerCase()));
  if (known) return known;
  const generic = lines.slice(0, 12).map(line => line.replace(/^(?:目标|意向|应聘|求职)\s*(?:岗位|职位)?\s*[：:|｜-]?\s*/, '').trim()).find(line => line.length >= 2 && line.length <= 24 && /(?:工程师|经理|总监|主管|顾问|专员|设计师|分析师|架构师|会计|出纳)$/.test(line));
  return generic || '';
}

function inferEducation(text: string) {
  const values = ['博士', '硕士', '本科', '大专', '中专', '高中'];
  const labeled = text.match(/(?:最高学历|学历)\s*[：:|｜-]?\s*(博士|硕士|本科|大专|中专|高中)/)?.[1];
  return labeled || values.find(item => text.includes(item)) || '';
}

function inferRecentCompany(lines: string[]) {
  const workStart = lines.findIndex(line => /^(?:工作经历|工作经验|职业经历)/.test(line));
  if (workStart < 0) return '';
  const candidate = lines.slice(workStart + 1, workStart + 7).find(line => /(?:公司|集团|科技|网络|信息|智能|实业|银行|事务所)/.test(line) && line.length <= 80);
  return candidate?.split(/[|｜/]/)[0].trim() || '';
}

function parseSalary(value: string) {
  if (!value) return null;
  const range = value.match(/(\d+(?:\.\d+)?)\s*[kK千]\s*[-~至]\s*(\d+(?:\.\d+)?)\s*[kK千]?/);
  if (range) return Math.round((Number(range[1]) + Number(range[2])) / 2 * 1000);
  const kValue = value.match(/(\d+(?:\.\d+)?)\s*[kK千]/)?.[1];
  if (kValue) return Math.round(Number(kValue) * 1000);
  const amount = value.match(/\d{4,6}/)?.[0];
  return amount ? Number(amount) : null;
}

function splitResumeList(value: string) {
  return value.split(/[,，、;；|｜\n]/).map(item => cleanField(item)).filter(item => item.length > 1).slice(0, 20);
}

function sectionText(text: string, starts: string[], ends: string[], maxLength: number) {
  const startPattern = starts.map(escapeRegExp).join('|');
  const endPattern = ends.map(escapeRegExp).join('|');
  return text.match(new RegExp(`(?:^|\\n)\\s*(?:${startPattern})\\s*[：:]?\\s*\\n?([\\s\\S]{2,${maxLength}}?)(?=\\n\\s*(?:${endPattern})\\s*[：:]?|$)`, 'i'))?.[1]?.trim() || '';
}

function sectionLines(text: string, starts: string[], ends: string[]) {
  return sectionText(text, starts, ends, 2400).split(/\n+/).map(item => cleanField(item)).filter(item => item.length > 2).slice(0, 20);
}

function cleanField(value: string) {
  return value.replace(/^[：:|｜\-—·•\s]+|[|｜\s]+$/g, '').trim();
}

function normalizeJobTitle(value: string) {
  return value.toLowerCase().replace(/招聘|急聘|诚聘|岗位|职位|全职|兼职/g, '').replace(/开发/g, '').replace(/[\s·•|｜/\\()（）\-_—]/g, '');
}

function diceSimilarity(a: string, b: string) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const pairs = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i += 1) pairs.set(a.slice(i, i + 2), (pairs.get(a.slice(i, i + 2)) || 0) + 1);
  let overlap = 0;
  for (let i = 0; i < b.length - 1; i += 1) {
    const pair = b.slice(i, i + 2); const count = pairs.get(pair) || 0;
    if (count > 0) { overlap += 1; pairs.set(pair, count - 1); }
  }
  return 2 * overlap / (a.length + b.length - 2);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
