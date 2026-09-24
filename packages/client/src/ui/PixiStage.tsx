import { useEffect, useRef } from 'react';
import { BOARD_COLS, BOARD_ROWS } from '@match3/shared';
import { controller } from '../app/controller';
import { GameView } from '../game/GameView';

export const HUD_HEIGHT = 92;

/**
 * Bridge between React and PixiJS. React owns the DOM container, Pixi owns
 * the canvas inside it. Init is async, so the effect handles the case where
 * the component unmounts before init finishes (StrictMode mounts twice in dev).
 */
export function PixiStage() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current!;
    let view: GameView | null = null;
    let cancelled = false;

    GameView.create(host, { rows: BOARD_ROWS, cols: BOARD_COLS, topInset: HUD_HEIGHT })
      .then((v) => {
        if (cancelled) return v.destroy();
        view = v;
        controller.attachView(v);
      })
      .catch((err) => console.error('Pixi init failed', err));

    return () => {
      cancelled = true;
      if (view) {
        controller.detachView();
        view.destroy();
      }
    };
  }, []);

  return <div ref={hostRef} className="stage" />;
}
