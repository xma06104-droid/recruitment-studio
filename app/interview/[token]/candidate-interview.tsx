'use client';

import { useEffect, useRef, useState } from 'react';
import { buildSpeechHints, contextualizeSpeechTranscript, selectContextualSpeechTranscript } from '@/app/speech-context';

type Question = { id:string; title:string; duration:number; questionType:string; competency?:string };
type Invitation = { id:string; candidateName:string; jobTitle:string; status:string; expiresAt:string };
type SpeechAlternativeLike = { transcript:string;confidence?:number };
type SpeechResultLike = { [index:number]:SpeechAlternativeLike;length:number;isFinal?:boolean };
type SpeechRecognitionEventLike = { resultIndex?:number;results:ArrayLike<SpeechResultLike> };
type SpeechRecognitionPhraseLike = { phrase:string;boost:number };
type SpeechRecognitionLike = { lang:string;continuous:boolean;interimResults:boolean;maxAlternatives?:number;phrases?:SpeechRecognitionPhraseLike[];processLocally?:boolean;start:()=>void;stop:()=>void;abort:()=>void;onresult:((event:SpeechRecognitionEventLike)=>void)|null;onspeechstart:(()=>void)|null;onspeechend:(()=>void)|null;onend:(()=>void)|null;onerror:((event:{error?:string})=>void)|null };
type SpeechRecognitionOptionsLike = { langs:string[];processLocally:boolean;quality:'dictation' };
type SpeechRecognitionConstructor = {
  new():SpeechRecognitionLike;
  available?:(options:SpeechRecognitionOptionsLike)=>Promise<'available'|'downloadable'|'downloading'|'unavailable'>;
  install?:(options:SpeechRecognitionOptionsLike)=>Promise<boolean>;
};

export default function CandidateInterview({ token }:{ token:string }) {
  const videoRef=useRef<HTMLVideoElement>(null);
  const streamRef=useRef<MediaStream|null>(null);
  const recognitionRef=useRef<SpeechRecognitionLike|null>(null);
  const recorderRef=useRef<MediaRecorder|null>(null);
  const recordingChunksRef=useRef<Blob[]>([]);
  const pendingRecordingsRef=useRef<Record<string,Blob>>({});
  const transcriptRef=useRef<Record<string,string>>({});
  const committedTranscriptRef=useRef<Record<string,string>>({});
  const listenWantedRef=useRef(false);
  const recognitionGenerationRef=useRef(0);
  const speechRestartTimerRef=useRef<number|null>(null);
  const speechWatchdogTimerRef=useRef<number|null>(null);
  const speechPendingTimerRef=useRef<number|null>(null);
  const speechFailureCountRef=useRef(0);
  const preferLocalSpeechRef=useRef(false);
  const startedAt=useRef(0);
  const [invitation,setInvitation]=useState<Invitation|null>(null);
  const [questions,setQuestions]=useState<Question[]>([]);
  const [phase,setPhase]=useState<'loading'|'intro'|'interview'|'complete'|'error'>('loading');
  const [error,setError]=useState('');
  const [index,setIndex]=useState(0);
  const [answers,setAnswers]=useState<Record<string,string>>({});
  const [seconds,setSeconds]=useState(120);
  const [listening,setListening]=useState(false);
  const [speechPending,setSpeechPending]=useState(false);
  const [speechMode,setSpeechMode]=useState<'preparing'|'local'|'online'>('online');
  const [speechNotice,setSpeechNotice]=useState('');
  const [recording,setRecording]=useState(false);
  const [camera,setCamera]=useState<'idle'|'ready'|'blocked'|'denied'>('idle');
  const [saving,setSaving]=useState(false);
  const question=questions[index];

  useEffect(()=>{
    void fetch(`/api/interview/${encodeURIComponent(token)}`,{cache:'no-store'}).then(async response=>{
      const result=await response.json().catch(()=>({})) as {message?:string;invitation?:Invitation;questions?:Question[]};
      if(!response.ok||!result.invitation){setError(result.message||'无法读取面试邀请。');setPhase('error');return}
      setInvitation(result.invitation);setQuestions(result.questions||[]);
      setPhase(result.invitation.status==='已完成'?'complete':'intro');
    }).catch(()=>{setError('网络连接失败，请稍后重试。');setPhase('error')});
    return()=>stopDevices();
  },[token]);

  useEffect(()=>{
    if(phase!=='interview'||!question)return;
    listenWantedRef.current=false;recognitionGenerationRef.current+=1;recognitionRef.current?.abort();
    if(speechPendingTimerRef.current!==null)window.clearTimeout(speechPendingTimerRef.current);
    setSpeechPending(false);
    setSeconds(question.duration||120);
    const timer=window.setTimeout(()=>{setSpeechNotice('');speakAndListen(question.title)},400);
    return()=>window.clearTimeout(timer);
  },[phase,index,question?.id]);

  useEffect(()=>{
    if(phase!=='interview'||seconds<=0||saving)return;
    const timer=window.setTimeout(()=>setSeconds(value=>Math.max(0,value-1)),1000);
    return()=>window.clearTimeout(timer);
  },[phase,seconds,saving]);

  useEffect(()=>{if(phase==='interview'&&seconds===0&&!saving)void nextQuestion(true)},[phase,seconds,saving]);

  useEffect(()=>{if(phase==='interview')void playVideo()},[phase]);

  async function start(){
    const scope=window as unknown as {SpeechRecognition?:SpeechRecognitionConstructor;webkitSpeechRecognition?:SpeechRecognitionConstructor};
    const Recognition=scope.SpeechRecognition||scope.webkitSpeechRecognition;
    if(typeof MediaRecorder==='undefined'){setError('当前浏览器不支持录音，请使用最新版 Chrome 或 Edge 打开面试地址。');return}
    if(!Recognition){setError('当前浏览器不支持实时语音识别，请使用最新版 Chrome 或 Edge 打开面试地址。');return}
    speechFailureCountRef.current=0;setError('');setSpeechNotice('');
    if(Recognition){setSpeechMode('preparing');preferLocalSpeechRef.current=await prepareOnDeviceSpeech(Recognition);setSpeechMode(preferLocalSpeechRef.current?'local':'online')}
    try{
      const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:1280},height:{ideal:720}},audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
      const videoTrack=stream.getVideoTracks()[0];
      if(!videoTrack)throw new Error('missing-video-track');
      videoTrack.onended=()=>{setCamera('denied');setError('摄像头连接已断开，请重新允许摄像头权限。')};
      videoTrack.onmute=()=>setCamera('blocked');videoTrack.onunmute=()=>void playVideo();
      streamRef.current=stream;setCamera('idle');startedAt.current=Date.now();setPhase('interview');
    }catch{setCamera('denied');setError('AI 面试仅支持语音作答，请允许浏览器使用麦克风和摄像头后重试。')}
  }

  async function playVideo(){
    const video=videoRef.current,stream=streamRef.current,track=stream?.getVideoTracks()[0];
    if(!video||!stream||!track)return;
    if(track.readyState==='ended'){setCamera('denied');setError('摄像头连接已断开，请重新允许摄像头权限。');return}
    video.srcObject=stream;video.muted=true;video.playsInline=true;setCamera('idle');
    try{await video.play()}catch{setCamera('blocked');setError('摄像头已授权，但画面未能自动播放，请点击左侧按钮重新显示画面。')}
  }

  function speakAndListen(text:string){
    if('speechSynthesis'in window){window.speechSynthesis.cancel();const speech=new SpeechSynthesisUtterance(text);speech.lang='zh-CN';speech.rate=.95;speech.onend=startListening;window.speechSynthesis.speak(speech)}else startListening();
  }

  function startListening(){startQuestionRecording();beginListening(false)}

  async function retryListening(){
    speechFailureCountRef.current=0;setError('');setSpeechNotice('');
    const scope=window as unknown as {SpeechRecognition?:SpeechRecognitionConstructor;webkitSpeechRecognition?:SpeechRecognitionConstructor};
    const Recognition=scope.SpeechRecognition||scope.webkitSpeechRecognition;
    if(!Recognition){startListening();return}
    if(!preferLocalSpeechRef.current){
      setSpeechMode('preparing');
      preferLocalSpeechRef.current=await prepareOnDeviceSpeech(Recognition);
      setSpeechMode(preferLocalSpeechRef.current?'local':'online');
    }
    startListening();
  }

  function beginListening(resume:boolean){
    const scope=window as unknown as {SpeechRecognition?:SpeechRecognitionConstructor;webkitSpeechRecognition?:SpeechRecognitionConstructor};
    const Recognition=scope.SpeechRecognition||scope.webkitSpeechRecognition;
    if(!Recognition){
      setError('当前浏览器不支持实时语音识别，无法继续本次面试。');return
    }
    if(!question)return;
    if(speechRestartTimerRef.current!==null){window.clearTimeout(speechRestartTimerRef.current);speechRestartTimerRef.current=null}
    if(speechWatchdogTimerRef.current!==null){window.clearTimeout(speechWatchdogTimerRef.current);speechWatchdogTimerRef.current=null}
    if(!resume){
      listenWantedRef.current=false;recognitionGenerationRef.current+=1;
      const previous=recognitionRef.current;if(previous){previous.onend=null;previous.onerror=null;previous.onresult=null;previous.onspeechstart=null;previous.onspeechend=null;previous.abort()}
    }
    const generation=recognitionGenerationRef.current;const recognition=new Recognition();const questionId=question.id;
    const sessionBase=committedTranscriptRef.current[questionId]||transcriptRef.current[questionId]||answers[questionId]||'';let committed=sessionBase;let latestInterim='';let fatalError=false;
    recognition.lang='zh-CN';recognition.continuous=true;recognition.interimResults=true;recognition.maxAlternatives=5;
    if(preferLocalSpeechRef.current)recognition.processLocally=true;
    applySpeechContext(recognition,invitation?.jobTitle||'',question);
    listenWantedRef.current=true;
    const scheduleRestart=(delay=320)=>{
      if(!listenWantedRef.current||generation!==recognitionGenerationRef.current)return;
      setListening(true);
      speechRestartTimerRef.current=window.setTimeout(()=>{speechRestartTimerRef.current=null;if(listenWantedRef.current&&generation===recognitionGenerationRef.current)beginListening(true)},delay);
    };
    const armWatchdog=()=>{
      if(speechWatchdogTimerRef.current!==null)window.clearTimeout(speechWatchdogTimerRef.current);
      speechWatchdogTimerRef.current=window.setTimeout(()=>{
        speechWatchdogTimerRef.current=null;
        if(listenWantedRef.current&&generation===recognitionGenerationRef.current&&recognitionRef.current===recognition)recognition.abort();
      },18000);
    };
    const schedulePendingRelease=()=>{
      if(speechPendingTimerRef.current!==null)window.clearTimeout(speechPendingTimerRef.current);
      speechPendingTimerRef.current=window.setTimeout(()=>{speechPendingTimerRef.current=null;setSpeechPending(false)},2500);
    };
    recognition.onspeechstart=()=>{
      if(speechPendingTimerRef.current!==null)window.clearTimeout(speechPendingTimerRef.current);
      setSpeechPending(true);
    };
    recognition.onspeechend=()=>{
      schedulePendingRelease();
    };
    recognition.onresult=event=>{
      speechFailureCountRef.current=0;setSpeechNotice('');setError(current=>current.startsWith('语音识别')?'':current);
      armWatchdog();
      let sessionFinal='';let interim='';
      for(let resultIndex=0;resultIndex<event.results.length;resultIndex+=1){
        const result=event.results[resultIndex];const value=selectContextualSpeechTranscript(speechAlternatives(result),invitation?.jobTitle||'',question);
        if(!value)continue;
        if(result.isFinal)sessionFinal=joinSpeechTranscript(sessionFinal,value);else interim=joinSpeechTranscript(interim,value);
      }
      committed=joinSpeechTranscript(sessionBase,sessionFinal);committedTranscriptRef.current[questionId]=committed;
      latestInterim=interim;
      const transcript=contextualizeSpeechTranscript(joinSpeechTranscript(committed,interim),invitation?.jobTitle||'',question);transcriptRef.current[questionId]=transcript;
      if(transcript){if(speechPendingTimerRef.current!==null){window.clearTimeout(speechPendingTimerRef.current);speechPendingTimerRef.current=null}setSpeechPending(false)}
      setAnswers(current=>({...current,[questionId]:transcript}));
    };
    recognition.onerror=event=>{
      const code=event.error||'';
      schedulePendingRelease();
      if(['not-allowed','audio-capture'].includes(code)){fatalError=true;listenWantedRef.current=false;setError('无法使用麦克风进行语音识别，请检查浏览器权限后重试。')}
      else if(code==='service-not-allowed'){fatalError=true;listenWantedRef.current=false;setError('当前浏览器无法连接实时语音识别服务，请使用最新版 Chrome 或 Edge 打开后重试。')}
      else if(code==='language-not-supported'&&preferLocalSpeechRef.current){preferLocalSpeechRef.current=false;setSpeechMode('online')}
      else if(code!=='no-speech'&&code!=='aborted'){
        speechFailureCountRef.current+=1;
        if(speechFailureCountRef.current>=3){
          fatalError=true;
          listenWantedRef.current=false;setListening(false);setError(preferLocalSpeechRef.current?'本机中文语音识别启动失败，请点击“重新识别”。':'当前浏览器无法连接实时语音识别服务。请复制 AI 面试地址，使用最新版 Chrome 或 Edge 打开后重试。')
        }
      }
    };
    recognition.onend=()=>{
      if(speechWatchdogTimerRef.current!==null){window.clearTimeout(speechWatchdogTimerRef.current);speechWatchdogTimerRef.current=null}
      if(latestInterim){committed=contextualizeSpeechTranscript(joinSpeechTranscript(committed,latestInterim),invitation?.jobTitle||'',question);committedTranscriptRef.current[questionId]=committed;transcriptRef.current[questionId]=committed;setAnswers(current=>({...current,[questionId]:committed}))}
      schedulePendingRelease();
      if(!fatalError&&listenWantedRef.current&&generation===recognitionGenerationRef.current)scheduleRestart();else setListening(false);
    };
    recognitionRef.current=recognition;
    try{recognition.start();setListening(true);armWatchdog()}catch{
      speechFailureCountRef.current+=1;
      if(speechFailureCountRef.current>=3){
        fatalError=true;
        listenWantedRef.current=false;setListening(false);setError('实时语音识别启动失败，请点击“重新识别”。')
      }else scheduleRestart(650)
    }
  }

  async function nextQuestion(auto=false){
    if(saving)return;
    setSaving(true);
    listenWantedRef.current=false;recognitionGenerationRef.current+=1;recognitionRef.current?.stop();setListening(false);
    const freshRecordingBlob=await stopQuestionRecording();
    if(question&&freshRecordingBlob)pendingRecordingsRef.current[question.id]=freshRecordingBlob;
    const recordingBlob=question?pendingRecordingsRef.current[question.id]||null:null;
    let currentAnswer=question?contextualizeSpeechTranscript(transcriptRef.current[question.id]||answers[question.id]||'',invitation?.jobTitle||'',question):'';
    if(question&&currentAnswer){transcriptRef.current[question.id]=currentAnswer;committedTranscriptRef.current[question.id]=currentAnswer;setAnswers(current=>({...current,[question.id]:currentAnswer}))}
    if(question&&recordingBlob){
      const durationSeconds=Math.max(1,(question.duration||120)-seconds);
      const stored=await uploadQuestionRecording(recordingBlob,question.id,durationSeconds);
      if(!stored){if(auto)setSeconds(5);setSaving(false);return}
      delete pendingRecordingsRef.current[question.id];
    }
    setError('');
    if(index<questions.length-1){setSaving(false);setIndex(value=>value+1);return}
    const response=await fetch(`/api/interview/${encodeURIComponent(token)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      answers:questions.map(item=>({questionId:item.id,answer:contextualizeSpeechTranscript(transcriptRef.current[item.id]||answers[item.id]||'',invitation?.jobTitle||'',item)})),durationSeconds:Math.max(1,Math.round((Date.now()-startedAt.current)/1000)),
    })});
    const result=await response.json().catch(()=>({})) as {message?:string};
    if(!response.ok){setError(result.message||'提交失败，请稍后重试。');setSaving(false);return}
    stopDevices();setPhase('complete');setSaving(false);
  }

  function startQuestionRecording(){
    if(recorderRef.current?.state==='recording'||typeof MediaRecorder==='undefined')return;
    const audioTracks=streamRef.current?.getAudioTracks().filter(track=>track.readyState==='live')||[];
    if(!audioTracks.length)return;
    try{
      const mimeType=['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(type=>MediaRecorder.isTypeSupported(type));
      const recorder=new MediaRecorder(new MediaStream(audioTracks),mimeType?{mimeType}:undefined);
      recordingChunksRef.current=[];recorder.ondataavailable=event=>{if(event.data.size)recordingChunksRef.current.push(event.data)};
      recorderRef.current=recorder;recorder.start(1000);setRecording(true);
    }catch{}
  }

  function stopQuestionRecording(){
    const recorder=recorderRef.current;
    if(!recorder||recorder.state==='inactive'){setRecording(false);return Promise.resolve<Blob|null>(null)}
    return new Promise<Blob|null>(resolve=>{
      recorder.onstop=()=>{const blob=recordingChunksRef.current.length?new Blob(recordingChunksRef.current,{type:recorder.mimeType||'audio/webm'}):null;recordingChunksRef.current=[];recorderRef.current=null;setRecording(false);resolve(blob)};
      recorder.stop();
    });
  }

  async function uploadQuestionRecording(audio:Blob,questionId:string,durationSeconds:number){
    try{
      const extension=audio.type.includes('mp4')?'m4a':audio.type.includes('ogg')?'ogg':'webm';
      const form=new FormData();
      form.set('recording',audio,`answer.${extension}`);
      form.set('questionId',questionId);
      form.set('durationSeconds',String(durationSeconds));
      const response=await fetch(`/api/interview/${encodeURIComponent(token)}/recording`,{method:'POST',body:form});
      const result=await response.json().catch(()=>({})) as {message?:string};
      if(!response.ok){setError(result.message||'录音保存失败，请重试后再提交本题。');return false}
      return true;
    }catch{setError('录音上传失败，请检查网络后重试。');return false}
  }

  function stopDevices(){listenWantedRef.current=false;recognitionGenerationRef.current+=1;if(speechRestartTimerRef.current!==null)window.clearTimeout(speechRestartTimerRef.current);if(speechWatchdogTimerRef.current!==null)window.clearTimeout(speechWatchdogTimerRef.current);if(speechPendingTimerRef.current!==null)window.clearTimeout(speechPendingTimerRef.current);setSpeechPending(false);if(recorderRef.current?.state==='recording')recorderRef.current.stop();setRecording(false);streamRef.current?.getTracks().forEach(track=>track.stop());recognitionRef.current?.abort();if(typeof window!=='undefined'&&'speechSynthesis'in window)window.speechSynthesis.cancel()}

  if(phase==='loading')return <main className="candidate-interview-shell"><div className="candidate-interview-state"><i>✦</i><h1>正在验证面试邀请</h1><p>请稍候，系统正在读取您的专属面试题。</p></div></main>;
  if(phase==='error')return <main className="candidate-interview-shell"><div className="candidate-interview-state error"><i>!</i><h1>无法进入面试</h1><p>{error}</p></div></main>;
  if(phase==='complete')return <main className="candidate-interview-shell"><div className="candidate-interview-state complete"><i>✓</i><h1>AI 面试已完成</h1><p>感谢您的参与。回答与面试结果已安全提交给招聘团队，您可以关闭此页面。</p></div></main>;
  if(phase==='intro')return <main className="candidate-interview-shell"><section className="candidate-interview-welcome"><span>AI INTERVIEW INVITATION</span><div className="candidate-brand">星鉴人才</div><h1>{invitation?.candidateName}，您好</h1><p>您即将参加 <b>{invitation?.jobTitle}</b> 岗位的 AI 面试。本次共 {questions.length} 道题，建议在安静、网络稳定的环境中完成。</p><div className="candidate-device-list"><div><i>01</i><span><b>使用 Chrome 或 Edge</b><small>请在系统浏览器打开，避免使用应用内置浏览器</small></span></div><div><i>02</i><span><b>开启摄像头，仅录制语音</b><small>语音将在作答过程中实时转为文字，录音同步保存用于招聘评估</small></span></div><div><i>03</i><span><b>一次提交，不可重复作答</b><small>请勿关闭页面或将专属链接转发他人</small></span></div></div>{error&&<div className="candidate-submit-error">{error}</div>}<button disabled={speechMode==='preparing'} onClick={()=>void start()}>{speechMode==='preparing'?'正在准备中文语音识别…':'同意录音并开始面试'} <b>→</b></button><small>点击开始即表示您知悉摄像头将开启、系统仅录制语音。链接有效期至 {invitation?new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(invitation.expiresAt)):''}</small></section></main>;
  const answer=question?answers[question.id]||'':'';const progress=Math.round((index+1)/Math.max(1,questions.length)*100);
  return <main className="candidate-interview-shell live"><header className="candidate-live-head"><div><span>星鉴人才 · AI 面试</span><h1>{invitation?.jobTitle}</h1></div><div><b>{index+1}</b><span>/ {questions.length}</span></div></header><div className="candidate-live-progress"><i style={{width:`${progress}%`}}/></div><div className="candidate-live-grid"><section className="candidate-video"><video ref={videoRef} autoPlay playsInline muted onPlaying={()=>{setCamera('ready');setError(current=>current.startsWith('摄像头')?'':current)}} onStalled={()=>setCamera('blocked')} onError={()=>setCamera('blocked')}/><div className={`candidate-camera-badge ${camera}`}>{camera==='ready'?'● 摄像头与麦克风已连接':camera==='blocked'?'摄像头已连接，画面等待播放':camera==='denied'?'未获得摄像头权限':'正在加载摄像头画面…'}</div>{camera==='blocked'&&<button type="button" className="candidate-video-retry" onClick={()=>void playVideo()}>重新显示摄像头画面</button>}<footer><b>{invitation?.candidateName}</b><span>{recording?'● 语音录音已同步保存':'正在准备录音'}</span></footer></section><section className="candidate-question"><div className="candidate-question-meta"><span>QUESTION {String(index+1).padStart(2,'0')}</span><time>{String(Math.floor(seconds/60)).padStart(2,'0')}:{String(seconds%60).padStart(2,'0')}</time></div><h2>{question?.title}</h2><p>请直接口述回答。系统会实时识别并显示文字，同时保存语音录音；倒计时结束后自动进入下一题。</p><div className={`candidate-voice-answer ${listening||recording?'listening':''}`}><i>◉</i><span><b>{speechPending?'正在识别当前语音':listening?(speechMode==='local'?'正在本机实时识别':'正在实时识别语音'):'实时语音识别'}</b><p>{answer||(speechMode==='preparing'?'正在准备中文语音识别…':speechPending?'正在将刚才的语音转换为文字…':'请开始口述，识别出的文字会实时显示在这里。')}</p></span></div>{speechNotice&&<div className="candidate-submit-notice" role="status">{speechNotice}</div>}{error&&<div className="candidate-submit-error">{error}</div>}<div className="candidate-question-actions"><span className={listening||recording?'active':''}>{saving?'正在保存本题…':speechPending?'● 正在识别当前语音':listening?(speechMode==='local'?'● 本机实时识别中':'● 在线实时识别中'):'实时语音识别已暂停'}</span>{!listening&&<button className="voice-retry" disabled={saving||speechMode==='preparing'} onClick={()=>void retryListening()}>{speechMode==='preparing'?'正在准备…':'重新识别'}</button>}<button disabled={saving||speechPending} onClick={()=>void nextQuestion()}>{speechPending?'识别中…':saving?'正在保存…':index===questions.length-1?'提交全部回答':'提交并进入下一题'} <b>→</b></button></div></section></div></main>;
}

function speechAlternatives(result:SpeechResultLike){return Array.from({length:result.length},(_,index)=>({transcript:String(result[index]?.transcript||''),confidence:result[index]?.confidence}))}
function applySpeechContext(recognition:SpeechRecognitionLike,jobTitle:string,question:Question){
  const scope=window as unknown as {SpeechRecognitionPhrase?:new(phrase:string,boost:number)=>SpeechRecognitionPhraseLike};
  const Phrase=scope.SpeechRecognitionPhrase;if(!Phrase||!('phrases' in recognition))return;
  try{recognition.phrases=buildSpeechHints(jobTitle,question).map(phrase=>new Phrase(phrase,5))}catch{}
}
function joinSpeechTranscript(base:string,next:string){const left=base.trim(),right=next.trim();if(!right)return left;if(!left)return right;if(left.endsWith(right))return left;if(right.startsWith(left))return right;for(let overlap=Math.min(24,left.length,right.length);overlap>=2;overlap-=1){if(left.slice(-overlap)===right.slice(0,overlap))return `${left}${right.slice(overlap)}`}return `${left}${/[。！？!?，,；;：:]$/.test(left)?'':'，'}${right}`}
async function prepareOnDeviceSpeech(Recognition:SpeechRecognitionConstructor){
  if(!Recognition.available||!Recognition.install)return false;
  const options:SpeechRecognitionOptionsLike={langs:['zh-CN'],processLocally:true,quality:'dictation'};
  try{
    const availability=await Recognition.available(options);
    if(availability==='available')return true;
    if(availability==='downloadable'||availability==='downloading')return await Recognition.install(options);
  }catch{}
  return false;
}
