import { useEffect, useState } from 'react';
import { AnalysisList, AnalysisView } from './Analysis.js';
import { BacklogTab, useHasBacklog } from './Backlog.js';
import { ChatHome } from './ChatHome.js';
import { DocumentPreview, DocumentsTab } from './Documents.js';
import { PresentationTab, PresentationView } from './Presentation.js';
import { RunView } from './RunView.js';
import { StatusPage } from './StatusPage.js';

/** The views of one feature request, shown as tabs in the header; Backlog only once it is in Jira. */
const TABS = [
  { id: 'chat', label: 'Chat', path: '' },
  { id: 'analysis', label: 'Analysis', path: '/analysis' },
  { id: 'documents', label: 'Documents', path: '/documents' },
  { id: 'presentation', label: 'Presentation', path: '/presentation' },
  { id: 'backlog', label: 'Backlog', path: '/backlog' },
] as const;
type Tab = (typeof TABS)[number]['id'];

type Route =
  | { page: 'home' }
  | { page: 'status' }
  | { page: 'assessments' }
  | { page: 'feature'; runId: string; tab: Tab; document?: string; slides?: boolean };

const UUID = '([0-9a-f-]{36})';

function parseHash(hash: string): Route {
  const feature = new RegExp(
    `^#/runs/${UUID}(?:/(analysis|documents|presentation|backlog)(?:/([a-z_]+))?)?$`,
    'i',
  ).exec(hash);
  if (feature?.[1]) {
    const tab = (feature[2]?.toLowerCase() ?? 'chat') as Tab;
    const sub = feature[3];
    if (tab === 'documents' && sub) return { page: 'feature', runId: feature[1], tab, document: sub };
    if (tab === 'presentation' && sub === 'slides')
      return { page: 'feature', runId: feature[1], tab, slides: true };
    return { page: 'feature', runId: feature[1], tab };
  }
  // Older links to an assessment open the feature's Analysis tab.
  const legacy = new RegExp(`^#/analysis/${UUID}$`, 'i').exec(hash);
  if (legacy?.[1]) return { page: 'feature', runId: legacy[1], tab: 'analysis' };
  if (hash === '#/analysis') return { page: 'assessments' };
  if (hash === '#/status') return { page: 'status' };
  return { page: 'home' };
}

export function navigate(hash: string) {
  window.location.hash = hash;
}

function FeatureTabs({ runId, tab }: { runId: string; tab: Tab }) {
  const hasBacklog = useHasBacklog(runId);
  return (
    <nav aria-label="Feature views">
      {TABS.filter((t) => t.id !== 'backlog' || hasBacklog || tab === 'backlog').map((t) => (
        <a key={t.id} href={`#/runs/${runId}${t.path}`} aria-current={t.id === tab ? 'page' : undefined}>
          {t.label}
        </a>
      ))}
    </nav>
  );
}

function FeatureView({ route }: { route: Extract<Route, { page: 'feature' }> }) {
  const { runId } = route;
  switch (route.tab) {
    case 'chat':
      return <RunView key={runId} runId={runId} />;
    case 'analysis':
      return <AnalysisView key={runId} runId={runId} />;
    case 'documents':
      return route.document ? (
        <DocumentPreview key={route.document} runId={runId} type={route.document} />
      ) : (
        <DocumentsTab key={runId} runId={runId} />
      );
    case 'presentation':
      return route.slides ? (
        <PresentationView key={runId} runId={runId} />
      ) : (
        <PresentationTab key={runId} runId={runId} />
      );
    case 'backlog':
      return <BacklogTab key={runId} runId={runId} />;
  }
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

  const wide = route.page === 'feature' && (route.tab === 'analysis' || !!route.document || !!route.slides);
  // The page width lives on #root, which holds both the pinned bar and the content.
  useEffect(() => {
    document.getElementById('root')?.classList.toggle('wide', wide);
  }, [wide]);

  return (
    <>
      {/* Pinned at the top: the bar, and a soft blur strip under it (siblings, so each blurs the page). */}
      <div className="topbar">
        <header className="top">
          <h1>
            <a href="#/">AI PM</a>
          </h1>
          {route.page === 'home' && (
            <a className="button" href="#/status">
              System status
            </a>
          )}
          {route.page === 'feature' && <FeatureTabs runId={route.runId} tab={route.tab} />}
        </header>
        <div className="topbar-fade" aria-hidden="true" />
      </div>

      <main>
        {route.page === 'home' && <ChatHome />}
        {route.page === 'feature' && <FeatureView route={route} />}
        {route.page === 'assessments' && <AnalysisList />}
        {route.page === 'status' && <StatusPage />}
      </main>
    </>
  );
}
