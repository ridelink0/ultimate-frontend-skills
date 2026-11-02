#!/usr/bin/env node
// Explain measured failures; missing evidence is never converted to zero.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const SCENE_BUDGET = { frameP95Ms: 20, drawCalls: 100, triangles: 300000, gpuBytes: 128 * 1024 * 1024, dpr: 2 };
const FIXES = {
  frameP95Ms: 'Profile CPU and GPU separately; pause hidden effects and remove repeated layout reads before reducing optional detail.',
  drawCalls: 'Batch or instance repeated meshes and share materials; remeasure the same camera path.',
  triangles: 'Use measured LOD for distant detail and inspect silhouettes before keeping simplification.',
  gpuBytes: 'Dispose textures, geometries, materials and render targets on teardown; check counters after repeated navigation.',
  dpr: 'Cap the drawing-buffer DPR and compare readability; preserve semantic DOM content.',
};
export function checkScene(measured, budget = SCENE_BUDGET) {
  const findings = [];
  for (const key of Object.keys(SCENE_BUDGET)) {
    const value = measured?.[key], limit = budget[key];
    if (!Number.isFinite(limit) || limit <= 0) throw new Error('invalid budget for ' + key);
    if (!Number.isFinite(value) || value < 0) findings.push({ key, level: 'unknown', reason: 'Missing or invalid measurement; measure before claiming this passes.' });
    else if (value > limit) findings.push({ key, level: 'over', measured: value, budget: limit, reason: FIXES[key] });
  }
  return { ok: findings.length === 0, findings, budget, note: 'Project defaults only. A passing record is not a live hardware benchmark.' };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!process.argv[2]) throw new Error('provide a JSON file with frameP95Ms, drawCalls, triangles, gpuBytes and dpr');
    const result = checkScene(JSON.parse(readFileSync(process.argv[2], 'utf8')));
    console.log(JSON.stringify(result, null, 2)); process.exitCode = result.ok ? 0 : 1;
  } catch (err) { console.error('scene-budget: ' + err.message); process.exitCode = 2; }
}
