import type { Product } from "@/data/catalog";

export type AgentRecommendation = {
  productId: string;
  name: string;
  sku?: string | null;
  unit: string;
  quantity: number;
  unitPrice: number | null;
  supplier: string | null;
  category: string | null;
  subcategory: string | null;
  priceSource?: "project" | "contract" | null;
  listPrice?: number | null;
};

export type AgentResponse = {
  reply: string;
  recommendations?: AgentRecommendation[];
};

export function parseAgentResponse(data: unknown): AgentResponse | null {
  if (!data || typeof data !== "object") return null;
  const raw = data as {
    reply?: unknown;
    recommendations?: unknown;
    message?: unknown;
  };

  const reply =
    typeof raw.reply === "string"
      ? raw.reply
      : typeof raw.message === "string"
        ? raw.message
        : null;

  if (!reply) return null;

  const recommendations = Array.isArray(raw.recommendations)
    ? (raw.recommendations
        .map((item): AgentRecommendation | null => {
          if (!item || typeof item !== "object") return null;
          const rec = item as Record<string, unknown>;
          const productId = typeof rec.productId === "string" ? rec.productId : null;
          const name = typeof rec.name === "string" ? rec.name : null;
          const unit = typeof rec.unit === "string" ? rec.unit : null;
          const quantity = Number(rec.quantity);
          if (!productId || !name || !unit || !Number.isFinite(quantity) || quantity <= 0) return null;
          const unitPrice = Number(rec.unitPrice);
          const listPrice = Number(rec.listPrice);
          return {
            productId,
            name,
            sku: typeof rec.sku === "string" ? rec.sku : null,
            unit,
            quantity: Math.max(1, Math.ceil(quantity)),
            unitPrice: Number.isFinite(unitPrice) && unitPrice > 0 ? unitPrice : null,
            supplier: typeof rec.supplier === "string" ? rec.supplier : null,
            category: typeof rec.category === "string" ? rec.category : null,
            subcategory: typeof rec.subcategory === "string" ? rec.subcategory : null,
            priceSource:
              rec.priceSource === "project" || rec.priceSource === "contract"
                ? rec.priceSource
                : null,
            listPrice: Number.isFinite(listPrice) && listPrice > 0 ? listPrice : null,
          };
        })
        .filter(Boolean) as AgentRecommendation[])
    : undefined;

  return { reply, recommendations };
}

export function recommendationToProduct(rec: AgentRecommendation): Product {
  return {
    id: rec.productId,
    name: rec.name,
    sku: rec.sku ?? rec.productId,
    unit: rec.unit,
    price: rec.unitPrice ?? 0,
    category: rec.category ?? "Allgemein",
    subcategory: rec.subcategory ?? null,
    supplier: rec.supplier,
    priceSource: rec.priceSource ?? undefined,
    listPrice: rec.listPrice ?? null,
  };
}