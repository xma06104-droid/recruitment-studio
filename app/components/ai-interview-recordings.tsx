'use client';

import { useEffect, useState } from 'react';
import fixWebmDuration from 'fix-webm-duration';

type InterviewRecording = {
  id:string; questionId:string; questionTitle:string; contentType:string; sizeBytes:number;
  durationSeconds:number; createdAt:string; playbackUrl:string;
};

export default function AiInterviewRecordings({candidateId}:{candidateId:string}){
  const [recordings,setRecordings]=useState<InterviewRecording[]>([]);
  const [selectedId,setSelectedId]=useState('');
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [playbackUrl,setPlaybackUrl]=useState('');

  useEffect(()=>{
    const controller=new AbortController();
    setLoading(true);setError('');setRecordings([]);setSelectedId('');
    void fetch(`/api/interview-recordings?candidateId=${encodeURIComponent(candidateId)}`,{cache:'no-store',signal:controller.signal}).then(async response=>{
      const result=await response.json().catch(()=>({})) as {recordings?:InterviewRecording[];message?:string};
      if(!response.ok)throw new Error(result.message||'录音读取失败');
      const items=result.recordings||[];setRecordings(items);setSelectedId(items[0]?.id||'');
    }).catch(reason=>{if(reason?.name!=='AbortError')setError('面试录音暂时无法读取，请稍后重试。')}).finally(()=>setLoading(false));
    return()=>controller.abort();
  },[candidateId]);

  useEffect(()=>{
    const selected=recordings.find(item=>item.id===selectedId)||recordings[0];
    if(!selected){setPlaybackUrl('');return}
    if(!selected.contentType.includes('webm')){setPlaybackUrl(selected.playbackUrl);return}
    const controller=new AbortController();let objectUrl='';
    setPlaybackUrl('');
    void fetch(selected.playbackUrl,{cache:'no-store',signal:controller.signal}).then(response=>{
      if(!response.ok)throw new Error('recording-fetch-failed');
      return response.blob();
    }).then(blob=>fixWebmDuration(blob,Math.max(1000,selected.durationSeconds*1000),{logger:false})).then(fixed=>{
      if(controller.signal.aborted)return;
      objectUrl=URL.createObjectURL(fixed);setPlaybackUrl(objectUrl);
    }).catch(reason=>{if(reason?.name!=='AbortError')setPlaybackUrl(selected.playbackUrl)});
    return()=>{controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl)};
  },[recordings,selectedId]);

  if(loading)return <div className="ai-recordings-state">正在读取面试录音…</div>;
  if(error)return <div className="ai-recordings-state error">{error}</div>;
  if(!recordings.length)return <div className="ai-recordings-state"><b>暂无可回放录音</b><span>新完成的 AI 面试会按题保存原始音频。</span></div>;
  const selected=recordings.find(item=>item.id===selectedId)||recordings[0];
  return <section className="ai-recordings-panel">
    <header><div><h3>AI 面试录音</h3><p>当前保存原始音频，同时兼容后续视频回放</p></div><span>{recordings.length} 段</span></header>
    <div className="ai-recordings-layout">
      <div className={`ai-recording-player ${selected.contentType.startsWith('audio/')?'audio':'video'}`}>{playbackUrl?(selected.contentType.startsWith('audio/')?<audio key={`${selected.id}-${playbackUrl}`} controls preload="metadata" src={playbackUrl}/>:<video key={`${selected.id}-${playbackUrl}`} controls playsInline preload="metadata" src={playbackUrl}/>):<div className="ai-recording-preparing">正在校准录音时长…</div>}<div><b>{selected.questionTitle}</b><span>{formatDuration(selected.durationSeconds)} · {formatSize(selected.sizeBytes)}</span></div></div>
      <div className="ai-recording-list">{recordings.map((item,index)=><button type="button" key={item.id} className={item.id===selected.id?'active':''} onClick={()=>setSelectedId(item.id)}><i>{String(index+1).padStart(2,'0')}</i><span><b>{item.questionTitle}</b><small>{formatDuration(item.durationSeconds)} · {formatSize(item.sizeBytes)}</small></span><em>▶</em></button>)}</div>
    </div>
  </section>;
}

function formatDuration(seconds:number){const safe=Math.max(0,Math.round(seconds||0));return `${Math.floor(safe/60)}:${String(safe%60).padStart(2,'0')}`;}
function formatSize(bytes:number){const safe=Math.max(0,bytes||0);return safe>=1024*1024?`${(safe/1024/1024).toFixed(1)} MB`:`${Math.max(1,Math.round(safe/1024))} KB`;}
