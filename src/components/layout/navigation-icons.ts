import { AlarmClock, Banknote, BarChart3, BedDouble, BookOpen, CalendarClock, DoorClosed, History, Home, KeyRound, Settings, ShieldCheck } from 'lucide-react';

export const NAV_ICONS = {
  home: Home, book: BookOpen, shift: CalendarClock, supervision: ShieldCheck,
  guest: BedDouble, history: History, metrics: BarChart3, room: DoorClosed,
  key: KeyRound, cash: Banknote, alarm: AlarmClock, admin: Settings,
} as const;
