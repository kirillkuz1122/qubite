// Graduated from assets/design-lab/src/milo/Transition.tsx; approved Flux mechanics.
import { useContext, useLayoutEffect, useRef, type ReactNode } from "react";
import { MotionContext } from "./motion";
export function MorphContent({
  identity,
  children,
  className = "",
  privateContent = false,
}: {
  identity: string;
  children: ReactNode;
  className?: string;
  privateContent?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const old = useRef<HTMLDivElement>(null);
  const previous = useRef("");
  const snapshot = useRef<Node[]>([]);
  const animations = useRef<Animation[]>([]);
  const context = useContext(MotionContext);
  useLayoutEffect(() => {
    const content = ref.current,
      ghost = old.current;
    if (!content || !ghost || !context) return;
    const changed = previous.current !== identity;
    if (changed && previous.current && !context.quiet) {
      animations.current.forEach((a) => a.cancel());
      ghost.replaceChildren(...snapshot.current);
      ghost.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
      ghost
        .querySelectorAll<HTMLInputElement>("input, textarea")
        .forEach((n) => {
          n.value = "";
          n.removeAttribute("value");
          if (n.tagName === "TEXTAREA") n.textContent = "";
        });
      const frames: Record<string, Keyframe[]> = {
        souffle: [
          { transform: "translateY(28px) scale(.96,1.03)", opacity: 0.55 },
          {
            transform: "translateY(-3px) scale(1.006,.995)",
            opacity: 1,
            offset: 0.7,
          },
          { transform: "none", opacity: 1 },
        ],
        flux: [
          {
            transform: "translateX(38px) skewX(-4deg) scaleX(.94)",
            opacity: 0.4,
          },
          {
            transform: "translateX(-2px) skewX(1deg)",
            opacity: 1,
            offset: 0.8,
          },
          { transform: "none", opacity: 1 },
        ],
        halo: [
          {
            transform: "translateY(16px) scale(.988)",
            filter: "brightness(1.2)",
            opacity: 0.55,
          },
          { transform: "none", filter: "brightness(1)", opacity: 1 },
        ],
        orbit: [
          { transform: "translateX(45px) rotate(1.4deg)", opacity: 0.5 },
          {
            transform: "translateX(-5px) rotate(-.3deg)",
            opacity: 1,
            offset: 0.74,
          },
          { transform: "none", opacity: 1 },
        ],
        bloom: [
          {
            clipPath: "inset(0 0 90% 0 round 35px)",
            transform: "translateY(-12px)",
            opacity: 0.7,
          },
          {
            clipPath: "inset(0 0 0 0 round 12px)",
            transform: "none",
            opacity: 1,
          },
        ],
      };
      const a = content.animate(frames[context.profile.id], {
        duration: context.selectionMs || 503,
        easing: "cubic-bezier(.2,.8,.2,1)",
      });
      const b = ghost.animate(
        [
          { transform: "none", opacity: 0.42 },
          {
            transform:
              context.profile.id === "flux"
                ? "translateX(-32px) scaleX(.95)"
                : "translateY(-14px) scale(.98)",
            opacity: 0,
          },
        ],
        { duration: 340, fill: "forwards" },
      );
      animations.current = [a, b];
      void b.finished
        .then(() => {
          if (animations.current[1] === b) ghost.replaceChildren();
        })
        .catch(() => {});
    } else if (context.quiet) {
      animations.current.forEach((a) => a.cancel());
      ghost.replaceChildren();
    }
    previous.current = identity;
    // A visual snapshot is needed once per scene, not on every keystroke.
    // Freeze decorative animation in the departing layer as well.
    if (changed)
      snapshot.current = privateContent
        ? []
        : Array.from(content.childNodes).map((n) => {
            const clone = n.cloneNode(true);
            if (clone instanceof Element)
              clone
                .querySelectorAll<HTMLInputElement>("input, textarea")
                .forEach((field) => {
                  field.value = "";
                  field.removeAttribute("value");
                  if (field.tagName === "TEXTAREA") field.textContent = "";
                });
            return clone;
          });
  });
  useLayoutEffect(
    () => () => {
      animations.current.forEach((a) => a.cancel());
      snapshot.current = [];
    },
    [],
  );
  return (
    <div className={`morph-host ${className}`}>
      <div ref={old} className="morph-ghost" aria-hidden="true" inert />
      <div ref={ref} className="morph-current">
        {children}
      </div>
    </div>
  );
}
