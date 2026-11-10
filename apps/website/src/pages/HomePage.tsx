import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';

const HIGHLIGHTS = [
  { title: 'Works offline', body: 'Sales, stock and receipts run on your own PC. No internet? Keep selling.' },
  { title: 'Your data stays yours', body: 'Products and sales live in a local database on your machine, not in our cloud.' },
  { title: 'Barcode-ready', body: 'Plug in a USB scanner and start ringing up items in seconds.' },
  { title: 'Grow when ready', body: 'Start free. Upgrade for branches, employees and advanced reports.' },
];

export function HomePage() {
  const { user } = useAuth();
  return (
    <div className="space-y-16">
      <section className="pt-6 text-center">
        <p className="text-sm font-semibold text-indigo-600">Point of sale for small stores</p>
        <h1 className="mx-auto mt-3 max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">
          Sell faster. Track stock. Even without internet.
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-slate-600">
          A lightweight desktop POS with a simple online account for your stores and subscription.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            to={user ? '/pos' : '/register'}
            className="rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-500"
          >
            {user ? 'Open POS' : 'Start free'}
          </Link>
          <Link
            to="/pricing"
            className="rounded-md border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            See pricing
          </Link>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        {HIGHLIGHTS.map((h) => (
          <div key={h.title} className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="font-semibold">{h.title}</h2>
            <p className="mt-1 text-sm text-slate-600">{h.body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
