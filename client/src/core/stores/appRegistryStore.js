import { get, writable } from 'svelte/store';
import { apiFetch, getErrorCode, getUserFacingMessage } from '../../utils/api.js';

const INITIAL_STATE = {
  apps: [],
  loading: false,
  error: null,
  loaded: false
};

export const appRegistryState = writable(INITIAL_STATE);

let inFlightRequest = null;

function describeReceivedType(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function toRegistryError(err, fallbackCode = 'WEBOS_APP_REGISTRY_LOAD_FAILED') {
  return {
    code: getErrorCode(err, fallbackCode),
    message: getUserFacingMessage(err, 'Failed to load desktop app registry.'),
    status: err?.status,
    details: err?.details,
    validation: err?.validation
  };
}

function createInvalidRegistryError(data) {
  const err = new Error('App registry returned an invalid response.');
  err.code = 'WEBOS_APP_REGISTRY_INVALID';
  err.details = { receivedType: describeReceivedType(data) };
  return err;
}

export async function loadAppRegistry({ force = false } = {}) {
  const current = get(appRegistryState);
  if (!force && current.loaded) {
    return current.apps;
  }
  if (!force && inFlightRequest) {
    return inFlightRequest;
  }

  appRegistryState.update((state) => ({
    ...state,
    loading: true,
    error: null
  }));

  const request = apiFetch('/api/system/apps')
    .then((data) => {
      if (!Array.isArray(data)) {
        throw createInvalidRegistryError(data);
      }
      appRegistryState.set({
        apps: data,
        loading: false,
        error: null,
        loaded: true
      });
      return data;
    })
    .catch((err) => {
      appRegistryState.update((state) => ({
        ...state,
        loading: false,
        error: toRegistryError(err)
      }));
      throw err;
    })
    .finally(() => {
      if (inFlightRequest === request) {
        inFlightRequest = null;
      }
    });

  inFlightRequest = request;
  return request;
}
