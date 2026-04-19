import { TopBar } from "@/components/TopBar";
import { useApp, OrderStatus as Status } from "@/store/app";
import { Check, Clock, Truck, PackageCheck } from "lucide-react";
import { PROJECTS } from "@/data/catalog";

const STEPS: { id: Status; label: string; Icon: typeof Clock }[] = [
  { id: "Requested", label: "Requested", Icon: Clock },
  { id: "Ordered", label: "Ordered", Icon: Truck },
  { id: "Delivered", label: "Delivered", Icon: PackageCheck },
];

const statusIndex = (s: Status) => STEPS.findIndex((x) => x.id === s);

const OrderStatusScreen = () => {
  const orders = useApp((s) => s.orders);

  return (
    <div className="min-h-screen bg-background pb-10">
      <TopBar title="Order Status" subtitle={`${orders.length} order${orders.length === 1 ? "" : "s"}`} back="/" />
      <main className="mx-auto max-w-md space-y-5 px-4 pt-5">
        {orders.length === 0 && (
          <p className="rounded-xl bg-muted p-4 text-center text-muted-foreground">No orders yet.</p>
        )}
        {orders.map((o) => {
          const project = PROJECTS.find((p) => p.id === o.projectId);
          const idx = statusIndex(o.status);
          return (
            <article key={o.id} className="rounded-2xl bg-card p-5 shadow-rugged ring-1 ring-border">
              <header className="mb-4 flex items-center justify-between">
                <div>
                  <p className="font-display text-2xl">{o.id}</p>
                  <p className="text-xs text-muted-foreground">
                    {project?.name} · {o.delivery}
                  </p>
                </div>
                <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-primary">
                  {o.status}
                </span>
              </header>

              <ol className="relative">
                {STEPS.map((step, i) => {
                  const reached = i <= idx;
                  const current = i === idx;
                  return (
                    <li key={step.id} className="flex gap-4 pb-5 last:pb-0">
                      <div className="relative flex flex-col items-center">
                        <div
                          className={`grid h-11 w-11 place-items-center rounded-full ring-2 transition ${
                            reached
                              ? "bg-primary text-primary-foreground ring-primary"
                              : "bg-muted text-muted-foreground ring-border"
                          } ${current ? "animate-pulse-glow" : ""}`}
                        >
                          {reached && !current ? (
                            <Check className="h-5 w-5" />
                          ) : (
                            <step.Icon className="h-5 w-5" />
                          )}
                        </div>
                        {i < STEPS.length - 1 && (
                          <span
                            className={`mt-1 w-1 flex-1 rounded ${
                              i < idx ? "bg-primary" : "bg-muted"
                            }`}
                          />
                        )}
                      </div>
                      <div className="pt-2">
                        <p className={`font-display text-lg leading-none ${reached ? "" : "text-muted-foreground"}`}>
                          {step.label}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {current ? "In progress" : reached ? "Done" : "Waiting"}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </article>
          );
        })}
      </main>
    </div>
  );
};

export default OrderStatusScreen;
