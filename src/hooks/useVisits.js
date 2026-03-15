import { useState, useEffect } from 'react';
import { getVisits } from '../services/visits';

export function useVisits(user, authLoading, loadTrigger) {
  const [visitedShrines, setVisitedShrines] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (authLoading) return;

    const loadVisits = async () => {
      setError(null);
      setLoading(true);
      try {
        const visits = await getVisits();
        setVisitedShrines(visits);
      } catch (err) {
        // M3: expose load error via return value instead of silently swallowing it
        setError(err);
      } finally {
        setLoading(false);
      }
    };
    loadVisits();
  }, [user, authLoading, loadTrigger]);

  return { visitedShrines, updateVisitedShrines: setVisitedShrines, loading, error };
}
