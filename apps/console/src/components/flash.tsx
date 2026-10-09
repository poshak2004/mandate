/** A one-line status from ?error= or a success flag in the URL. */
export function Flash({ error, success }: { error?: string; success?: string }) {
  if (error) {
    return (
      <div className="mb-6 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm whitespace-pre-wrap text-rose-800">
        {error}
      </div>
    );
  }
  if (success) {
    return (
      <div className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        {success}
      </div>
    );
  }
  return null;
}
