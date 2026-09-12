'use client';

import { useEffect, useState } from 'react';

type InterviewRecording = {
  id:string; questionId:string; questionTitle:string; contentType:string; sizeBytes:number;
  durationSeconds:number; createdAt:string; playbackUrl:string;
};

export default function AiInterviewRecordings({candidateId}:{candidateId:string}){
  const [recordings,setRecordings]=useState<InterviewRecording[]>([]);
  const [selectedId,setSelectedId]=useState('');
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');

  useEffect(()=>{
    const controller=new AbortController();
    setLoading(true);setError('');setRecordings([]);setSelectedId('');
    void fetch(`/api/interview-recordings?candidateId=${encodeURIComponent(candidateId)}`,{cache:'no-store',signal:controller.signal}).then(async response=>{
      const result=await response.json().catch(()=>({})) as {recordings?:InterviewRecording[];message?:string};
      if(!response.ok)throw new Error(result.message||'录像读取失败');
      const items=result.recordings||[];setRecordings(items);setSelectedId(items[0]?.id||'');
    }).catch(reason=>{if(reason?.name!=='AbortError')setError('面试录像暂时无法读取，请稍后重试。')}).finally(()=>setLoading(false));
    return()=>controller.abort();
  },[candidateId]);

  if(loading)return <div className="ai-recordings-state">正在读取面试录像…</div>;
  if(error)return <div className="ai-recordings-state error">{error}</div>;
  if(!recordings.length)return <div className="ai-recordings-state"><b>暂无可回放录像</b><span>新完成的 AI 面试会按题保存音视频。</span></div>;
  const selected=recordings.find(item=>item.id===selectedId)||recordings[0];
  return <section className="ai-recordings-panel">
    <header><div><h3>AI 面试录像</h3><p>仅超级管理员和该候选人的接收 HR 可查看</p></div><span>{recordings.length} 段</span></header>
    <div className="ai-recordings-layout">
      <div className="ai-recording-player"><video key={selected.id} controls playsInline preload="metadata" src={selected.playbackUrl}/><div><b>{selected.questionTitle}</b><span>{formatDuration(selected.durationSeconds)} · {formatSize(selected.sizeBytes)}</span></div></div>
      <div className="ai-recording-list">{recordings.map((item,index)=><button type="button" key={item.id} className={item.id===selected.id?'active':''} onClick={()=>setSelectedId(item.id)}><i>{String(index+1).padStart(2,'0')}</i><span><b>{item.questionTitle}</b><small>{formatDuration(item.durationSeconds)} · {formatSize(item.sizeBytes)}</small></span><em>▶</em></button>)}</div>
    </div>
  </section>;
}

function formatDuration(seconds:number){const safe=Math.max(0,Math.round(seconds||0));return `${Math.floor(safe/60)}:${String(safe%60).padStart(2,'0')}`;}
function formatSize(bytes:number){const safe=Math.max(0,bytes||0);return safe>=1024*1024?`${(safe/1024/1024).toFixed(1)} MB`:`${Math.max(1,Math.round(safe/1024))} KB`;}
