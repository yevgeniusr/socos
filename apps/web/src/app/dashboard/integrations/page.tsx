import { Suspense } from "react";

import IntegrationsWorkspace from "./integrations-workspace";

export default function IntegrationsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-sm text-on-surface-variant">
          Loading integrations...
        </div>
      }
    >
      <IntegrationsWorkspace />
    </Suspense>
  );
}
