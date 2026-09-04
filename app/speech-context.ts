export type SpeechQuestionContext = {
  title:string;
  competency?:string;
  keywords?:string;
  category?:string;
};

type SpeechAlternative = { transcript:string; confidence?:number };

const COMMON_HINTS = ['工作流程','核心职责','项目经验','风险控制','沟通协作','量化结果','复盘改进'];

const ROLE_HINTS:[RegExp,string[]][] = [
  [/会计|财务|审计|出纳|税务/,['月结','对账','账务','核算','凭证','财务报表','资产负债表','利润表','现金流量表','账实相符','账证相符','账账相符','账表相符','总账','明细账','应收账款','应付账款','纳税申报','税务合规','内部控制','原始凭证','银行流水','成本核算']],
  [/测试|质量保证|QA|QE/i,['测试用例','功能测试','接口测试','性能测试','兼容性测试','回归测试','自动化测试','缺陷管理','质量保证','测试报告','问题定位','复现步骤','验收标准']],
  [/开发|工程师|程序|前端|后端|Java|Python|Go|算法/i,['系统设计','技术方案','接口设计','数据库','高并发','性能优化','稳定性','可扩展性','故障定位','根因分析','代码评审','持续集成','微服务']],
  [/产品|运营/,['用户需求','需求分析','需求评审','需求优先级','产品规划','用户反馈','数据分析','转化率','留存率','迭代方案','业务价值','用户体验']],
  [/人力|招聘|HR/i,['岗位画像','人才招聘','简历筛选','面试评估','候选人','胜任力','人才盘点','员工关系','绩效管理','薪酬福利']],
  [/设计|视觉|交互/,['用户体验','视觉设计','交互设计','设计规范','用户研究','设计评审','可用性测试','品牌一致性']],
  [/销售|商务|客户/,['客户需求','销售目标','商机管理','转化率','客单价','商务谈判','客户关系','回款','复购率']],
];

const SUSPICIOUS_BY_ROLE:[RegExp,string[]][] = [
  [/会计|财务|审计|出纳|税务/,['治疗','宝座','障碍体系','障碍处理','对长','凭正','报婊','税误']],
  [/测试|质量保证|QA|QE/i,['测是','测式','接头测试','用力测试']],
  [/产品|运营/,['需球','产平','数句分析','用户体检']],
  [/开发|工程师|程序|前端|后端|Java|Python|Go|算法/i,['接头设计','数句库','微服物','代码平审']],
];

export function buildSpeechHints(jobTitle:string,question:SpeechQuestionContext){
  const context=`${jobTitle} ${question.title} ${question.category||''} ${question.competency||''} ${question.keywords||''}`;
  const configured=context.split(/[\s,，、;；/|：:（）()？?。！!]+/).map(item=>item.trim()).filter(item=>/^[\p{Script=Han}A-Za-z0-9+#.\-]{2,18}$/u.test(item));
  const roleHints=ROLE_HINTS.flatMap(([pattern,hints])=>pattern.test(context)?hints:[]);
  return Array.from(new Set([...configured,...roleHints,...COMMON_HINTS])).slice(0,40);
}

export function contextualizeSpeechTranscript(value:string,jobTitle:string,question:SpeechQuestionContext){
  let text=String(value||'').replace(/\s+/g,' ').trim();
  const context=`${jobTitle} ${question.title} ${question.category||''} ${question.competency||''} ${question.keywords||''}`;
  if(/会计|财务|审计|出纳|税务|月结|对账|凭证|报表/.test(context)){
    const accountingCorrections:[RegExp,string][]=[
      [/保证工作治疗/g,'保证工作质量'],[/工作治疗/g,'工作质量'],[/治疗控制/g,'质量控制'],
      [/宝座(?=工作|质量|准确|及时|数据|报表|流程)/g,'保证'],[/保证宝座/g,'保证'],
      [/障碍体系/g,'账务体系'],[/障碍处理/g,'账务处理'],[/障碍核算/g,'账务核算'],
      [/账实不服/g,'账实不符'],[/对长/g,'对账'],[/凭正/g,'凭证'],[/报婊/g,'报表'],[/税误/g,'税务'],
      [/帐务/g,'账务'],[/对帐/g,'对账'],[/记帐/g,'记账'],[/错帐/g,'错账'],[/结帐/g,'结账'],
      [/资产负责表/g,'资产负债表'],[/现今流量表/g,'现金流量表'],[/应收帐款/g,'应收账款'],[/应付帐款/g,'应付账款'],
    ];
    for(const [pattern,replacement] of accountingCorrections)text=text.replace(pattern,replacement);
  }
  if(/测试|质量保证|QA|QE/i.test(context)){
    const testingCorrections:[RegExp,string][]=[[/测是用例/g,'测试用例'],[/功能测是/g,'功能测试'],[/接口测是/g,'接口测试'],[/性能测是/g,'性能测试'],[/回归测是/g,'回归测试'],[/自栋化测试/g,'自动化测试'],[/质量宝座/g,'质量保证']];
    for(const [pattern,replacement] of testingCorrections)text=text.replace(pattern,replacement);
  }
  if(/产品|运营|需求/.test(context)){
    const productCorrections:[RegExp,string][]=[[/用户需球/g,'用户需求'],[/需球分析/g,'需求分析'],[/需球评审/g,'需求评审'],[/产平规划/g,'产品规划'],[/用户体检/g,'用户体验'],[/数句分析/g,'数据分析']];
    for(const [pattern,replacement] of productCorrections)text=text.replace(pattern,replacement);
  }
  if(/开发|工程师|程序|前端|后端|Java|Python|Go|算法|系统|技术/i.test(context)){
    const technicalCorrections:[RegExp,string][]=[[/数句库/g,'数据库'],[/接头设计/g,'接口设计'],[/微服物/g,'微服务'],[/代码平审/g,'代码评审'],[/跟因分析/g,'根因分析']];
    for(const [pattern,replacement] of technicalCorrections)text=text.replace(pattern,replacement);
  }
  return text;
}

export function selectContextualSpeechTranscript(alternatives:SpeechAlternative[],jobTitle:string,question:SpeechQuestionContext){
  const hints=buildSpeechHints(jobTitle,question);
  const suspicious=SUSPICIOUS_BY_ROLE.flatMap(([pattern,terms])=>pattern.test(`${jobTitle} ${question.title} ${question.competency||''}`)?terms:[]);
  let selected='';let selectedScore=-Infinity;
  for(const alternative of alternatives){
    const raw=String(alternative?.transcript||'').replace(/\s+/g,' ').trim();
    if(!raw)continue;
    const corrected=contextualizeSpeechTranscript(raw,jobTitle,question);
    const compact=corrected.toLowerCase().replace(/\s+/g,'');
    const contextScore=hints.reduce((score,hint)=>score+(compact.includes(hint.toLowerCase().replace(/\s+/g,''))?Math.min(8,hint.length)*1.8:0),0);
    const suspiciousPenalty=suspicious.reduce((score,term)=>score+(raw.includes(term)?6:0),0);
    const confidence=Number.isFinite(alternative.confidence)?Number(alternative.confidence):0.5;
    const score=confidence*10+contextScore-suspiciousPenalty;
    if(score>selectedScore){selectedScore=score;selected=corrected}
  }
  return selected;
}
