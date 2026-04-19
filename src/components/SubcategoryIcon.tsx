import {
  Bolt,
  Zap,
  PenTool,
  Wrench,
  HardHat,
  PaintBucket,
  Hammer,
  Ruler,
  Package,
  Truck,
  Trash2,
  SprayCan,
  Tags,
  FlaskConical,
  Droplets,
  Box,
  Brush,
  Boxes,
  Layers,
  Cog,
  Sparkles,
  Container,
  Tag,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type IconSpec = { Icon: LucideIcon; tone: string };

// Each known subcategory in `normalized_products` gets a unique line-art icon
// in a distinct Comstruct accent color. Kept thin-stroke, square corners.
const SUBCATEGORY_ICONS: Record<string, IconSpec> = {
  // Fasteners
  Befestigung: { Icon: Bolt, tone: "text-[hsl(var(--icon-fastener))]" }, // screw/bolt
  Kleinmaterial: { Icon: Boxes, tone: "text-[hsl(var(--icon-fastener))]" },
  Kunststoff: { Icon: Box, tone: "text-[hsl(var(--icon-fastener))]" },

  // Electrical
  Elektro: { Icon: Zap, tone: "text-[hsl(var(--icon-electric))]" },

  // Tools
  Werkzeug: { Icon: Wrench, tone: "text-[hsl(var(--icon-tool))]" },
  Handwerkzeug: { Icon: Hammer, tone: "text-[hsl(var(--icon-tool))]" },
  Messwerkzeug: { Icon: Ruler, tone: "text-[hsl(var(--icon-measure))]" },
  Malerbedarf: { Icon: Brush, tone: "text-[hsl(var(--icon-paint))]" },

  // Consumables
  Farbe: { Icon: PaintBucket, tone: "text-[hsl(var(--icon-paint))]" },
  Chemie: { Icon: FlaskConical, tone: "text-[hsl(var(--icon-chem))]" },
  Dichtstoffe: { Icon: Droplets, tone: "text-[hsl(var(--icon-seal))]" },
  Abdichtung: { Icon: Droplets, tone: "text-[hsl(var(--icon-seal))]" },
  Klebeband: { Icon: Tag, tone: "text-[hsl(var(--icon-tool))]" },
  Abdeckung: { Icon: Layers, tone: "text-[hsl(var(--icon-pack))]" },
  Reinigung: { Icon: SprayCan, tone: "text-[hsl(var(--icon-clean))]" },
  Markierung: { Icon: Tags, tone: "text-[hsl(var(--icon-mark))]" },
  Konsum: { Icon: Sparkles, tone: "text-[hsl(var(--icon-clean))]" },
  Entsorgung: { Icon: Trash2, tone: "text-[hsl(var(--icon-waste))]" },
  Verpackung: { Icon: Package, tone: "text-[hsl(var(--icon-pack))]" },

  // PPE
  PSA: { Icon: HardHat, tone: "text-[hsl(var(--icon-ppe))]" },

  // Site supplies
  Behälter: { Icon: Container, tone: "text-[hsl(var(--icon-pack))]" },
  Schreibwaren: { Icon: PenTool, tone: "text-[hsl(var(--icon-write))]" },
  Transport: { Icon: Truck, tone: "text-[hsl(var(--icon-transport))]" },
};

const FALLBACK: IconSpec = { Icon: Cog, tone: "text-[hsl(var(--icon-default))]" };

const resolve = (subcategory?: string | null, category?: string | null): IconSpec => {
  if (subcategory && SUBCATEGORY_ICONS[subcategory]) return SUBCATEGORY_ICONS[subcategory];
  if (category && SUBCATEGORY_ICONS[category]) return SUBCATEGORY_ICONS[category];
  if (category) {
    const c = category.toLowerCase();
    if (c.includes("elec")) return SUBCATEGORY_ICONS.Elektro;
    if (c.includes("tool")) return SUBCATEGORY_ICONS.Werkzeug;
    if (c.includes("ppe")) return SUBCATEGORY_ICONS.PSA;
    if (c.includes("fasten")) return SUBCATEGORY_ICONS.Befestigung;
  }
  return FALLBACK;
};

type Props = {
  subcategory?: string | null;
  category?: string | null;
  className?: string;
};

export const SubcategoryIcon = ({ subcategory, category, className }: Props) => {
  const { Icon, tone } = resolve(subcategory, category);
  return (
    <Icon
      className={cn(tone, className)}
      strokeWidth={1.5}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
    />
  );
};
