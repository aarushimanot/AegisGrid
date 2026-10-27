import { useEffect, useState } from 'react';
import { X, CheckCircle, AlertTriangle, Info, XCircle } from 'lucide-react';
import type { Notification } from '../types';
import { useApp } from '../context/AppContext';

function Toast({ notification, onRemove }: { notification: Notification; onRemove: (id: string) => void }) {
  const [exiting, setExiting] = useState(false);

  const handleRemove = () => {
    setExiting(true);
    setTimeout(() => onRemove(notification.id), 300);
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setExiting(true);
      setTimeout(() => onRemove(notification.id), 300);
    }, 4700);
    return () => clearTimeout(timer);
  }, [notification.id, onRemove]);

  const icons = {
    success: <CheckCircle size={16} className="text-green-400 flex-shrink-0" />,
    error: <XCircle size={16} className="text-red-400 flex-shrink-0" />,
    warning: <AlertTriangle size={16} className="text-yellow-400 flex-shrink-0" />,
    info: <Info size={16} className="text-blue-400 flex-shrink-0" />,
  };

  const borderColors = {
    success: 'border-green-500/30',
    error: 'border-red-500/30',
    warning: 'border-yellow-500/30',
    info: 'border-blue-500/30',
  };

  return (
    <div className={`flex items-start gap-3 p-3.5 rounded-lg bg-black-200 border ${borderColors[notification.type]} max-w-sm shadow-xl ${exiting ? 'toast-exit' : 'toast-enter'}`}>
      {icons[notification.type]}
      <p className="text-sm text-white/80 flex-1 leading-relaxed">{notification.message}</p>
      <button onClick={handleRemove} className="text-white/30 hover:text-white/60 transition-colors flex-shrink-0">
        <X size={13} />
      </button>
    </div>
  );
}

export default function NotificationToaster() {
  const { notifications, removeNotification } = useApp();

  if (notifications.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
      {notifications.map(n => (
        <Toast key={n.id} notification={n} onRemove={removeNotification} />
      ))}
    </div>
  );
}
