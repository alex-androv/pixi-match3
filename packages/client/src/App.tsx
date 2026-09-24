import { controller } from './app/controller';
import { useStore } from './app/store';
import { GameOver } from './ui/GameOver';
import { Hud } from './ui/Hud';
import { Menu } from './ui/Menu';
import { PixiStage } from './ui/PixiStage';

export function App() {
  const screen = useStore(controller.store, (s) => s.screen);

  return (
    <div className="app">
      {/* The canvas is mounted once and never re-created when screens change */}
      <PixiStage />
      <Hud />
      {screen === 'loading' && <div className="overlay"><div className="spinner" /></div>}
      {screen === 'menu' && <Menu />}
      {screen === 'gameover' && <GameOver />}
    </div>
  );
}
