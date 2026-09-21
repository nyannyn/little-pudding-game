// 壓縮 public/models/*.glb（meshopt）並檢查資產預算；超標 exit 1。
// 用法：node tools/optimize-models.mjs [--check]   （--check 只檢查不改檔）
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize, reorder, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'public/models';
const BUDGET = { perFileTriangles: 3000, perFileBytes: 300 * 1024, totalBytes: 3 * 1024 * 1024 };
const checkOnly = process.argv.includes('--check');

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

const files = readdirSync(DIR).filter((f) => f.endsWith('.glb'));
if (files.length === 0) { console.log(`${DIR}: 沒有 .glb`); process.exit(0); }

let total = 0, failed = false;
for (const f of files) {
  const path = join(DIR, f);
  const doc = await io.read(path);
  if (!checkOnly) {
    await doc.transform(dedup(), prune(), weld(), reorder({ encoder: MeshoptEncoder }), quantize());
    await io.write(path, doc);
  }
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const idx = prim.getIndices();
    tris += (idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
  }
  const bytes = statSync(path).size;
  total += bytes;
  const over = tris > BUDGET.perFileTriangles || bytes > BUDGET.perFileBytes;
  failed ||= over;
  console.log(`${over ? 'OVER' : 'ok  '} ${f}  tris=${tris}  bytes=${bytes}`);
}
console.log(`total bytes=${total} (budget ${BUDGET.totalBytes})`);
if (total > BUDGET.totalBytes) failed = true;
process.exit(failed ? 1 : 0);
