// The hook lists the core asks for (`hooks(name, slot)`, sim/features/index.js), kept apart from the
// records. This module imports nothing, so a module the records themselves load can ask for a list
// without loading the registry: sim/parallel-park.js, which the controller loads, and through it the
// bus lanes and the buses. The registry fills every list handed out before, in registration order, as
// soon as all its records have loaded, and each list keeps its identity.

const byName = new Map();
const pending = [];
let fill = null;

export function hooks(name, slot = "end") {
  if (!byName.has(name)) byName.set(name, new Map());
  const slots = byName.get(name);
  if (slots.has(slot)) return slots.get(slot);
  const out = [];
  if (fill) fill(out, name, slot);
  else pending.push([out, name, slot]);
  slots.set(slot, out);
  return out;
}

// (the registry, once its records have loaded: fill the lists handed out before, and every later one)
export function fillHookLists(fillHooks) {
  fill = fillHooks;
  for (const [out, name, slot] of pending) fillHooks(out, name, slot);
  pending.length = 0;
}
