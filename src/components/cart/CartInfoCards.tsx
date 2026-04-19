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
};

export const CartApprovalCard = ({
  threshold,
  needsApproval,
  approver = "Max Mustermann",
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
    </ul>
  </section>
);
