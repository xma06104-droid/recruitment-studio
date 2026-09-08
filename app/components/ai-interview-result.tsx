'use client';

export const AI_REPORT_PREFIX = '__AI_REPORT_V1__';

export type StructuredAiInterviewResult = {
  version: 1;
  source: 'external-report';
  rating: number;
  ratingMax: number;
  duration: string;
  summary: string;
  dimensions: { name: string; stars: number; suggestion: string }[];
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
      rating: clamp(value.rating, 0, 5),
      ratingMax: clamp(value.ratingMax, 1, 5),
      duration: clean(value.duration),
      summary: clean(value.summary),
      dimensions: Array.isArray(value.dimensions) ? value.dimensions.slice(0, 12).map(item => ({
        name: clean(item?.name), stars: clamp(item?.stars, 0, 5), suggestion: clean(item?.suggestion),
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
  const result = parseStructuredAiResult(summary);
  return result ? `${result.rating}星` : String(fallback ?? '—');
}

export function AiInterviewResultPanel({ summary, fallbackScore, compact = false }:{ summary:string; fallbackScore:number|null; compact?:boolean }) {
  const result = parseStructuredAiResult(summary);
  if (!result) return null;
  const stars = Array.from({ length:result.ratingMax }, (_, index) => index < Math.round(result.rating) ? '★' : '☆').join('');
  return <div className={`structured-ai-result${compact?' compact':''}`}>
    <section className="structured-ai-hero">
      <div><strong>{result.rating}</strong><span>/ {result.ratingMax}</span><small>综合评价</small></div>
      <div><b aria-label={`${result.rating} 星`}>{stars}</b><p>{result.summary}</p>{(result.duration||result.completedAt)&&<time>{result.duration&&`面试用时：${result.duration}`}{result.duration&&result.completedAt?'　·　':''}{result.completedAt&&`完成于 ${result.completedAt}`}</time>}</div>
    </section>

    {result.dimensions.length>0&&<section className="structured-ai-section">
      <header><h3>核心胜任力</h3><span>原报告量纲：5 星</span></header>
      <div className="structured-ai-dimensions">{result.dimensions.map(item=><article key={item.name}>
        <div><b>{item.name}</b><em>{item.stars} / 5</em></div>
        <i><span style={{width:`${item.stars/5*100}%`}}/></i>
        {item.suggestion&&<p>{item.suggestion}</p>}
      </article>)}</div>
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
    <p className="structured-ai-note">该结果来自已完成的 AI 面试报告，应结合简历、人工面试和岗位要求综合判断，不建议作为单一录用依据。{fallbackScore!==null?` 系统归一化分：${fallbackScore}。`:''}</p>
  </div>;
}

function clean(value: unknown) {
  return String(value ?? '').trim().slice(0, 3000);
}

function clamp(value: unknown, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : min;
}
