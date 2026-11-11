/** Download proof as JSON, safe HTML, or a runnable Postman collection. */
import { postmanCollection } from "@sundown/engine/verification";
import { snapshot } from "../../../lib/store";
export function GET(request: Request) {
  const format = new URL(request.url).searchParams.get("format");
  const s = snapshot();
  if (format === "postman")
    return Response.json(postmanCollection(new URL(request.url).origin), {
      headers: {
        "Content-Disposition":
          'attachment; filename="sundown.postman_collection.json"',
      },
    });
  if (format === "html") {
    const escaped = JSON.stringify(s.results, null, 2)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;");
    return new Response(
      '<!doctype html><html lang="en"><title>Sundown parity proof</title><h1>Sundown / ' +
        s.mode +
        " evidence</h1><p>Synthetic replay fixtures are not live sandbox proof.</p><pre>" +
        escaped +
        "</pre></html>",
      {
        headers: {
          "Content-Type": "text/html",
          "Content-Disposition": 'attachment; filename="parity.html"',
        },
      },
    );
  }
  return Response.json(s.results, {
    headers: { "Content-Disposition": 'attachment; filename="parity.json"' },
  });
}
