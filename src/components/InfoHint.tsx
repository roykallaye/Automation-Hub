import { Info } from "lucide-react";
import { useId, useState } from "react";

/*
  InfoHint: a small "i" bubble that keeps an explanatory sentence out of sight
  until wanted. It shows on hover and keyboard focus, and toggles on
  click/Enter for touch users. It is a span rather than a button so it can sit
  safely inside clickable rows without triggering them.
*/
export function InfoHint({ text }: { text: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);

  return (
    <span className="ip-hint">
      <span
        aria-describedby={id}
        aria-label="More about this"
        className="ip-hint__mark"
        onBlur={() => setOpen(false)}
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
        onMouseLeave={() => setOpen(false)}
        tabIndex={0}
      >
        <Info aria-hidden="true" size={13} />
      </span>
      <span
        className={`ip-hint__bubble${open ? " is-open" : ""}`}
        id={id}
        role="tooltip"
      >
        {text}
      </span>
    </span>
  );
}
