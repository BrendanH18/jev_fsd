import { h } from "../common.js";

function csvCell(value) {
  let s = value == null ? "" : String(value);
  // Keep imported labels as text if a spreadsheet interprets the CSV.
  if (typeof value === "string" && /^\s*[=+@-]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function downloadFile(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = h("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadCsv(filename, headers, rows) {
  const lines = [headers.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))];
  downloadFile(filename, `\uFEFF${lines.join("\r\n")}\r\n`, "text/csv;charset=utf-8");
}

export function downloadJson(filename, payload) {
  downloadFile(filename, `${JSON.stringify(payload, null, 2)}\n`, "application/json;charset=utf-8");
}
