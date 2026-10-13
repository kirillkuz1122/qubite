/* Approved assets/design-lab Ribbon SVG paths; no demo runtime. */
const glyphs: Record<string, string> = {
  search: "M24 26a11 11 0 1 0 22 0a11 11 0 1 0-22 0M43 35l10 13",
  writing: "M24 44l3-12L43 16l8 8-16 16-11 4M28 32l7 8M23 50h27",
  vpn: "M21 22l16-6 16 6v11c0 12-16 19-16 19S21 45 21 33Z M30 33l5 5 10-11",
  vault: "M26 30v-7a11 11 0 0 1 22 0v7M23 30h28v22H23Z M37 38v7",
  memos: "M24 17h26v29l-8 8H24Z M42 54v-8h8M30 27h13M30 34h13M30 41h7",
  vikunja: "M23 24l4 4 6-8M23 40l4 4 6-8M39 25h12M39 41h12",
  siyuan:
    "M37 22c-6-5-13-6-20-2v29c7-4 14-3 20 2 6-5 13-6 20-2V20c-7-4-14-3-20 2Z M37 22v29",
  brief: "M20 20h34v25H38l-10 8v-8h-8Z M27 28h20M27 36h13",
  kwork: "M21 46l10-12 10 6 12-21M43 19h10v10M22 53h31",
  tournaments:
    "M27 18h20v15c0 8-5 12-10 12s-10-4-10-12Z M27 22h-9v5c0 8 6 11 11 11M47 22h9v5c0 8-6 11-11 11M37 45v9M28 54h18",
  telegram: "M17 30l40-14-9 39-13-15-10 9 2-17 22-10-22 17Z",
};

export function Mark({
  service = "qubite",
  className = "",
}: {
  service?: string;
  className?: string;
}) {
  const aliases: Record<string, string> = {
    docs: "memos",
    projects: "brief",
    planner: "vikunja",
    atlas: "siyuan",
  };
  const main = service === "qubite";
  const glyph = glyphs[aliases[service] || service];
  return (
    <svg
      className={`brand-mark ${className}`}
      viewBox="0 0 74 74"
      fill="none"
      aria-hidden="true"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {main ? (
        <path
          strokeWidth="8"
          d="M50 48C39 59 19 53 18 36c-2-18 20-29 34-16 11 10 6 23-3 25-7 2-12-6-7-10 5-5 14 7 18 18"
        />
      ) : (
        <>
          <path
            strokeWidth="2.5"
            opacity=".32"
            d="M54 57C32 67 9 49 15 28c6-24 34-21 43-9"
          />
          <path strokeWidth="4" d={glyph} />
        </>
      )}
    </svg>
  );
}
