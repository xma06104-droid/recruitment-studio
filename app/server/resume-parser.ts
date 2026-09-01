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

export type ResumeJob = {
  id: string;
  title: string;
  department?: string;
  city?: string;
  minEducation?: string;
  majors?: string[];
  minYears?: number | null;
  certificates?: string[];
  industries?: string[];
  keywords?: string[];
  keywordWeight?: number;
  experienceWeight?: number;
  educationWeight?: number;
  stabilityWeight?: number;
};
export type ResumeJobMatch = ResumeJob & { confidence: number; reason: string };
export type ResumeMatchAnalysis = {
  score: number;
  level: '高匹配' | '中匹配' | '低匹配';
  keywordScore: number;
  experienceScore: number;
  educationScore: number;
  stabilityScore: number;
  matchedKeywords: string[];
  missingKeywords: string[];
  highlights: string[];
  risks: string[];
  summary: string;
};

const roleLabels = ['应聘岗位', '应聘职位', '求职意向', '求职目标', '目标岗位', '期望职位', '期望岗位', '求职岗位', '意向职位', '目标职位', '职位名称', '岗位名称', '意向岗位', '期望工作', '求职方向', '职业目标'];
const commonRoles = [
  '大模型算法工程师', '自然语言处理工程师', '机器学习工程师', '人工智能工程师', '数据开发工程师', '数据分析师', '数据产品经理',
  '高级产品经理', '产品经理', '项目经理', '前端开发工程师', '前端工程师', '后端开发工程师', '后端工程师', '全栈工程师',
  'Java开发工程师', 'Java工程师', 'Python开发工程师', 'Python工程师', '软件开发工程师', '软件工程师', '测试开发工程师',
  '自动化测试工程师', '测试工程师', '运维开发工程师', '运维工程师', 'DevOps工程师', '架构师', '技术经理', '研发经理',
  'UI设计师', 'UX设计师', '视觉设计师', '交互设计师', '平面设计师', '产品设计师', '运营经理', '产品运营', '用户运营',
  '市场经理', '品牌经理', '销售经理', '客户经理', '商务经理', '渠道经理', '招聘经理', '招聘专员', '人力资源经理', 'HRBP',
  '财务经理', '财务分析师', '会计', '出纳', '行政经理', '行政专员', '采购经理', '采购专员', '供应链经理', '客服主管', '客服专员',
].sort((a, b) => b.length - a.length);

const roleFamilies = [
  { role: '产品经理', patterns: [/产品经理/i, /产品运营/i, /产品规划/i, /product\s*manager/i], keywords: ['需求分析', '产品规划', '用户研究', '竞品分析', '原型设计', 'Axure', 'PRD', '数据分析', '项目管理'] },
  { role: '前端工程师', patterns: [/前端/i, /web\s*开发/i, /frontend/i], keywords: ['JavaScript', 'TypeScript', 'React', 'Vue', 'HTML', 'CSS', 'Webpack', 'Vite', '小程序'] },
  { role: '后端工程师', patterns: [/后端/i, /服务端/i, /backend/i, /Java开发/i, /Python开发/i], keywords: ['Java', 'Python', 'Go', 'Node.js', 'Spring', 'MySQL', 'Redis', '微服务', '数据库'] },
  { role: '测试工程师', patterns: [/测试/i, /质量保障/i, /质量工程/i, /\bqa\b/i, /\bqe\b/i], keywords: ['测试用例', '功能测试', '接口测试', '自动化测试', '性能测试', 'Selenium', 'JMeter', 'Postman', '缺陷管理'] },
  { role: '大模型算法工程师', patterns: [/大模型/i, /算法工程师/i, /机器学习/i, /自然语言处理/i, /\bai\b/i], keywords: ['Python', 'PyTorch', 'TensorFlow', '机器学习', '深度学习', 'NLP', '大模型', 'LLM', 'RAG', '算法'] },
  { role: '数据分析师', patterns: [/数据分析/i, /商业分析/i, /数据科学/i, /business\s*intelligence/i], keywords: ['SQL', 'Python', 'Excel', 'Tableau', 'Power BI', '数据分析', '数据可视化', '指标体系', '数据仓库'] },
  { role: '运维工程师', patterns: [/运维/i, /devops/i, /sre/i], keywords: ['Linux', 'Docker', 'Kubernetes', 'CI/CD', '云服务', '监控', 'Shell', '运维', 'DevOps'] },
  { role: 'UI设计师', patterns: [/UI设计/i, /视觉设计/i, /交互设计/i, /UX设计/i], keywords: ['Figma', 'Sketch', 'Photoshop', 'Illustrator', '视觉设计', '交互设计', '设计规范', '用户体验'] },
  { role: '销售经理', patterns: [/销售/i, /客户经理/i, /商务拓展/i, /business\s*development/i], keywords: ['客户开发', '销售目标', '渠道拓展', '商务谈判', '客户关系', '业绩', '回款', '销售'] },
  { role: '招聘专员', patterns: [/招聘/i, /人才招聘/i, /人力资源/i, /HRBP/i], keywords: ['招聘', '人才寻访', '面试', '招聘渠道', '人才库', '组织发展', '员工关系', '人力资源'] },
];

const knownSkills = [...new Set(roleFamilies.flatMap(item => item.keywords).concat([
  'C++', 'C#', 'PHP', 'Oracle', 'MongoDB', 'Kafka', 'Git', 'GitLab', 'Jenkins', 'Flink', 'Spark', 'Hadoop', 'Pandas', 'NumPy', 'Scikit-learn',
]))].sort((a, b) => b.length - a.length);

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
  const role = cleanRole(labeledRole) || inferRole(lines, text);
  const education = inferEducation(text);
  const school = labeledValue(lines, ['毕业院校', '院校', '学校'], 80) || text.match(/([\u4e00-\u9fa5]{2,30}(?:大学|学院|学校))/)?.[1] || '';
  const major = labeledValue(lines, ['所学专业', '专业'], 50);
  const ageText = labeledValue(lines, ['年龄'], 10).match(/\d{2}/)?.[0] || text.match(/(?<!\d)(\d{2})\s*岁/)?.[1];
  const yearsText = text.match(/(?:工作经验|工作年限|从业年限)\s*[：:|｜-]?\s*(\d+(?:\.\d+)?)\s*年/)?.[1]
    || text.match(/(\d+(?:\.\d+)?)\s*年(?:以上)?(?:工作|从业)经验/)?.[1];
  const stabilityText = text.match(/(?:平均任职|任职周期)\s*[：:|｜-]?\s*(\d+)\s*个?月/)?.[1];
  const city = labeledValue(lines, ['所在城市', '现居地', '现居城市', '工作地点', '期望城市'], 30) || inferCity(lines);
  const company = labeledValue(lines, ['最近公司', '当前公司', '现公司'], 80) || inferRecentCompany(lines);
  const industry = labeledValue(lines, ['行业背景', '所属行业', '行业'], 50) || inferIndustry(text);
  const salaryText = labeledValue(lines, ['期望月薪', '期望薪资', '薪资期望'], 30);
  const skillText = labeledValue(lines, ['核心技能', '专业技能', '技能'], 500) || sectionText(text, ['核心技能', '专业技能', '技能清单'], ['证书', '工作经历', '项目经验'], 800);
  const certificateText = labeledValue(lines, ['资格证书', '职业证书', '证书'], 300) || sectionText(text, ['证书', '资格证书'], ['工作经历', '项目经验', '教育经历'], 500);
  const listedSkills = splitResumeList(skillText);
  const durations = employmentDurations(text);

  return {
    phone,
    email,
    name,
    role,
    education,
    school: cleanField(school),
    major: cleanField(major),
    age: ageText ? Number(ageText) : null,
    workYears: yearsText ? Number(yearsText) : durations.length ? Math.round(durations.reduce((sum, item) => sum + item, 0) / 6) / 2 : null,
    stabilityMonths: stabilityText ? Number(stabilityText) : durations.length ? Math.round(durations.reduce((sum, item) => sum + item, 0) / durations.length) : null,
    city: cleanField(city),
    company: cleanField(company),
    industry: cleanField(industry),
    expectedSalary: parseSalary(salaryText),
    skills: listedSkills.length ? listedSkills : inferSkills(text),
    certificates: splitResumeList(certificateText),
    workHistory: sectionLines(text, ['工作经历', '工作经验', '职业经历'], ['项目经验', '教育经历', '教育背景', '专业技能', '技能', '证书']),
    projectHistory: sectionLines(text, ['项目经验', '项目经历'], ['教育经历', '教育背景', '专业技能', '技能', '证书', '自我评价']),
  };
}

export function matchResumeJob(role: string, rawText: string, jobs: ResumeJob[]): ResumeJobMatch | null {
  if (!jobs.length) return null;
  const normalizedRole = normalizeJobTitle(role);
  const normalizedText = normalizeJobTitle(normalizeResumeText(rawText));
  let best: ResumeJobMatch | null = null;

  for (const job of jobs) {
    const normalizedTitle = normalizeJobTitle(job.title);
    if (!normalizedTitle) continue;
    const titleScore = titleAlignment(role, rawText, job.title);
    const family = familyFor(job.title);
    const familyEvidence = family ? family.keywords.filter(item => includesTerm(rawText, item)).length : 0;
    const familyScore = family && (family.patterns.some(pattern => pattern.test(role)) || familyEvidence >= 2)
      ? Math.min(88, 68 + familyEvidence * 4) : 0;
    const keywords = jobKeywords(job);
    const keywordHits = keywords.filter(item => includesTerm(rawText, item)).length;
    const keywordScore = keywords.length ? Math.round(keywordHits / keywords.length * 86) : 0;
    const explicitTitle = normalizedText.includes(normalizedTitle) ? 90 : 0;
    const confidence = Math.max(titleScore, familyScore, keywordScore, explicitTitle);
    const reason = titleScore >= 92 ? '应聘职位与岗位名称一致'
      : explicitTitle >= confidence ? '简历全文明确出现该岗位'
        : familyScore >= keywordScore ? '履历与岗位职能方向一致' : '核心技能与岗位要求吻合';
    const threshold = jobs.length === 1 ? 44 : 56;
    if (confidence >= threshold && (!best || confidence > best.confidence)) best = { ...job, confidence, reason };
  }
  return best;
}

export function scoreResumeForJob(parsed: ParsedResume, rawText: string, job: ResumeJob): ResumeMatchAnalysis {
  const keywords = jobKeywords(job);
  const evidence = [rawText, parsed.role, parsed.company, parsed.industry, ...parsed.skills, ...parsed.certificates, ...parsed.workHistory, ...parsed.projectHistory].join(' ');
  const matchedKeywords = keywords.filter(item => includesTerm(evidence, item));
  const missingKeywords = keywords.filter(item => !matchedKeywords.includes(item));
  const titleScore = titleAlignment(parsed.role, evidence, job.title);
  const coverageScore = keywords.length ? Math.round(matchedKeywords.length / keywords.length * 100) : titleScore;
  const keywordScore = Math.round(coverageScore * .62 + titleScore * .38);

  const requiredYears = job.minYears ?? 3;
  const yearsScore = parsed.workYears === null ? 52 : requiredYears > 0 ? Math.min(100, Math.round(parsed.workYears / requiredYears * 100)) : 100;
  const experienceRelevance = Math.max(titleScore, keywordScore);
  const experienceScore = Math.round(yearsScore * .48 + experienceRelevance * .52);

  const educationRank: Record<string, number> = { '高中': 1, '中专': 1, '大专': 2, '本科': 3, '硕士': 4, '博士': 5 };
  const currentEducation = educationRank[parsed.education] || 0;
  const requiredEducation = educationRank[job.minEducation || ''] || 0;
  const educationScore = requiredEducation
    ? currentEducation ? Math.min(100, Math.round(currentEducation / requiredEducation * 100)) : 45
    : currentEducation ? Math.min(100, 48 + currentEducation * 10) : 55;
  const stabilityScore = parsed.stabilityMonths === null ? 58 : Math.min(100, Math.max(30, Math.round(parsed.stabilityMonths / 24 * 100)));

  const weights = [job.keywordWeight ?? 45, job.experienceWeight ?? 25, job.educationWeight ?? 18, job.stabilityWeight ?? 12];
  const totalWeight = Math.max(1, weights.reduce((sum, item) => sum + item, 0));
  const score = Math.round((keywordScore * weights[0] + experienceScore * weights[1] + educationScore * weights[2] + stabilityScore * weights[3]) / totalWeight);
  const level: ResumeMatchAnalysis['level'] = score >= 80 ? '高匹配' : score >= 60 ? '中匹配' : '低匹配';
  const highlights: string[] = [];
  const risks: string[] = [];
  if (titleScore >= 85) highlights.push('岗位方向高度一致');
  if (matchedKeywords.length >= Math.min(4, Math.max(2, Math.ceil(keywords.length * .45)))) highlights.push('核心技能覆盖较好');
  if (parsed.workYears !== null && parsed.workYears >= Math.max(5, requiredYears)) highlights.push('经验年限充足');
  if (parsed.certificates.length) highlights.push('具备相关证书');
  if (job.minYears !== null && job.minYears !== undefined && (parsed.workYears ?? 0) < job.minYears) risks.push('工作年限低于岗位要求');
  if (requiredEducation && currentEducation < requiredEducation) risks.push(parsed.education ? '学历低于岗位要求' : '学历信息待核验');
  if (keywords.length && matchedKeywords.length / keywords.length < .3) risks.push('核心技能覆盖不足');
  if (parsed.stabilityMonths !== null && parsed.stabilityMonths < 12) risks.push('平均任职周期偏短');
  const summary = `${job.title}匹配度 ${score} 分（${level}），已匹配 ${matchedKeywords.length} 项岗位关键词${parsed.workYears === null ? '；工作年限待补充核验' : `；识别工作经验 ${parsed.workYears} 年`}。`;

  return {
    score, level, keywordScore, experienceScore, educationScore, stabilityScore,
    matchedKeywords: matchedKeywords.slice(0, 8), missingKeywords: missingKeywords.slice(0, 6),
    highlights: [...new Set(highlights)], risks: [...new Set(risks)], summary,
  };
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
  const compact = value.replace(/\s+/g, '');
  return compact.match(/^[\u4e00-\u9fa5·]{2,12}$/)?.[0] || '';
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

function inferRole(lines: string[], text: string) {
  const top = lines.slice(0, 28).join('\n').toLowerCase();
  const known = commonRoles.find(role => top.includes(role.toLowerCase()));
  if (known) return known;
  const generic = lines.slice(0, 32).map(line => line.replace(/^(?:目标|意向|应聘|求职|期望)\s*(?:岗位|职位|工作|方向)?\s*[：:|｜-]?\s*/, '').trim()).find(line => line.length >= 2 && line.length <= 32 && /(?:工程师|经理|总监|主管|顾问|专员|设计师|分析师|架构师|会计|出纳|运营|开发|测试)$/.test(line));
  if (generic) return cleanRole(generic);
  const anywhere = commonRoles.find(role => text.toLowerCase().includes(role.toLowerCase()));
  if (anywhere) return anywhere;
  const ranked = roleFamilies.map(family => ({
    role: family.role,
    score: family.patterns.filter(pattern => pattern.test(text)).length * 3 + family.keywords.filter(keyword => includesTerm(text, keyword)).length,
  })).sort((a, b) => b.score - a.score);
  return ranked[0]?.score >= 3 ? ranked[0].role : '';
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

function inferCity(lines: string[]) {
  const cities = ['北京', '上海', '广州', '深圳', '杭州', '南京', '苏州', '成都', '重庆', '武汉', '西安', '天津', '长沙', '郑州', '青岛', '厦门', '合肥', '宁波', '无锡', '福州', '济南'];
  const top = lines.slice(0, 24).join(' ');
  return cities.find(city => top.includes(city)) || '';
}

function inferIndustry(text: string) {
  const industries = [
    ['互联网/软件', /互联网|软件|SaaS|云计算|信息技术/i],
    ['人工智能', /人工智能|大模型|机器学习|深度学习|算法/i],
    ['金融', /银行|证券|基金|保险|金融|支付/i],
    ['电子商务', /电商|电子商务|零售平台/i],
    ['制造业', /制造|工厂|生产线|工业自动化/i],
    ['教育', /教育|培训|学校|课程研发/i],
    ['医疗健康', /医疗|医药|医院|健康管理/i],
    ['房地产/建筑', /房地产|建筑|工程施工|物业/i],
  ] as const;
  return industries.find(([, pattern]) => pattern.test(text))?.[0] || '';
}

function inferSkills(text: string) {
  return knownSkills.filter(skill => includesTerm(text, skill)).slice(0, 20);
}

function employmentDurations(text: string) {
  const values: number[] = [];
  const pattern = /((?:19|20)\d{2})[.\-/年](\d{1,2})?\s*(?:月)?\s*(?:至|到|[-—~～])\s*(?:(今|现在|至今)|((?:19|20)\d{2})[.\-/年](\d{1,2})?\s*(?:月)?)/g;
  const now = new Date();
  for (const match of text.matchAll(pattern)) {
    const startYear = Number(match[1]);
    const startMonth = Number(match[2] || 1);
    const endYear = match[3] ? now.getFullYear() : Number(match[4]);
    const endMonth = match[3] ? now.getMonth() + 1 : Number(match[5] || 12);
    const months = (endYear - startYear) * 12 + endMonth - startMonth + 1;
    if (months > 0 && months <= 600) values.push(months);
  }
  return values.slice(0, 20);
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

function familyFor(value: string) {
  return roleFamilies.find(family => family.patterns.some(pattern => pattern.test(value)));
}

function jobKeywords(job: ResumeJob) {
  const family = familyFor(job.title);
  const supplied = job.keywords || [];
  const titleTerms = job.title.split(/[\s/｜|·、,，()（）-]+/).map(item => item.trim()).filter(item => item.length >= 2);
  return [...new Set([...supplied, ...(family?.keywords || []), ...titleTerms])].filter(Boolean).slice(0, 24);
}

function titleAlignment(role: string, rawText: string, title: string) {
  const normalizedRole = normalizeJobTitle(role);
  const normalizedTitle = normalizeJobTitle(title);
  if (!normalizedTitle) return 0;
  if (normalizedRole === normalizedTitle) return 100;
  if (normalizedRole && (normalizedRole.includes(normalizedTitle) || normalizedTitle.includes(normalizedRole))) return 94;
  const similarity = normalizedRole ? diceSimilarity(normalizedRole, normalizedTitle) : 0;
  const explicit = normalizeJobTitle(rawText).includes(normalizedTitle) ? 90 : 0;
  const roleFamily = familyFor(role);
  const jobFamily = familyFor(title);
  const familyScore = roleFamily && jobFamily && roleFamily.role === jobFamily.role ? 82 : 0;
  return Math.max(explicit, familyScore, similarity >= .45 ? Math.round(55 + similarity * 38) : 0);
}

function includesTerm(value: string, term: string) {
  return value.toLowerCase().includes(term.toLowerCase());
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
