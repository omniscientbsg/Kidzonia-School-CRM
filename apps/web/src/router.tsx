import { createBrowserRouter } from 'react-router';
import type { RouteObject } from 'react-router';
import { LoginPage } from './auth/LoginPage';
import { RegisterPage } from './auth/RegisterPage';
import { ChangesPage } from './settings/ChangesPage';
import { ProfilePage } from './settings/ProfilePage';
import { ComingSoonPage } from './pages/ComingSoonPage';
import { HomePage } from './pages/HomePage';
import { ModulePage } from './pages/ModulePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { AppLayout } from './shell/AppLayout';

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <HomePage /> },
      // App pages come from the module registry; ModulePage checks access.
      { path: 'tasks/*', element: <ModulePage /> },
      { path: 'tasks', element: <ModulePage /> },
      { path: 'settings/*', element: <ModulePage /> },
      { path: 'apps/:key', element: <ComingSoonPage /> },
      { path: 'profile', element: <ProfilePage /> },
      { path: 'changes', element: <ChangesPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routes);
