import { useEffect, useState } from 'react';
import { AnalysisList, AnalysisView } from './Analysis.js';
import { ChatHome } from './ChatHome.js';
import { RunView } from './RunView.js';
import { StatusPage } from './StatusPage.js';

type Route =
  | { page: 'chat' }
  | { page: 'run'; runId: string }
  | { page: 'analysis' }
  | { page: 'assessment'; runId: string }
  | { page: 'status' };

const UUID = '([0-9a-f-]{36})';

function parseHash(hash: string): Route {
  const run = new RegExp(`^#/runs/${UUID}$`, 'i').exec(hash);
  if (run?.[1]) return { page: 'run', runId: run[1] };
  const assessment = new RegExp(`^#/analysis/${UUID}$`, 'i').exec(hash);
  if (assessment?.[1]) return { page: 'assessment', runId: assessment[1] };
  if (hash === '#/analysis') return { page: 'analysis' };
  if (hash === '#/status') return { page: 'status' };
  return { page: 'chat' };
}

export function navigate(hash: string) {
  window.location.hash = hash;
}

export function App() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const tab =
    route.page === 'analysis' || route.page === 'assessment'
      ? 'analysis'
      : route.page === 'status'
        ? 'status'
        : 'chat';
  const wide = route.page === 'assessment';

  return (
    <main className={wide ? 'wide' : undefined}>
      <header className="top">
        <h1>
          <a href="#/">AI PM</a>
        </h1>
        <nav>
          <a href="#/" aria-current={tab === 'chat' ? 'page' : undefined}>
            Chat
          </a>
          <a href="#/analysis" aria-current={tab === 'analysis' ? 'page' : undefined}>
            Analysis
          </a>
          <a href="#/status" aria-current={tab === 'status' ? 'page' : undefined}>
            System status
          </a>
        </nav>
      </header>

      {route.page === 'chat' && <ChatHome />}
      {route.page === 'run' && <RunView key={route.runId} runId={route.runId} />}
      {route.page === 'analysis' && <AnalysisList />}
      {route.page === 'assessment' && <AnalysisView key={route.runId} runId={route.runId} />}
      {route.page === 'status' && <StatusPage />}
    </main>
  );
}
