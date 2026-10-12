import { useId } from "react";
import type { Direction, Mood } from "./types";
export function Material({
  direction,
  mood = "idle",
  event = 0,
  small = false,
}: {
  direction: Direction;
  mood?: Mood;
  event?: number;
  small?: boolean;
}) {
  const uid = useId().replaceAll(":", "");
  return (
    <div
      className={`material material-${direction} ${small ? "material-small" : ""}`}
      data-mood={mood}
      data-event={event % 2}
      aria-hidden="true"
    >
      {direction === "nacre" && (
        <div className="ceramic-scene">
          <div className="ceramic-shadow" />
          <div className="ceramic-orbit">
            <div className="ceramic-disc disc-back" />
            <div className="ceramic-disc disc-front" />
            <div className="ceramic-disc disc-side" />
            <div className="ceramic-seed" />
          </div>
          <div className="ceramic-pin" />
          <span className="material-coordinate">38° / SOFT MATTER</span>
        </div>
      )}
      {direction === "ferro" && (
        <svg className="ferro-sculpture" viewBox="0 0 600 560">
          <defs>
            <filter id={`${uid}goo`} colorInterpolationFilters="sRGB">
              <feGaussianBlur stdDeviation="13" />
              <feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 28 -12" />
            </filter>
            <radialGradient id={`${uid}mass`} cx="30%" cy="22%">
              <stop stopColor="#f1ffb5" />
              <stop offset=".55" stopColor="#d6f76b" />
              <stop offset="1" stopColor="#8fba23" />
            </radialGradient>
          </defs>
          <g className="magnet-grid" stroke="#50514c" fill="none">
            {[100, 200, 300, 400, 500].map((x) => (
              <path key={x} d={`M${x} 40V520M40 ${x}H560`} />
            ))}
            <circle cx="300" cy="280" r="210" />
            <circle cx="300" cy="280" r="130" />
          </g>
          <g
            className="magnet-mass"
            filter={`url(#${uid}goo)`}
            fill={`url(#${uid}mass)`}
          >
            <circle className="mass-core" cx="300" cy="280" r="88" />
            {Array.from({ length: 8 }, (_, i) => (
              <circle
                className={`mass-satellite sat-${i}`}
                key={i}
                cx={300 + Math.cos((i * Math.PI) / 4) * 140}
                cy={280 + Math.sin((i * Math.PI) / 4) * 140}
                r={30 + (i % 3) * 7}
                style={{ "--i": i } as React.CSSProperties}
              />
            ))}
          </g>
          <g
            className="magnet-labels"
            fill="#ddd"
            fontFamily="monospace"
            fontSize="10"
          >
            <text x="40" y="35">
              FIELD / 002
            </text>
            <text x="420" y="535">
              POLARITY: YOU
            </text>
          </g>
        </svg>
      )}
      {direction === "folio" && (
        <div className="paper-scene">
          <div className="paper-orbit" />
          <div className="paper-sheet sheet-one">
            <div className="paper-lines" />
          </div>
          <div className="paper-sheet sheet-two">
            <span>
              Une idée
              <br />à la fois.
            </span>
            <div className="ink-loop" />
          </div>
          <div className="paper-sheet sheet-three">
            <span className="paper-mark">q.</span>
            <div className="paper-fold" />
          </div>
          <div className="paper-bookmark" />
          <span className="paper-index">Fig. 03 — пространство мысли</span>
        </div>
      )}
      {direction === "prism" && (
        <svg className="weave-sculpture" viewBox="0 0 600 560">
          <defs>
            <linearGradient id={`${uid}thread`} x1="0" y1="0" x2="1" y2="1">
              <stop stopColor="#59d7de" />
              <stop offset=".44" stopColor="#93e5e0" />
              <stop offset=".68" stopColor="#f1b9ad" />
              <stop offset="1" stopColor="#f19677" />
            </linearGradient>
          </defs>
          <g className="weave-grid" fill="none" stroke="#284257">
            <circle cx="300" cy="280" r="220" />
            <path d="M300 20V540M30 280H570" />
          </g>
          <g
            className="woven-threads"
            fill="none"
            stroke={`url(#${uid}thread)`}
            strokeWidth="3.6"
          >
            {Array.from({ length: 38 }, (_, i) => (
              <path
                key={i}
                style={{ "--i": i } as React.CSSProperties}
                d={`M${90 + i * 5} ${90 + i * 2} C${460 - i * 5} ${10 + i * 4},${90 + i * 4} ${510 - i * 3},${510 - i * 4} ${450 - i * 2}`}
              />
            ))}
          </g>
          <circle
            className="weave-node"
            cx="300"
            cy="280"
            r="9"
            fill="#f2b4a2"
          />
          <g fill="#6e9ba5" fontFamily="monospace" fontSize="10">
            <text x="30" y="35">
              THREADS · 38
            </text>
            <text x="450" y="535">
              EVERYTHING CONNECTS
            </text>
          </g>
        </svg>
      )}
      {direction === "milo" && (
        <div className="milo-scene">
          <div className="milo-star">✳</div>
          {["tall", "square", "round"].map((shape, i) => (
            <div
              className={`milo-body milo-${shape}`}
              key={shape}
              style={{ "--i": i } as React.CSSProperties}
            >
              <div className="milo-eyes">
                <span />
                <span />
              </div>
              <div className="milo-mouth" />
              <div className="milo-cheek" />
            </div>
          ))}
          <span className="milo-caption">
            У каждого действия есть характер.
          </span>
        </div>
      )}
    </div>
  );
}
