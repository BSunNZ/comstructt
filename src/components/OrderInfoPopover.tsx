import { useEffect, useRef, useState } from "react";
import { Info, X } from "lucide-react";

/**
 * OrderInfoPopover
 *
 * Subtle ⓘ trigger placed inside the TopBar's right slot. Tapping it
 * toggles a small inline popover anchored below the icon explaining what
 * the user can — and cannot — order on this screen.
 *
 *   - Pure local state (useState), no modal lib, no overlay.
 *   - Click-outside + Escape to close.
 *   - Anchored top-right so it never overflows the viewport on a phone
 *     screen, and falls back to a full-width panel on tiny widths.
 *   - Renders ABOVE the TopBar (z-50) but does NOT shift any layout.
 */
export const OrderInfoPopover = () => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Was kann ich hier bestellen?"
        aria-expanded={open}
        aria-haspopup="dialog"
        className="grid h-11 w-11 place-items-center rounded-full text-secondary-foreground/60 transition-colors active:bg-white/10 hover:text-secondary-foreground"
      >
        <Info size={18} strokeWidth={1.75} aria-hidden="true" />
      </button>

      {open && (
        <>
          {/* Anchored panel.
              Mobile (<sm): full-width, fixed below the nav bar.
              ≥sm: absolutely positioned top-right under the icon. */}
          <div
            role="dialog"
            aria-label="Was kann ich hier bestellen?"
            className="animate-fade-in fixed inset-x-3 top-[64px] z-50 rounded-2xl border border-border bg-card text-foreground shadow-rugged sm:absolute sm:inset-x-auto sm:right-0 sm:top-[calc(100%+8px)] sm:w-[320px]"
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Schließen"
              className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>

            <div className="px-4 pb-4 pt-4 pr-12">
              <h2 className="font-display text-base font-bold leading-tight">
                Was kann ich hier bestellen?
              </h2>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Auf dieser Seite bestellst du C-Materialien – das sind
                Verbrauchsmaterialien und Kleinteile, die du direkt für die
                Baustelle brauchst.
              </p>
              <p className="mt-2 text-xs font-semibold text-foreground">
                Dazu gehören zum Beispiel:
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs leading-relaxed text-muted-foreground">
                <li>Arbeitshandschuhe, Helme, Warnwesten</li>
                <li>Schrauben, Dübel, Kabelbinder</li>
                <li>Klebeband, Reinigungsmittel, Schutzfolien</li>
                <li>Batterien, Leuchtmittel, Kleinwerkzeug-Zubehör</li>
              </ul>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                Hauptbaustoffe wie Beton, Stahl, Fenster oder Heizungsanlagen
                gehören nicht hierher – diese werden über das
                Procurement-System bestellt.
              </p>
              <p className="mt-3 border-t border-border pt-3 text-xs">
                <span className="text-muted-foreground">Falsche Seite? </span>
                <span className="font-medium text-foreground/80 underline decoration-dotted underline-offset-2">
                  → Zum Procurement-System
                </span>
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
