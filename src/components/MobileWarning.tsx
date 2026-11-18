'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Monitor, Smartphone } from 'lucide-react';

export const MOBILE_WARNING_DISMISSED_EVENT = 'tt:mobile-warning-dismissed';

/** True while the mobile overlay is (or is about to be) shown. */
export function isMobileWarningPending(): boolean {
  try {
    return (
      window.innerWidth < 768 &&
      sessionStorage.getItem('mobileWarningDismissed') !== 'true'
    );
  } catch {
    return false;
  }
}

export const MobileWarning = () => {
  const [isMobile, setIsMobile] = useState(false);
  const [isDismissed, setIsDismissed] = useState(true);

  useEffect(() => {
    // This effect runs only on the client-side
    const checkDismissed = sessionStorage.getItem('mobileWarningDismissed') === 'true';
    setIsDismissed(checkDismissed);

    const handleResize = () => {
      setIsMobile(window.innerWidth < 768); // 768px is the md breakpoint
    };

    handleResize(); // Check on initial load
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const handleDismiss = () => {
    sessionStorage.setItem('mobileWarningDismissed', 'true');
    setIsDismissed(true);
    window.dispatchEvent(new Event(MOBILE_WARNING_DISMISSED_EVENT));
  };

  if (!isMobile || isDismissed) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75 p-4">
      <Card className="w-full max-w-sm text-center">
        <CardHeader>
          <CardTitle className="flex items-center justify-center gap-2">
            <Monitor className="h-6 w-6" />
            Desktop Recommended
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-gray-600">
            This application is best viewed on a desktop or tablet. The mobile experience is not yet optimized.
          </p>
          <Button onClick={handleDismiss} className="w-full">
            Proceed Anyway
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};