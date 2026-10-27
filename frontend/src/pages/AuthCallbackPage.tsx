import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { completeGoogleSignIn, homeFor } from '../services/auth';

/** Return point from Google sign-in (Cognito hosted OAuth). */
export default function AuthCallbackPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // the code can be exchanged only once (React StrictMode runs effects twice)
    started.current = true;
    completeGoogleSignIn(params)
      .then(s => navigate(homeFor(s.role), { replace: true }))
      .catch(e => setError((e as Error).message));
  }, [params, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#090909] px-4">
      <div className="glass-card p-6 text-center max-w-sm w-full">
        {error ? (
          <>
            <p className="text-sm text-red-400 mb-4">{error}</p>
            <button className="btn-primary w-full justify-center" onClick={() => navigate('/login', { replace: true })}>Back to sign in</button>
          </>
        ) : (
          <div className="flex items-center justify-center gap-3 text-white/60 text-sm">
            <Loader2 size={18} className="animate-spin text-red-400" /> Signing you in with Google…
          </div>
        )}
      </div>
    </div>
  );
}
