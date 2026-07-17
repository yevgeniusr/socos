import type { ReactNode } from "react";

type IntegrationSectionProps = {
  title: string;
  description: string;
  icon: string;
  status: string;
  children: ReactNode;
};

export default function IntegrationSection({
  title,
  description,
  icon,
  status,
  children,
}: IntegrationSectionProps) {
  const headingId = `integration-${title.toLowerCase().replaceAll(" ", "-")}`;

  return (
    <section
      role="region"
      aria-labelledby={headingId}
      className="overflow-hidden border border-outline-variant/30 bg-surface-container-low"
    >
      <header className="flex min-w-0 items-start gap-3 border-b border-outline-variant/25 px-4 py-4 sm:px-5">
        <span
          className="material-symbols-outlined mt-0.5 text-[22px] text-primary"
          aria-hidden="true"
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <h2
              id={headingId}
              className="text-base font-extrabold text-on-surface"
            >
              {title}
            </h2>
            <span className="text-xs font-bold uppercase text-on-surface-variant">
              {status}
            </span>
          </div>
          <p className="mt-1 text-sm leading-5 text-on-surface-variant">
            {description}
          </p>
        </div>
      </header>
      <div className="min-w-0 p-4 sm:p-5">{children}</div>
    </section>
  );
}
