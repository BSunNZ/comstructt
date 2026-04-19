import { Minus, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { CartLine } from "@/data/catalog";
import { SubcategoryIcon } from "@/components/SubcategoryIcon";

type Props = {
  line: CartLine;
  onChange: (qty: number) => void;
  onRemove?: () => void;
};

const MIN_QTY = 1;
const MAX_QTY = 10000;
const clampQty = (n: number) => Math.min(MAX_QTY, Math.max(MIN_QTY, Math.floor(n)));

export const QuantityRow = ({ line, onChange, onRemove }: Props) => {
  const { product, qty } = line;

  // Local draft string lets the user temporarily clear the field while
  // typing without us snapping back to "1" on every keystroke.
  const [draft, setDraft] = useState<string>(String(qty));
  useEffect(() => {
    setDraft(String(qty));
  }, [qty]);

  const commit = () => {
    if (draft.trim() === "") {
      onChange(MIN_QTY);
      setDraft(String(MIN_QTY));
      return;
    }
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(qty));
      return;
    }
    const next = clampQty(parsed);
    if (next !== qty) onChange(next);
    setDraft(String(next));
  };

  return (
    <div className="flex items-center gap-3 rounded-xl bg-card p-3 shadow-rugged ring-1 ring-border">
      <div className="grid h-16 w-16 shrink-0 place-items-center">
        <SubcategoryIcon
          subcategory={product.subcategory}
          category={product.category}
          className="h-14 w-14"
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 font-semibold leading-tight">{product.name}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {product.sku} · {product.unit}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Lieferant:{" "}
          {product.supplier ? (
            product.supplier
          ) : (
            <span className="italic text-muted-foreground/70">nicht verfügbar</span>
          )}
        </p>
        {product.price > 0 ? (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <p className="font-display text-lg text-foreground">€{(product.price * qty).toFixed(2)}</p>
            {product.priceSource === "project" && (
              <span
                className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary ring-1 ring-primary/30"
                title="Projekt-spezifischer Sonderpreis"
              >
                Projektpreis
              </span>
            )}
          </div>
        ) : (
          <p className="mt-1 text-sm font-semibold text-muted-foreground">Preis auf Anfrage</p>
        )}
      </div>
      <div className="flex flex-col items-end gap-2">
        <div className="flex items-center gap-1 rounded-xl bg-secondary p-1">
          <button
            onClick={() => onChange(clampQty(qty - 1))}
            className="grid h-11 w-11 place-items-center rounded-lg text-secondary-foreground active:bg-white/10"
            aria-label="Decrease"
          >
            <Minus className="h-5 w-5" />
          </button>
          <input
            type="number"
            inputMode="numeric"
            min={MIN_QTY}
            max={MAX_QTY}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.currentTarget as HTMLInputElement).blur();
              }
            }}
            aria-label="Quantity"
            className="w-12 rounded-md bg-transparent text-center font-display text-xl text-secondary-foreground outline-none [appearance:textfield] focus:ring-2 focus:ring-primary/40 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <button
            onClick={() => onChange(clampQty(qty + 1))}
            className="grid h-11 w-11 place-items-center rounded-lg bg-primary text-primary-foreground active:bg-primary-glow"
            aria-label="Increase"
          >
            <Plus className="h-5 w-5" />
          </button>
        </div>
        {onRemove && (
          <button
            onClick={onRemove}
            className="grid h-9 w-9 place-items-center rounded-lg text-destructive active:bg-destructive/10"
            aria-label="Remove"
          >
            <Trash2 className="h-5 w-5" />
          </button>
        )}
      </div>
    </div>
  );
};
