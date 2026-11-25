// Catch module-download failures as well as map/WebGL startup errors.
const retry = document.querySelector("#retry-start");
const freeDrive = document.querySelector("#start-free-drive");
retry.addEventListener("click", () => location.reload());

import("./main.js")
  .then(({ boot }) => boot())
  .catch((error) => {
    console.error(error);
    document.querySelector("#loading").hidden = false;
    document.querySelector(".loading-mark").hidden = true;
    const message = document.querySelector("#loading-text");
    message.setAttribute("role", "alert");
    message.textContent = `Could not start the simulator: ${error?.message || "loading failed"}`;
    retry.hidden = false;
    freeDrive.hidden = !location.search;
    retry.focus({ preventScroll: true });
  });
