import { useEffect, useState } from 'react';

/** Shows the exact receipt document that will be printed. */
export function ReceiptPreview({ html }: { html: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [html]);
  return (
    <div className="flex justify-center rounded-lg bg-slate-100 p-3">
      {url && <iframe title="Receipt preview" src={url} className="h-96 w-[340px] max-w-full rounded bg-white shadow" />}
    </div>
  );
}
