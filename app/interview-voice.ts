export function createInterviewUtterance(text:string){
  const utterance=new SpeechSynthesisUtterance(text);
  utterance.lang='zh-CN';
  utterance.rate=.92;
  utterance.pitch=1.08;
  const voices=window.speechSynthesis.getVoices();
  const chinese=voices.filter(voice=>/^zh[-_]/i.test(voice.lang));
  const preferred=chinese.find(voice=>/xiaoxiao|xiaoyi|meijia|sin.?ji|female|女声/i.test(`${voice.name} ${voice.voiceURI}`))
    ||chinese.find(voice=>!voice.default)
    ||chinese[0];
  if(preferred)utterance.voice=preferred;
  return utterance;
}
