import { useEffect } from 'react';

/**
 * Custom hook to set document title dynamically.
 * Automatically appends " | Business Advisor CRM" suffix.
 */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${title} | Business Advisor CRM`;

    return () => {
      document.title = previousTitle;
    };
  }, [title]);
}
