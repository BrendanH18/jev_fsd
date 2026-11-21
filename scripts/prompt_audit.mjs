// Report request sizes for the city pilot without saving the request contents.
// Count Unicode code points, as the server does when validating Jev instructions.
import { statSync } from "node:fs";
import { resolve } from "node:path";

export function checkAuditPath(path, otherPaths, fail) {
  const resolved = resolve(path);
  const auditFile = statSync(resolved, { throwIfNoEntry: false });
  for (const other of otherPaths.filter(Boolean)) {
    const file = statSync(other, { throwIfNoEntry: false });
    if (resolve(other) === resolved || (file && auditFile && file.dev === auditFile.dev && file.ino === auditFile.ino))
      fail("--prompt-audit needs its own output path.");
  }
}

export function promptAudit() {
  const counters = new Map();
  const report = { requests: 0 };
  function count(prompt, text) {
    if (typeof text !== "string") return;
    const chars = Array.from(text).length;
    const stat = counters.get(prompt) || {
      samples: 0,
      max_chars: 0,
      ...(prompt === "llm_system" ? {} : { over_4000: 0 }),
    };
    stat.samples++;
    stat.max_chars = Math.max(stat.max_chars, chars);
    if (prompt !== "llm_system" && chars > 4000) stat.over_4000++;
    counters.set(prompt, stat);
  }
  return {
    observe(body) {
      report.requests++;
      for (const [id, question] of Object.entries(body.questions || {})) count(id, question.instructions);
      for (const message of body.messages || []) if (message.role === "system") count("llm_system", message.content);
    },
    result() {
      return { ...report, prompts: Object.fromEntries(counters) };
    },
  };
}
