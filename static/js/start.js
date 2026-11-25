// Catch module-download failures as well as map/WebGL startup errors.
const retry = document.querySelector("#retry-start");
const freeDrive = document.querySelector("#start-free-drive");
const loading = document.querySelector("#loading");
const mark = document.querySelector(".loading-mark");
const message = document.querySelector("#loading-text");
retry.addEventListener("click", () => location.reload());

import("./main.js")
  .then(({ boot }) => boot())
  .catch((error) => {
    console.error(error);
    loading.hidden = false;
    mark.hidden = true;
    document.querySelector("#hud").hidden = true;
    document.querySelector("#view").inert = true;
    message.setAttribute("role", "alert");
    message.textContent = `Could not start the simulator: ${error?.message || "loading failed"}`;
    retry.hidden = false;
    const url = new URL(location.href);
    if (url.search) {
      for (const key of ["challenge", "replay", "explore", "bbox", "map"]) url.searchParams.delete(key);
      url.searchParams.set("drive", "manual");
      freeDrive.href = url;
      freeDrive.hidden = false;
    }
    retry.focus({ preventScroll: true });
  });
