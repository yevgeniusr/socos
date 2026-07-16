import { Suspense } from "react";

import ContactsWorkspace from "./contacts-workspace";

export default function ContactsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-sm text-on-surface-variant">
          Loading contacts...
        </div>
      }
    >
      <ContactsWorkspace />
    </Suspense>
  );
}
