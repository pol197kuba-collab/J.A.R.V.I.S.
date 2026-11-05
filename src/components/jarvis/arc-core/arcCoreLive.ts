// What the live /jarvis Arc Core (R3F) is showing right now, in app units:
// written every frame by JarvisCanvasV2, read by the module transition so the
// "leave /jarvis" flight starts from exactly the view on screen and its agent
// nodes sit where the R3F nodes are. Plain numbers, three-free, no allocation.

export const arcCoreLive = {
  /** Set while a JarvisCanvasV2 is mounted and rendering. */
  active: false,
  cam: { x: 0, y: 0, z: 0 },
  target: { x: 0, y: 0, z: 0 },
  /** R3F clock (seconds): drives the orbit angles of the agent nodes. */
  time: 0,
  /** performance.now() of the last write, to know the time is current. */
  stamp: 0,
};
