'use client';

import { Suspense } from 'react';
import { ExplorerWorkspace } from '@/components/ExplorerWorkspace';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { MobileWarning } from '@/components/MobileWarning';
import '@xyflow/react/dist/style.css';

export default function Home() {
  return (
    <main id="main" className="h-screen">
      <h1 className="sr-only">Investment Tech Tree</h1>
      <Suspense
        fallback={
          <div className="h-full bg-gray-100">
            <LoadingSpinner />
          </div>
        }
      >
        <ExplorerWorkspace />
      </Suspense>
      <MobileWarning />
    </main>
  );
}
