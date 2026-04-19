import { Truck, ShieldCheck, Package, MapPin, User } from "lucide-react";

// All numbers below are illustrative placeholders. Replace with live
// inventory / approval / project data once those backends exist.

type DeliveryProps = {
  stock?: number;
  shipping?: string;
  delivery?: string;
  location?: string;
};

export const CartDeliveryCard = ({
  stock = 12400,
  shipping = "Versand heute",
  delivery = "Lieferung morgen–Mittwoch",
  location = "Baustelle Mannheim",
}: DeliveryProps) => (
  <section
    aria-label="Lieferung & Bestand"
    className="rounded-2xl bg-card p-4 shadow-rugged ring-1 ring-border"
  >
    <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
      Lieferung & Bestand
    </h2>
    <ul className="space-y-2.5 text-sm">
      <li className="flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-[hsl(var(--primary)/0.12)] text-primary">
          <Package className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-tight">
            {stock.toLocaleString("de-DE")} auf Lager
          </p>
        </div>
      </li>
      <li className="flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-[hsl(var(--primary)/0.12)] text-primary">
          <Truck className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-tight">{shipping}</p>
          <p className="text-xs text-muted-foreground">{delivery}</p>
        </div>
      </li>
      <li className="flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-[hsl(var(--primary)/0.12)] text-primary">
          <MapPin className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-tight">Lieferort</p>
          <p className="text-xs text-muted-foreground">{location}</p>
        </div>
      </li>
    </ul>
  </section>
);

type ApprovalProps = {
  threshold: number;
  needsApproval: boolean;
  approver?: string;
  sla?: string;
  budgetOk?: boolean;
};

export const CartApprovalCard = ({
  threshold,
  needsApproval,
  approver = "Max Mustermann",
  sla = "Freigabezeit < 2h",
  budgetOk = true,
}: ApprovalProps) => (
  <section
    aria-label="Freigabe"
    className="rounded-2xl bg-card p-4 shadow-rugged ring-1 ring-border"
  >
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
        Freigabe
      </h2>
      <span
        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 ${
          needsApproval
            ? "bg-[hsl(45_95%_55%/0.18)] text-[hsl(38_90%_28%)] ring-[hsl(45_85%_75%)]"
            : "bg-[hsl(140_60%_45%/0.15)] text-[hsl(140_55%_22%)] ring-[hsl(140_45%_75%)]"
        }`}
      >
        {needsApproval ? "Erforderlich" : "Auto-Freigabe"}
      </span>
    </div>
    <ul className="space-y-2.5 text-sm">
      <li className="flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-[hsl(var(--primary)/0.12)] text-primary">
          <ShieldCheck className="h-4 w-4" />
        </span>
        <p className="font-semibold leading-tight">
          Freigabe nötig ab €{threshold.toFixed(2)}
        </p>
      </li>
      <li className="flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-[hsl(var(--primary)/0.12)] text-primary">
          <User className="h-4 w-4" />
        </span>
        <div>
          <p className="text-xs text-muted-foreground">Zuständig</p>
          <p className="font-semibold leading-tight">{approver}</p>
        </div>
      </li>
      <li className="flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-[hsl(var(--primary)/0.12)] text-primary">
          <Clock className="h-4 w-4" />
        </span>
        <p className="font-semibold leading-tight">{sla}</p>
      </li>
      <li className="flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-[hsl(var(--primary)/0.12)] text-primary">
          <Wallet className="h-4 w-4" />
        </span>
        <p className="font-semibold leading-tight">
          {budgetOk ? "Budget verfügbar" : "Budget knapp"}
        </p>
      </li>
    </ul>
  </section>
);

type Tier = { qty: number; price: number };
type TierProps = {
  tiers?: Tier[];
  selectedQty?: number;
  unit?: string;
};

const DEFAULT_TIERS: Tier[] = [
  { qty: 100, price: 0.95 },
  { qty: 500, price: 0.84 },
  { qty: 1000, price: 0.8 },
  { qty: 2000, price: 0.74 },
];

export const CartVolumeTiersCard = ({
  tiers = DEFAULT_TIERS,
  selectedQty = 1000,
  unit = "Stk",
}: TierProps) => (
  <section
    aria-label="Mengenpreise"
    className="rounded-2xl bg-card p-4 shadow-rugged ring-1 ring-border"
  >
    <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
      Mengenpreise
    </h2>
    <ul className="grid grid-cols-2 gap-2">
      {tiers.map((t) => {
        const isSelected = t.qty === selectedQty;
        return (
          <li
            key={t.qty}
            className={`flex items-center justify-between rounded-xl px-3 py-2.5 text-sm ring-1 transition ${
              isSelected
                ? "bg-primary text-primary-foreground ring-primary"
                : "bg-background ring-border"
            }`}
          >
            <span className="font-semibold">
              {t.qty.toLocaleString("de-DE")} {unit}
            </span>
            <span
              className={`font-display ${
                isSelected ? "text-primary-foreground" : "text-foreground"
              }`}
            >
              €{t.price.toFixed(2)}
            </span>
          </li>
        );
      })}
    </ul>
    <p className="mt-2 text-[11px] text-muted-foreground">
      Beispielpreise. Effektive Konditionen siehe Lieferantenvertrag.
    </p>
  </section>
);

export type OrderMeta = {
  costCenter: string;
  projectNumber: string;
  note: string;
};

type MetaProps = {
  value: OrderMeta;
  onChange: (next: OrderMeta) => void;
};

export const CartOrderMetaCard = ({ value, onChange }: MetaProps) => (
  <section
    aria-label="Bestelldaten"
    className="rounded-2xl bg-card p-4 shadow-rugged ring-1 ring-border"
  >
    <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
      Bestelldaten
    </h2>
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-muted-foreground">
          Kostenstelle
        </span>
        <input
          value={value.costCenter}
          onChange={(e) => onChange({ ...value, costCenter: e.target.value })}
          placeholder="z. B. KS-4711"
          className="block h-11 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-muted-foreground">
          Projektnummer
        </span>
        <input
          value={value.projectNumber}
          onChange={(e) => onChange({ ...value, projectNumber: e.target.value })}
          placeholder="z. B. MTF-2024-01"
          className="block h-11 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-muted-foreground">
          Notiz
        </span>
        <textarea
          value={value.note}
          onChange={(e) => onChange({ ...value, note: e.target.value })}
          placeholder="Optionale Anmerkung an den Lieferanten"
          rows={3}
          className="block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        />
      </label>
    </div>
  </section>
);
