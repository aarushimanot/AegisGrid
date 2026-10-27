import { Biohazard, CarFront, CircleAlert, Flame, HeartHandshake, HeartPulse, Siren, Waves, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { EmergencyType } from '../types';
import { getTypeColor } from '../utils/helpers';

export const TYPE_ICON: Record<EmergencyType, LucideIcon> = {
  Accident: CarFront,
  Medical: HeartPulse,
  Fire: Flame,
  'Natural Disaster': Waves,
  Crime: Siren,
  Harassment: HeartHandshake,
  Hazmat: Biohazard,
  'Gas / Electrical': Zap,
  Other: CircleAlert,
};

/** Line icon for an emergency type, tinted with the type colour. */
export default function TypeIcon({ type, size = 16, className = '' }: { type: EmergencyType; size?: number; className?: string }) {
  const Icon = TYPE_ICON[type] ?? CircleAlert;
  return <Icon size={size} className={`flex-shrink-0 ${className}`} style={{ color: getTypeColor(type) }} aria-hidden />;
}
