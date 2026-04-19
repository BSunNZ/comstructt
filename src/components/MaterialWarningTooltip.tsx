import { AlertTriangle } from "lucide-react";
import type { MaterialClass } from "@/utils/materialClassifier";

type Props = {
  /** Result of classifyMaterial(query). */
  classification: MaterialClass;
};

/**
 * Inline, non-blocking material classification hint shown directly under the
 * material search bar.
 *
 *   - A_B → amber/orange warning telling the user to use the procurement system
 *   - C   → subtle green "hier bestellbar" confirmation badge
 *   - unknown → renders nothing (returns null)
 *
 * Animates in with a soft fade + slight slide. Always wrapped in a region
 * with role="status"/"alert" so screen readers announce the change.
 *
 * Copy is intentionally jargon-free per spec — no "A-Material" / "C-Material"
 * terminology in the user-facing strings.
 */
export const MaterialWarningTooltip = ({ classification }: Props) => {
  if (classification === "unknown") return null;

  if (classification === "A_B") {
    return (
      <div
        role="alert"
        aria-live="polite"
        className="mt-2 animate-fade-in rounded-xl border-2 border-warning/60 bg-warning/10 p-3 shadow-rugged"
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-warning text-warning-foreground"
          >
            <AlertTriangle className="h-5 w-5" strokeWidth={2.25} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-sm font-bold text-foreground">
              Dieses Material wird anders bestellt
            </p>
            <p className="mt-1 text-xs leading-snug text-foreground/80">
              Hauptbaustoffe wie Träger, Beton oder Bewehrungsstahl werden über das
              Procurement-System beschafft – nicht hier. Hier kannst du nur
              Verbrauchsmaterial und Kleinteile bestellen.
            </p>
            <p className="mt-2 text-xs font-semibold uppercase tracking-wider text-warning-foreground/90">
              Bitte über die Procurement-Software bestellen
            </p>
          </div>
        </div>
      </div>
    );
  }

  // classification === "C" → no visible confirmation, normal flow.
  return null;
};

