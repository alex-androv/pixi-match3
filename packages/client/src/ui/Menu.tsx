import { MAX_NAME_LENGTH } from '@match3/shared';
import { controller } from '../app/controller';
import { useStore } from '../app/store';
import { ConnectionBadge } from './ConnectionBadge';
import { Leaderboard } from './Leaderboard';

export function Menu() {
  const nickname = useStore(controller.store, (s) => s.nickname);
  const best = useStore(controller.store, (s) => s.best);

  return (
    <div className="overlay">
      <form
        className="panel"
        onSubmit={(e) => {
          e.preventDefault();
          void controller.startGame();
        }}
      >
        <h1 className="logo">Gem Rush</h1>
        <p className="muted">Собери как можно больше камней за 60 секунд. Свайп или два тапа — поменять местами.</p>
        <label className="field">
          <span>Никнейм</span>
          <input
            value={nickname}
            maxLength={MAX_NAME_LENGTH}
            placeholder="Player"
            onChange={(e) => controller.setNickname(e.target.value)}
          />
        </label>
        <button className="btn" type="submit" autoFocus>Играть</button>
        <div className="panel-footer">
          <span>Рекорд: <b>{best.toLocaleString('ru-RU')}</b></span>
          <ConnectionBadge />
        </div>
        <Leaderboard />
      </form>
    </div>
  );
}
