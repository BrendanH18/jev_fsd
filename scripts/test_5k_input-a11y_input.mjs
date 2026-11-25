import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { BUTTON, GamepadInput, buttonValue, deadZone, pickPad, readPad } from "../static/js/ui/gamepad.js";
import { Input } from "../static/js/ui/input.js";
import { steerFromDrag, touchWanted } from "../static/js/ui/touch.js";

globalThis.window = new EventTarget();
globalThis.document = new EventTarget();
let dialog = false;
document.querySelector = () => (dialog ? { open: true } : null);

function key(type, value, options = {}) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { key: value }, options);
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

let camera = 0;
let shortcuts = true;
const input = new Input({ camera: () => camera++, shortcutsEnabled: () => shortcuts });
const down = (value, options) => key("keydown", value, options);
const up = (value, options) => key("keyup", value, options);

assert.equal(down("W", { code: "KeyZ" }), true, "honour the character from a non-QWERTY layout");
assert.equal(input.throttle, 1);
up("z", { code: "KeyZ" });
assert.equal(input.throttle, 0, "release the same physical key after the reported character changes");
down("a", { code: "KeyA" });
down("a", { code: "KeyB" });
up("a", { code: "KeyA" });
assert.equal(input.left, 1, "two physical keys can share the same character");
up("a", { code: "KeyB" });
assert.equal(input.left, 0);
down("ArrowUp");
down("w");
up("ArrowUp");
assert.equal(input.throttle, 1, "keyboard aliases are independent");
up("w");
assert.equal(input.throttle, 0);

down("s");
document.dispatchEvent(new Event("compositionstart"));
assert.equal(input.brake, 0, "starting composition releases keyboard braking before the first composition key");
assert.equal(down("s", { repeat: true }), true, "a stale repeat is consumed so arrows cannot scroll");
assert.equal(input.brake, 0, "key repeat cannot re-engage driving after clearing");
assert.equal(down("c", { ctrlKey: true }), false, "leave the browser Copy shortcut available");
assert.equal(down("c", { altKey: true }), false, "leave OS Alt shortcuts available");
assert.equal(down("c", { metaKey: true }), false, "leave Command shortcuts available");
assert.equal(camera, 0);
assert.equal(down("constructor"), false, "inherited object names are never shortcut bindings");
assert.equal(down(undefined), false, "a keyboard event missing its key is ignored");

const withSelector = (part) => ({
  composedPath: () => [{ closest: (selector) => (selector.includes(part) ? {} : null) }],
});
assert.equal(down("w", withSelector("[role='combobox']")), false, "editing in an ARIA combobox takes priority");
assert.equal(down("ArrowUp", withSelector("[role='listbox']")), false, "leave listbox navigation available");
assert.equal(down("ArrowRight", withSelector("[role='tree']")), false, "leave tree navigation available");
assert.equal(down("ArrowLeft", withSelector("[role='grid']")), false, "leave grid navigation available");
assert.equal(down("c", withSelector("[data-local-keys]")), false, "local overlays can reserve character keys");
assert.equal(
  down("c", { composedPath: () => [{ isContentEditable: true }] }),
  false,
  "a retargeted shadow editor keeps its keystrokes",
);
down("d");
document.hidden = true;
assert.equal(down("c"), false);
assert.equal(input.right, 0, "a background key event drops held keys");
assert.equal(camera, 0);
document.hidden = false;

shortcuts = false;
assert.equal(down("w"), false, "disabling character shortcuts keeps WASD available to the browser");
assert.equal(down("c"), false, "disabling character shortcuts blocks camera actions");
assert.equal(down("ArrowDown"), true);
assert.equal(input.brake, 1, "non-character driving remains available");
up("ArrowDown");
assert.equal(down(" "), true);
assert.equal(input.hardBrake, true, "Space remains available with letter shortcuts disabled");
up(" ");
const hints = new Map([["aria-keyshortcuts", "C"]]);
const hint = {
  dataset: { driveShortcut: "C" },
  setAttribute: (name, value) => hints.set(name, value),
  removeAttribute: (name) => hints.delete(name),
};
const hintRoot = { querySelectorAll: () => [hint] };
input.refreshShortcutHints(hintRoot);
assert.equal(hints.has("aria-keyshortcuts"), false);
shortcuts = true;
input.refreshShortcutHints(hintRoot);
assert.equal(hints.get("aria-keyshortcuts"), "C");
assert.equal(down("c"), true);
assert.equal(down("c", { repeat: true }), true, "consume repeats of a handled shortcut");
assert.equal(camera, 1);

let polls = 0;
let releases = 0;
let pulse = true;
const source = {
  get state() {
    return { steer: -0.5, throttle: pulse, brake: false, hardBrake: pulse };
  },
  poll() {
    polls++;
    return this.state;
  },
  stepped() {
    const consumed = pulse;
    pulse = false;
    return consumed;
  },
  release() {
    releases++;
  },
};
assert.equal(input.addSource(source), source, "addSource returns the registered source");
input.addSource(source);
input.poll();
assert.equal(polls, 1, "registering a source twice does not double-poll it");
assert.equal(input.throttle, 1, "boolean accelerator travel equals full numeric travel");
assert.equal(input.brake, 0, "boolean false pedal travel equals zero");
assert.equal(input.left, 0.5, "analog steering reaches the corresponding directional getter");
assert.equal(input.hardBrake, true);
input.stepped();
assert.equal(polls, 1, "consuming a one-step pulse does not poll the hardware again");
assert.equal(input.throttle, 0);
assert.equal(input.hardBrake, false);
assert.equal(input.left, 0.5, "consuming a pulse keeps sustained steering");
window.dispatchEvent(new Event("pagehide"));
assert.equal(releases, 1, "pagehide releases sources even before another frame runs");
assert.equal(input.anyDriving, false);
pulse = true;
input.poll();
input.clear();
input.stepped();
assert.equal(input.anyDriving, false, "consuming a stale pulse cannot resurrect an invalidated frame");
window.dispatchEvent(new Event("blur"));
input.poll();
assert.equal(input.anyDriving, false, "a blurred window ignores sources even if the tab remains visible");
assert.equal(down("c"), false, "a blurred window ignores one-shot shortcuts");
window.dispatchEvent(new Event("focus"));
input.poll();
assert.equal(input.left, 0.5, "focus restores normal input polling");
const bogus = new Input();
bogus.addSource({ state: { steer: Symbol("axis"), brake: "1", throttle: {}, hardBrake: "false" } });
assert.equal(bogus.poll().steer, 0, "malformed axis values do not throw");
assert.equal(bogus.anyDriving, false, "unsupported value types cannot engage driving");

let modalReleases = 0;
const modalInput = new Input();
modalInput.addSource({
  poll() {
    dialog = true;
    return { throttle: 1 };
  },
});
modalInput.addSource({ release: () => modalReleases++ });
assert.equal(modalInput.poll().throttle, 0, "a dialog opened during polling blocks that frame immediately");
assert.equal(modalReleases, 1, "later sources receive the block in the same poll");
dialog = false;

assert.equal(buttonValue(true), 1, "a boolean legacy gamepad button supplies full travel");
assert.equal(buttonValue(false), 0, "a released boolean legacy gamepad button supplies no travel");
assert.equal(buttonValue({ pressed: "false" }), 0, "a string must not be mistaken for a held gamepad button");
assert.equal(deadZone(Symbol("invalid axis")), 0, "non-numeric axes fail closed without parsing or throwing");
assert.equal(deadZone(0.1, NaN), 0, "an invalid dead-zone setting falls back to the standard dead zone");
assert.equal(deadZone(0.8, -1), deadZone(0.8), "negative dead zones use the standard dead zone");
assert.equal(deadZone(1, 1), 1, "a singular dead zone does not hide full steering");
assert.equal(steerFromDrag(45, 0), 0.5, "a zero range does not turn a short drag into full lock");
assert.equal(steerFromDrag(45, Infinity), 0.5, "a non-finite range keeps the standard steering scale");
assert.equal(steerFromDrag(Symbol("invalid position")), 0, "malformed drag input is neutral");
assert.equal(touchWanted("?touch=true", false), true, "the spelled-out query override enables controls");
assert.equal(touchWanted("?touch=false", true), false, "the spelled-out query override disables controls");
assert.equal(touchWanted("?touch=other", true), true, "an unrecognised override falls back to the pointer type");
assert.equal(
  readPad({ axes: [0, 1], buttons: { [BUTTON.RT]: 0.3 } }).brake,
  1,
  "missing triggers fall back independently",
);
assert.equal(readPad({ axes: [0, -1], buttons: { [BUTTON.RT]: 0 } }).throttle, 0, "an installed trigger owns its axis");
assert.equal(
  readPad({ axes: [0.575, 0], buttons: { [BUTTON.LEFT]: true, [BUTTON.RIGHT]: true } }).steer > 0,
  true,
  "opposing D-pad steering cancels without suppressing stick steering",
);

const standard = { id: "standard", index: 1, mapping: "standard" };
const second = { id: "second", index: 0, mapping: "standard" };
const basic = { id: "basic", index: 3, mapping: "" };
assert.equal(pickPad([second, standard], "1:standard"), standard, "retain the active pad of the same priority");
assert.equal(pickPad([basic, standard], "3:basic"), standard, "prefer standard mapping over raw layout");
assert.equal(pickPad([second, standard], "1:missing"), second, "fall back when the active controller disappears");

let live = standard;
let blocked = false;
let horns = 0;
let pauses = 0;
const lifecycle = [];
const gamepad = new GamepadInput({
  getPads: () => [live],
  blocked: () => blocked,
  actions: {
    horn: () => horns++,
    camera: () => {
      blocked = true;
    },
    pause: () => pauses++,
  },
  onConnect: (pad) => lifecycle.push(pad.id),
  onDisconnect: (id) => lifecycle.push(id),
});
gamepad.poll();
live = { ...standard, buttons: [false, false, true, false, false, false, false, true, false, true] };
assert.equal(gamepad.poll().throttle, 0, "an action that opens a dialog discards the pending gamepad sample");
assert.equal(pauses, 0, "later gamepad actions in the same frame cannot reach behind a dialog");
blocked = false;
live = { ...standard, axes: [0.5, 0], buttons: [false, true] };
assert.equal(gamepad.poll().steer, 0, "steering remains neutral while the controller rearms");
assert.equal(horns, 0, "blocked button edges are discarded during rearming");
live = standard;
gamepad.poll();
live = { ...standard, buttons: [false, true] };
gamepad.poll();
assert.equal(horns, 1, "a fresh press works after the gamepad returns to neutral");
gamepad.release();
assert.equal(gamepad.state.hardBrake, false);
live = { ...standard, axes: [1, 0], buttons: [false, false, false, false, false, false, false, false, false, true] };
assert.equal(gamepad.poll().steer, 0, "an explicit source release requires the stick to return to centre");
assert.equal(pauses, 0);
live = { ...second, axes: [-1, 0] };
gamepad.poll();
assert.equal(
  lifecycle.join(","),
  "standard,1:standard,second",
  "controller replacement announces disconnect before connect",
);
assert.equal(gamepad.poll().steer, 0, "a replacement controller cannot immediately steer with a held stick");
live = second;
gamepad.poll();
live = { ...second, axes: [-1, 0] };
assert.equal(gamepad.poll().steer, -1);
console.log("Input accessibility and source lifecycle checks passed");

// unittest discovery skips hyphenated modules. Run the markup checks under the batch slug.
execFileSync("python3", [fileURLToPath(new URL("../tests/test_5k_input-a11y_markup.py", import.meta.url))], {
  stdio: "inherit",
});
