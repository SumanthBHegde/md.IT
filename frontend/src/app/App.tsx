import { useEffect } from 'react';
import { Route, Routes } from 'react-router';
import { AuthProvider, LoginErrorNotice } from '../auth';
import { MissingPage } from './MissingPage';
import { ProjectList } from './ProjectList';
import { requestPersistentStorage } from './storage';
import { UpdateNotice } from './UpdateNotice';
import { useApplyTheme } from './theme';
import { Workspace } from './Workspace';

export function App() {
  useApplyTheme();
  useEffect(() => {
    void requestPersistentStorage();
  }, []);

  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<ProjectList />} />
        <Route path="/p/:projectId" element={<Workspace />} />
        <Route path="/p/:projectId/d/:docId" element={<Workspace />} />
        <Route path="*" element={<MissingPage title="This page doesn’t exist" text="Check the address, or go back to your projects." />} />
      </Routes>
      <LoginErrorNotice />
      <UpdateNotice />
    </AuthProvider>
  );
}
