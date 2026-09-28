let selectedVoiceUri='';
let speechRequestId=0;

export function createInterviewUtterance(text:string,voices=window.speechSynthesis.getVoices()){
  const utterance=new SpeechSynthesisUtterance(text);
  utterance.lang='zh-CN';
  utterance.rate=.92;
  utterance.pitch=1.12;
  const preferred=selectFemaleChineseVoice(voices);
  if(preferred)utterance.voice=preferred;
  return utterance;
}

export async function speakInterviewText(text:string,onend?:()=>void){
  if(typeof window==='undefined'||!('speechSynthesis'in window)){onend?.();return}
  const requestId=++speechRequestId;
  window.speechSynthesis.cancel();
  const voices=await loadVoices();
  if(requestId!==speechRequestId)return;
  const utterance=createInterviewUtterance(text,voices);
  if(onend)utterance.onend=onend;
  window.speechSynthesis.speak(utterance);
}

export function cancelInterviewSpeech(){
  speechRequestId+=1;
  if(typeof window!=='undefined'&&'speechSynthesis'in window)window.speechSynthesis.cancel();
}

function selectFemaleChineseVoice(voices:SpeechSynthesisVoice[]){
  const chinese=voices.filter(voice=>/^zh[-_]/i.test(voice.lang));
  const selected=chinese.find(voice=>voice.voiceURI===selectedVoiceUri);
  if(selected)return selected;
  const female=/xiaoxiao|xiaoyi|xiaomeng|xiaomo|xiaorui|huihui|yaoyao|ting.?ting|mei.?jia|sin.?ji|lili|female|女声|晓晓|晓伊|晓梦|晓墨|晓睿|慧慧|瑶瑶|婷婷|美佳/i;
  const male=/yunxi|yunyang|yunjian|yunhao|kangkang|danny|daniel|male|男声|云希|云扬|云健|云皓|康康/i;
  const preferred=chinese.find(voice=>female.test(`${voice.name} ${voice.voiceURI}`))
    ||chinese.find(voice=>!male.test(`${voice.name} ${voice.voiceURI}`)&&voice.default)
    ||chinese.find(voice=>!male.test(`${voice.name} ${voice.voiceURI}`))
    ||chinese[0];
  selectedVoiceUri=preferred?.voiceURI||'';
  return preferred;
}

function loadVoices(){
  const current=window.speechSynthesis.getVoices();
  if(current.length)return Promise.resolve(current);
  return new Promise<SpeechSynthesisVoice[]>(resolve=>{
    let settled=false;
    const finish=()=>{
      if(settled)return;
      settled=true;
      window.speechSynthesis.removeEventListener('voiceschanged',finish);
      resolve(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.addEventListener('voiceschanged',finish,{once:true});
    window.setTimeout(finish,700);
  });
}
