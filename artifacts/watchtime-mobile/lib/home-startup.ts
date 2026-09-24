import { InteractionManager } from 'react-native';

export function startHomeStartup(setStartupReady: (ready: boolean) => void) {
  let cancelled = false;
  let animationFrame: number | null = null;
  const interaction = InteractionManager.runAfterInteractions(() => {
    if (cancelled) return;
    animationFrame = requestAnimationFrame(() => {
      if (!cancelled) {
        setStartupReady(true);
      }
    });
  });

  return () => {
    cancelled = true;
    interaction.cancel();
    if (animationFrame !== null) {
      cancelAnimationFrame(animationFrame);
    }
  };
}