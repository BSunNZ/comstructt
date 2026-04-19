import { AlertTriangle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Props = {
  open: boolean;
  term: string | null;
  onClose: () => void;
};

export const MisuseDialog = ({ open, term, onClose }: Props) => {
  return (
    <AlertDialog open={open} onOpenChange={(v) => !v && onClose()}>
      <AlertDialogContent className="rounded-2xl border-0 p-0 sm:max-w-md">
        <div className="hazard-stripe h-3 rounded-t-2xl" />
        <div className="px-6 pb-6 pt-5">
          <AlertDialogHeader className="items-center text-center sm:text-center">
            <div className="mb-3 grid h-16 w-16 place-items-center rounded-full bg-warning text-warning-foreground">
              <AlertTriangle className="h-8 w-8" />
            </div>
            <AlertDialogTitle className="font-display text-2xl uppercase">
              Out of scope
            </AlertDialogTitle>
            <AlertDialogDescription className="text-base text-foreground/80">
              This app is for <span className="font-semibold">small everyday site materials and consumables</span>.
              {term && (
                <>
                  {" "}
                  We don't handle <span className="font-semibold">"{term}"</span> here.
                </>
              )}
              <br />
              <span className="mt-2 block text-sm text-muted-foreground">
                For large equipment or structural items, contact your project manager.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-6">
            <AlertDialogAction
              onClick={onClose}
              className="tap-target h-14 w-full rounded-xl bg-primary text-base font-bold uppercase tracking-wide text-primary-foreground shadow-rugged hover:bg-primary-glow"
            >
              Got it
            </AlertDialogAction>
          </AlertDialogFooter>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
};
