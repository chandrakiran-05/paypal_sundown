/** Existing production proxy authentication protects all source-assessment endpoints. */
import {
  assessmentLimits,
  BusinessAssessmentError,
  createBusinessAssessment,
  getBusinessAssessment,
  listBusinessAssessments,
} from "../../../lib/business-assessment";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function failure(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof BusinessAssessmentError
          ? error.message
          : "Assessment unavailable",
    },
    {
      status: error instanceof BusinessAssessmentError ? error.status : 500,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
export function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const id = params.get("id");
    if (!id)
      return Response.json(
        { assessments: listBusinessAssessments() },
        { headers: { "Cache-Control": "no-store" } },
      );
    const assessment = getBusinessAssessment(id);
    if (params.get("format") === "json")
      return Response.json(assessment, {
        headers: {
          "Cache-Control": "no-store",
          "Content-Disposition": `attachment; filename="sundown-assessment-${assessment.id}.json"`,
        },
      });
    return Response.json(
      { assessment },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    const declared = request.headers.get("content-length");
    if (
      declared &&
      (!/^\d+$/.test(declared) ||
        Number(declared) > assessmentLimits.requestBytes)
    )
      throw new BusinessAssessmentError("Assessment request is too large", 413);
    if (!request.body)
      throw new BusinessAssessmentError("Invalid assessment request", 400);
    const reader = request.body.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > assessmentLimits.requestBytes) {
        await reader.cancel();
        throw new BusinessAssessmentError(
          "Assessment request is too large",
          413,
        );
      }
      chunks.push(result.value);
    }
    let input: unknown;
    try {
      input = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
      );
    } catch {
      throw new BusinessAssessmentError("Invalid assessment request", 400);
    }
    return Response.json(
      { assessment: createBusinessAssessment(input) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
