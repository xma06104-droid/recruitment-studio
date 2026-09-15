const GENERIC_FALLBACK = ['职责','行动','结果','复盘'];

const KEYWORD_RULES:{label:string;terms:string[]}[] = [
  {label:'发票真伪',terms:['发票真伪','查验发票','验真']},
  {label:'业务真实性',terms:['业务真实','真实性','真实业务']},
  {label:'票面要素',terms:['票面要素','抬头','税号','日期','盖章','要素齐全']},
  {label:'审批流程',terms:['审批流程','审批是否','审核审批']},
  {label:'费用归属',terms:['入账费用','费用归属','可入账','报销范围']},
  {label:'税务合规',terms:['税务合规','税务风险','纳税','税号','税务']},
  {label:'风险控制',terms:['风险控制','控制风险','风险识别','合规风险']},
  {label:'证据留痕',terms:['证据','留痕','保留记录','原始凭证']},
  {label:'月结',terms:['月结','月末结账','结账流程']},
  {label:'对账',terms:['对账','账账相符','账实相符','账证相符','账表相符']},
  {label:'凭证审核',terms:['凭证审核','凭证异常','会计凭证']},
  {label:'财务报表',terms:['财务报表','资产负债表','利润表','现金流量表']},
  {label:'成本核算',terms:['成本核算','成本控制','成本分析']},
  {label:'预算管理',terms:['预算管理','预算执行','预算控制']},
  {label:'用户需求',terms:['用户需求','用户反馈','需求洞察']},
  {label:'业务价值',terms:['业务价值','商业价值']},
  {label:'需求分析',terms:['需求分析','需求评审','需求优先级']},
  {label:'数据分析',terms:['数据分析','数据指标','数据来源']},
  {label:'方案验证',terms:['验证方案','方案验证','验证过程','可用性测试']},
  {label:'系统架构',terms:['系统架构','架构设计','系统设计']},
  {label:'性能与稳定性',terms:['性能','稳定性','高并发']},
  {label:'可扩展性',terms:['可扩展性','扩展能力']},
  {label:'故障定位',terms:['故障定位','问题定位','排查路径']},
  {label:'根因分析',terms:['根因','原因分析','分析原因']},
  {label:'解决方案',terms:['解决方案','处理方案','改进方案']},
  {label:'沟通协作',terms:['沟通协作','跨团队','相关方','协作对象']},
  {label:'目标与优先级',terms:['目标','优先级','紧急程度']},
  {label:'关键行动',terms:['关键行动','采取行动','改进动作','执行过程']},
  {label:'量化结果',terms:['量化结果','衡量结果','最终结果','结果指标']},
  {label:'复盘改进',terms:['复盘改进','复盘','持续优化','预防措施']},
];

export function isGenericInterviewKeywords(value:string){
  const words=splitKeywords(value);
  return !words.length||words.length===GENERIC_FALLBACK.length&&GENERIC_FALLBACK.every(word=>words.includes(word));
}

export function deriveInterviewKeywords(title:string,referenceAnswer:string,competency='',configured=''){
  if(configured.trim()&&!isGenericInterviewKeywords(configured))return normalizeKeywords(configured);
  const source=`${title} ${referenceAnswer} ${competency}`.replace(/\s+/g,'').toLowerCase();
  const matched=KEYWORD_RULES.filter(rule=>rule.terms.some(term=>source.includes(term.replace(/\s+/g,'').toLowerCase()))).map(rule=>rule.label);
  const usefulCompetency=competency.trim()&&!/^(综合能力|通用素质|综合素质)$/.test(competency.trim())?competency.trim():'';
  const result=[...new Set([...matched,usefulCompetency].filter(Boolean))].slice(0,8);
  return (result.length>=3?result:[...result,...GENERIC_FALLBACK.filter(word=>!result.includes(word))].slice(0,6)).join('，');
}

function splitKeywords(value:string){return value.split(/[,，、;；/|]/).map(item=>item.trim()).filter(Boolean)}
function normalizeKeywords(value:string){return [...new Set(splitKeywords(value))].slice(0,10).join('，')}
