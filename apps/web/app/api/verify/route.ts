import { fixtures } from "../../../lib/store";
import { verifyScenarios } from "@sundown/engine/verification";
export const dynamic = "force-dynamic";
export function GET() {
  try {
    const report = verifyScenarios(fixtures());
    return Response.json(report, { status: report.passed ? 200 : 409 });
  } catch (error) {
    return Response.json(
      {
        passed: false,
        error: error instanceof Error ? error.message : "Invalid evidence",
      },
      { status: 422 },
    );
  }
}
