import { memo } from "react";
import logoSrc from "@/assets/app-logo.jpg";

type Props = {
  className?: string;
  /** Pixel size of the logo box (square). Defaults to 32. */
  size?: number;
  alt?: string;
};

/**
 * AppLogo — reusable company logo.
 * Renders the original image without altering aspect ratio, colors, or padding.
 */
export const AppLogo = memo(({ className = "", size = 32, alt = "comstruct" }: Props) => {
  return (
    <img
      src={logoSrc}
      alt={alt}
      width={size}
      height={size}
      decoding="async"
      loading="eager"
      style={{ width: size, height: size }}
      className={`object-contain rounded-lg ${className}`}
    />
  );
});

AppLogo.displayName = "AppLogo";
