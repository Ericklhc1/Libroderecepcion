import { Fragment } from 'react';

export default function AppTemplate({ children }: { children: React.ReactNode }) {
  // This server template also receives streamed children directly under a host.
  // An unkeyed Fragment is flattened; a stable key gives replay its own fiber.
  return <div className="surface-enter min-w-0"><Fragment key="aroh-template-content">{children}</Fragment></div>;
}
