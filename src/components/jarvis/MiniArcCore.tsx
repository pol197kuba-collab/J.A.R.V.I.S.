import { cn } from "@/lib/utils";

/**
 * The Arc Core in miniature, for the mobile dock's menu button: the hot golden
 * core pulsing, three golden rings turning around it in 3D (CSS 3D transforms,
 * no WebGL), each with a bead like the rings on /jarvis. No frame around it.
 *
 * `state` follows the agents: "busy" spins the rings up, "error" tints the
 * glow red. `charge` (0…1) is the long-press progress: the core brightens and
 * the rings speed up as it fills.
 */
export function MiniArcCore({
  size = 56,
  state = "idle",
  charging = false,
}: {
  size?: number;
  state?: "idle" | "busy" | "error";
  /** The button is being held: the core charges up over the hold time. */
  charging?: boolean;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "mini-arc-core",
        state === "busy" && "is-busy",
        state === "error" && "is-error",
        charging && "is-charging",
      )}
      style={{ width: size, height: size }}
    >
      <span className="mac-glow" />
      <span className="mac-ring mac-ring-1">
        <i />
      </span>
      <span className="mac-ring mac-ring-2">
        <i />
      </span>
      <span className="mac-ring mac-ring-3">
        <i />
      </span>
      <span className="mac-core" />
    </span>
  );
}
