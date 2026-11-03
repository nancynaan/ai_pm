import { useEffect, useState } from 'react';
import { ChatHome } from './ChatHome.js';
import { RunView } from './RunView.js';
import { StatusPage } from './StatusPage.js';

type Route = { page: 'chat' } | { page: 'run'; runId: string } | { page: 'status' };

function parseHash(hash: string): Route {
  const run = /^#\/runs\/([0-9a-f-]{36})$/i.exec(hash);
  if (run?.[1]) return { page: 'run', runId: run[1] };
  if (hash === '#/status') return { page: 'status' };
  return { page: 'chat' };
}

export function navigate(hash: string) {
  window.location.hash = hash;
}

export function App() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return (
    <main>
      <header className="top">
        <h1>
          <a href="#/">AI PM</a>
        </h1>
        <nav>
          <a href="#/" aria-current={route.page !== 'status' ? 'page' : undefined}>
            Chat
          </a>
          <a href="#/status" aria-current={route.page === 'status' ? 'page' : undefined}>
            System status
          </a>
        </nav>
      </header>

      {route.page === 'chat' && <ChatHome />}
      {route.page === 'run' && <RunView key={route.runId} runId={route.runId} />}
      {route.page === 'status' && <StatusPage />}
    </main>
  );
}
