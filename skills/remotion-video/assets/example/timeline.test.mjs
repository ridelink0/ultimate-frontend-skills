import test from 'node:test';
import assert from 'node:assert/strict';
import {stateAtFrame} from './timeline.mjs';
test('workflow advances at known frames and reaches its final hold',()=>{
  assert.deepEqual(stateAtFrame(0),{active:0,progress:0,complete:false});
  assert.equal(stateAtFrame(33).active,1);assert.equal(stateAtFrame(66).active,2);
  assert.equal(stateAtFrame(102).complete,true);assert.equal(stateAtFrame(119).progress,1);
});
test('negative and invalid inputs never produce out-of-range frame states',()=>{
  assert.equal(stateAtFrame(-1).progress,0);assert.equal(stateAtFrame(10000).active,2);
  for(const frame of [NaN,Infinity])assert.throws(()=>stateAtFrame(frame),/finite/);
  for(const fps of [0,-1,NaN])assert.throws(()=>stateAtFrame(0,fps),/positive/);
  assert.deepEqual(stateAtFrame(33,30),stateAtFrame(66,60));
});
