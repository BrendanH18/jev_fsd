const steps = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

// Keep the keyboard marker in canvas coordinates so it scales with the map on phones.
export function bindMapPicker(canvas, cursor, { fromCar, onSelect }) {
  let x, y;
  const keepInside = (value, max) => Math.min(max, Math.max(0, value));
  function move(nextX, nextY) {
    x = keepInside(nextX, canvas.width);
    y = keepInside(nextY, canvas.height);
    cursor.style.left = `${(100 * x) / canvas.width}%`;
    cursor.style.top = `${(100 * y) / canvas.height}%`;
    cursor.hidden = false;
  }
  canvas.addEventListener("blur", () => (cursor.hidden = true));
  canvas.addEventListener("keydown", (event) => {
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    const step = Object.hasOwn(steps, event.key) ? steps[event.key] : null;
    if (!step && event.key !== "Enter" && event.key !== "Home") return;
    event.preventDefault();
    event.stopPropagation();
    if (cursor.hidden || event.key === "Home") move(...fromCar());
    if (step) {
      const distance = event.shiftKey ? 1 : 6;
      move(x + step[0] * distance, y + step[1] * distance);
    }
    if (event.key === "Enter" && !event.repeat) onSelect(x, y);
  });
}
