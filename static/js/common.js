// Small shared helpers: API calls with the session token, formatting, DOM building.

const TOKEN = document.querySelector('meta[name="jev-csrf"]')?.content || "";

export async function api(path, body, { signal } = {}) {
  const opts = body === undefined
    ? { headers: { "X-Jev-Token": TOKEN }, signal }
    : { method: "POST", headers: { "Content-Type": "application/json", "X-Jev-Token": TOKEN }, body: JSON.stringify(body), signal };
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({ error: "Invalid response from server" }));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.jevStatus = data.jev_status;
    throw err;
  }
  return data;
}

export const ms = (v) => (v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`);
export function usd(v) {
  if (!v) return "$0";
  if (v < 0.0001) return `$${v.toFixed(7)}`;
  if (v < 0.01) return `$${v.toFixed(5)}`;
  return `$${v.toFixed(4)}`;
}
export const num = (v) => Number(v || 0).toLocaleString("en-US");
export const pct = (p) => `${Math.round(p * 100)}%`;
export const r1 = (v) => Math.round(v * 10) / 10;
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}
export const $ = (sel, root = document) => root.querySelector(sel);

export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

// Seeded RNG (mulberry32) so traffic is reproducible.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
