// Runs streak prediction off the main thread.
import { decodeCatalog } from '../lib/catalog.js';
import { predictStreaks } from '../lib/streaks.js';

let objects = null;
self.onmessage = async (e) => {
  const { obs, target, fov, rotation, exposures, minEl } = e.data;
  try {
    if (!objects) objects = decodeCatalog(await (await fetch('/data/catalog.json')).json());
    const streaks = predictStreaks(objects, obs, target, fov, rotation, exposures, { minEl, onProgress: (f) => self.postMessage({ progress: f }) });
    self.postMessage({ done: true, streaks, checked: objects.length });
  } catch (err) { self.postMessage({ error: err.message }); }
};
