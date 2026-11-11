/// <reference lib="webworker" />
import Module, { type ManifoldToplevel } from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { runPipeline } from './pipeline/run';
import type { ImageLike, Params } from './pipeline/types';

let wasmPromise: Promise<ManifoldToplevel> | null = null;
function getWasm() {
  if (!wasmPromise) {
    wasmPromise = Module({ locateFile: () => wasmUrl }).then((m) => { m.setup(); return m; });
  }
  return wasmPromise;
}
getWasm();

export type WorkerRequest = { id: number; image: ImageLike; params: Params };

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const { id, image, params } = ev.data;
  try {
    const wasm = await getWasm();
    const result = runPipeline(wasm, image, params, (stage) => self.postMessage({ id, type: 'stage', stage }));
    const transfer: Transferable[] = [];
    for (const p of result.parts) transfer.push(p.positions.buffer, p.indices.buffer);
    self.postMessage({ id, type: 'done', result }, { transfer });
  } catch (err) {
    self.postMessage({ id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
