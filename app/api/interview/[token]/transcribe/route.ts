import { env } from 'cloudflare:workers';
import { NextRequest, NextResponse } from 'next/server';
import { ensureSchema, getDb, hashToken } from '@/app/server/db';
import { contextualizeSpeechTranscript } from '@/app/speech-context';

type InvitationRow = { job_title:string;questions_json:string;status:string;expires_at:string };
type Question = { id:string;title:string;competency:string;keywords:string };

export async function POST(request:NextRequest, context:{ params:Promise<{ token:string }> }) {
  await ensureSchema();
  const apiKey=(env as unknown as { OPENAI_API_KEY?:string }).OPENAI_API_KEY;
  if(!apiKey)return failure('服务端语音转写尚未配置。',503,'TRANSCRIPTION_NOT_CONFIGURED');
  const {token}=await context.params;
  const tokenValue=token.trim().slice(0,200);
  if(!tokenValue)return failure('面试地址无效。',404);
  const invitation=await getDb().prepare(`SELECT job_title, questions_json, status, expires_at
    FROM ai_interview_invitations WHERE token_hash = ? LIMIT 1`
  ).bind(await hashToken(tokenValue)).first<InvitationRow>();
  if(!invitation)return failure('面试地址无效或已被重新发送。',404);
  if(Date.parse(invitation.expires_at)<Date.now()||['已超时','已过期','已失效','已完成'].includes(invitation.status))return failure('本次面试已结束，无法继续转写。',410);

  const form=await request.formData().catch(()=>null);
  const audio=form?.get('audio');
  const questionId=String(form?.get('questionId')||'').slice(0,100);
  if(!(audio instanceof File)||audio.size<512)return failure('没有收到有效录音。',400);
  if(audio.size>12*1024*1024)return failure('单题录音过大，请缩短回答后重试。',413);
  const question=parseQuestions(invitation.questions_json).find(item=>item.id===questionId);
  if(!question)return failure('面试题不存在。',400);

  const prompt=[`应聘岗位：${invitation.job_title}`,`面试题：${question.title}`,question.competency&&`能力项：${question.competency}`,question.keywords&&`岗位术语：${question.keywords}`].filter(Boolean).join('；').slice(0,800);
  const openAIForm=new FormData();
  openAIForm.set('file',audio,recordingName(audio.type));
  openAIForm.set('model','gpt-transcribe');
  openAIForm.set('language','zh');
  openAIForm.set('prompt',prompt);
  try{
    const response=await fetch('https://api.openai.com/v1/audio/transcriptions',{
      method:'POST',headers:{Authorization:`Bearer ${apiKey}`},body:openAIForm,
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

function parseQuestions(value:string):Question[]{
  try{const parsed=JSON.parse(value);return Array.isArray(parsed)?parsed.map(item=>({id:String(item?.id||''),title:String(item?.title||''),competency:String(item?.competency||''),keywords:String(item?.keywords||'')})).filter(item=>item.id&&item.title):[]}catch{return []}
}
function recordingName(type:string){if(type.includes('mp4'))return 'answer.m4a';if(type.includes('ogg'))return 'answer.ogg';return 'answer.webm'}
function failure(message:string,status:number,code?:string){return NextResponse.json({ok:false,message,code},{status})}
