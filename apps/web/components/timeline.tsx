/** Real Bryntum Gantt and Scheduler instances driven by engine plan and portfolio records. */
"use client";
import { useEffect, useRef } from "react";
import type { Snapshot } from "../lib/store";
export default function Timeline({
  s,
  portfolio = false,
}: {
  s: Snapshot;
  portfolio?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let destroyed = false;
    let instance: { destroy: () => void } | undefined;
    async function mount() {
      if (!ref.current) return;
      if (portfolio) {
        const { Scheduler } = await import("@bryntum/gantt");
        if (destroyed) return;
        instance = new Scheduler({
          appendTo: ref.current,
          height: 530,
          startDate: new Date("2026-11-11"),
          endDate: new Date("2026-11-19"),
          viewPreset: "dayAndWeek",
          readOnly: true,
          rowHeight: 43,
          barMargin: 10,
          columns: [{ text: "Merchant", field: "name", width: 200 }],
          resources: s.merchants.map((m) => ({ id: m.id, name: m.name })),
          events: s.merchants.map((m) => ({
            id: m.id,
            resourceId: m.id,
            name: "Sandbox cutover",
            startDate: new Date(m.startDate + "Z"),
            endDate: new Date(m.endDate + "Z"),
            eventColor: "cyan",
          })),
        });
      } else {
        const { Gantt } = await import("@bryntum/gantt");
        if (destroyed) return;
        const gantt = new Gantt({
          appendTo: ref.current,
          height: 460,
          startDate: new Date("2026-11-09"),
          endDate: new Date("2026-12-04"),
          viewPreset: "dayAndWeek",
          columns: [{ type: "name", width: 280, text: "Migration task" }],
          readOnly: true,
          project: {
            tasks: s.tasks.map((t) => ({
              ...t,
              constraintType: "startnoearlierthan",
              constraintDate: t.startDate,
              cls: t.flagged ? "deferred-task" : "",
            })),
            dependencies: s.tasks.flatMap((t) =>
              t.predecessors.map((from) => ({ fromTask: from, toTask: t.id })),
            ),
          },
        });
        instance = gantt;
        await gantt.project.commitAsync();
        if (!destroyed)
          await gantt.zoomToFit({
            leftMargin: 20,
            rightMargin: 20,
            animate: false,
          });
      }
    }
    mount().catch(() => {
      if (ref.current)
        ref.current.textContent =
          "Timeline could not load. The dependency table below remains available.";
    });
    return () => {
      destroyed = true;
      instance?.destroy();
    };
  }, [s.tasks.map((t) => t.startDate).join(","), portfolio]);
  return <div ref={ref} className="bryntum-host" />;
}
