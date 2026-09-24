import { GAME_DURATION_MS } from '@match3/shared';
import { controller } from '../app/controller';
import { useStore } from '../app/store';
import { ConnectionBadge } from './ConnectionBadge';

export function Hud() {
  const score = useStore(controller.store, (s) => s.score);
  const combo = useStore(controller.store, (s) => s.combo);
  const timeLeft = useStore(controller.store, (s) => s.timeLeft);
  const fps = useStore(controller.store, (s) => s.fps);
  const screen = useStore(controller.store, (s) => s.screen);

  const total = GAME_DURATION_MS / 1000;
  const progress = Math.max(0, timeLeft / total);
  const danger = screen === 'playing' && timeLeft <= 10;

  return (
    <header className="hud">
      <div className="hud-row">
        <div className="hud-block">
          <span className="hud-label">Очки</span>
          {/* key re-mounts the element, so the "bump" CSS animation plays on every change */}
          <span key={score} className="hud-score">{score.toLocaleString('ru-RU')}</span>
        </div>
        {combo > 1 && <div key={`c${combo}`} className="hud-combo">Комбо x{combo}</div>}
        <div className="hud-block hud-right">
          <span className={`hud-time ${danger ? 'danger' : ''}`}>{timeLeft}s</span>
          <span className="hud-meta">
            <ConnectionBadge /> · {fps} FPS
          </span>
        </div>
      </div>
      <div className="timebar">
        <div className={`timebar-fill ${danger ? 'danger' : ''}`} style={{ transform: `scaleX(${progress})` }} />
      </div>
    </header>
  );
}
