import { Navigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { TopBar } from "@/components/TopBar";
import { CartBar } from "@/components/CartBar";
import { findCategoryBySlug } from "@/data/categories";
import { useApp } from "@/store/app";
import { useProductsBySubcategory } from "@/hooks/useCategoryProducts";
import { ProductOrderCard } from "@/components/ProductOrderCard";
import type { DbProduct } from "@/lib/productSearch";
import type { Product } from "@/data/catalog";

const toProduct = (r: DbProduct): Product => ({
  id: String(r.id),
  name: r.product_name ?? r.family_name ?? "Unbenanntes Produkt",
  sku: r.family_key ?? String(r.id),
  unit: r.unit ?? "Stk",
  price: typeof r.price === "number" && r.price > 0 ? r.price : 0,
  category: r.category ?? "Allgemein",
  subcategory: r.subcategory ?? null,
  priceSource: r.priceSource ?? undefined,
  listPrice: typeof r.listPrice === "number" && r.listPrice > 0 ? r.listPrice : null,
  supplier: r.supplierName ?? null,
});

const SubcategoryPage = () => {
  const { categorySlug, subcategory } = useParams<{ categorySlug: string; subcategory: string }>();
  const category = findCategoryBySlug(categorySlug);
  const projectId = useApp((s) => s.projectId);
  const decodedSub = subcategory ? decodeURIComponent(subcategory) : null;
  const { data, loading, error } = useProductsBySubcategory(
    category?.dbValue ?? null,
    decodedSub,
    projectId,
  );

  if (!category) return <Navigate to="/order/trade" replace />;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopBar
        title={decodedSub ?? category.label}
        subtitle={category.label}
        back={`/category/${category.slug}`}
      />
      <main className="mx-auto max-w-md px-4 pt-5 pb-32">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Lade Produkte…
          </div>
        ) : error ? (
          <p className="rounded-xl bg-destructive/10 p-4 text-center text-sm text-destructive">
            Fehler: {error}
          </p>
        ) : data.length === 0 ? (
          <p className="rounded-xl bg-muted p-4 text-center text-sm text-muted-foreground">
            Keine Produkte in dieser Subkategorie.
          </p>
        ) : (
          <div className="space-y-3">
            {data.map((r) => (
              <ProductOrderCard key={r.id} product={toProduct(r)} />
            ))}
          </div>
        )}
      </main>
      <CartBar />
    </div>
  );
};

export default SubcategoryPage;