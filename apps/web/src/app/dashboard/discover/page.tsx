import { Suspense } from "react";

import DiscoverWorkspace from "./discover-workspace";

export default function DiscoverPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-sm text-on-surface-variant">
          Loading event catalog...
        </div>
      }
    >
      <DiscoverWorkspace />
    </Suspense>
  );
}
