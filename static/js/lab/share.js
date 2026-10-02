import { appUrl, copyText } from "../common.js";

export function driveLink(config, base = appUrl()) {
  const url = new URL(base);
  url.search = ""; url.hash = "";
  for (const key of ["challenge", "map", "seed", "weather", "time", "traffic", "car", "clock", "quality", "drive"]) {
    if (config?.[key] != null) url.searchParams.set(key, String(config[key]));
  }
  return url.href;
}

export async function copyDriveLink(config) {
  const link = driveLink(config);
  if (!await copyText(link)) { const error = new Error("Clipboard unavailable. Select and copy this link:"); error.link = link; throw error; }
  return link;
}

export async function exportDriveCard(report, config = {}) {
  const canvas = document.createElement("canvas"); canvas.width = 1200; canvas.height = 675;
  const ctx = canvas.getContext("2d");
  const bg = ctx.createLinearGradient(0, 0, 1200, 675); bg.addColorStop(0, "#101f2a"); bg.addColorStop(1, "#070c14");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, 1200, 675);
  ctx.strokeStyle = "#263d4a"; ctx.lineWidth = 1;
  for (let i = 0; i < 19; i++) { ctx.beginPath(); ctx.moveTo(600 + i * 45, 0); ctx.lineTo(170 + i * 85, 675); ctx.stroke(); }
  ctx.fillStyle = "#83d9c4"; ctx.font = "bold 22px system-ui"; ctx.fillText("JEV / DRIVE LAB", 70, 75);
  ctx.fillStyle = "#f3f6f9"; ctx.font = "bold 48px system-ui";
  let title = report.title;
  while (ctx.measureText(title).width > 1040 && title.length > 1) title = title.slice(0, -2) + "…";
  ctx.fillText(title, 70, 157);
  ctx.fillStyle = "#a2b6c6"; ctx.font = "24px system-ui"; ctx.fillText(report.map, 72, 204);
  ctx.fillStyle = report.qualified ? "#83d9c4" : "#a2b6c6";
  ctx.font = "bold 166px system-ui"; ctx.fillText(report.qualified ? String(report.score) : "—", 60, 393);
  ctx.font = "24px system-ui"; ctx.fillText(report.qualified ? `GRADE ${report.grade} / 100` : "PRACTICE DRIVE", 74, 437);
  const labels = { safety: "Safety", legality: "Road rules", comfort: "Smoothness", control: "Control" };
  Object.entries(report.categories).forEach(([key, score], i) => {
    const y = 282 + i * 54;
    ctx.fillStyle = "#b6c6d0"; ctx.font = "19px system-ui"; ctx.fillText(labels[key], 525, y);
    ctx.fillStyle = "#233845"; ctx.fillRect(680, y - 17, 320, 10);
    ctx.fillStyle = "#83d9c4"; ctx.fillRect(680, y - 17, score * 3.2, 10);
    ctx.fillStyle = "#ecf5f9"; ctx.fillText(String(score), 1026, y);
  });
  ctx.fillStyle = "#a2b6c6"; ctx.font = "21px system-ui";
  ctx.fillText(`${report.driver.toUpperCase()}  ·  ${(report.distance_m / 1000).toFixed(2)} km  ·  ${Math.round(report.elapsed_s)} s  ·  ${config.weather || "dry"}  ·  ${report.status}${report.branched ? " · replay branch" : report.modified ? " · modified" : ""}`, 74, 511);
  ctx.fillStyle = "#83d9c4"; ctx.font = "bold 24px system-ui"; ctx.fillText("Can you beat this drive?", 74, 596);
  ctx.fillStyle = "#8da3b1"; ctx.font = "17px system-ui"; ctx.fillText("github.com/BrendanH18/jev_fsd · Simulation coaching model v1", 74, 630);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Could not create the image.");
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = "jev-drive-card.png"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
