/** AG Studio owns the overview canvas, custom widget registry and branded theme. */
"use client";
import { useMemo, createContext, useContext, useEffect, useRef } from "react";
import {
  AgStudio,
  AgStudioProvider,
  type AgRegistry,
  type AgWidgetDefinition,
} from "ag-studio-react";
import {
  studioTheme,
  type AgReportState,
  AgStudioAiModule,
  createAiHarness,
  type AgLlmAdapter,
  type AgLlmResponse,
  type AgAiEvent,
  type AgStudioApi,
} from "ag-studio";
import type { Snapshot } from "../lib/store";
import { Matrix, Risk, Burndown, Countdown } from "./widgets";
const Evidence = createContext<{
  s: Snapshot;
  onSelect: (i: number) => void;
} | null>(null);
function useEvidence() {
  const value = useContext(Evidence);
  if (!value) throw new Error("Missing evidence");
  return value.s;
}
function ParityWidget() {
  const context = useContext(Evidence);
  return <Matrix s={useEvidence()} onSelect={context?.onSelect} />;
}
function RiskWidget() {
  return <Risk s={useEvidence()} />;
}
function BurndownWidget() {
  return <Burndown s={useEvidence()} />;
}
interface Registry extends AgRegistry {
  widgets: readonly AgWidgetDefinition[];
}
const definitions: AgWidgetDefinition[] = [
  {
    id: "parity",
    label: "Differential parity",
    comp: ParityWidget,
    form: (params) => params.createDefaults({}),
    defaultSize: { width: 12, height: 12 },
    minSize: { width: 5, height: 5 },
    ai: { description: "Six-flow parity matrix from replay evidence" },
  },
  {
    id: "risk",
    label: "Risk by file",
    comp: RiskWidget,
    form: (params) => params.createDefaults({}),
    defaultSize: { width: 10, height: 12 },
    minSize: { width: 5, height: 5 },
    ai: { description: "Scanner risk by actual source file" },
  },
  {
    id: "burndown",
    label: "Template progress · illustrative",
    comp: BurndownWidget,
    form: (params) => params.createDefaults({}),
    defaultSize: { width: 12, height: 10 },
    minSize: { width: 5, height: 5 },
  },
  {
    id: "countdown",
    label: "Migration horizon",
    comp: Countdown,
    form: (params) => params.createDefaults({}),
    defaultSize: { width: 10, height: 10 },
    minSize: { width: 5, height: 5 },
  },
];
export default function Studio({
  s,
  focus,
  onSelect,
}: {
  s: Snapshot;
  focus?: string;
  onSelect: (i: number) => void;
}) {
  const studioRef = useRef<AgStudio<Registry>>(null);
  useEffect(() => {
    if (!focus || !studioRef.current) return;
    const api = studioRef.current.api;
    const current = api.getState();
    const pages = current.pages.map((page) => ({
      ...page,
      widgets: { ...page.widgets, ["agent-" + focus]: { type: focus } },
      widgetLayout: {
        ...page.widgetLayout,
        ["agent-" + focus]: page.widgetLayout?.["agent-" + focus] ?? {
          xTrack: 0,
          yTrack: Math.max(
            0,
            ...Object.values(page.widgetLayout ?? {}).map((position) =>
              position ? position.yTrack + position.ySpan : 0,
            ),
          ),
          xSpan: 24,
          ySpan: 18,
        },
      },
    }));
    api.setState({ ...current, pages });
  }, [focus]);
  const theme = useMemo(
    () =>
      studioTheme.withParams({
        backgroundColor: "#161b18",
        foregroundColor: "#e7e9e2",
        accentColor: "#e99b68",
        borderColor: "#303830",
        browserColorScheme: "dark",
        fontFamily: "Arial, sans-serif",
      }),
    [],
  );
  const state = useMemo<AgReportState<Registry>>(
    () => ({
      selectedPageId: "overview",
      pages: [
        {
          id: "overview",
          name: "Migration evidence",
          widgets: Object.fromEntries(
            definitions.map((d) => [d.id, { type: d.id }]),
          ),
          widgetLayout: {
            parity: { xTrack: 0, yTrack: 0, xSpan: 15, ySpan: 26 },
            risk: { xTrack: 15, yTrack: 0, xSpan: 9, ySpan: 26 },
            burndown: { xTrack: 0, yTrack: 26, xSpan: 15, ySpan: 14 },
            countdown: { xTrack: 15, yTrack: 26, xSpan: 9, ySpan: 14 },
          },
        },
      ],
      panels: { filters: { collapsed: true } },
    }),
    [],
  );
  return (
    <Evidence.Provider value={{ s, onSelect }}>
      <AgStudioProvider
        modules={[AgStudioAiModule]}
        licenseKey={process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY}
      >
        <div className="studio-shell">
          <div className="studio" data-focus-widget={focus}>
            <AgStudio<Registry>
              ref={studioRef}
              style={{ height: "100%", width: "100%" }}
              theme={theme}
              mode="view"
              layout={{ rowHeight: 16, minWidth: 0 }}
              panels={{ view: { left: [], right: [] } }}
              responsiveLayoutBreakpoints={[
                {
                  maxWidth: 700,
                  layout: (items) => {
                    let row = 0;
                    return items.map((item) => {
                      const height = item.layout.ySpan;
                      const next = {
                        ...item.layout,
                        xTrack: 0,
                        xSpan: 24,
                        yTrack: row,
                      };
                      row += height;
                      return next;
                    });
                  },
                },
              ]}
              ai={({ api }) =>
                createAiHarness(api as unknown as AgStudioApi, {
                  adapter: studioAdapter,
                })
              }
              data={{
                sources: [
                  {
                    id: "parity",
                    data: s.results.map((r) => ({
                      scenario: r.label,
                      amount: r.legacy.amount,
                      status: r.legacy.status,
                      passed: r.differences.length === 0,
                    })),
                  },
                  { id: "findings", data: s.findings },
                ],
              }}
              widgets={{
                widgets: definitions,
                menu: [
                  {
                    label: "Sundown evidence",
                    widgetIds: definitions.map((d) => d.id),
                  },
                ],
                defaultType: "parity",
              }}
              initialState={state}
            />
          </div>
        </div>
      </AgStudioProvider>
    </Evidence.Provider>
  );
}

const studioAdapter: AgLlmAdapter = {
  executeTurn(request, options) {
    const promise = (async (): Promise<AgLlmResponse> => {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: options?.signal,
        body: JSON.stringify({
          prompt: request.input
            .filter((i) => i.kind === "input")
            .map((i) =>
              i.type === "message"
                ? i.content
                    .filter((c) => c.type === "text")
                    .map((c) => (c.type === "text" ? c.text : ""))
                    .join(" ")
                : "",
            )
            .join(" ")
            .slice(-2000),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      return {
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        status: "completed",
        output: [
          {
            id: crypto.randomUUID(),
            kind: "output",
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "text", text: data.answer, annotations: [] }],
          },
        ],
      };
    })();
    return {
      complete: promise,
      stream: {
        async *[Symbol.asyncIterator](): AsyncIterator<AgAiEvent> {
          const result = await promise;
          const text = result.output
            .filter((i) => i.type === "message")
            .map((i) =>
              i.type === "message"
                ? i.content
                    .map((c) => (c.type === "text" ? c.text : ""))
                    .join("")
                : "",
            )
            .join("");
          yield {
            type: "TEXT_MESSAGE_CHUNK",
            messageId: result.id,
            role: "assistant",
            delta: text,
          };
        },
      },
    };
  },
};
