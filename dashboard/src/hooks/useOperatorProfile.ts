import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { operatorApi } from '../services/api';
import { syncUsername } from '../utils/operatorSettings';

export const operatorMeKey = ['operator', 'me'] as const;

/**
 * The signed-in key's operator name, from the server. The copy the reply prefix reads is kept in step with
 * it, so a name changed by an administrator, or on another computer, reaches the next reply.
 */
export function useOperatorProfile() {
  const query = useQuery({
    queryKey: operatorMeKey,
    queryFn: operatorApi.me,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
  const name = query.data?.name;
  useEffect(() => {
    if (query.data) syncUsername(name ?? null);
  }, [query.data, name]);
  return query;
}
