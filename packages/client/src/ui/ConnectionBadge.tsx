import { controller } from '../app/controller';
import { useStore } from '../app/store';

export function ConnectionBadge() {
  const connection = useStore(controller.store, (s) => s.connection);
  const online = useStore(controller.store, (s) => s.online);
  const label = connection === 'online' ? `${online} онлайн` : connection === 'connecting' ? 'подключение…' : 'офлайн';
  return (
    <span className={`badge badge-${connection}`}>
      <i />
      {label}
    </span>
  );
}
