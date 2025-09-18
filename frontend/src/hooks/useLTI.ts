import { useEffect, useState } from 'react';
import { API_AUTH_KEY, API_BASE_URL } from '../config';

interface LTIUser {
  subject: string;
  name: string | null;
  email: string | null;
  roles: string[];
}

interface LTIContext {
  user: LTIUser;
  context: Record<string, any>;
  ags: Record<string, any> | null;
  expiresAt: string;
}

interface LTIScorePayload {
  missionId?: string;
  stageIndex?: number;
  runId?: string;
  success?: boolean;
  scoreGiven?: number;
  scoreMaximum?: number;
  activityProgress?: string;
  gradingProgress?: string;
  metadata?: Record<string, any>;
}

export function useLTI() {
  const [context, setContext] = useState<LTIContext | null>(null);
  const [isLTISession, setIsLTISession] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchLTIContext = async () => {
      try {
        const headers: HeadersInit = {};
        if (API_AUTH_KEY) headers['X-API-Key'] = API_AUTH_KEY;

        const response = await fetch(`${API_BASE_URL}/api/lti/context`, {
          method: 'GET',
          headers,
          credentials: 'include',
        });

        if (response.ok) {
          const data = await response.json();
          setContext(data);
          setIsLTISession(true);
        } else if (response.status === 401) {
          // No LTI session, normal operation
          setIsLTISession(false);
        } else {
          throw new Error(`Erreur lors de la récupération du contexte LTI: ${response.status}`);
        }
      } catch (err) {
        console.warn('LTI context not available:', err);
        setIsLTISession(false);
        setError(err instanceof Error ? err.message : 'Erreur inconnue');
      } finally {
        setLoading(false);
      }
    };

    fetchLTIContext();
  }, []);

  const submitScore = async (payload: LTIScorePayload): Promise<boolean> => {
    if (!isLTISession) {
      console.log('Score submission skipped: Not in LTI session');
      return false;
    }

    try {
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };
      if (API_AUTH_KEY) headers['X-API-Key'] = API_AUTH_KEY;

      const response = await fetch(`${API_BASE_URL}/api/lti/score`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Erreur lors de l'envoi du score: ${response.status} - ${errorText}`);
      }

      console.log('Score successfully submitted to LTI platform');
      return true;
    } catch (err) {
      console.error('Failed to submit score to LTI platform:', err);
      setError(err instanceof Error ? err.message : 'Erreur lors de l\'envoi du score');
      return false;
    }
  };

  const logout = async (): Promise<void> => {
    if (!isLTISession) return;

    try {
      const headers: HeadersInit = {};
      if (API_AUTH_KEY) headers['X-API-Key'] = API_AUTH_KEY;

      await fetch(`${API_BASE_URL}/api/lti/session`, {
        method: 'DELETE',
        headers,
        credentials: 'include',
      });

      setContext(null);
      setIsLTISession(false);
    } catch (err) {
      console.error('Failed to logout from LTI session:', err);
    }
  };

  return {
    context,
    isLTISession,
    loading,
    error,
    submitScore,
    logout,
  };
}