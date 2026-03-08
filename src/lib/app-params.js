// Standalone mode — no base44 app params needed
export const appParams = {
  appId: 'pathir-demo',
  token: null,
  fromUrl: typeof window !== 'undefined' ? window.location.href : '',
  functionsVersion: 'local',
  appBaseUrl: typeof window !== 'undefined' ? window.location.origin : '',
};
