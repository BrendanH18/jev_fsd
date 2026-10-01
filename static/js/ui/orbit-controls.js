// Bind only the driving canvas: HUD buttons and minimap gestures retain their own behavior.
export class OrbitControls {
  constructor(canvas, { rotate, zoom, pinch }) {
    this.points = new Map();
    const gesture = () => {
      const points = [...this.points.values()];
      const [a, b] = points;
      return b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, span: Math.hypot(a.x - b.x, a.y - b.y) }
        : a ? { ...a, span: 0 } : null;
    };
    const clear = () => {
      for (const id of this.points.keys()) if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
      this.points.clear(); canvas.classList.remove("orbit-dragging");
    };
    canvas.addEventListener("pointerdown", ev => {
      if (ev.pointerType === "mouse" && ev.button !== 0) return;
      canvas.focus({ preventScroll: true });
      this.points.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      canvas.setPointerCapture(ev.pointerId);
      canvas.classList.add("orbit-dragging");
    });
    canvas.addEventListener("pointermove", ev => {
      if (!this.points.has(ev.pointerId)) return;
      const before = gesture();
      this.points.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      const after = gesture();
      if (before.span > 2 && after.span > 2) pinch(before.span / after.span);
      if (after.x !== before.x || after.y !== before.y) rotate(after.x - before.x, after.y - before.y);
    });
    const release = ev => {
      this.points.delete(ev.pointerId);
      if (canvas.hasPointerCapture(ev.pointerId)) canvas.releasePointerCapture(ev.pointerId);
      if (!this.points.size) canvas.classList.remove("orbit-dragging");
    };
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);
    canvas.addEventListener("lostpointercapture", release);
    canvas.addEventListener("wheel", ev => {
      if (ev.ctrlKey || ev.metaKey) return; // Keep browser zoom available.
      ev.preventDefault();
      zoom(ev.deltaY * (ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? canvas.clientHeight : 1));
    }, { passive: false });
    canvas.addEventListener("keydown", ev => {
      // Shift+arrows orbit; plain arrows remain driving inputs.
      if (!ev.shiftKey || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(ev.key)) return;
      ev.preventDefault(); ev.stopImmediatePropagation();
      rotate(ev.key === "ArrowLeft" ? -24 : ev.key === "ArrowRight" ? 24 : 0,
        ev.key === "ArrowUp" ? -24 : ev.key === "ArrowDown" ? 24 : 0);
    });
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", () => { if (document.hidden) clear(); });
  }
}
