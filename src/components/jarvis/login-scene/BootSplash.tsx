import { BOOT_SPLASH_IMG_ATTR } from "@/lib/theme/loginScene";

/**
 * The app's first frame. It continues the system splash screen of the installed
 * app (Android draws /icon-512.png centred on black from the manifest) and, on
 * the 3D path, it is replaced in place by the scene: the icon IS a render of the
 * scene's first frame (scripts/render-app-icon.mjs), so the cross-fade is
 * seamless and the camera then flies to the landing page. Rendered on the
 * server too, so no other screen flashes before the intro mode is known.
 */
export function BootSplash({ fading }: { fading: boolean }) {
  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black transition-opacity duration-500 ease-out motion-reduce:transition-none"
      style={{ opacity: fading ? 0 : 1, pointerEvents: fading ? "none" : "auto" }}
    >
      <img
        {...{ [BOOT_SPLASH_IMG_ATTR]: "" }}
        src="/icon-512.png"
        alt=""
        draggable={false}
        className="aspect-square w-[min(60vw,240px)] select-none"
      />
    </div>
  );
}
