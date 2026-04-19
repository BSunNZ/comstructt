import { ArrowLeft } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { ReactNode } from "react";
import { AppLogo } from "@/components/AppLogo";

type Props = {
  title: string;
  subtitle?: string;
  back?: string;
  right?: ReactNode;
};

export const TopBar = ({ title, subtitle, back, right }: Props) => {
  const nav = useNavigate();
  return (
    <header className="sticky top-0 z-30 bg-secondary text-secondary-foreground">
      <div className="flex items-center gap-3 px-4 pt-[max(env(safe-area-inset-top),0.5rem)] md:pt-7 pb-3">
        {back !== undefined ? (
          <button
            onClick={() => (back ? nav(back) : nav(-1))}
            className="-ml-2 grid h-11 w-11 place-items-center rounded-full active:bg-white/10"
            aria-label="Back"
          >
            <ArrowLeft className="h-6 w-6" />
          </button>
        ) : (
          <Link to="/" className="flex items-center gap-2 font-display text-xl font-bold tracking-tight">
            <AppLogo size={32} />
            <span>comstruct</span>
          </Link>
        )}
        <div className="flex-1 leading-tight">
          {back !== undefined && (
            <>
              <h1 className="font-display text-lg font-semibold">{title}</h1>
              {subtitle && <p className="text-xs text-secondary-foreground/70">{subtitle}</p>}
            </>
          )}
        </div>
        {right}
      </div>
    </header>
  );
};
