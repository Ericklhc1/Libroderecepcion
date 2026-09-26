'use client';

import { useRef } from 'react';
import { startKeyInventoryMetricAction } from '@/server/actions/key-inventory';

export function KeyInventoryMetricBoundary({
  floor,
  children,
}: {
  floor: number;
  children: React.ReactNode;
}) {
  const correlationRef = useRef<HTMLInputElement>(null);
  const startedAtRef = useRef<HTMLInputElement>(null);

  function markStarted() {
    if (!correlationRef.current || !startedAtRef.current) return;
    if (correlationRef.current.value) return;

    const startedAtMs = Date.now();
    const correlationId = `key-inventory:${floor}:${crypto.randomUUID()}`;
    correlationRef.current.value = correlationId;
    startedAtRef.current.value = String(startedAtMs);

    void startKeyInventoryMetricAction({
      floor,
      correlationId,
      startedAtMs,
    }).catch(() => undefined);
  }

  return (
    <div onFocusCapture={markStarted} onPointerDownCapture={markStarted}>
      <input ref={correlationRef} type="hidden" name="metricCorrelationId" defaultValue="" />
      <input ref={startedAtRef} type="hidden" name="metricStartedAt" defaultValue="" />
      {children}
    </div>
  );
}
