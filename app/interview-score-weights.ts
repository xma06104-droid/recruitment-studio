const SCORE_PRESETS:Record<number,number[]> = {
  1:[100],
  2:[55,45],
  3:[40,35,25],
  4:[30,25,25,20],
  5:[25,20,20,20,15],
  6:[20,20,15,15,15,15],
  7:[20,20,15,15,10,10,10],
  8:[15,15,15,15,10,10,10,10],
  9:[15,15,10,10,10,10,10,10,10],
  10:[10,10,10,10,10,10,10,10,10,10],
};

export function questionMaxScores(count:number,total=100) {
  const safeCount=Math.max(0,Math.min(100,Math.round(count)));
  if(!safeCount)return [];
  const safeTotal=Math.max(safeCount,Math.round(total));
  const preset=SCORE_PRESETS[safeCount];
  if(preset&&safeTotal===100)return [...preset];
  const base=Math.floor(safeTotal/safeCount);
  const remainder=safeTotal-base*safeCount;
  return Array.from({length:safeCount},(_,index)=>base+(index<remainder?1:0));
}

export function weightedQuestionScore(rawScore:number,maxScore:number) {
  const safeRaw=Math.min(100,Math.max(0,Number(rawScore)||0));
  const safeMax=Math.max(1,Math.round(Number(maxScore)||1));
  return Math.round(safeRaw/100*safeMax);
}
