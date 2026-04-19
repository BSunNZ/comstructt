import { PROJECTS } from "@/data/catalog";
import { useApp } from "@/store/app";
import { Building2, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const ProjectSelector = () => {
  const { projectId, setProject } = useApp();
  const project = PROJECTS.find((p) => p.id === projectId)!;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="tap-target flex w-full items-center gap-3 rounded-xl bg-card px-4 py-4 text-left shadow-rugged ring-1 ring-border active:translate-y-0.5 active:shadow-press">
          <span className="grid h-12 w-12 place-items-center rounded-lg bg-secondary text-secondary-foreground">
            <Building2 className="h-6 w-6" />
          </span>
          <span className="flex-1">
            <span className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Active Project
            </span>
            <span className="block truncate font-display text-lg leading-tight text-foreground">
              {project.name}
            </span>
          </span>
          <ChevronDown className="h-6 w-6 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[92vw] max-w-md">
        <DropdownMenuLabel>Switch project</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {PROJECTS.map((p) => (
          <DropdownMenuItem
            key={p.id}
            onClick={() => setProject(p.id)}
            className="py-3 text-base"
          >
            <div className="flex flex-col">
              <span className="font-semibold">{p.name}</span>
              <span className="text-xs text-muted-foreground">{p.code}</span>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
