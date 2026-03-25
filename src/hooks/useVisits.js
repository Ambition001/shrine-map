import { useState, useEffect, useRef } from 'react';
import { getVisits, getLocalVisits } from '../services/visits';

export function useVisits(user, authLoading, loadTrigger) {
  const [visitedShrines, setVisitedShrines] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const cloudLoadedRef = useRef(false);

  // Load local IndexedDB data immediately to unblock map rendering while auth is pending.
  // The cloudLoadedRef guard prevents stale local data from overwriting cloud data
  // if cloud somehow resolves before the local read completes.
  useEffect(() => {
    let active = true;
    getLocalVisits()
      .then(visits => {
        if (active && !cloudLoadedRef.current) {
          setVisitedShrines(visits);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active && !cloudLoadedRef.current) setLoading(false);
      });
    return () => { active = false; };
  }, []); // only on mount

  // Full load after auth resolves (cloud if logged in, local if not).
  useEffect(() => {
    if (authLoading) return;
    const loadVisits = async () => {
      setError(null);
      setLoading(true);
      try {
        const visits = await getVisits();
        cloudLoadedRef.current = true;
        setVisitedShrines(visits);
      } catch (err) {
        setError(err);
      } finally {
        setLoading(false);
      }
    };
    loadVisits();
  }, [user, authLoading, loadTrigger]);

  return { visitedShrines, updateVisitedShrines: setVisitedShrines, loading, error };
}
