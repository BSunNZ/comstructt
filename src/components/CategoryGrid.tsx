import { Link } from "react-router-dom";
import { CATEGORIES } from "@/data/categories";

/**
 * 2×3 grid of the six main product categories. Each tile links to
 * /category/:slug where the user picks a subcategory.
 */
export const CategoryGrid = () => {
  return (
    <section aria-label="Produktkategorien" className="space-y-3">
      <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
        Nach Kategorie bestellen
      </h2>

      <div className="grid grid-cols-3 gap-3">
        {CATEGORIES.map((c) => (
          <Link
            key={c.slug}
            to={`/category/${c.slug}`}
            className="group flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl bg-card p-2 text-center shadow-rugged ring-1 ring-border transition active:translate-y-0.5"
            aria-label={`${c.label} öffnen`}
          >
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary text-primary-foreground shadow-press">
              <c.icon className="h-6 w-6" strokeWidth={2.5} />
            </span>
            <span className="text-[13px] font-bold leading-tight text-foreground break-words hyphens-auto px-0.5">
              {c.label}
            </span>
            <span className="line-clamp-2 text-[10px] leading-snug text-muted-foreground px-0.5">
              {c.tagline}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
};