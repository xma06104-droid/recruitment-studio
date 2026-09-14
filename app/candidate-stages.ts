export const CANDIDATE_STAGES = ['简历筛选', 'AI面试', '用人部门筛选', '安排面试', '录用', '待入职', '已入职'] as const;

export const REJECTED_CANDIDATE_STAGES = new Set(['初筛淘汰', '淘汰人才库', '已淘汰']);

const LEGACY_STAGE_MAP: Record<string, (typeof CANDIDATE_STAGES)[number] | '待定' | '已淘汰'> = {
  '待初筛': '简历筛选',
  '待复核': '简历筛选',
  'AI 初筛': '简历筛选',
  'AI 初面待发起': 'AI面试',
  '已发起AI面试邀请': 'AI面试',
  '面试待安排': '安排面试',
  '待沟通': '待定',
  '一面': '安排面试',
  '技术面': '安排面试',
  '二面': '安排面试',
  'Offer': '录用',
  '初筛淘汰': '已淘汰',
  '淘汰人才库': '已淘汰',
};

export function normalizeCandidateStage(stage: string) {
  return LEGACY_STAGE_MAP[stage] || stage || '简历筛选';
}

export function displayCandidateStage(stage: string) {
  const normalized = normalizeCandidateStage(stage);
  return normalized === '用人部门筛选' ? '待用人部门审核' : normalized;
}

export function candidateStageIndex(stage: string) {
  const index = CANDIDATE_STAGES.indexOf(normalizeCandidateStage(stage) as (typeof CANDIDATE_STAGES)[number]);
  return index < 0 ? 0 : index;
}
