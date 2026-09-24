import { controller } from '../app/controller';
import { useStore } from '../app/store';
import { Leaderboard } from './Leaderboard';

export function GameOver() {
  const score = useStore(controller.store, (s) => s.score);
  const best = useStore(controller.store, (s) => s.best);
  const submit = useStore(controller.store, (s) => s.submit);

  let status: string;
  switch (submit.kind) {
    case 'sending':
      status = 'Сервер проверяет результат…';
      break;
    case 'accepted':
      status = submit.rank ? `Результат подтверждён сервером — ${submit.rank} место!` : 'Результат подтверждён сервером.';
      break;
    case 'rejected':
      status = `Сервер отклонил результат: ${submit.reason}`;
      break;
    case 'offline':
      status = 'Офлайн-игра: результат не отправлен.';
      break;
    default:
      status = '';
  }

  return (
    <div className="overlay">
      <div className="panel">
        <h2>Время вышло!</h2>
        <div className="final-score">{score.toLocaleString('ru-RU')}</div>
        {score > 0 && score >= best && <div className="new-best">Новый рекорд!</div>}
        <p className={`status status-${submit.kind}`}>{status}</p>
        <div className="actions">
          <button className="btn" onClick={() => void controller.startGame()} autoFocus>Ещё раз</button>
          <button className="btn btn-ghost" onClick={() => controller.backToMenu()}>Меню</button>
        </div>
        <Leaderboard highlightRank={submit.kind === 'accepted' ? submit.rank : null} />
      </div>
    </div>
  );
}
