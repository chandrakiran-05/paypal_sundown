/** Stream state changes without retaining disconnected consumers. */
import { snapshot } from "../../../lib/store";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let stopped = false;
  let close: (() => void) | undefined;
  const cleanup = () => {
    stopped = true;
    clearInterval(timer);
    request.signal.removeEventListener("abort", abort);
  };
  const abort = () => {
    cleanup();
    close?.();
  };
  const stream = new ReadableStream({
    start(controller) {
      close = () => {
        try {
          controller.close();
        } catch {
          /* Already closed. */
        }
      };
      const send = () => {
        if (stopped) return;
        try {
          controller.enqueue(
            new TextEncoder().encode(
              "data: " + JSON.stringify(snapshot()) + "\n\n",
            ),
          );
        } catch (error) {
          cleanup();
          controller.error(error);
        }
      };
      if (request.signal.aborted) {
        abort();
        return;
      }
      request.signal.addEventListener("abort", abort, { once: true });
      timer = setInterval(send, 900);
      send();
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
