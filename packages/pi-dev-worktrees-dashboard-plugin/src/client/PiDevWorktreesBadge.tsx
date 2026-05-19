import React, { useEffect, useState } from "react";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { footerText } from "./predicates.js";

/** Tracks `<html data-theme>` reactively so badge palette flips with the dashboard theme. */
function useIsLightTheme(): boolean {
  const read = () =>
    typeof document !== "undefined" &&
    document.documentElement.getAttribute("data-theme") === "light";
  const [light, setLight] = useState(read);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const obs = new MutationObserver(() => setLight(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return light;
}

export function PiDevWorktreesBadge({
  session,
}: {
  session: DashboardSession;
}): React.ReactElement | null {
  const text = footerText(session, "footer-segment:pi-dev-worktrees:workspace-state");
  const light = useIsLightTheme();
  if (!text) return null;

  const palette = light
    ? { background: "rgba(34, 197, 94, 0.15)", color: "rgb(21, 128, 61)" }
    : { background: "rgba(34, 197, 94, 0.15)", color: "rgb(134, 239, 172)" };

  return (
    <span
      data-testid="pi-dev-worktrees-badge"
      title={text}
      className="inline-flex items-center px-1.5 py-[1px] rounded font-mono text-[10px]"
      style={{ ...palette, verticalAlign: "middle" }}
    >
      {text}
    </span>
  );
}
