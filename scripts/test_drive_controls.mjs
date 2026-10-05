import assert from "node:assert/strict";
import { Input } from "../static/js/ui/input.js";

globalThis.window = new EventTarget();
globalThis.document = new EventTarget();
let dialogOpen = false;
document.querySelector = () => dialogOpen ? {} : null;
const target = kind => ({ isContentEditable: kind === "editable", closest: selector => selector.split(",").map(s => s.trim()).includes(kind) ? {} : null });
function emit(surface, type, fields = {}, focus = target("canvas")) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, fields); Object.defineProperty(event, "target", { value: focus });
  surface.dispatchEvent(event); return event;
}
let pauses = 0;
const input = new Input({ pause: () => pauses++ });
const press = (key, focus, extra = {}) => emit(window, "keydown", { key, ...extra }, focus);
assert(press("W").defaultPrevented); assert(input.throttle);
emit(window, "keyup", { key: "w" }); assert(!input.anyDriving);
press("ArrowLeft"); assert(input.left);
emit(window, "blur"); assert(!input.anyDriving);
for (const kind of ["input", "textarea", "select", "editable", "button", "a", "[role='textbox']"]) {
  press("w"); assert(input.throttle);
  emit(document, "focusin", {}, target(kind)); assert(!input.anyDriving, `held throttle clears when focusing ${kind}`);
}
for (const kind of ["input", "textarea", "select", "editable", "[role='textbox']"]) {
  assert(!press("w", target(kind)).defaultPrevented); assert(!input.anyDriving);
  press("p", target(kind)); assert.equal(pauses, 0);
}
for (const kind of ["button", "a", "[role='button']", "[role='radio']", "[role='switch']"]) {
  for (const key of ["w", "a", "s", "d", " ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]) {
    assert(!press(key, target(kind)).defaultPrevented, `${kind} retains normal ${key} behaviour`);
    assert(!input.anyDriving, `${key} cannot drive while ${kind} is focused`);
  }
}
press("w"); document.hidden = true; emit(document, "visibilitychange"); assert(!input.anyDriving);
document.hidden = false; emit(document, "visibilitychange"); assert(!input.anyDriving);
press("w"); dialogOpen = true; emit(document, "focusin"); assert(!input.anyDriving);
press("w"); press("p"); assert(!input.anyDriving); assert.equal(pauses, 0);
dialogOpen = false;
for (const modifier of ["ctrlKey", "metaKey", "altKey"]) {
  assert(!press("w", undefined, { [modifier]: true }).defaultPrevented); assert(!input.anyDriving);
  press("p", undefined, { [modifier]: true }); assert.equal(pauses, 0);
}
press("p"); press("p", undefined, { repeat: true }); assert.equal(pauses, 1);
console.log("Drive controls passed: key release, blur, hidden tabs, form/dialog focus, editable fields, focused controls and browser shortcuts.");
