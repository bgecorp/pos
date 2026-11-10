import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

const navClass = ({ isActive }: { isActive: boolean }) =>
  `text-sm ${isActive ? 'text-slate-900 font-medium' : 'text-slate-500 hover:text-slate-900'}`;

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-indigo-600 text-xs text-white">POS</span>
            SaaS POS
          </Link>
          <nav className="flex flex-wrap items-center gap-5">
            <NavLink to="/pricing" className={navClass}>Pricing</NavLink>
            {user ? (
              <>
                {user.role === 'ADMIN' && (
                  <NavLink to="/admin" className={({ isActive }) => `text-sm font-medium ${isActive ? 'text-amber-700' : 'text-amber-600 hover:text-amber-800'}`}>
                    Admin
                  </NavLink>
                )}
                <Link to="/pos" className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">
                  Open POS
                </Link>
                <button
                  className="text-sm text-slate-500 hover:text-slate-900"
                  onClick={() => {
                    logout();
                    navigate('/login');
                  }}
                >
                  Log out
                </button>
              </>
            ) : (
              <>
                <NavLink to="/login" className={navClass}>Log in</NavLink>
                <Link to="/register" className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">
                  Get started
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
        <Outlet />
      </main>
      <footer className="border-t border-slate-200 py-4 text-center text-xs text-slate-400">
        SaaS POS · MVP · <Link to="/status" className="hover:text-slate-600">System status</Link>
      </footer>
    </div>
  );
}
