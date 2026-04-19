import {
  Wrench,
  HardHat,
  Bolt,
  Zap,
  Boxes,
  Sparkles,
  Package,
  type LucideIcon,
} from "lucide-react";

/**
 * Top-level product categories as they appear in `normalized_products.category`.
 * The order here drives the 2×3 grid + bottom "Other" button on /order/trade.
 * `dbValue` MUST stay identical to the value stored in the DB column.
 */
export type CategoryDef = {
  /** German label shown to the user. */
  label: string;
  /** Exact DB value used for filtering `normalized_products.category`. */
  dbValue: string;
  /** URL-safe slug used as the route param. */
  slug: string;
  /** Lucide icon for the tile. */
  icon: LucideIcon;
  /** Tailwind class for the tile accent (uses semantic icon tokens). */
  tone: string;
  /** Short helper line under the label. */
  tagline: string;
};

export const CATEGORIES: CategoryDef[] = [
  {
    label: "Verbrauchsmaterial",
    dbValue: "Consumables",
    slug: "consumables",
    icon: Sparkles,
    tone: "text-[hsl(var(--icon-clean))]",
    tagline: "Farben, Chemie, Klebeband",
  },
  {
    label: "Werkzeug",
    dbValue: "Tools",
    slug: "tools",
    icon: Wrench,
    tone: "text-[hsl(var(--icon-tool))]",
    tagline: "Hand- & Messwerkzeug",
  },
  {
    label: "PSA",
    dbValue: "PPE",
    slug: "ppe",
    icon: HardHat,
    tone: "text-[hsl(var(--icon-ppe))]",
    tagline: "Schutzausrüstung",
  },
  {
    label: "Befestigung",
    dbValue: "Fasteners",
    slug: "fasteners",
    icon: Bolt,
    tone: "text-[hsl(var(--icon-fastener))]",
    tagline: "Schrauben, Dübel, Muttern",
  },
  {
    label: "Elektro",
    dbValue: "Electrical",
    slug: "electrical",
    icon: Zap,
    tone: "text-[hsl(var(--icon-electric))]",
    tagline: "Kabel, Klemmen, Geräte",
  },
  {
    label: "Baustellenbedarf",
    dbValue: "Site Supplies",
    slug: "site-supplies",
    icon: Boxes,
    tone: "text-[hsl(var(--icon-pack))]",
    tagline: "Behälter, Transport, Sonstiges",
  },
];

export const OTHER_CATEGORY: CategoryDef = {
  label: "Sonstiges",
  dbValue: "Other",
  slug: "other",
  icon: Package,
  tone: "text-[hsl(var(--icon-default))]",
  tagline: "Baustoffe, Sanitär & mehr",
};

export const ALL_CATEGORIES: CategoryDef[] = [...CATEGORIES, OTHER_CATEGORY];

export const findCategoryBySlug = (slug: string | undefined): CategoryDef | null =>
  ALL_CATEGORIES.find((c) => c.slug === slug) ?? null;