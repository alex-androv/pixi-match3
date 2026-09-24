import { controller } from '../app/controller';
import { useStore } from '../app/store';

export function Leaderboard({ highlightRank }: { highlightRank?: number | null }) {
  const entries = useStore(controller.store, (s) => s.leaderboard);
  const connection = useStore(controller.store, (s) => s.connection);

  return (
    <section className="leaderboard">
      <h3>Топ игроков <small>обновляется в реальном времени</small></h3>
      {entries.length === 0 ? (
        <p className="muted">{connection === 'online' ? 'Пока пусто — стань первым!' : 'Нет связи с сервером'}</p>
      ) : (
        <ol>
          {entries.map((e, i) => (
            <li key={`${e.name}-${e.at}`} className={highlightRank === i + 1 ? 'me' : ''}>
              <span className="place">{i + 1}</span>
              <span className="name">{e.name}</span>
              <span className="pts">{e.score.toLocaleString('ru-RU')}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
