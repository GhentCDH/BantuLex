import { createApp, createIdentityProvider } from '@kottster/server';
import schema from '../../kottster-app.json';

/* 
 * For security, consider moving the secret data to environment variables.
 * See https://kottster.app/docs/deploying#before-you-deploy
 */
export const app = createApp({
  schema,
  secretKey: 'awTEcaj3X4zcelgSCvDymxu2VdSzgcyu',
  kottsterApiToken: 'u0w3Xc6fXkesZn1J7GmoOxesrijGLCnU',

  /*
   * The identity provider configuration.
   * See https://kottster.app/docs/app-configuration/identity-provider
   */
  identityProvider: createIdentityProvider('sqlite', {
    fileName: process.env.DATABASE_PATH ?? 'app.db',

    passwordHashAlgorithm: 'bcrypt',
    jwtSecretSalt: 'SoN8tUO_PsUVTIyC',
    
    /* The root admin user credentials */
    rootUsername: 'admin',
    rootPassword: 'admin',
  }),
});