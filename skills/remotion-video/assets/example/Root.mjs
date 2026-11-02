// Original composition by Gev's UFS. No stock media, fonts, music or downloads.
import React from 'react';
import { AbsoluteFill, Composition, registerRoot, useCurrentFrame, useVideoConfig } from 'remotion';
import { stateAtFrame, STEPS } from './timeline.mjs';
const el = React.createElement;
export function WorkflowFilm({ title = 'Make the release reviewable' }) {
  const frame = useCurrentFrame(), { fps } = useVideoConfig(), state = stateAtFrame(frame, fps);
  return el(AbsoluteFill, { style: { backgroundColor:'#121b24', color:'#e6edf3', padding:72, fontFamily:'Arial, sans-serif' } },
    el('div', { style:{ fontSize:23, color:'#a8bbc9', letterSpacing:2 } }, 'UFS ORIGINAL REFERENCE'),
    el('h1', { style:{ fontSize:Math.max(38, 64 - Math.max(0,title.length-32)*0.55), lineHeight:1.12, maxWidth:1000, margin:'32px 0 46px', overflowWrap:'anywhere' } }, title),
    el('div', { style:{ display:'flex', gap:20 } }, ...STEPS.map((step,i)=>el('div',{key:step,style:{ flex:1,padding:24,border:'1px solid '+(i<=state.active?'#77bcae':'#384a59'),background:i===state.active?'#243b42':'#1a2935',transform:'translateY('+(i===state.active?0:6)+'px)' }},
      el('div',{style:{fontSize:22,color:'#a8bbc9',marginBottom:18}},String(i+1).padStart(2,'0')),
      el('div',{style:{fontSize:29,lineHeight:1.25}},step),
      el('div',{style:{fontSize:18,color:'#a8bbc9',marginTop:20}},i<state.active||state.complete?'Checked':i===state.active?'In progress':'Up next')))),
    el('div',{style:{marginTop:50,height:5,background:'#384a59'}},el('div',{style:{height:'100%',width:(state.progress*100)+'%',background:'#77bcae'}})),
    el('p',{style:{fontSize:21,color:'#a8bbc9',marginTop:20}},state.complete?'Demonstration complete. Verify real work before publishing.':'Deterministic frames. Local rendering. No generated facts.'));
}
export const FilmRoot = () => el(Composition, { id:'WorkflowReview', component:WorkflowFilm, durationInFrames:120, fps:30, width:1280, height:720 });
registerRoot(FilmRoot);
