import { Minus, Plus } from "lucide-react";
import { useEffect, useState } from "react";

type Size = "md" | "lg";

type Props = {
  qty: number;
  onChange: (qty: number) => void;
  min?: number;
  max?: number;
  size?: Size;
  /** aria-label prefix used on the +/- buttons for screen readers. */
  label?: string;
};

const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.floor(n)));

/**
 * Glove-friendly quantity selector: [-] [ input ] [+]
 *
 * - Single source of truth lives in the parent (Zustand cart store).
 * - Local `draft` string state lets the user temporarily clear the field
 *   without us snapping the cart back to `min` on every keystroke.
 * - On blur / Enter we sanitize → clamp → commit. Empty falls back to `min`.
 * - +/- buttons share the exact same commit path, so the input and the
 *   buttons stay perfectly in sync.
 *
 * Sizes:
 *   md → 12 (h-12)  — used in compact rows (recently ordered)
 *   lg → 14 (h-14)  — used in result cards
 */
export const QuantitySelector = ({
  qty,
  onChange,
  min = 0,
  max = 9999,
  size = "lg",
  label = "Quantity",
}: Props) => {
  const [draft, setDraft] = useState<string>(String(qty));
  useEffect(() => {
    setDraft(String(qty));
  }, [qty]);

  const commitDraft = () => {
    const trimmed = draft.trim();
    if (trimmed === "") {
      onChange(min);
      setDraft(String(min));
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      setDraft(String(qty));
      return;
    }
    const next = clamp(parsed, min, max);
    if (next !== qty) onChange(next);
    setDraft(String(next));
  };

  const step = (delta: number) => onChange(clamp(qty + delta, min, max));

  const heightCls = size === "lg" ? "h-14" : "h-12";
  const btnSizeCls = size === "lg" ? "h-14 w-14" : "h-12 w-12";
  const iconCls = size === "lg" ? "h-6 w-6" : "h-5 w-5";
  const fontCls = size === "lg" ? "text-2xl" : "text-lg";

  return (
    <div className={`flex items-center gap-1 rounded-xl bg-secondary p-1`}>
      <button
        type="button"
        onClick={() => step(-1)}
        aria-label={`${label}: decrease`}
        className={`grid ${btnSizeCls} shrink-0 place-items-center rounded-lg text-secondary-foreground active:bg-white/10`}
      >
        <Minus className={iconCls} />
      </button>
      <input
        type="number"
        inputMode="numeric"
        pattern="[0-9]*"
        min={min}
        max={max}
        value={draft}
        onChange={(e) => {
          // Sanitize on the fly: keep only digits.
          const cleaned = e.target.value.replace(/[^\d]/g, "");
          setDraft(cleaned);
        }}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={commitDraft}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
        aria-label={label}
        className={`${heightCls} min-w-0 flex-1 rounded-lg bg-transparent text-center font-display ${fontCls} text-secondary-foreground outline-none [appearance:textfield] focus:ring-2 focus:ring-primary/40 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
      />
      <button
        type="button"
        onClick={() => step(1)}
        aria-label={`${label}: increase`}
        className={`grid ${btnSizeCls} shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground shadow-press active:translate-y-0.5 active:bg-primary-glow`}
      >
        <Plus className={iconCls} />
      </button>
    </div>
  );
};
