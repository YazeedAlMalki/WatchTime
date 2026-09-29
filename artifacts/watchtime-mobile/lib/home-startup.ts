export function startHomeStartup(setStartupReady: (ready: boolean) => void) {
  let cancelled = false;
  let animationFrame: number | null = null;
  // The second callback runs after the first frame has had a chance to paint.
  animationFrame = requestAnimationFrame(() => {
    if (cancelled) return;
    animationFrame = requestAnimationFrame(() => {
      if (!cancelled) {
        setStartupReady(true);
      }
    });
  });

  return () => {
    cancelled = true;
    if (animationFrame !== null) {
      cancelAnimationFrame(animationFrame);
    }
  };
}