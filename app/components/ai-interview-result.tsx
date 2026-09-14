'use client';

import { questionMaxScores, weightedQuestionScore } from '@/app/interview-score-weights';

export const AI_REPORT_PREFIX = '__AI_REPORT_V1__';

export type StructuredAiInterviewResult = {
  version: 1;
  source: 'external-report' | 'system-interview';
  rating: number;
  ratingMax: number;
  duration: string;
  summary: string;
  dimensions: { name: string; stars: number; score?: number; max?: number; suggestion: string }[];
  presentation: { name: string; score: number; max: number; comment: string }[];
  cognitive?: { score: number; max: number; comment: string };
  personality?: { name: string; score: number }[];
  followUp: string;
  completedAt?: string;
};

export function parseStructuredAiResult(summary: string): StructuredAiInterviewResult | null {
  if (!summary.startsWith(AI_REPORT_PREFIX)) return null;
  try {
    const value = JSON.parse(summary.slice(AI_REPORT_PREFIX.length)) as Partial<StructuredAiInterviewResult>;
    if (value.version !== 1 || value.source !== 'external-report' || !value.summary) return null;
    return {
      version: 1,
      source: 'external-report',
      rating: Math.round(clamp(value.rating, 0, 5)),
      ratingMax: clamp(value.ratingMax, 1, 5),
      duration: clean(value.duration),
      summary: clean(value.summary),
      dimensions: Array.isArray(value.dimensions) ? value.dimensions.slice(0, 12).map(item => ({
        name: clean(item?.name), stars: Math.round(clamp(item?.stars, 0, 5)), suggestion: clean(item?.suggestion),
      })).filter(item => item.name) : [],
      presentation: Array.isArray(value.presentation) ? value.presentation.slice(0, 8).map(item => ({
        name: clean(item?.name), score: clamp(item?.score, 0, 100), max: clamp(item?.max, 1, 100), comment: clean(item?.comment),
      })).filter(item => item.name) : [],
      cognitive: value.cognitive ? { score:clamp(value.cognitive.score, 0, 100), max:clamp(value.cognitive.max, 1, 100), comment:clean(value.cognitive.comment) } : undefined,
      personality: Array.isArray(value.personality) ? value.personality.slice(0, 12).map(item => ({ name:clean(item?.name), score:clamp(item?.score, 0, 100) })).filter(item => item.name) : undefined,
      followUp: clean(value.followUp),
      completedAt: clean(value.completedAt),
    };
  } catch {
    return null;
  }
}

export function aiResultScoreLabel(summary: string, fallback: number | null) {
  return `${normalizeAiInterviewResult(summary, fallback).rating}星`;
}

export function aiInterviewQuestionTotal(summary:string,fallbackScore:number|null){
  const result=normalizeAiInterviewResult(summary,fallbackScore);
  if(result.source!=='system-interview')return null;
  const items=parseLegacyInterviewSummary(summary).items;
  if(items.length){
    const scores=resolveQuestionScores(items);
    return {
      score:scores.reduce((sum,item)=>sum+item.score,0),
      max:scores.reduce((sum,item)=>sum+item.max,0),
    };
  }
  return {
    score:fallbackScore===null?0:Math.round(clamp(fallbackScore,0,100)),
    max:100,
  };
}

export function AiInterviewResultPanel({ summary, fallbackScore, durationSeconds = null, completedAt = null, compact = false }:{ summary:string; fallbackScore:number|null; durationSeconds?:number|null; completedAt?:string|null; compact?:boolean }) {
  const result = normalizeAiInterviewResult(summary, fallbackScore, durationSeconds, completedAt);
  const usesQuestionTotal=result.source==='system-interview'&&result.dimensions.length>0;
  const questionTotal=result.dimensions.reduce((total,item)=>total+item.stars,0);
  const usesSystemScore=result.source==='system-interview';
  const systemTotal=aiInterviewQuestionTotal(summary,fallbackScore);
  const displayScore=systemTotal?.score??result.rating;
  const displayMax=systemTotal?.max??result.ratingMax;
  const averageRating=usesQuestionTotal?questionTotal/result.dimensions.length:result.rating;
  const stars = Array.from({ length:result.ratingMax }, (_, index) => index < Math.round(averageRating) ? '★' : '☆').join('');
  return <div className={`structured-ai-result${compact?' compact':''}`}>
    <section className="structured-ai-hero">
      <div><strong>{displayScore}</strong><span>/ {displayMax}</span><small>{usesSystemScore?'综合总分':'综合评价'}</small></div>
      <div><b aria-label={`平均 ${averageRating.toFixed(1)} 星`}>{stars}</b><p>{result.summary}</p>{(result.duration||result.completedAt)&&<time>{result.duration&&`面试用时：${result.duration}`}{result.duration&&result.completedAt?'　·　':''}{result.completedAt&&`完成于 ${result.completedAt}`}</time>}</div>
    </section>

    {result.dimensions.length>0&&<section className="structured-ai-section">
      <header><h3>能力维度与答题表现</h3><span>{usesSystemScore?'各题满分合计：100 分':'统一量纲：5 星'}</span></header>
      <div className="structured-ai-dimensions">{result.dimensions.map(item=>{
        const itemScore=usesSystemScore?(item.score??item.stars*20):item.stars;
        const itemMax=usesSystemScore?(item.max??100):5;
        return <article key={item.name}>
          <div><b>{item.name}</b><em>{itemScore} / {itemMax}</em></div>
          <i><span style={{width:`${clamp(itemScore/itemMax*100,0,100)}%`}}/></i>
          {item.suggestion&&<p>{item.suggestion}</p>}
        </article>;
      })}</div>
    </section>}

    {(result.presentation.length>0||result.cognitive)&&<section className="structured-ai-section">
      <header><h3>面试表现</h3><span>分项结果</span></header>
      <div className="structured-ai-metrics">
        {result.presentation.map(item=><article key={item.name}><div><b>{item.name}</b><strong>{item.score}<small>/{item.max}</small></strong></div><p>{item.comment}</p></article>)}
        {result.cognitive&&<article><div><b>认知推理</b><strong>{result.cognitive.score}<small>/{result.cognitive.max}</small></strong></div><p>{result.cognitive.comment}</p></article>}
      </div>
    </section>}

    {result.personality?.length?<section className="structured-ai-section">
      <header><h3>性格测评参考</h3><span>仅作为面试辅助信息</span></header>
      <div className="structured-ai-personality">{result.personality.map(item=><span key={item.name}><b>{item.name}</b><em>{item.score}</em></span>)}</div>
    </section>:null}

    {result.followUp&&<section className="structured-ai-followup"><span>→</span><div><h3>后续面试建议</h3><p>{result.followUp}</p></div></section>}
    <p className="structured-ai-note">该结果来自已完成的 AI 面试记录，已按统一报告框架整理；应结合简历、人工面试和岗位要求综合判断，不建议作为单一录用依据。{fallbackScore!==null?` 系统原始得分：${fallbackScore}。`:''}</p>
  </div>;
}

export function normalizeAiInterviewResult(summary:string, fallbackScore:number|null, durationSeconds:number|null = null, completedAt:string|null = null):StructuredAiInterviewResult {
  const structured=parseStructuredAiResult(summary);
  if(structured)return structured;
  const parsed=parseLegacyInterviewSummary(summary);
  const score=clamp(fallbackScore,0,100);
  const answered=parsed.items.filter(item=>item.answer&&item.answer!=='未作答').length;
  const answerRate=parsed.items.length?Math.round(answered/parsed.items.length*100):score;
  const resolvedScores=resolveQuestionScores(parsed.items);
  const weakItems=parsed.items.filter(item=>questionScoreRate(item)<60).sort((a,b)=>questionScoreRate(a)-questionScoreRate(b)).slice(0,3);
  const dimensions=parsed.items.map((item,index)=>({
    name:`第 ${item.number} 题 · ${item.question}`,
    stars:Math.round(questionScoreRate(item)/20),
    score:resolvedScores[index].score,
    max:resolvedScores[index].max,
    suggestion:[item.keywords&&item.keywords!=='无'?`命中关键词：${item.keywords}`:'未命中配置关键词',item.answer&&item.answer!=='未作答'?`完整转写：${item.answer}`:'本题未有效作答'].join('；'),
  }));
  const presentation=[
    {name:'综合匹配度',score,max:100,comment:'基于面试题、岗位关键词和候选人实际回答生成的系统原始评分。'},
    ...(parsed.items.length?[{name:'有效作答率',score:answerRate,max:100,comment:`共 ${parsed.items.length} 道题，其中 ${answered} 道检测到有效回答。`}]:[]),
  ];
  const followUp=weakItems.length
    ? buildCandidateFocus(weakItems,answerRate)
    : score>=80
      ? '整体回答与岗位要求匹配度较高，建议下一轮重点验证关键经历的真实性、复杂场景判断和协作方式。'
      : '建议下一轮结合岗位核心职责补充追问，并要求候选人提供具体场景、个人行动和量化结果。';
  return {
    version:1,
    source:'system-interview',
    rating:Math.round(score/20),
    ratingMax:5,
    duration:formatDuration(durationSeconds),
    summary:parsed.intro||clean(summary)||'该候选人的 AI 面试已完成，暂无文字总结。',
    dimensions,
    presentation,
    followUp,
    completedAt:formatCompletedAt(completedAt),
  };
}

function parseLegacyInterviewSummary(summary:string){
  const blocks=summary.split(/\n{2,}(?=\d+\.\s)/);
  const intro=(blocks.shift()||'').trim();
  const items=blocks.map(block=>{
    const lines=block.split('\n');
    const heading=(lines.shift()||'').match(/^(\d+)\.\s*(.*?)（(?:得分\s*)?(?:(\d+)\s*\/\s*(\d+)|(\d+)分)）\s*$/);
    if(!heading)return null;
    const keywordLine=lines.find(line=>line.startsWith('命中关键词：'))||'';
    const answerIndex=lines.findIndex(line=>line.startsWith('回答：'));
    return {number:Number(heading[1]),question:heading[2].trim(),score:Number(heading[3]||heading[5]),max:heading[4]?Number(heading[4]):null,keywords:keywordLine.replace(/^命中关键词：/,'').trim()||'无',answer:answerIndex>=0?lines.slice(answerIndex).join('\n').replace(/^回答：/,'').trim():'未作答'};
  }).filter(Boolean) as LegacyQuestionScore[];
  return {intro,items};
}

type LegacyQuestionScore={number:number;question:string;score:number;max:number|null;keywords:string;answer:string};

function resolveQuestionScores(items:LegacyQuestionScore[]){
  const defaults=questionMaxScores(items.length);
  return items.map((item,index)=>{
    if(item.max!==null)return {score:Math.round(clamp(item.score,0,item.max)),max:Math.round(clamp(item.max,1,100))};
    const max=defaults[index]||1;
    return {score:weightedQuestionScore(item.score,max),max};
  });
}

function questionScoreRate(item:LegacyQuestionScore){
  return item.max===null?clamp(item.score,0,100):clamp(item.score/Math.max(1,item.max)*100,0,100);
}

function buildCandidateFocus(items:{question:string;score:number;answer:string}[],answerRate:number){
  const focuses=items.map(item=>{
    if(!item.answer||item.answer==='未作答')return '表达完整性与信息有效性：确认候选人能否在限定时间内完整陈述背景、行动、结果和个人贡献';
    if(/系统|架构|设计|技术取舍|核心技术/.test(item.question))return '核心技术与系统设计能力：重点核验技术栈掌握深度、方案边界、关键取舍及风险意识';
    if(/故障|难题|定位|解决|异常|问题/.test(item.question))return '复杂问题分析与闭环能力：重点考察问题拆解、定位路径、决策依据和复盘改进';
    if(/项目|经历|案例/.test(item.question))return '项目经历真实性与个人贡献：核验候选人在代表项目中的职责边界、实际产出及量化结果';
    if(/职责|岗位|理解|胜任/.test(item.question))return '岗位理解与胜任能力：确认候选人对核心职责、质量标准和业务目标的理解是否准确';
    if(/目标|资源|团队|协作|推进|冲突/.test(item.question))return '目标推进与协作能力：考察资源受限场景下的优先级判断、沟通方式和结果交付';
    return '岗位核心能力的实际应用：结合真实工作场景核验候选人的判断依据、行动过程和结果质量';
  });
  if(answerRate<80)focuses.push('回答稳定性与沟通表达：重点观察信息组织、重点提炼及连续追问下的表达一致性');
  const unique=[...new Set(focuses)].slice(0,3);
  return `建议下一步重点考察：${unique.map((focus,index)=>`${index+1}. ${focus}`).join('；')}。`;
}

function formatDuration(seconds:number|null){
  if(seconds===null||!Number.isFinite(seconds)||seconds<=0)return '';
  const minutes=Math.floor(seconds/60);
  const rest=Math.round(seconds%60);
  return minutes?`${minutes}分${rest}秒`:`${rest}秒`;
}

function formatCompletedAt(value:string|null){
  if(!value)return '';
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return '';
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
}

function clean(value: unknown) {
  return String(value ?? '').trim().slice(0, 3000);
}

function clamp(value: unknown, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : min;
}
