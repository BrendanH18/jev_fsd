// Catch module-download failures as well as map/WebGL startup errors. A failed
// import must not leave the loading spinner running forever.
const retry = document.querySelector("#retry-start");
retry.addEventListener("click", () => location.reload());

import("./main.js").then(({ boot }) => boot()).catch(error => {
  console.error(error);
  document.querySelector("#loading").hidden = false;
  document.querySelector(".loading-mark").style.animation = "none";
  const message = document.querySelector("#loading-text");
  message.setAttribute("role", "alert");
  message.textContent = `Could not start the simulator: ${error.message || "loading failed"}`;
  retry.hidden = false;
});
