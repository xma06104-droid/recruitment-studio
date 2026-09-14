import { env } from 'cloudflare:workers';
import { NextRequest, NextResponse } from 'next/server';
import { ensureSchema, getDb, hashToken, invitationIdFromShareToken } from '@/app/server/db';
import { contextualizeSpeechTranscript } from '@/app/speech-context';

type InvitationRow = { job_title:string;questions_json:string;status:string;expires_at:string };
type Question = { id:string;title:string;competency:string;keywords:string };

export async function POST(request:NextRequest, context:{ params:Promise<{ token:string }> }) {
  await ensureSchema();
  const credentials=env as unknown as { TENCENT_SECRET_ID?:string;TENCENT_SECRET_KEY?:string;OPENAI_API_KEY?:string };
  const hasTencent=Boolean(credentials.TENCENT_SECRET_ID&&credentials.TENCENT_SECRET_KEY);
  if(!hasTencent&&!credentials.OPENAI_API_KEY)return failure('服务端语音转写尚未配置。',503,'TRANSCRIPTION_NOT_CONFIGURED');
  const {token}=await context.params;
  const tokenValue=token.trim().slice(0,200);
  if(!tokenValue)return failure('面试地址无效。',404);
  const invitationId=await invitationIdFromShareToken(tokenValue);
  const invitation=invitationId
    ?await getDb().prepare(`SELECT job_title, questions_json, status, expires_at FROM ai_interview_invitations WHERE id = ? LIMIT 1`).bind(invitationId).first<InvitationRow>()
    :await getDb().prepare(`SELECT job_title, questions_json, status, expires_at FROM ai_interview_invitations WHERE token_hash = ? LIMIT 1`).bind(await hashToken(tokenValue)).first<InvitationRow>();
  if(!invitation)return failure('面试地址无效或已被重新发送。',404);
  if(Date.parse(invitation.expires_at)<Date.now()||['已超时','已过期','已失效','已完成'].includes(invitation.status))return failure('本次面试已结束，无法继续转写。',410);

  const form=await request.formData().catch(()=>null);
  const audio=form?.get('audio');
  const questionId=String(form?.get('questionId')||'').slice(0,100);
  if(!(audio instanceof File)||audio.size<512)return failure('没有收到有效录音。',400);
  if(audio.size>3*1024*1024)return failure('单段录音过大，请缩短回答后重试。',413);
  const question=parseQuestions(invitation.questions_json).find(item=>item.id===questionId);
  if(!question)return failure('面试题不存在。',400);

  if(hasTencent){
    try{
      const transcript=await transcribeWithTencent(audio,credentials.TENCENT_SECRET_ID!,credentials.TENCENT_SECRET_KEY!);
      const contextualized=contextualizeSpeechTranscript(transcript.slice(0,5000),invitation.job_title,question);
      if(!contextualized)return failure('未识别到清晰语音，请靠近麦克风后重试。',422);
      return NextResponse.json({ok:true,transcript:contextualized});
    }catch(error){
      console.error('Tencent speech transcription failed',safeTencentError(error));
      if(!credentials.OPENAI_API_KEY)return failure(tencentFailureMessage(error),502);
    }
  }

  const prompt=[`应聘岗位：${invitation.job_title}`,`面试题：${question.title}`,question.competency&&`能力项：${question.competency}`,question.keywords&&`岗位术语：${question.keywords}`].filter(Boolean).join('；').slice(0,800);
  const openAIForm=new FormData();
  openAIForm.set('file',audio,recordingName(audio.type));
  openAIForm.set('model','gpt-transcribe');
  openAIForm.set('language','zh');
  openAIForm.set('prompt',prompt);
  try{
    const response=await fetch('https://api.openai.com/v1/audio/transcriptions',{
      method:'POST',headers:{Authorization:`Bearer ${credentials.OPENAI_API_KEY}`},body:openAIForm,
    });
    const result=await response.json().catch(()=>({})) as {text?:string;error?:{message?:string}};
    if(!response.ok){console.error('Speech transcription failed',{status:response.status,message:result.error?.message});return failure('语音转写服务暂时不可用，请稍后重试。',502)}
    const transcript=contextualizeSpeechTranscript(String(result.text||'').trim().slice(0,5000),invitation.job_title,question);
    if(!transcript)return failure('未识别到清晰语音，请靠近麦克风后重试。',422);
    return NextResponse.json({ok:true,transcript});
  }catch(error){
    console.error('Speech transcription request failed',error);
    return failure('语音转写网络异常，请稍后重试。',502);
  }
}

type TencentResponse={Response:{Result?:string;RequestId?:string;Error?:{Code?:string;Message?:string}}};

async function transcribeWithTencent(audio:File,secretId:string,secretKey:string){
  const host='asr.tencentcloudapi.com',service='asr',action='SentenceRecognition',version='2019-06-14';
  const contentType='application/json; charset=utf-8';
  const payload=JSON.stringify({
    EngSerViceType:'16k_zh',SourceType:1,VoiceFormat:'wav',
    Data:arrayBufferToBase64(await audio.arrayBuffer()),DataLen:audio.size,
    FilterDirty:0,FilterModal:0,FilterPunc:0,ConvertNumMode:1,WordInfo:0,
  });
  const timestamp=Math.floor(Date.now()/1000);
  const date=new Date(timestamp*1000).toISOString().slice(0,10);
  const signedHeaders='content-type;host';
  const canonicalHeaders=`content-type:${contentType}\nhost:${host}\n`;
  const canonicalRequest=`POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${await sha256Hex(payload)}`;
  const credentialScope=`${date}/${service}/tc3_request`;
  const stringToSign=`TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${await sha256Hex(canonicalRequest)}`;
  const secretDate=await hmac(`TC3${secretKey}`,date);
  const secretService=await hmac(secretDate,service);
  const secretSigning=await hmac(secretService,'tc3_request');
  const signature=hex(await hmac(secretSigning,stringToSign));
  const authorization=`TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const response=await fetch(`https://${host}`,{method:'POST',headers:{
    Authorization:authorization,'Content-Type':contentType,Host:host,
    'X-TC-Action':action,'X-TC-Version':version,'X-TC-Timestamp':String(timestamp),
  },body:payload});
  const result=await response.json().catch(()=>({Response:{Error:{Code:'InvalidResponse',Message:'Invalid JSON response'}}})) as TencentResponse;
  if(!response.ok||result.Response?.Error){
    const issue=new Error(result.Response?.Error?.Message||'Tencent ASR request failed') as Error&{code?:string;requestId?:string;status?:number};
    issue.code=result.Response?.Error?.Code;issue.requestId=result.Response?.RequestId;issue.status=response.status;throw issue;
  }
  return String(result.Response?.Result||'').trim();
}

const encoder=new TextEncoder();
async function sha256Hex(value:string){return hex(await crypto.subtle.digest('SHA-256',encoder.encode(value)))}
async function hmac(key:string|ArrayBuffer,data:string){
  const raw=typeof key==='string'?encoder.encode(key):key;
  const cryptoKey=await crypto.subtle.importKey('raw',raw,{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return crypto.subtle.sign('HMAC',cryptoKey,encoder.encode(data));
}
function hex(value:ArrayBuffer){return Array.from(new Uint8Array(value),byte=>byte.toString(16).padStart(2,'0')).join('')}
function arrayBufferToBase64(value:ArrayBuffer){
  const bytes=new Uint8Array(value);let binary='';
  for(let offset=0;offset<bytes.length;offset+=0x8000)binary+=String.fromCharCode(...bytes.subarray(offset,offset+0x8000));
  return btoa(binary);
}
function safeTencentError(error:unknown){const issue=error as {code?:string;requestId?:string;status?:number};return {code:issue?.code,requestId:issue?.requestId,status:issue?.status}}
function tencentFailureMessage(error:unknown){
  const code=String((error as {code?:string})?.code||'');
  if(code.includes('AuthFailure'))return '腾讯云语音服务认证失败，请联系招聘负责人检查服务配置。';
  if(code.includes('UnsupportedOperation')||code.includes('InvalidParameter'))return '当前录音格式暂不受支持，请重新录制后再试。';
  return '语音转写服务暂时不可用，请稍后重试。';
}

function parseQuestions(value:string):Question[]{
  try{const parsed=JSON.parse(value);return Array.isArray(parsed)?parsed.map(item=>({id:String(item?.id||''),title:String(item?.title||''),competency:String(item?.competency||''),keywords:String(item?.keywords||'')})).filter(item=>item.id&&item.title):[]}catch{return []}
}
function recordingName(type:string){if(type.includes('wav'))return 'answer.wav';if(type.includes('mp4'))return 'answer.m4a';if(type.includes('ogg'))return 'answer.ogg';return 'answer.webm'}
function failure(message:string,status:number,code?:string){return NextResponse.json({ok:false,message,code},{status})}
