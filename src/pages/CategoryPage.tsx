import { Link, Navigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { TopBar } from "@/components/TopBar";
import { CartBar } from "@/components/CartBar";
import { findCategoryBySlug } from "@/data/categories";
import { useSubcategories } from "@/hooks/useCategoryProducts";
import { SubcategoryIcon } from "@/components/SubcategoryIcon";

const CategoryPage = () => {
  const { categorySlug } = useParams<{ categorySlug: string }>();
  const category = findCategoryBySlug(categorySlug);
  const { data: subs, loading, error } = useSubcategories(category?.dbValue ?? null);

  if (!category) return <Navigate to="/order/trade" replace />;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopBar title={category.label} subtitle="Subkategorie wählen" back="/order/trade" />
      <main className="mx-auto max-w-md px-4 pt-5 pb-32">
        <div className="mb-4 flex items-center gap-3 rounded-2xl bg-card p-3 shadow-rugged ring-1 ring-border">
          <span className={`grid h-10 w-10 place-items-center rounded-xl bg-secondary/60 ${category.tone}`}>
            <category.icon className="h-6 w-6" />
          </span>
          <div>
            <p className="font-display text-base font-semibold">{category.label}</p>
            <p className="text-xs text-muted-foreground">{category.tagline}</p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Lade Subkategorien…
          </div>
        ) : error ? (
          <p className="rounded-xl bg-destructive/10 p-4 text-center text-sm text-destructive">
            Fehler: {error}
          </p>
        ) : subs.length === 0 ? (
          <p className="rounded-xl bg-muted p-4 text-center text-sm text-muted-foreground">
            Keine Subkategorien gefunden.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {subs.map((sub) => (
              <Link
                key={sub}
                to={`/category/${category.slug}/${encodeURIComponent(sub)}`}
                className="flex aspect-[5/4] flex-col items-center justify-center gap-2 rounded-2xl bg-card p-3 text-center shadow-rugged ring-1 ring-border active:translate-y-0.5"
                aria-label={`${sub} öffnen`}
              >
                <SubcategoryIcon
                  subcategory={sub}
                  category={category.dbValue}
                  className="h-10 w-10"
                />
                <span className="text-sm font-bold leading-tight text-foreground">{sub}</span>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default CategoryPage;