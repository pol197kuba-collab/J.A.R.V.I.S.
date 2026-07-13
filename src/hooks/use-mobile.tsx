import * as React from "react";

const MOBILE_BREAKPOINT = 768;
// Matches the "short" viewport concept already used elsewhere (styles.css
// custom-variant, StarkLogin/ArcReactorTriangle/VisionScanner): a phone
// rotated to landscape is typically wider than MOBILE_BREAKPOINT but short
// in height, so a width-only check misclassifies it as "desktop" and this
// hook's consumers (e.g. the sidebar) render the wrong layout for it.
const SHORT_HEIGHT_BREAKPOINT = 500;

function computeIsMobile() {
  return window.innerWidth < MOBILE_BREAKPOINT || window.innerHeight <= SHORT_HEIGHT_BREAKPOINT;
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const widthMql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const heightMql = window.matchMedia(`(max-height: ${SHORT_HEIGHT_BREAKPOINT}px)`);
    const onChange = () => setIsMobile(computeIsMobile());
    widthMql.addEventListener("change", onChange);
    heightMql.addEventListener("change", onChange);
    setIsMobile(computeIsMobile());
    return () => {
      widthMql.removeEventListener("change", onChange);
      heightMql.removeEventListener("change", onChange);
    };
  }, []);

  return !!isMobile;
}
