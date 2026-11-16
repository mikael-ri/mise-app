import { API_PREFIX, DeviceSessionList, MeResponse } from '@mise/contracts';
import type { DeviceSession } from '@mise/contracts';
import type { ApiClient } from './api-client.js';

export interface AuthApi {
  me(): Promise<MeResponse>;
  logout(): Promise<void>;
  listDevices(): Promise<DeviceSession[]>;
  revokeDevice(sessionId: string): Promise<void>;
}

export function createAuthApi(client: ApiClient): AuthApi {
  return {
    me: () => client.request({ path: `${API_PREFIX}/auth/me`, schema: MeResponse }),
    async logout() {
      await client.request({ method: 'POST', path: `${API_PREFIX}/auth/logout` });
    },
    async listDevices() {
      const list = await client.request({
        path: `${API_PREFIX}/auth/devices`,
        schema: DeviceSessionList,
      });
      return list.items;
    },
    async revokeDevice(sessionId) {
      await client.request({
        method: 'DELETE',
        path: `${API_PREFIX}/auth/devices/${encodeURIComponent(sessionId)}`,
      });
    },
  };
}
