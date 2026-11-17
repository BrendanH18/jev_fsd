// Gamepad and touch driving (static/js/ui/gamepad.js, ui/touch.js, ui/input.js): dead zones, trigger
// and axis mapping, button press edges, the touch override and steering slide, and the analog amounts
// reaching World.stepManual with the keyboard's all-or-nothing path unchanged.
//   node --experimental-default-type=module scripts/test_gamepad_touch.mjs
import assert from "node:assert/strict";

globalThis.window = new EventTarget();
globalThis.document = new EventTarget();
let dialogOpen = false;
document.querySelector = () => (dialogOpen ? {} : null);

const {
  deadZone,
  buttonValue,
  buttonHeld,
  triggerValue,
  readPad,
  pressedEdges,
  pickPad,
  GamepadInput,
  BUTTON,
  STICK_DEAD_ZONE,
} = await import("../static/js/ui/gamepad.js");
const { touchWanted, steerFromDrag, STEER_RANGE_PX } = await import("../static/js/ui/touch.js");
const { Input } = await import("../static/js/ui/input.js");

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const button = (value = 0, pressed = value >= 0.5) => ({ value, pressed });
// A standard pad at rest, with overrides by button index and axes.
function pad({
  axes = [0, 0, 0, 0],
  buttons = {},
  count = 17,
  mapping = "standard",
  id = "Test pad (STANDARD GAMEPAD)",
  index = 0,
} = {}) {
  const list = Array.from({ length: count }, (_, i) => buttons[i] ?? button(0));
  return { id, index, mapping, connected: true, axes, buttons: list };
}

// Dead zone: drift reads 0, the rest rescales to reach ±1, and junk reads 0.
assert.equal(deadZone(0.1), 0);
assert.equal(deadZone(-STICK_DEAD_ZONE), 0);
near(deadZone(1), 1);
near(deadZone(-1), -1);
near(deadZone(0.575), 0.5);
near(deadZone(-0.575), -0.5);
assert.equal(deadZone(1.4), 1);
assert.equal(deadZone(NaN), 0);
assert.equal(deadZone(undefined), 0);
near(deadZone(0.6, 0.2), 0.5);
// (monotonic across the whole range)
let prev = -Infinity;
for (let v = -1; v <= 1; v += 0.01) {
  const d = deadZone(v);
  assert.ok(d >= prev - 1e-12);
  prev = d;
}

// Buttons: an analog value, a digital `pressed`, an old numeric button, and nothing.
assert.equal(buttonValue(button(0.4, false)), 0.4);
assert.equal(buttonValue({ value: 0, pressed: true }), 1);
assert.equal(buttonValue(0.7), 0.7);
assert.equal(buttonValue(undefined), 0);
assert.equal(buttonHeld(button(0.3, false)), false);
assert.equal(buttonHeld(button(0.6)), true);

// Triggers: rest drift reads 0, full travel 1, and a pad without the button gives null.
assert.equal(triggerValue(pad({ buttons: { [BUTTON.RT]: button(0.03, false) } }), BUTTON.RT), 0);
near(triggerValue(pad({ buttons: { [BUTTON.RT]: button(1) } }), BUTTON.RT), 1);
assert.ok(triggerValue(pad({ buttons: { [BUTTON.RT]: button(0.5) } }), BUTTON.RT) > 0.4);
assert.equal(triggerValue(pad({ count: 4 }), BUTTON.RT), null);

// readPad: the stick steers (right positive), the triggers accelerate and brake, A brakes hard.
{
  const rest = readPad(pad({ axes: [0.08, -0.05, 0.3, 0.3] }));
  assert.deepEqual(rest, { steer: 0, throttle: 0, brake: 0, hardBrake: false });
  const drive = readPad(
    pad({ axes: [-1, 0, 0, 0], buttons: { [BUTTON.RT]: button(0.8), [BUTTON.LT]: button(0.2, false) } }),
  );
  near(drive.steer, -1);
  assert.ok(drive.throttle > 0.7 && drive.throttle < 0.85);
  assert.ok(drive.brake > 0.1 && drive.brake < 0.2);
  assert.equal(drive.hardBrake, false);
  assert.equal(readPad(pad({ buttons: { [BUTTON.A]: button(1) } })).hardBrake, true);
  // (the D-pad steers and drives all or nothing, and wins over a stick barely pushed)
  const dpad = readPad(
    pad({
      axes: [0.3, 0, 0, 0],
      buttons: { [BUTTON.LEFT]: button(1), [BUTTON.UP]: button(1), [BUTTON.DOWN]: button(1) },
    }),
  );
  assert.deepEqual([dpad.steer, dpad.throttle, dpad.brake], [-1, 1, 1]);
  // (no analog triggers: the stick's vertical axis, up to go, down to brake)
  const small = readPad(pad({ count: 6, axes: [0, -1] }));
  near(small.throttle, 1);
  assert.equal(small.brake, 0);
  const smallBrake = readPad(pad({ count: 6, axes: [0, 0.575] }));
  near(smallBrake.brake, 0.5);
  assert.equal(smallBrake.throttle, 0);
  // (a standard pad's stick vertical never drives: only its triggers do)
  assert.equal(readPad(pad({ axes: [0, -1, 0, 0] })).throttle, 0);
  assert.deepEqual(readPad(null), { steer: 0, throttle: 0, brake: 0, hardBrake: false });
  assert.deepEqual(readPad({ connected: false, axes: [1], buttons: [] }).steer, 0);
}

// Press edges: only buttons newly held fire.
{
  const first = pressedEdges([], [button(1), button(0), button(1)]);
  assert.deepEqual(first.edges, [0, 2]);
  const again = pressedEdges(first.held, [button(1), button(1), button(0)]);
  assert.deepEqual(again.edges, [1]);
  assert.deepEqual(pressedEdges(again.held, [button(1), button(1), button(0)]).edges, []);
}

// pickPad: the standard layout first, disconnected and empty slots skipped.
assert.equal(
  pickPad([null, { id: "raw", connected: true, mapping: "" }, { id: "std", connected: true, mapping: "standard" }]).id,
  "std",
);
assert.equal(pickPad([null, { id: "gone", connected: false }]), null);
assert.equal(pickPad(undefined), null);

// GamepadInput: connect toast, no action for a button already held as the pad appears, actions on press
// edges, nothing while blocked, and a disconnect.
{
  let pads = [],
    blocked = false;
  const log = [];
  const actions = {
    autopilot: () => log.push("autopilot"),
    camera: () => log.push("camera"),
    pause: () => log.push("pause"),
    reset: () => log.push("reset"),
    signalLeft: () => log.push("left"),
    signalRight: () => log.push("right"),
    horn: () => log.push("horn"),
  };
  const gp = new GamepadInput({
    actions,
    getPads: () => pads,
    blocked: () => blocked,
    onConnect: (p) => log.push(`connect:${p.id}`),
    onDisconnect: () => log.push("disconnect"),
  });
  assert.deepEqual(gp.poll(), { steer: 0, throttle: 0, brake: 0, hardBrake: false });
  pads = [pad({ buttons: { [BUTTON.Y]: button(1) } })];
  gp.poll();
  assert.deepEqual(log, ["connect:Test pad (STANDARD GAMEPAD)"]);
  gp.poll();
  assert.equal(log.length, 1, "a button held while the pad appeared fires nothing");
  pads = [
    pad({
      axes: [0.575, 0, 0, 0],
      buttons: { [BUTTON.RT]: button(1), [BUTTON.X]: button(1), [BUTTON.MENU]: button(1), [BUTTON.LB]: button(1) },
    }),
  ];
  const s = gp.poll();
  near(s.steer, 0.5);
  near(s.throttle, 1);
  assert.deepEqual(log.slice(1), ["camera", "left", "pause"]);
  gp.poll();
  assert.equal(log.length, 4, "a held button fires once");
  pads = [
    pad({
      buttons: { [BUTTON.VIEW]: button(1), [BUTTON.RB]: button(1), [BUTTON.B]: button(1), [BUTTON.RT]: button(1) },
    }),
  ];
  blocked = true;
  assert.equal(gp.poll().throttle, 0, "nothing drives while blocked");
  assert.equal(log.length, 4, "no action while blocked");
  blocked = false;
  pads = [
    pad({
      buttons: { [BUTTON.VIEW]: button(1), [BUTTON.RB]: button(1), [BUTTON.B]: button(1), [BUTTON.Y]: button(1) },
    }),
  ];
  gp.poll();
  assert.deepEqual(log.slice(4), ["autopilot"], "buttons pressed while blocked do not fire on release of the block");
  pads = [];
  gp.poll();
  assert.equal(log.at(-1), "disconnect");
  assert.equal(gp.pad, null);
}

// Touch: the ?touch= override and the slide-to-steer mapping.
assert.equal(touchWanted("", false), false);
assert.equal(touchWanted("", true), true);
assert.equal(touchWanted("?touch=1", false), true);
assert.equal(touchWanted("?seed=4&touch=0", true), false);
assert.equal(steerFromDrag(0), 0);
near(steerFromDrag(STEER_RANGE_PX / 2), 0.5);
assert.equal(steerFromDrag(-5 * STEER_RANGE_PX), -1);
assert.equal(steerFromDrag(NaN), 0);

// Input: keys keep their all-or-nothing values, analog sources add their amounts, the strongest
// pedal wins, steering sums and clamps, and an open dialog stops the analog sources.
{
  const input = new Input({});
  const source = { state: { steer: 0, throttle: 0, brake: 0, hardBrake: false } };
  input.addSource(source);
  input.poll();
  assert.equal(input.anyDriving, false);
  assert.equal(input.left, 0);
  assert.equal(input.right, 0);
  assert.equal(input.throttle, 0);
  input.keys.add("w");
  assert.equal(input.throttle, 1);
  assert.equal(input.anyDriving, true);
  input.keys.clear();
  source.state = { steer: -0.4, throttle: 0.3, brake: 0, hardBrake: false };
  input.poll();
  near(input.left, 0.4);
  assert.equal(input.right, 0);
  near(input.throttle, 0.3);
  assert.equal(input.anyDriving, true);
  input.keys.add("d");
  near(input.right, 1);
  near(input.left, 0.4);
  input.keys.clear();
  input.addSource({ poll: () => ({ steer: -0.9, throttle: 0.8, brake: 0, hardBrake: true }) });
  input.poll();
  assert.equal(input.left, 1, "two sources steering the same way clamp at full lock");
  near(input.throttle, 0.8);
  assert.equal(input.hardBrake, true);
  dialogOpen = true;
  input.poll();
  dialogOpen = false;
  assert.equal(input.anyDriving, false, "a dialog stops the analog sources");
}

// World.stepManual: the keyboard's booleans and 1s drive exactly alike, and half a trigger asks for
// half the acceleration and half the steering demand. (Only primitives go to assert.)
{
  const { MapData } = await import("../static/js/map/mapdata.js");
  const { World } = await import("../static/js/sim/world.js");
  const { readFileSync, readdirSync } = await import("node:fs");
  // (any committed street pack will do: the smallest, which loads fastest)
  const { statSync } = await import("node:fs");
  const file = readdirSync("data/maps")
    .filter((f) => f.endsWith(".pack.json"))
    .sort((a, b) => statSync(`data/maps/${a}`).size - statSync(`data/maps/${b}`).size)[0];
  const map = new MapData(JSON.parse(readFileSync(`data/maps/${file}`, "utf8")));
  const run = (controls) => {
    const world = new World(map, { parked: 0, pedestrians: 0 });
    world.ego.v = 6;
    for (const c of controls) for (let i = 0; i < 30; i++) world.stepManual(1 / 60, c);
    return [world.ego.x, world.ego.y, world.ego.psi, world.ego.v, world.ego.delta].join(",");
  };
  const keys = [{ throttle: true, left: true }, { brake: true, right: true }, {}, { hardBrake: true, brake: true }];
  const numbers = [
    { throttle: 1, left: 1, right: 0, brake: 0 },
    { brake: 1, right: 1, left: 0, throttle: 0 },
    { throttle: 0, brake: 0, left: 0, right: 0 },
    { hardBrake: true, brake: 1, throttle: 0 },
  ];
  assert.equal(run(keys), run(numbers), "keys and full analog amounts drive identically");
  const world = new World(map, { parked: 0, pedestrians: 0 });
  world.ego.v = 6;
  world.stepManual(1 / 60, { throttle: 0.5 });
  const half = world.ego.v;
  const full = new World(map, { parked: 0, pedestrians: 0 });
  full.ego.v = 6;
  full.stepManual(1 / 60, { throttle: 1 });
  assert.ok(half > 6 && half < full.ego.v, "half throttle accelerates, less than full");
  const steerWorld = new World(map, { parked: 0, pedestrians: 0 });
  for (let i = 0; i < 120; i++) steerWorld.stepManual(1 / 60, { left: 0.5 });
  const fullSteer = new World(map, { parked: 0, pedestrians: 0 });
  for (let i = 0; i < 120; i++) fullSteer.stepManual(1 / 60, { left: 1 });
  near(steerWorld.ego.delta / fullSteer.ego.delta, 0.5, 1e-3);
}

console.log("gamepad and touch input: ok");
process.exit(0);
