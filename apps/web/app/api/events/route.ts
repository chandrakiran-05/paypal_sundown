/** Stream state changes without retaining disconnected consumers. */
import { snapshot } from "../../../lib/store";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  let timer: ReturnType<typeof setInterval>;
  const stream = new ReadableStream({
    start(controller) {
      const send = () =>
        controller.enqueue(
          new TextEncoder().encode(
            "data: " + JSON.stringify(snapshot()) + "\n\n",
          ),
        );
      send();
      timer = setInterval(send, 900);
      request.signal.addEventListener("abort", () => {
        clearInterval(timer);
        try {
          controller.close();
        } catch {
          /* Stream already closed. */
        }
      });
    },
    cancel() {
      clearInterval(timer);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
