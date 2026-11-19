import test from 'node:test';
import assert from 'node:assert/strict';
import {bindJumpButton,createJoystick} from '../src/joystick.ts';

class Control extends EventTarget {
  knob = {style:{}};
  classList = {add(){},remove(){}};
  pointers = new Set();
  querySelector(){return this.knob;}
  setPointerCapture(id){this.pointers.add(id);}
  hasPointerCapture(id){return this.pointers.has(id);}
  releasePointerCapture(id){this.pointers.delete(id);}
}

function pointer(target,type,id,properties={}){
  const event=Object.assign(new Event(type,{cancelable:true}),{
    pointerId:id,button:0,buttons:1,clientX:0,clientY:0,pointerType:'touch',...properties,
  });
  target.dispatchEvent(event);
  return event;
}

test('a second finger can jump while the steering finger stays captured',()=>{
  const stick=new Control(),jump=new Control();
  const browserWindow=new EventTarget();
  const oldWindow=globalThis.window;
  globalThis.window=browserWindow;
  try{
    let jumps=0,starts=0;
    const joystick=createJoystick(stick,()=>true,()=>starts++);
    bindJumpButton(jump,()=>jumps++);
    pointer(stick,'pointerdown',1);
    pointer(stick,'pointermove',1,{clientY:-36});
    assert.deepEqual(joystick.input,[0,-1]);
    assert.equal(starts,1);
    const secondTouch=pointer(jump,'pointerdown',2,{isPrimary:false});
    assert.equal(jumps,1);
    assert.equal(secondTouch.defaultPrevented,true);
    jump.dispatchEvent(Object.assign(new Event('click'),{detail:1}));
    assert.equal(jumps,1);
    pointer(browserWindow,'pointerup',2);
    assert.equal(joystick.active,true);
    assert.deepEqual(joystick.input,[0,-1]);
    pointer(browserWindow,'pointerup',1);
    assert.equal(joystick.active,false);
    assert.deepEqual(joystick.input,[0,0]);
    jump.dispatchEvent(Object.assign(new Event('click'),{detail:0}));
    assert.equal(jumps,2);
  }finally{
    globalThis.window=oldWindow;
  }
});

test('cancelled capture and an unreported mouse release clear the steering direction',()=>{
  const stick=new Control(),browserWindow=new EventTarget();
  const oldWindow=globalThis.window;
  globalThis.window=browserWindow;
  try{
    const joystick=createJoystick(stick,()=>true,()=>{});
    pointer(stick,'pointerdown',1);
    pointer(stick,'pointermove',1,{clientX:36});
    pointer(browserWindow,'pointercancel',1);
    assert.deepEqual(joystick.input,[0,0]);
    pointer(stick,'pointerdown',2);
    pointer(stick,'lostpointercapture',2);
    assert.equal(joystick.active,false);
    pointer(stick,'pointerdown',3,{pointerType:'mouse'});
    pointer(stick,'pointermove',3,{pointerType:'mouse',buttons:0,clientY:36});
    assert.equal(joystick.active,false);
    assert.deepEqual(joystick.input,[0,0]);
  }finally{
    globalThis.window=oldWindow;
  }
});
