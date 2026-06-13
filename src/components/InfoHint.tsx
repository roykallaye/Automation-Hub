import { Info } from "lucide-react";
import { useId, useState } from "react";

/*
  InfoHint: a small friendly "i" bubble that keeps explanatory sentences out
  of sight until wanted. The hint shows on hover and keyboard focus, and can
  be toggled by click/Enter for touch users. It is a span (not a button) so it
  can live safely inside clickable cards; clicks never trigger the card.
*/
export function InfoHint({ text }: { text: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);

  return (
    <span className="group/info relative inline-flex shrink-0 align-middle">
      <span
        tabIndex={0}
        aria-label="More about this"
        aria-describedby={id}
        className="grid h-5 w-5 cursor-help place-items-center rounded-full bg-white/80 text-brand-700 ring-1 ring-brand-200 transition hover:bg-brand-50 hover:text-brand-800"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            setOpen((value) => !value);
          }
          if (event.key === "Escape") setOpen(false);
        }}
        onBlur={() => setOpen(false)}
        onMouseLeave={() => setOpen(false)}
      >
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <span
        id={id}
        role="tooltip"
        className={[
          "pointer-events-none absolute left-1/2 top-full z-30 mt-2 w-60 -translate-x-1/2 rounded-lg border border-white/80 bg-white/95 px-3 py-2 text-left text-xs font-medium leading-5 text-slate-700 shadow-lift backdrop-blur",
          open
            ? "block animate-pop"
            : "hidden group-hover/info:block group-hover/info:animate-pop group-focus-within/info:block",
        ].join(" ")}
      >
        {text}
      </span>
    </span>
  );
}
