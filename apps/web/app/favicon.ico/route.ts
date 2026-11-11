/** Preserve conventional favicon requests using the authored SVG brand mark. */
export function GET(request: Request) {
  return Response.redirect(new URL("/icon.svg", request.url), 308);
}
