import { useMutation, useQueryClient } from '@tanstack/react-query';
import { endSession } from '../../lib/session.js';
import { useAuthApi } from './use-session.js';

/** Sign out of this device, then show /signin with the signed_out message. */
export function useSignOut() {
  const api = useAuthApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.logout(),
    onSuccess: () => endSession(queryClient, 'signed_out'),
  });
}
