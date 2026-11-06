import { runSummarySchema } from '@ai-pm/shared';
import { useEffect, useState } from 'react';
import { api } from './api.js';

/** The feature's name above a tab's content (Documents, Presentation). */
export function FeatureTitle({ runId }: { runId: string }) {
  const [title, setTitle] = useState<string | null>(null);
  useEffect(() => {
    api(`/api/runs/${runId}`, runSummarySchema)
      .then((r) => setTitle(r.title))
      .catch(() => setTitle(null));
  }, [runId]);
  return title ? <h2 className="feature-title">{title}</h2> : null;
}
