(()=>{
'use strict';
const KEY='madedeck-accessibility-v1';
const defaults={contrast:'default',reducedMotion:false,clickFrenzy:true,tts:false,voice:'',volume:.8,lizardPhrase:'LIZARD',stopPhrase:'STOP IT.'};
const $=s=>document.querySelector(s);
const safeMode=new URLSearchParams(location.search).get('safe-ui')==='1';
let prefs={...defaults};
try{prefs={...defaults,...JSON.parse(localStorage.getItem(KEY)||'{}')}}catch(_){}
const allowed=new Set(['default','high-light','high-dark']);
function apply(){
  const contrast=safeMode?'default':(allowed.has(prefs.contrast)?prefs.contrast:'default');
  document.documentElement.dataset.contrast=contrast;
  document.documentElement.classList.toggle('md-reduced-motion',!!prefs.reducedMotion);
}
function voices(){
  if(!('speechSynthesis' in window))return [];
  const list=speechSynthesis.getVoices(),select=$('#mdPrefVoice');
  if(select){const chosen=select.value||prefs.voice;select.innerHTML='<option value="">System default</option>'+list.map((v,i)=>'<option value="'+i+'">'+v.name+' · '+v.lang+'</option>').join('');select.value=list[Number(chosen)]?chosen:''}
  return list;
}
function speak(text,force=false){
  if(!('speechSynthesis' in window)||(!force&&!prefs.tts))return;
  speechSynthesis.cancel();
  const u=new SpeechSynthesisUtterance(String(text).slice(0,64)),v=voices()[Number(prefs.voice)];
  if(v)u.voice=v;u.volume=Math.max(0,Math.min(1,Number(prefs.volume)||.8));speechSynthesis.speak(u);
}
function flash(text,urgent=false){
  const el=$('#mdA11yToast');if(!el)return;el.textContent=text;el.classList.toggle('urgent',urgent);el.hidden=false;
  clearTimeout(flash.timer);flash.timer=setTimeout(()=>{el.hidden=true},1800);
}
function writeForm(){
  $('#mdPrefContrast').value=prefs.contrast;
  $('#mdPrefMotion').checked=prefs.reducedMotion;
  $('#mdPrefFrenzy').checked=prefs.clickFrenzy;
  $('#mdPrefTTS').checked=prefs.tts;
  $('#mdPrefVolume').value=prefs.volume;
  $('#mdPrefLizard').value=prefs.lizardPhrase;
  $('#mdPrefStop').value=prefs.stopPhrase;
  voices();$('#mdPrefVoice').value=prefs.voice||'';
}
function open(){writeForm();$('#mdPreferences').hidden=false;$('#mdPrefContrast').focus()}
function close(){$('#mdPreferences').hidden=true;$('#mdPreferencesGear').focus()}
function save(){
  prefs={...prefs,contrast:$('#mdPrefContrast').value,reducedMotion:$('#mdPrefMotion').checked,clickFrenzy:$('#mdPrefFrenzy').checked,tts:$('#mdPrefTTS').checked,voice:$('#mdPrefVoice').value,volume:Number($('#mdPrefVolume').value),lizardPhrase:$('#mdPrefLizard').value.trim().slice(0,32)||'LIZARD',stopPhrase:$('#mdPrefStop').value.trim().slice(0,32)||'STOP IT.'};
  localStorage.setItem(KEY,JSON.stringify(prefs));apply();close();flash('Preferences saved');
}
apply();
$('#mdPreferencesGear')?.addEventListener('click',open);
$('#mdPreferencesClose')?.addEventListener('click',close);
$('#mdPreferencesSave')?.addEventListener('click',save);
$('#mdPreferencesReset')?.addEventListener('click',()=>{prefs={...defaults};localStorage.setItem(KEY,JSON.stringify(prefs));apply();writeForm();flash('Preferences reset')});
$('#mdPreferencesVoiceTest')?.addEventListener('click',()=>{prefs.tts=$('#mdPrefTTS').checked;prefs.voice=$('#mdPrefVoice').value;prefs.volume=Number($('#mdPrefVolume').value);speak(($('#mdPrefLizard').value||'LIZARD')+' … '+($('#mdPrefStop').value||'STOP IT.'),true)});
$('#mdPreferences')?.addEventListener('click',e=>{if(e.target.id==='mdPreferences')close()});
addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#mdPreferences')?.hidden)close()});
if('speechSynthesis' in window)speechSynthesis.onvoiceschanged=voices;
let count=0,last=0,timer;
document.addEventListener('click',e=>{
  if(!prefs.clickFrenzy||e.detail===0||e.target.closest('input,textarea,select,[contenteditable="true"]'))return;
  const now=Date.now();count=now-last<650?count+1:1;last=now;clearTimeout(timer);timer=setTimeout(()=>{count=0;last=0},5000);
  if(count===50){flash(prefs.stopPhrase,true);speak(prefs.stopPhrase);count=0}
  else if(count>=10&&count%10===0){flash(prefs.lizardPhrase);speak(prefs.lizardPhrase)}
});
window.MadeDeckAccessibility={get preferences(){return {...prefs}},apply,open,reset:()=>{prefs={...defaults};localStorage.setItem(KEY,JSON.stringify(prefs));apply()}};
})();