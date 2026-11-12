/** Operator source assessments remain separate from the Horizon demo and payment evidence. */
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { scan, plan, type Task } from "@sundown/engine";
import { openDatabase, initializeSchema } from "./database";
import { root } from "./store";

export const assessmentLimits = {
  files: 10,
  fileBytes: 100 * 1024,
  totalBytes: 300 * 1024,
  requestBytes: 1024 * 1024,
  findings: 500,
} as const;
const controls = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;
const filename = z
  .string()
  .min(1)
  .max(120)
  .refine(
    (value) =>
      /^[A-Za-z0-9][A-Za-z0-9._ -]*\.(php|js|ts|tsx|html)$/i.test(value) &&
      !value.includes("..") &&
      !/(^|\.)env(\.|$)/i.test(value),
    "Use a source filename without paths",
  );
const content = z
  .string()
  .min(1)
  .max(assessmentLimits.fileBytes)
  .refine(
    (value) =>
      value.trim().length > 0 &&
      !controls.test(value) &&
      Buffer.byteLength(value, "utf8") <= assessmentLimits.fileBytes &&
      Buffer.from(value, "utf8").toString("utf8") === value,
    "Use a plain UTF-8 source file",
  );
const validSite = (value: string) => {
  if (!value) return true;
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
};
export const businessAssessmentInput = z
  .strictObject({
    requestId: z.uuid(),
    name: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine((value) => !/\p{Cc}/u.test(value)),
    siteUrl: z.string().trim().max(2048).refine(validSite).optional(),
    files: z
      .array(z.strictObject({ name: filename, content }))
      .min(1)
      .max(assessmentLimits.files),
  })
  .superRefine((input, context) => {
    if (
      new Set(input.files.map((file) => file.name.toLowerCase())).size !==
      input.files.length
    )
      context.addIssue({ code: "custom", message: "Duplicate filenames" });
    if (
      input.files.reduce(
        (total, file) => total + Buffer.byteLength(file.content, "utf8"),
        0,
      ) > assessmentLimits.totalBytes
    )
      context.addIssue({
        code: "custom",
        message: "Total source size exceeds the limit",
      });
  });

export type BusinessAssessment = {
  id: string;
  name: string;
  siteUrl: string | null;
  createdAt: string;
  provenance: "uploaded-source-analysis";
  status: "assessed";
  sourceHash: string;
  files: { name: string; bytes: number; sha256: string }[];
  findings: {
    id: string;
    rule: string;
    file: string;
    line: number;
    replacement: string;
    risk: number;
    doc: string;
  }[];
  tasks: Task[];
  limitations: string[];
};
export class BusinessAssessmentError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}
const db = openDatabase(path.join(root, "workspace/sundown.sqlite"));
initializeSchema(
  db,
  "CREATE TABLE IF NOT EXISTS business_assessments(id TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL, input_hash TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL)",
);
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const stored = (value: unknown): BusinessAssessment =>
  JSON.parse(String(value)) as BusinessAssessment;

export function createBusinessAssessment(value: unknown): BusinessAssessment {
  const parsed = businessAssessmentInput.safeParse(value);
  if (!parsed.success)
    throw new BusinessAssessmentError(
      "Invalid assessment input. Use 1–10 plain source files, up to 100 KiB each and 300 KiB total, with unique filenames and no paths.",
      400,
    );
  const input = parsed.data;
  const sources = [...input.files].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  const files = sources.map((file) => ({
    name: file.name,
    bytes: Buffer.byteLength(file.content, "utf8"),
    sha256: digest(file.content),
  }));
  const sourceHash = digest(JSON.stringify(files));
  let siteUrl: string | null = null;
  if (input.siteUrl) {
    const url = new URL(input.siteUrl);
    url.search = "";
    url.hash = "";
    siteUrl = url.toString();
  }
  const inputHash = digest(
    JSON.stringify({ name: input.name, siteUrl, sourceHash }),
  );
  const existing = db
    .prepare(
      "SELECT input_hash,payload FROM business_assessments WHERE request_id=?",
    )
    .get(input.requestId);
  if (existing) {
    if (existing.input_hash !== inputHash)
      throw new BusinessAssessmentError(
        "This request ID was already used for a different assessment. Start a new assessment.",
        409,
      );
    return stored(existing.payload);
  }
  const findings = scan(
    Object.fromEntries(sources.map((file) => [file.name, file.content])),
  );
  if (findings.length > assessmentLimits.findings)
    throw new BusinessAssessmentError(
      "This source sample contains too many findings for one assessment. Upload a smaller source sample.",
      422,
    );
  const assessment: BusinessAssessment = {
    id: randomUUID(),
    name: input.name,
    siteUrl,
    createdAt: new Date().toISOString(),
    provenance: "uploaded-source-analysis",
    status: "assessed",
    sourceHash,
    files,
    // Source excerpts may contain credentials. Do not persist or return snippets.
    findings: findings.map((finding) => ({
      id: digest(`${finding.file}:${finding.line}:${finding.id}`).slice(0, 24),
      rule: finding.id,
      file: finding.file,
      line: finding.line,
      replacement: finding.replacement,
      risk: finding.risk,
      doc: finding.doc,
    })),
    tasks: findings.length ? plan(findings) : [],
    limitations: [
      "Static source analysis only. No source code was executed or retained.",
      "The website URL is metadata only; Sundown did not fetch the site.",
      "No PayPal account is connected and no payment was attempted.",
      "Parity scenarios have not run for this business; no migration has been executed.",
      "The proposed plan is not a readiness certification. Zero findings do not prove checkout compatibility.",
      "Plan dates are illustrative suggestions from the demo planner; no business cutover has been scheduled.",
      "Horizon demo transactions, catalog and migration results do not apply to this assessment.",
    ],
  };
  db.prepare(
    "INSERT OR IGNORE INTO business_assessments(id,request_id,input_hash,created_at,payload) VALUES(?,?,?,?,?)",
  ).run(
    assessment.id,
    input.requestId,
    inputHash,
    assessment.createdAt,
    JSON.stringify(assessment),
  );
  const saved = db
    .prepare(
      "SELECT input_hash,payload FROM business_assessments WHERE request_id=?",
    )
    .get(input.requestId)!;
  if (saved.input_hash !== inputHash)
    throw new BusinessAssessmentError(
      "This request ID was already used for a different assessment. Start a new assessment.",
      409,
    );
  return stored(saved.payload);
}
export function listBusinessAssessments(): BusinessAssessment[] {
  return db
    .prepare(
      "SELECT payload FROM business_assessments ORDER BY created_at DESC,id DESC LIMIT 50",
    )
    .all()
    .map((row) => stored(row.payload));
}
export function getBusinessAssessment(id: string): BusinessAssessment {
  if (!z.uuid().safeParse(id).success)
    throw new BusinessAssessmentError("Invalid assessment ID", 400);
  const row = db
    .prepare("SELECT payload FROM business_assessments WHERE id=?")
    .get(id);
  if (!row) throw new BusinessAssessmentError("Assessment not found", 404);
  return stored(row.payload);
}
