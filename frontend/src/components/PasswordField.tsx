import { useState } from 'react';
import { Check, Eye, EyeOff, X } from 'lucide-react';
import { PASSWORD_RULES, passwordScore } from '../utils/password';

const METER = ['bg-red-500', 'bg-red-500', 'bg-orange-400', 'bg-yellow-400', 'bg-green-500'];
const METER_LABEL = ['Too weak', 'Weak', 'Fair', 'Almost there', 'Strong'];

interface Props {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: 'current-password' | 'new-password';
  /** Show the strength meter and rule checklist (for new passwords). */
  showRules?: boolean;
  error?: string;
  placeholder?: string;
}

export default function PasswordField({ label, value, onChange, autoComplete, showRules, error, placeholder }: Props) {
  const [visible, setVisible] = useState(false);
  const score = passwordScore(value);
  return (
    <div>
      <label className="label">{label}</label>
      <div className="relative">
        <input
          className={`input-field pr-10 ${error ? 'border-red-500/60' : ''}`}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={value}
          placeholder={placeholder}
          onChange={e => onChange(e.target.value)}
        />
        <button type="button" onClick={() => setVisible(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70" aria-label={visible ? 'Hide password' : 'Show password'}>
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {showRules && (
        <div className="mt-2.5 space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex-1 grid grid-cols-4 gap-1">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className={`h-1 rounded-full ${i < score ? METER[score] : 'bg-white/10'}`} />
              ))}
            </div>
            <span className={`text-[11px] w-20 text-right ${score === 4 ? 'text-green-400' : 'text-white/40'}`}>{value ? METER_LABEL[score] : ''}</span>
          </div>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
            {PASSWORD_RULES.map(r => {
              const ok = r.test(value);
              return (
                <li key={r.id} className={`flex items-center gap-1.5 text-[11px] ${ok ? 'text-green-400' : 'text-white/40'}`}>
                  {ok ? <Check size={12} /> : <X size={12} />}
                  {r.label}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
    </div>
  );
}
