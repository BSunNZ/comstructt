import { Link } from "react-router-dom";
import { CATEGORIES, OTHER_CATEGORY } from "@/data/categories";

/**
 * 2×3 grid of the six main product categories with the "Sonstiges"
 * (Other) catch-all rendered as a wide button beneath. Each tile links
 * to /category/:slug where the user picks a subcategory.
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
            className="group flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl bg-card p-3 text-center shadow-rugged ring-1 ring-border transition active:translate-y-0.5"
            aria-label={`${c.label} öffnen`}
          >
            <span className={`grid h-10 w-10 place-items-center rounded-xl bg-secondary/60 ${c.tone}`}>
              <c.icon className="h-6 w-6" />
            </span>
            <span className="text-sm font-bold leading-tight text-foreground">{c.label}</span>
            <span className="line-clamp-2 text-[10px] leading-snug text-muted-foreground">
              {c.tagline}
            </span>
          </Link>
        ))}
      </div>

      <Link
        to={`/category/${OTHER_CATEGORY.slug}`}
        className="flex w-full items-center gap-3 rounded-2xl bg-card p-4 shadow-rugged ring-1 ring-border active:translate-y-0.5"
        aria-label="Sonstige Kategorien"
      >
        <span className={`grid h-10 w-10 place-items-center rounded-xl bg-secondary/60 ${OTHER_CATEGORY.tone}`}>
          <OTHER_CATEGORY.icon className="h-6 w-6" />
        </span>
        <span className="flex-1 text-left">
          <span className="block text-sm font-bold text-foreground">{OTHER_CATEGORY.label}</span>
          <span className="block text-[11px] text-muted-foreground">{OTHER_CATEGORY.tagline}</span>
        </span>
        <span className="text-xs font-bold uppercase tracking-wider text-primary">Öffnen →</span>
      </Link>
    </section>
  );
};