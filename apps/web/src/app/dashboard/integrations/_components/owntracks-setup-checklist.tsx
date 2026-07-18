type OwnTracksSetupChecklistProps = {
  endpoint: string;
  externalDeviceId?: string;
  credentialsShown?: boolean;
};

export default function OwnTracksSetupChecklist({
  endpoint,
  externalDeviceId,
  credentialsShown = false,
}: OwnTracksSetupChecklistProps) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-bold uppercase text-on-surface-variant">
        HTTPS endpoint
      </p>
      <p className="mt-1 break-all bg-surface-container-lowest px-3 py-3 font-mono text-sm text-on-surface [overflow-wrap:anywhere]">
        {endpoint}
      </p>
      {externalDeviceId ? (
        <p className="mt-3 break-all text-xs leading-5 text-on-surface-variant">
          External device ID: <strong>{externalDeviceId}</strong>. This is a
          Socos reference; the HTTP connection uses the Basic credentials.
        </p>
      ) : null}
      <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-6 text-on-surface-variant marker:font-bold marker:text-secondary">
        <li>In OwnTracks, set Connection mode to HTTP.</li>
        <li>Enter the HTTPS endpoint exactly as shown above.</li>
        <li>
          Set the Basic username and password under Identification or
          connection settings, using the one-time values {credentialsShown
            ? "shown in this dialog"
            : "already saved in OwnTracks"}
          .
        </li>
        <li>
          In Android settings, grant precise location and background access
          (“Allow all the time”) to OwnTracks.
        </li>
        <li>Disable battery optimization for OwnTracks.</li>
        <li>
          Save, then use OwnTracks manual publish or Report location once.
        </li>
        <li>Return to Socos and refresh this page.</li>
      </ol>
    </div>
  );
}
