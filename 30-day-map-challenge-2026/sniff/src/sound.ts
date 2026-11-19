const tune = [76,79,81,0,79,76,74,0,72,76,79,0,76,74,72,0,69,72,76,0,74,72,69,0,67,71,74,76,74,71,67,0];
const bass = [48,48,45,43];
const hz = (midi:number) => 440 * 2 ** ((midi - 69) / 12);
const baseStep = .25;
const urgencyBoost = .45;
const musicVolume = .045;

type PendingNote = {oscillator:OscillatorNode; startsAt:number; beat:number};

/** Original lightweight game music; no remote audio or autoplay before a gesture. */
export function createSound(){
 let context:AudioContext|undefined;
 let musicGain:GainNode|undefined;
 let enabled=true;
 let music=false;
 let urgency=0;
 let rate=1;
 let nextBeat:number|undefined;
 let beat=0;
 const pendingNotes=new Set<PendingNote>();

 function scheduleNote(frequency:number,startsAt:number,length:number,type:OscillatorType,volume:number,musicBeat?:number){
  if(!enabled||!context||context.state!=='running')return;
  const output=musicBeat===undefined?context.destination:musicGain;
  if(!output)return;
  const oscillator=context.createOscillator();
  const gain=context.createGain();
  oscillator.type=type;
  oscillator.frequency.setValueAtTime(frequency,startsAt);
  oscillator.connect(gain);
  gain.connect(output);
  gain.gain.setValueAtTime(0,startsAt);
  gain.gain.linearRampToValueAtTime(volume,startsAt+.012);
  gain.gain.exponentialRampToValueAtTime(.001,startsAt+length);
  oscillator.start(startsAt);
  oscillator.stop(startsAt+length+.01);
  if(musicBeat!==undefined){
   const pending={oscillator,startsAt,beat:musicBeat};
   pendingNotes.add(pending);
   oscillator.onended=()=>pendingNotes.delete(pending);
  }
 }

 function note(frequency:number,delay=0,length=.12,type:OscillatorType='sine',volume=.055){
  if(context)scheduleNote(frequency,context.currentTime+delay,length,type,volume);
 }

 function updateMusic(){
  if(!context||!musicGain)return;
  const now=context.currentTime;
  if(enabled&&music){
   nextBeat=now+.05;
   musicGain.gain.setTargetAtTime(musicVolume,now,.08);
   return;
  }
  musicGain.gain.setTargetAtTime(0,now,.08);
  nextBeat=undefined;
  for(const {oscillator,startsAt,beat:scheduledBeat} of pendingNotes){
   // Unheard notes can play after resume. Give sounding notes a short release.
   if(startsAt>now)beat=Math.min(beat,scheduledBeat);
   oscillator.stop(startsAt>now?now:now+.035);
  }
  pendingNotes.clear();
 }

 const timer=setInterval(()=>{
  if(!music||!enabled||!context||context.state!=='running')return;
  const now=context.currentTime;
  // When the interval is throttled, resume at the next unscheduled beat without a burst.
  if(nextBeat===undefined||nextBeat<now)nextBeat=now+.02;
  while(nextBeat<now+.13){
   const target=1+urgency*urgencyBoost;
   const response=target>rate?.42:.65;
   rate+=(target-rate)*(1-Math.exp(-baseStep/rate/response));
   const n=tune[beat%tune.length];
   if(n)scheduleNote(hz(n),nextBeat,.19/rate,'triangle',.32,beat);
   if(beat%4===0)scheduleNote(hz(bass[Math.floor(beat/8)%bass.length]),nextBeat,.34/rate,'sine',.5,beat);
   if(beat%2===1)scheduleNote(1500,nextBeat,.035/rate,'sine',.045,beat);
   beat++;
   nextBeat+=baseStep/rate;
  }
 },60);

 return {
  unlock(){
   if(!context){
    context=new AudioContext();
    musicGain=context.createGain();
    musicGain.gain.value=0;
    musicGain.connect(context.destination);
    updateMusic();
   }
   void context.resume();
  },
  toggle(){
   enabled=!enabled;
   updateMusic();
   return enabled;
  },
  setMusic(value:boolean){
   if(music===value)return;
   music=value;
   if(!music)rate=1;
   updateMusic();
  },
  setUrgency(value:number){
   urgency=Number.isFinite(value)?Math.min(1,Math.max(0,value)):0;
  },
  dispose(){
   clearInterval(timer);
   void context?.close();
  },
  play(kind:string){
   if(kind==='pickup'){note(660);note(990,.07);}
   else if(kind==='order'){[523,659,784,1046].forEach((n,i)=>note(n,i*.09,.2,'triangle'));}
   else if(kind==='hurt'){note(180,0,.2,'sawtooth',.025);note(100,.12,.22,'triangle');}
   else if(kind==='heal'){note(523);note(784,.12,.24);}
   else if(kind==='jump'){note(330,0,.1,'triangle',.035);note(660,.07,.15,'triangle',.03);}
   else if(kind==='chant'){note(232,0,.14,'triangle',.032);note(194,.02,.16,'triangle',.021);note(202,.16,.18,'triangle',.035);note(168,.18,.16,'triangle',.019);}
   else if(kind==='sniff'){note(170,0,.07,'triangle',.025);note(230,.1,.07,'triangle',.025);}
  },
 };
}
